// Copyright (c) 2009-2010 Satoshi Nakamoto
// Copyright (c) 2009-2014 The Bitcoin developers
// Distributed under the MIT/X11 software license, see the accompanying
// file COPYING or http://www.opensource.org/licenses/mit-license.php.

#if defined(HAVE_CONFIG_H)
#include "config/bitcoin-config.h"
#endif

#include "init.h"

#include "addrman.h"
#include "checkpoints.h"
#include "key.h"
#include "main.h"
#include "miner.h"
#include "net.h"
#include "rpcserver.h"
#include "txdb.h"
#include "ui_interface.h"
#include "util.h"
#ifdef ENABLE_WALLET
#include "db.h"
#include "wallet.h"
#include "walletdb.h"
#endif

#include <stdint.h>
#include <stdio.h>
#include <signal.h>

#include <boost/algorithm/string/predicate.hpp>
#include <boost/filesystem.hpp>
#include <boost/interprocess/sync/file_lock.hpp>
#include <openssl/crypto.h>

using namespace boost;
using namespace std;

#ifdef ENABLE_WALLET
CWallet* pwalletMain;
#endif

#define MIN_CORE_FILEDESCRIPTORS 150

// Used to pass flags to the Bind() function
enum BindFlags {
    BF_NONE         = 0,
    BF_EXPLICIT     = (1U << 0),
    BF_REPORT_ERROR = (1U << 1),
    BF_WHITELIST    = (1U << 2),
};

static const char* FEE_ESTIMATES_FILENAME="fee_estimates.dat";
CClientUIInterface uiInterface;

#include "rpcserver.h"
#include "init.h"
#include "main.h"
#include "noui.h"
#include "ui_interface.h"
#include "util.h"

#include <boost/algorithm/string/predicate.hpp>
#include <boost/filesystem.hpp>

/** Initialize bitcoin.
 *  @pre Parameters should be parsed and config file should be read.
 */
bool AppInit2(boost::thread_group& threadGroup) {
  umask(077);

  // Clean shutdown on SIGTERM
  struct sigaction sa;
  sa.sa_handler = HandleSIGTERM;
  sigemptyset(&sa.sa_mask);
  sa.sa_flags = 0;
  sigaction(SIGTERM, &sa, NULL);
  sigaction(SIGINT, &sa, NULL);

  // Reopen debug.log on SIGHUP
  struct sigaction sa_hup;
  sa_hup.sa_handler = HandleSIGHUP;
  sigemptyset(&sa_hup.sa_mask);
  sa_hup.sa_flags = 0;
  sigaction(SIGHUP, &sa_hup, NULL);

#if defined (__SVR4) && defined (__sun)
  // ignore SIGPIPE on Solaris
  signal(SIGPIPE, SIG_IGN);
#endif

  // ********************************************************* Step 2: parameter interactions

  // Make sure enough file descriptors are available
  int nBind = 1;
  nMaxConnections = 125;
  nMaxConnections = std::max(std::min(nMaxConnections, (int)(FD_SETSIZE - nBind - MIN_CORE_FILEDESCRIPTORS)), 0);
  int nFD = RaiseFileDescriptorLimit(nMaxConnections + MIN_CORE_FILEDESCRIPTORS);
  if (nFD < MIN_CORE_FILEDESCRIPTORS) {
    return InitError(_("Not enough file descriptors available."));
  }

  if (nFD - MIN_CORE_FILEDESCRIPTORS < nMaxConnections) {
    nMaxConnections = nFD - MIN_CORE_FILEDESCRIPTORS;
  }

  // ********************************************************* Step 3: parameter-to-internal-flags

  // Checkmempool defaults to true in regtest mode
  mempool.setSanityCheck(Params().DefaultCheckMemPool());
  Checkpoints::fEnabled = true;

  // -par=0 means autodetect, but nScriptCheckThreads==0 means no concurrency
  nScriptCheckThreads = DEFAULT_SCRIPTCHECK_THREADS;
  if (nScriptCheckThreads <= 0) {
    nScriptCheckThreads += boost::thread::hardware_concurrency();
  }
  if (nScriptCheckThreads <= 1) {
    nScriptCheckThreads = 0;
  } else if (nScriptCheckThreads > MAX_SCRIPTCHECK_THREADS) {
    nScriptCheckThreads = MAX_SCRIPTCHECK_THREADS;
  }

  fServer = true;
  fPrintToConsole = false;
  fLogTimestamps = true;
  fLogIPs = false;
  setvbuf(stdout, NULL, _IOLBF, 0);
#ifdef ENABLE_WALLET
  bool fDisableWallet = false;
#endif

  // Continue to put "/P2SH/" in the coinbase to monitor
  // BIP16 support.
  // This can be removed eventually...
  const char* pszP2SH = "/P2SH/";
  COINBASE_FLAGS << std::vector<unsigned char>(pszP2SH, pszP2SH+strlen(pszP2SH));

#ifdef ENABLE_WALLET
  std::string strWalletFile = "wallet.dat";
#endif

  // *********************************************************
  // Step 4: application initialization: dir lock, daemonize, pidfile, debug log
  // Sanity check
  if (!InitSanityCheck()) {
    return InitError(_("Initialization sanity check failed. Bitcoin Core is shutting down."));
  }

  std::string strDataDir = GetDataDir().string();
#ifdef ENABLE_WALLET
  // Wallet file must be a plain filename without a directory
  if (strWalletFile != boost::filesystem::basename(strWalletFile) + boost::filesystem::extension(strWalletFile)) {
    return InitError(strprintf(_("Wallet %s resides outside data directory %s"), strWalletFile, strDataDir));
  }
#endif

  // Make sure only a single Bitcoin process is using the data directory.
  boost::filesystem::path pathLockFile = GetDataDir() / ".lock";
  FILE* file = fopen(pathLockFile.string().c_str(), "a"); // empty lock file; created if it doesn't exist.
  if (file) fclose(file);
  static boost::interprocess::file_lock lock(pathLockFile.string().c_str());
  if (!lock.try_lock()) {
    return InitError(strprintf(_(
      "Cannot obtain a lock on data directory %s. Bitcoin Core is probably already running."), strDataDir));
  }

  if (nScriptCheckThreads) {
    for (int i = 0; i < nScriptCheckThreads - 1; i++) {
      threadGroup.create_thread(&ThreadScriptCheck);
    }
  }

  int64_t nStart;

  // ********************************************************* Step 5: verify wallet database integrity
#ifdef ENABLE_WALLET
  if (!fDisableWallet) {
    if (!bitdb.Open(GetDataDir())) {
      // try moving the database env out of the way
      boost::filesystem::path pathDatabase = GetDataDir() / "database";
      boost::filesystem::path pathDatabaseBak = GetDataDir() / strprintf("database.%d.bak", GetTime());
      try {
        boost::filesystem::rename(pathDatabase, pathDatabaseBak);
      } catch(boost::filesystem::filesystem_error &error) {
         // failure is ok (well, not really, but it's not worse than what we started with)
      }

      // try again
      if (!bitdb.Open(GetDataDir())) {
        // if it still fails, it probably means we can't even create the database env
        string msg = strprintf(_("Error initializing wallet database environment %s!"), strDataDir);
        return InitError(msg);
      }
    }

    if (filesystem::exists(GetDataDir() / strWalletFile)) {
      CDBEnv::VerifyResult r = bitdb.Verify(strWalletFile, CWalletDB::Recover);
      if (r == CDBEnv::RECOVER_OK) {
        // Warning: wallet.dat corrupt, data salvaged!
        // Original wallet.dat saved as wallet.{timestamp}.bak in data dir; if
        // your balance or transactions are incorrect you should
        // restore from a backup.
      }
      if (r == CDBEnv::RECOVER_FAIL) {
        return InitError(_("wallet.dat corrupt, salvage failed"));
      }
    }
  }
#endif

  // ********************************************************* Step 6: network initialization

  RegisterNodeSignals(GetNodeSignals());

  bool fBound = false;
  if (fListen) {
    struct in_addr inaddr_any;
    inaddr_any.s_addr = INADDR_ANY;
    fBound |= Bind(CService(in6addr_any, GetListenPort()), BF_NONE);
    fBound |= Bind(CService(inaddr_any, GetListenPort()), !fBound ? BF_REPORT_ERROR : BF_NONE);
    if (!fBound) {
      return InitError(_("Failed to listen on any port."));
    }
  }

  // ********************************************************* Step 7: load block chain

  fReindex = false;

  // Upgrading to 0.8; hard-link the old blknnnn.dat files into /blocks/
  filesystem::path blocksDir = GetDataDir() / "blocks";
  if (!filesystem::exists(blocksDir))
  {
    filesystem::create_directories(blocksDir);
    bool linked = false;
    for (unsigned int i = 1; i < 10000; i++) {
      filesystem::path source = GetDataDir() / strprintf("blk%04u.dat", i);
      if (!filesystem::exists(source)) break;
      filesystem::path dest = blocksDir / strprintf("blk%05u.dat", i-1);
      try {
        filesystem::create_hard_link(source, dest);
        linked = true;
      } catch (filesystem::filesystem_error & e) {
        // Note: hardlink creation failing is not a disaster, it just means
        // blocks will get re-downloaded from peers.
        break;
      }
    }
    if (linked) {
      fReindex = true;
    }
  }

  // cache size calculations
  size_t nTotalCache = nDefaultDbCache << 20;
  if (nTotalCache < (nMinDbCache << 20)) {
    nTotalCache = (nMinDbCache << 20); // total cache cannot be less than nMinDbCache
  } else if (nTotalCache > (nMaxDbCache << 20)) {
    nTotalCache = (nMaxDbCache << 20); // total cache cannot be greater than nMaxDbCache
  }
  size_t nBlockTreeDBCache = nTotalCache / 8;
  if (nBlockTreeDBCache > (1 << 21)) {
    nBlockTreeDBCache = (1 << 21); // block tree db cache shouldn't be larger than 2 MiB
  }
  nTotalCache -= nBlockTreeDBCache;
  size_t nCoinDBCache = nTotalCache / 2; // use half of the remaining cache for coindb cache
  nTotalCache -= nCoinDBCache;
  nCoinCacheSize = nTotalCache / 300; // coins in memory require around 300 bytes

  bool fLoaded = false;
  while (!fLoaded) {
    bool fReset = fReindex;
    std::string strLoadError;

    nStart = GetTimeMillis();
    do {
      try {
        UnloadBlockIndex();
        delete pcoinsTip;
        delete pcoinsdbview;
        delete pblocktree;

        pblocktree = new CBlockTreeDB(nBlockTreeDBCache, false, fReindex);
        pcoinsdbview = new CCoinsViewDB(nCoinDBCache, false, fReindex);
        pcoinsTip = new CCoinsViewCache(*pcoinsdbview);

        if (fReindex) {
          pblocktree->WriteReindexing(true);
        }

        if (!LoadBlockIndex()) {
          strLoadError = _("Error loading block database");
          break;
        }

        // If the loaded chain has a wrong genesis, bail out immediately
        // (we're likely using a testnet datadir, or the other way around).
        if (!mapBlockIndex.empty() && chainActive.Genesis() == NULL) {
          return InitError(_("Incorrect or no genesis block found. Wrong datadir for network?"));
        }

        // Initialize the block index (no-op if non-empty database was already loaded)
        if (!InitBlockIndex()) {
          strLoadError = _("Error initializing block database");
          break;
        }

        // Check for changed -txindex state
        if (fTxIndex != false) {
          strLoadError = _("You need to rebuild the database");
          break;
        }

        if (!CVerifyDB().VerifyDB(3, 288)) {
          strLoadError = _("Corrupted block database detected");
          break;
        }
      } catch(std::exception &e) {
        strLoadError = _("Error opening block database");
        break;
      }

      fLoaded = true;
    } while(false);

    if (!fLoaded) {
      if (!fReset) {
        // reindex or return
        fReindex = true;
        fRequestShutdown = false;
        // return false;
      } else {
        return InitError(strLoadError);
      }
    }
  }

  // As LoadBlockIndex can take several minutes, it's possible the user
  // requested to kill the GUI during the last operation. If so, exit.
  // As the program has not fully started yet, Shutdown() is possibly overkill.
  if (fRequestShutdown) {
    return false;
  }

  boost::filesystem::path est_path = GetDataDir() / FEE_ESTIMATES_FILENAME;
  CAutoFile est_filein = CAutoFile(fopen(est_path.string().c_str(), "rb"), SER_DISK, CLIENT_VERSION);
  // Allowed to fail as this file IS missing on first startup.
  if (est_filein) {
    mempool.ReadFeeEstimates(est_filein);
  }

  // ********************************************************* Step 8: load wallet
#ifdef ENABLE_WALLET
  if (fDisableWallet) {
    pwalletMain = NULL;
  } else {
    // needed to restore wallet transaction meta data after -zapwallettxes
    std::vector<CWalletTx> vWtx;

    nStart = GetTimeMillis();
    bool fFirstRun = true;
    pwalletMain = new CWallet(strWalletFile);
    DBErrors nLoadWalletRet = pwalletMain->LoadWallet(fFirstRun);
    if (nLoadWalletRet != DB_LOAD_OK) {
      if (nLoadWalletRet == DB_CORRUPT) {
        strErrors << _("Error loading wallet.dat: Wallet corrupted") << "\n";
      } else if (nLoadWalletRet == DB_NONCRITICAL_ERROR) {
        // Warning: error reading wallet.dat! All keys read correctly, but transaction data
        // or address book entries might be missing or incorrect.
      } else if (nLoadWalletRet == DB_TOO_NEW) {
        strErrors << _("Error loading wallet.dat: Wallet requires newer version of Bitcoin Core") << "\n";
      } else if (nLoadWalletRet == DB_NEED_REWRITE) {
        strErrors << _("Wallet needed to be rewritten: restart Bitcoin Core to complete") << "\n";
        return InitError(strErrors.str());
      } else {
        strErrors << _("Error loading wallet.dat") << "\n";
      }
    }

    if (fFirstRun) {
      int nMaxVersion = 0;
      if (nMaxVersion == 0) {
        nMaxVersion = CLIENT_VERSION;
        pwalletMain->SetMinVersion(FEATURE_LATEST); // permanently upgrade the wallet immediately
      } else {
        if (nMaxVersion < pwalletMain->GetVersion()) {
          strErrors << _("Cannot downgrade wallet") << "\n";
        }
      }
      pwalletMain->SetMaxVersion(nMaxVersion);

      // Create new keyUser and set as default key
      RandAddSeedPerfmon();

      CPubKey newDefaultKey;
      if (pwalletMain->GetKeyFromPool(newDefaultKey)) {
        pwalletMain->SetDefaultKey(newDefaultKey);
        if (!pwalletMain->SetAddressBook(pwalletMain->vchDefaultKey.GetID(), "", "receive")) {
          strErrors << _("Cannot write default address") << "\n";
        }
      }

      pwalletMain->SetBestChain(chainActive.GetLocator());
    }

    RegisterWallet(pwalletMain);

    CBlockIndex *pindexRescan = chainActive.Tip();
    CWalletDB walletdb(strWalletFile);
    CBlockLocator locator;

    if (walletdb.ReadBestBlock(locator)) {
      pindexRescan = chainActive.FindFork(locator);
    } else {
      pindexRescan = chainActive.Genesis();
    }

    if (chainActive.Tip() && chainActive.Tip() != pindexRescan) {
      nStart = GetTimeMillis();
      pwalletMain->ScanForWalletTransactions(pindexRescan, true);
      pwalletMain->SetBestChain(chainActive.GetLocator());
      nWalletDBUpdated++;
    }
  }
#endif
  // ********************************************************* Step 9: import blocks

  // scan for better chains in the block chain database, that are not yet connected in the active best chain
  CValidationState state;
  if (!ActivateBestChain(state)) {
    strErrors << "Failed to connect best block";
  }

  std::vector<boost::filesystem::path> vImportFiles;
  threadGroup.create_thread(boost::bind(&ThreadImport, vImportFiles));

  // ********************************************************* Step 10: load peers

  nStart = GetTimeMillis();

  {
    CAddrDB adb;
    adb.Read(addrman);
  }

  // ********************************************************* Step 11: start node

  if (!CheckDiskSpace()) {
    return false;
  }

  if (!strErrors.str().empty()) {
    return InitError(strErrors.str());
  }

  RandAddSeedPerfmon();

  StartNode(threadGroup);
  if (fServer) {
    StartRPCThreads();
  }

#ifdef ENABLE_WALLET
  // Generate coins in the background
  if (pwalletMain) {
    GenerateBitcoins(false, pwalletMain, -1);
  }
#endif

  // ********************************************************* Step 12: finished

#ifdef ENABLE_WALLET
  if (pwalletMain) {
    // Add wallet transactions that aren't already in a block to mapTransactions
    pwalletMain->ReacceptWalletTransactions();

    // Run a thread to flush wallet periodically
    threadGroup.create_thread(boost::bind(&ThreadFlushWalletDB, boost::ref(pwalletMain->strWalletFile)));
  }
#endif

  return !fRequestShutdown;
}

bool AppInit(int argc, char **argv) {
  boost::thread_group threadGroup;
  boost::thread* detectShutdownThread = NULL;

  bool fRet = false;
  try {
    ParseParameters(argc, argv);
    if (!boost::filesystem::is_directory(GetDataDir(false))) {
      // Error: Specified data directory does not exist.
      return false;
    }
    try {
      ReadConfigFile(mapArgs, mapMultiArgs);
    } catch(std::exception &e) {
      // Error reading configuration file
      return false;
    }

    // Check for -testnet or -regtest parameter (Params()
    // calls are only valid after this clause)
    if (!SelectParamsFromCommandLine()) {
      // Error: Invalid combination of -regtest and -testnet.
      return false;
    }

    detectShutdownThread = new boost::thread(boost::bind(&DetectShutdownThread, &threadGroup));
    fRet = AppInit2(threadGroup);
  } catch (std::exception& e) {
    PrintExceptionContinue(&e, "AppInit()");
  } catch (...) {
    PrintExceptionContinue(NULL, "AppInit()");
  }

  if (!fRet) {
    if (detectShutdownThread) {
      detectShutdownThread->interrupt();
    }
    threadGroup.interrupt_all();
  }

  if (detectShutdownThread) {
    detectShutdownThread->join();
    delete detectShutdownThread;
    detectShutdownThread = NULL;
  }

  Shutdown();

  return fRet;
}

int startBitcoin(int argc, char **argv) {
  SetupEnvironment();
  noui_connect();
  return AppInit(argc, argv) ? 0 : 1;
}




// Copyright (c) 2009-2010 Satoshi Nakamoto
// Copyright (c) 2009-2014 The Bitcoin developers
// Distributed under the MIT/X11 software license, see the accompanying
// file COPYING or http://www.opensource.org/licenses/mit-license.php.

#if defined(HAVE_CONFIG_H)
#include "config/bitcoin-config.h"
#endif

#include "net.h"

#include "addrman.h"
#include "chainparams.h"
#include "core.h"
#include "ui_interface.h"

#ifdef WIN32
#include <string.h>
#else
#include <fcntl.h>
#endif

#ifdef USE_UPNP
#include <miniupnpc/miniupnpc.h>
#include <miniupnpc/miniwget.h>
#include <miniupnpc/upnpcommands.h>
#include <miniupnpc/upnperrors.h>
#endif

#include <boost/filesystem.hpp>

// Dump addresses to peers.dat every 15 minutes (900s)
#define DUMP_ADDRESSES_INTERVAL 900

#if !defined(HAVE_MSG_NOSIGNAL) && !defined(MSG_NOSIGNAL)
#define MSG_NOSIGNAL 0
#endif

// Fix for ancient MinGW versions, that don't have defined these in ws2tcpip.h.
// Todo: Can be removed when our pull-tester is upgraded to a modern MinGW version.
#ifdef WIN32
#ifndef PROTECTION_LEVEL_UNRESTRICTED
#define PROTECTION_LEVEL_UNRESTRICTED 10
#endif
#ifndef IPV6_PROTECTION_LEVEL
#define IPV6_PROTECTION_LEVEL 23
#endif
#endif

using namespace std;
using namespace boost;

namespace {
  const int MAX_OUTBOUND_CONNECTIONS = 8;

  struct ListenSocket {
    SOCKET socket;
    bool whitelisted;

    ListenSocket(SOCKET socket, bool whitelisted) : socket(socket), whitelisted(whitelisted) {}
  };
}

void static Discover(boost::thread_group& threadGroup) {
  if (!fDiscover) {
    return;
  }

  // Get local host ip
  struct ifaddrs* myaddrs;
  if (getifaddrs(&myaddrs) == 0) {
    for (struct ifaddrs* ifa = myaddrs; ifa != NULL; ifa = ifa->ifa_next) {
      if (ifa->ifa_addr == NULL) continue;
      if ((ifa->ifa_flags & IFF_UP) == 0) continue;
      if (strcmp(ifa->ifa_name, "lo") == 0) continue;
      if (strcmp(ifa->ifa_name, "lo0") == 0) continue;
      if (ifa->ifa_addr->sa_family == AF_INET) {
        struct sockaddr_in* s4 = (struct sockaddr_in*)(ifa->ifa_addr);
        CNetAddr addr(s4->sin_addr);
        if (AddLocal(addr, LOCAL_IF)) {
          // LogPrintf("IPv4 %s: %s\n", ifa->ifa_name, addr.ToString());
        }
      } else if (ifa->ifa_addr->sa_family == AF_INET6) {
        struct sockaddr_in6* s6 = (struct sockaddr_in6*)(ifa->ifa_addr);
        CNetAddr addr(s6->sin6_addr);
        if (AddLocal(addr, LOCAL_IF)) {
          // LogPrintf("IPv6 %s: %s\n", ifa->ifa_name, addr.ToString());
        }
      }
    }
    freeifaddrs(myaddrs);
  }

  // Don't use external IPv4 discovery, when -onlynet="IPv6"
  if (!IsLimited(NET_IPV4)) {
    threadGroup.create_thread(boost::bind(&TraceThread<void (*)()>, "ext-ip", &ThreadGetMyExternalIP));
  }
}

void StartNode(boost::thread_group& threadGroup) {
  if (semOutbound == NULL) {
    // initialize semaphore
    int nMaxOutbound = min(MAX_OUTBOUND_CONNECTIONS, nMaxConnections);
    semOutbound = new CSemaphore(nMaxOutbound);
  }

  if (pnodeLocalHost == NULL) {
    pnodeLocalHost = new CNode(INVALID_SOCKET, CAddress(CService("127.0.0.1", 0), nLocalServices));
  }

  Discover(threadGroup);

  //
  // Start threads
  //

  if (!GetBoolArg("-dnsseed", true)) {
    LogPrintf("DNS seeding disabled\n");
  } else {
    threadGroup.create_thread(boost::bind(&TraceThread<void (*)()>, "dnsseed", &ThreadDNSAddressSeed));
  }

  // Map ports with UPnP
  MapPort(GetBoolArg("-upnp", DEFAULT_UPNP));

  // Send and receive from sockets, accept connections
  threadGroup.create_thread(boost::bind(&TraceThread<void (*)()>, "net", &ThreadSocketHandler));

  // Initiate outbound connections from -addnode
  threadGroup.create_thread(boost::bind(&TraceThread<void (*)()>, "addcon", &ThreadOpenAddedConnections));

  // Initiate outbound connections
  threadGroup.create_thread(boost::bind(&TraceThread<void (*)()>, "opencon", &ThreadOpenConnections));

  // Process messages
  threadGroup.create_thread(boost::bind(&TraceThread<void (*)()>, "msghand", &ThreadMessageHandler));

  // Dump network addresses
  threadGroup.create_thread(boost::bind(&LoopForever<void (*)()>, "dumpaddr",
    &DumpAddresses, DUMP_ADDRESSES_INTERVAL * 1000));
}

bool StopNode() {
  LogPrintf("StopNode()\n");
  MapPort(false);

  if (semOutbound) {
    for (int i = 0; i < MAX_OUTBOUND_CONNECTIONS; i++) {
      semOutbound->post();
    }
  }

  MilliSleep(50);
  DumpAddresses();

  return true;
}
