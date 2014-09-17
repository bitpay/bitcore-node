/**
 * bitcoind.js
 * Copyright (c) 2014, BitPay (MIT License)
 *
 * bitcoindjs.cc:
 *   A bitcoind node.js binding.
 */

#include "nan.h"

#include "bitcoindjs.h"

/**
 * Bitcoin headers
 */

#if defined(HAVE_CONFIG_H)
#include "bitcoin-config.h"
#endif

#include "core.h"
#include "addrman.h"
#include "checkpoints.h"
#include "crypter.h"
#include "main.h"
// #include "random.h"
// #include "timedata.h"

#ifdef ENABLE_WALLET
#include "db.h"
#include "wallet.h"
#include "walletdb.h"
#endif

// #include "walletdb.h"
#include "alert.h"
#include "checkqueue.h"
// #include "db.h"
#include "miner.h"
#include "rpcclient.h"
#include "tinyformat.h"
// #include "wallet.h"
#include "allocators.h"
#include "clientversion.h"
#include "hash.h"
#include "mruset.h"
#include "rpcprotocol.h"
#include "txdb.h"
#include "base58.h"
#include "coincontrol.h"
#include "init.h"
#include "netbase.h"
#include "rpcserver.h"
#include "txmempool.h"
#include "bloom.h"
#include "coins.h"
#include "key.h"
#include "net.h"
#include "script.h"
#include "ui_interface.h"
// #include "chainparamsbase.h"
#include "compat.h"
#include "keystore.h"
#include "noui.h"
#include "serialize.h"
#include "uint256.h"
#include "chainparams.h"
#include "core.h"
#include "leveldbwrapper.h"
// #include "pow.h"
#include "sync.h"
#include "util.h"
// #include "chainparamsseeds.h"
// #include "core_io.h"
#include "limitedmap.h"
#include "protocol.h"
#include "threadsafety.h"
#include "version.h"

/**
 * Bitcoin Globals
 * Relevant:
 *  ~/bitcoin/src/init.cpp
 *  ~/bitcoin/src/bitcoind.cpp
 *  ~/bitcoin/src/main.h
 */

#include <stdint.h>
#include <signal.h>

#include <boost/algorithm/string/predicate.hpp>
#include <boost/filesystem.hpp>
#include <boost/interprocess/sync/file_lock.hpp>
#include <openssl/crypto.h>

#define MIN_CORE_FILEDESCRIPTORS 150

extern volatile bool fRequestShutdown;

using namespace std;
using namespace boost;

extern void ThreadImport(std::vector<boost::filesystem::path>);
extern void DetectShutdownThread(boost::thread_group*);
extern void StartNode(boost::thread_group&);
extern void ThreadScriptCheck();
extern void StartShutdown();
extern bool AppInit2(boost::thread_group&);
extern bool AppInit(int, char**);
extern bool SoftSetBoolArg(const std::string&, bool);
extern void PrintExceptionContinue(std::exception*, const char*);
extern void Shutdown();
extern void noui_connect();
extern int nScriptCheckThreads;
extern bool fDaemon;
extern std::map<std::string, std::string> mapArgs;
#ifdef ENABLE_WALLET
extern std::string strWalletFile;
extern CWallet *pwalletMain;
#endif

#include <node.h>
#include <string>

#include <string.h>
#include <stdlib.h>
#include <unistd.h>

#include <sys/types.h>
#include <sys/stat.h>
#include <sys/ioctl.h>
#include <fcntl.h>

using namespace node;
using namespace v8;

NAN_METHOD(StartBitcoind);

static void
async_start_node_work(uv_work_t *req);

static void
async_start_node_after(uv_work_t *req);

static void
async_stop_node_work(uv_work_t *req);

static void
async_stop_node_after(uv_work_t *req);

static int
start_node(void);

static void
open_pipes(int **out_pipe, int **log_pipe);

static void
parse_logs(int **out_pipe, int **log_pipe);

static void
async_parse_logs(uv_work_t *req);

static void
async_parse_logs_after(uv_work_t *req);

extern "C" void
init(Handle<Object>);

/**
 * async_node_data
 * Where the uv async request data resides.
 */

struct async_node_data {
  char *err_msg;
  char *result;
  Persistent<Function> callback;
};

/**
 * async_log_data
 * Where the uv async request data resides.
 */

struct async_log_data {
  int **out_pipe;
  int **log_pipe;
  char *err_msg;
  char *result;
  Persistent<Function> callback;
};

/**
 * StartBitcoind
 * bitcoind.start(callback)
 */

NAN_METHOD(StartBitcoind) {
  NanScope();

  if (args.Length() < 1 || !args[0]->IsFunction()) {
    return NanThrowError(
        "Usage: bitcoind.start(callback)");
  }

  Local<Function> callback = Local<Function>::Cast(args[0]);

  //
  // Setup pipes to differentiate our logs from bitcoind's.
  // Run in a separate thread.
  //

  int *out_pipe = (int *)malloc(2 * sizeof(int));
  int *log_pipe = (int *)malloc(2 * sizeof(int));

  open_pipes(&out_pipe, &log_pipe);

#ifdef OUTPUT_REDIR
  uv_work_t *req_parse_logs = new uv_work_t();
  async_log_data* data_parse_logs = new async_log_data();
  data_parse_logs->out_pipe = &out_pipe;
  data_parse_logs->log_pipe = &log_pipe;
  data_parse_logs->err_msg = NULL;
  data_parse_logs->result = NULL;
  data_parse_logs->callback = Persistent<Function>::New(callback);
  req_parse_logs->data = data_parse_logs;
  int status_parse_logs = uv_queue_work(uv_default_loop(),
    req_parse_logs, async_parse_logs,
    (uv_after_work_cb)async_parse_logs_after);
  assert(status_parse_logs == 0);
#endif

  //
  // Run bitcoind's StartNode() on a separate thread.
  //

  async_node_data* data_start_node = new async_node_data();
  data_start_node->err_msg = NULL;
  data_start_node->result = NULL;
  data_start_node->callback = Persistent<Function>::New(callback);

  uv_work_t *req_start_node = new uv_work_t();
  req_start_node->data = data_start_node;

  int status_start_node = uv_queue_work(uv_default_loop(),
    req_start_node, async_start_node_work,
    (uv_after_work_cb)async_start_node_after);

  assert(status_start_node == 0);

  NanReturnValue(NanNew<Number>(log_pipe[1]));
}

/**
 * async_start_node_work()
 * Call start_node() and start all our boost threads.
 */

static void
async_start_node_work(uv_work_t *req) {
  async_node_data* node_data = static_cast<async_node_data*>(req->data);
  start_node();
  node_data->result = (char *)strdup("start_node(): bitcoind opened.");
}

/**
 * async_start_node_after()
 * Execute our callback.
 */

static void
async_start_node_after(uv_work_t *req) {
  NanScope();
  async_node_data* node_data = static_cast<async_node_data*>(req->data);

  if (node_data->err_msg != NULL) {
    Local<Value> err = Exception::Error(String::New(node_data->err_msg));
    free(node_data->err_msg);
    const unsigned argc = 1;
    Local<Value> argv[argc] = { err };
    TryCatch try_catch;
    node_data->callback->Call(Context::GetCurrent()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  } else {
    const unsigned argc = 2;
    Local<Value> argv[argc] = {
      Local<Value>::New(Null()),
      Local<Value>::New(String::New(node_data->result))
    };
    TryCatch try_catch;
    node_data->callback->Call(Context::GetCurrent()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  }

  // node_data->callback.Dispose();

  if (node_data->result != NULL) {
    free(node_data->result);
  }

  delete node_data;
  delete req;
}

/**
 * start_node(void)
 * A reimplementation of AppInit2 minus
 * the logging and argument parsing.
 */

static int
start_node(void) {
  //
  // main:
  //

  // Connect bitcoind signal handlers
  noui_connect();

  //
  // appnit1:
  //

  boost::thread_group threadGroup;
  boost::thread* detectShutdownThread = NULL;

  ParseParameters(argc, argv);
  ReadConfigFile(mapArgs, mapMultiArgs);
  // Check for -testnet or -regtest parameter (TestNet() calls are only valid after this clause)
  if (!SelectParamsFromCommandLine()) {
    return 1;
  }
  CreatePidFile(GetPidFile(), pid);
  detectShutdownThread = new boost::thread(boost::bind(&DetectShutdownThread, &threadGroup));

  //
  // appnit2:
  //

  // ********************************************************* Step 1: setup
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

  if (mapArgs.count("-bind")) {
    // when specifying an explicit binding address, you want to listen on it
    // even when -connect or -proxy is specified
    SoftSetBoolArg("-listen", true);
  }

  if (mapArgs.count("-connect") && mapMultiArgs["-connect"].size() > 0) {
    // when only connecting to trusted nodes, do not seed via DNS, or listen by default
    SoftSetBoolArg("-dnsseed", false);
    SoftSetBoolArg("-listen", false);
  }

  if (mapArgs.count("-proxy")) {
    // to protect privacy, do not listen by default if a default proxy server is specified
    SoftSetBoolArg("-listen", false);
  }

  if (!GetBoolArg("-listen", true)) {
    // do not map ports or try to retrieve public IP when not listening (pointless)
    SoftSetBoolArg("-upnp", false);
    SoftSetBoolArg("-discover", false);
  }

  if (mapArgs.count("-externalip")) {
    // if an explicit public IP is specified, do not try to find others
    SoftSetBoolArg("-discover", false);
  }

  if (GetBoolArg("-salvagewallet", false)) {
    // Rewrite just private keys: rescan to find transactions
    SoftSetBoolArg("-rescan", true);
  }

  // -zapwallettx implies a rescan
  if (GetBoolArg("-zapwallettxes", false)) {
    SoftSetBoolArg("-rescan", true);
  }

  // Make sure enough file descriptors are available
  int nBind = std::max((int)mapArgs.count("-bind"), 1);
  nMaxConnections = GetArg("-maxconnections", 125);
  nMaxConnections = std::max(std::min(nMaxConnections, (int)(FD_SETSIZE - nBind - MIN_CORE_FILEDESCRIPTORS)), 0);
  int nFD = RaiseFileDescriptorLimit(nMaxConnections + MIN_CORE_FILEDESCRIPTORS);
  if (nFD < MIN_CORE_FILEDESCRIPTORS) {
    return 1;
  }
  if (nFD - MIN_CORE_FILEDESCRIPTORS < nMaxConnections) {
    nMaxConnections = nFD - MIN_CORE_FILEDESCRIPTORS;
  }

  // ********************************************************* Step 3: parameter-to-internal-flags

  fDebug = !mapMultiArgs["-debug"].empty();
  // Special-case: if -debug=0/-nodebug is set, turn off debugging messages
  const vector<string>& categories = mapMultiArgs["-debug"];
  if (GetBoolArg("-nodebug", false)
      || find(categories.begin(), categories.end(), string("0")) != categories.end()) {
    fDebug = false;
  }

  // Check for -debugnet (deprecated)
  GetBoolArg("-debugnet", false);

  fBenchmark = GetBoolArg("-benchmark", false);
  mempool.setSanityCheck(GetBoolArg("-checkmempool", RegTest()));
  Checkpoints::fEnabled = GetBoolArg("-checkpoints", true);

  // -par=0 means autodetect, but nScriptCheckThreads==0 means no concurrency
  nScriptCheckThreads = GetArg("-par", 0);
  if (nScriptCheckThreads <= 0) {
    nScriptCheckThreads += boost::thread::hardware_concurrency();
  }
  if (nScriptCheckThreads <= 1) {
    nScriptCheckThreads = 0;
  } else if (nScriptCheckThreads > MAX_SCRIPTCHECK_THREADS) {
    nScriptCheckThreads = MAX_SCRIPTCHECK_THREADS;
  }

  fServer = GetBoolArg("-server", false);
  fPrintToConsole = GetBoolArg("-printtoconsole", false);
  fLogTimestamps = GetBoolArg("-logtimestamps", true);
#ifdef ENABLE_WALLET
  bool fDisableWallet = GetBoolArg("-disablewallet", false);
#endif

  if (mapArgs.count("-timeout")) {
    int nNewTimeout = GetArg("-timeout", 5000);
    if (nNewTimeout > 0 && nNewTimeout < 600000) {
      nConnectTimeout = nNewTimeout;
    }
  }

  // Continue to put "/P2SH/" in the coinbase to monitor
  // BIP16 support.
  // This can be removed eventually...
  const char* pszP2SH = "/P2SH/";
  COINBASE_FLAGS << std::vector<unsigned char>(pszP2SH, pszP2SH+strlen(pszP2SH));

  // Fee-per-kilobyte amount considered the same as "free"
  // If you are mining, be careful setting this:
  // if you set it to zero then
  // a transaction spammer can cheaply fill blocks using
  // 1-satoshi-fee transactions. It should be set above the real
  // cost to you of processing a transaction.
  if (mapArgs.count("-mintxfee")) {
    int64_t n = 0;
    if (ParseMoney(mapArgs["-mintxfee"], n) && n > 0) {
      CTransaction::nMinTxFee = n;
    } else {
      return 1;
    }
  }
  if (mapArgs.count("-minrelaytxfee")) {
    int64_t n = 0;
    if (ParseMoney(mapArgs["-minrelaytxfee"], n) && n > 0) {
      CTransaction::nMinRelayTxFee = n;
    } else {
      return 1;
    }
  }

#ifdef ENABLE_WALLET
  if (mapArgs.count("-paytxfee")) {
    if (!ParseMoney(mapArgs["-paytxfee"], nTransactionFee)) {
      return 1;
    }
  }
  bSpendZeroConfChange = GetArg("-spendzeroconfchange", true);

  strWalletFile = GetArg("-wallet", "wallet.dat");
#endif
  // ********************************************************* Step 4: application initialization: dir lock, daemonize, pidfile, debug log

  std::string strDataDir = GetDataDir().string();
#ifdef ENABLE_WALLET
  // Wallet file must be a plain filename without a directory
  if (strWalletFile != boost::filesystem::basename(strWalletFile)
      + boost::filesystem::extension(strWalletFile)) {
    return 1;
  }
#endif
  // Make sure only a single Bitcoin process is using the data directory.
  boost::filesystem::path pathLockFile = GetDataDir() / ".lock";
  FILE* file = fopen(pathLockFile.string().c_str(), "a"); // empty lock file; created if it doesn't exist.
  if (file) fclose(file);
  static boost::interprocess::file_lock lock(pathLockFile.string().c_str());
  if (!lock.try_lock()) {
    return 1;
  }

  if (GetBoolArg("-shrinkdebugfile", !fDebug)) {
    ShrinkDebugFile();
  }
  int failure = 0;

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
      } catch (boost::filesystem::filesystem_error &error) {
         ; // failure is ok (well, not really, but it's not worse than what we started with)
      }

      // try again
      if (!bitdb.Open(GetDataDir())) {
        // if it still fails, it probably means we can't even create the database env
        // Error initializing wallet database environment
        return 1;
      }
    }

    if (GetBoolArg("-salvagewallet", false)) {
      // Recover readable keypairs:
      if (!CWalletDB::Recover(bitdb, strWalletFile, true)) {
        return 1;
      }
    }

    if (filesystem::exists(GetDataDir() / strWalletFile)) {
      CDBEnv::VerifyResult r = bitdb.Verify(strWalletFile, CWalletDB::Recover);
      if (r == CDBEnv::RECOVER_OK) {
        ; // wallet salvaged
      }
      if (r == CDBEnv::RECOVER_FAIL) {
        return 1;
      }
    }
  } // (!fDisableWallet)
#endif // ENABLE_WALLET
  // ********************************************************* Step 6: network initialization

  RegisterNodeSignals(GetNodeSignals());

  int nSocksVersion = GetArg("-socks", 5);
  if (nSocksVersion != 4 && nSocksVersion != 5) {
    return 1;
  }

  if (mapArgs.count("-onlynet")) {
    std::set<enum Network> nets;
    BOOST_FOREACH(std::string snet, mapMultiArgs["-onlynet"]) {
      enum Network net = ParseNetwork(snet);
      if (net == NET_UNROUTABLE) {
        return 1;
      }
      nets.insert(net);
    }
    for (int n = 0; n < NET_MAX; n++) {
      enum Network net = (enum Network)n;
      if (!nets.count(net)) {
        SetLimited(net);
      }
    }
  }
#if defined(USE_IPV6)
#if ! USE_IPV6
  else
    SetLimited(NET_IPV6);
#endif
#endif

  CService addrProxy;
  bool fProxy = false;
  if (mapArgs.count("-proxy")) {
    addrProxy = CService(mapArgs["-proxy"], 9050);
    if (!addrProxy.IsValid()) {
      return 1;
    }

    if (!IsLimited(NET_IPV4)) {
      SetProxy(NET_IPV4, addrProxy, nSocksVersion);
    }

    if (nSocksVersion > 4) {
#ifdef USE_IPV6
      if (!IsLimited(NET_IPV6)) {
        SetProxy(NET_IPV6, addrProxy, nSocksVersion);
      }
#endif
      SetNameProxy(addrProxy, nSocksVersion);
    }
    fProxy = true;
  }

  // -onion can override normal proxy, -noonion disables tor entirely
  if (!(mapArgs.count("-onion")
      && mapArgs["-onion"] == "0")
      && !(mapArgs.count("-tor")
      && mapArgs["-tor"] == "0")
      && (fProxy || mapArgs.count("-onion") || mapArgs.count("-tor"))) {
    CService addrOnion;
    if (!mapArgs.count("-onion") && !mapArgs.count("-tor")) {
      addrOnion = addrProxy;
    } else {
      addrOnion = mapArgs.count("-onion")?CService(mapArgs["-onion"], 9050):CService(mapArgs["-tor"], 9050);
    }
    if (!addrOnion.IsValid()) {
      return 1;
    }
    SetProxy(NET_TOR, addrOnion, 5);
    SetReachable(NET_TOR);
  }

  // see Step 2: parameter interactions for more information about these
  fNoListen = !GetBoolArg("-listen", true);
  fDiscover = GetBoolArg("-discover", true);
  fNameLookup = GetBoolArg("-dns", true);

  bool fBound = false;
  if (!fNoListen) {
    if (mapArgs.count("-bind")) {
      BOOST_FOREACH(std::string strBind, mapMultiArgs["-bind"]) {
        CService addrBind;
        if (!Lookup(strBind.c_str(), addrBind, GetListenPort(), false))
          return 1;
        fBound |= Bind(addrBind, (BF_EXPLICIT | BF_REPORT_ERROR));
      }
    } else {
      struct in_addr inaddr_any;
      inaddr_any.s_addr = INADDR_ANY;
#ifdef USE_IPV6
      fBound |= Bind(CService(in6addr_any, GetListenPort()), BF_NONE);
#endif
      fBound |= Bind(CService(inaddr_any, GetListenPort()), !fBound ? BF_REPORT_ERROR : BF_NONE);
    }
    if (!fBound) {
      return 1;
    }
  }

  if (mapArgs.count("-externalip")) {
    BOOST_FOREACH(string strAddr, mapMultiArgs["-externalip"]) {
      CService addrLocal(strAddr, GetListenPort(), fNameLookup);
      if (!addrLocal.IsValid())
        return 1;
      AddLocal(CService(strAddr, GetListenPort(), fNameLookup), LOCAL_MANUAL);
    }
  }

  BOOST_FOREACH(string strDest, mapMultiArgs["-seednode"]) {
    AddOneShot(strDest);
  }

  // ********************************************************* Step 7: load block chain

  fReindex = GetBoolArg("-reindex", false);

  // Upgrading to 0.8; hard-link the old blknnnn.dat files into /blocks/
  filesystem::path blocksDir = GetDataDir() / "blocks";
  if (!filesystem::exists(blocksDir)) {
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
  size_t nTotalCache = (GetArg("-dbcache", nDefaultDbCache) << 20);
  if (nTotalCache < (nMinDbCache << 20)) {
    nTotalCache = (nMinDbCache << 20); // total cache cannot be less than nMinDbCache
  } else if (nTotalCache > (nMaxDbCache << 20)) {
    nTotalCache = (nMaxDbCache << 20); // total cache cannot be greater than nMaxDbCache
  }
  size_t nBlockTreeDBCache = nTotalCache / 8;
  if (nBlockTreeDBCache > (1 << 21) && !GetBoolArg("-txindex", false)) {
    nBlockTreeDBCache = (1 << 21); // block tree db cache shouldn't be larger than 2 MiB
  }
  nTotalCache -= nBlockTreeDBCache;
  size_t nCoinDBCache = nTotalCache / 2; // use half of the remaining cache for coindb cache
  nTotalCache -= nCoinDBCache;
  nCoinCacheSize = nTotalCache / 300; // coins in memory require around 300 bytes

  bool fLoaded = false;
  while (!fLoaded) {
    bool fReset = fReindex;

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
          // Error loading block database
          break;
        }

        // If the loaded chain has a wrong genesis, bail out immediately
        // (we're likely using a testnet datadir, or the other way around).
        if (!mapBlockIndex.empty() && chainActive.Genesis() == NULL) {
          return 1;
        }

        // Initialize the block index (no-op if non-empty database was already loaded)
        if (!InitBlockIndex()) {
          // Error initializing block database
          break;
        }

        // Check for changed -txindex state
        if (fTxIndex != GetBoolArg("-txindex", false)) {
          // You need to rebuild the database using -reindex to change -txindex
          break;
        }

        if (!VerifyDB(GetArg("-checklevel", 3), GetArg("-checkblocks", 288))) {
          // Corrupted block database detected
          break;
        }
      } catch(std::exception &e) {
        // Error opening block database
        break;
      }

      fLoaded = true;
    } while (false);

    if (!fLoaded) {
      // first suggest a reindex
      if (!fReset) {
        // automatically reindex:
        fReindex = true;
        fRequestShutdown = false;
      } else {
        return 1;
      }
    }
  }

  // As LoadBlockIndex can take several minutes, it's possible the user
  // requested to kill the GUI during the last operation. If so, exit.
  // As the program has not fully started yet, Shutdown() is possibly overkill.
  if (fRequestShutdown) {
    return 1;
  }

  // ********************************************************* Step 8: load wallet
#ifdef ENABLE_WALLET
  if (fDisableWallet) {
    pwalletMain = NULL;
  } else {
    if (GetBoolArg("-zapwallettxes", false)) {

      pwalletMain = new CWallet(strWalletFile);
      DBErrors nZapWalletRet = pwalletMain->ZapWalletTx();
      if (nZapWalletRet != DB_LOAD_OK) {
        return 1;
      }

      delete pwalletMain;
      pwalletMain = NULL;
    }

    nStart = GetTimeMillis();
    bool fFirstRun = true;
    pwalletMain = new CWallet(strWalletFile);
    DBErrors nLoadWalletRet = pwalletMain->LoadWallet(fFirstRun);
    if (nLoadWalletRet != DB_LOAD_OK) {
      if (nLoadWalletRet == DB_CORRUPT) {
        // Error loading wallet.dat: Wallet corrupted
        failure = 1;
      } else if (nLoadWalletRet == DB_NONCRITICAL_ERROR) {
        // wallet okay, txs bad
      } else if (nLoadWalletRet == DB_TOO_NEW) {
        // Error loading wallet.dat: Wallet requires newer version of Bitcoin
        failure = 1;
      } else if (nLoadWalletRet == DB_NEED_REWRITE) {
        // Wallet needed to be rewritten: restart Bitcoin to complete
        failure = 1;
        return 1;
      } else {
        // Error loading wallet.dat
        failure = 1;
      }
    }

    if (GetBoolArg("-upgradewallet", fFirstRun)) {
      int nMaxVersion = GetArg("-upgradewallet", 0);
      if (nMaxVersion == 0) { // the -upgradewallet without argument case
        nMaxVersion = CLIENT_VERSION;
        pwalletMain->SetMinVersion(FEATURE_LATEST); // permanently upgrade the wallet immediately
      } else if (nMaxVersion < pwalletMain->GetVersion()) {
        // Cannot downgrade wallet
        failure = 1;
      }
      pwalletMain->SetMaxVersion(nMaxVersion);
    }

    if (fFirstRun) {
      // Create new keyUser and set as default key
      RandAddSeedPerfmon();

      CPubKey newDefaultKey;
      if (pwalletMain->GetKeyFromPool(newDefaultKey)) {
        pwalletMain->SetDefaultKey(newDefaultKey);
        if (!pwalletMain->SetAddressBook(pwalletMain->vchDefaultKey.GetID(), "", "receive")) {
          // Cannot write default address
          failure = 1;
        }
      }

      pwalletMain->SetBestChain(chainActive.GetLocator());
    }

    RegisterWallet(pwalletMain);

    CBlockIndex *pindexRescan = chainActive.Tip();
    if (GetBoolArg("-rescan", false)) {
      pindexRescan = chainActive.Genesis();
    } else {
      CWalletDB walletdb(strWalletFile);
      CBlockLocator locator;
      if (walletdb.ReadBestBlock(locator)) {
        pindexRescan = chainActive.FindFork(locator);
      } else {
        pindexRescan = chainActive.Genesis();
      }
    }
    if (chainActive.Tip() && chainActive.Tip() != pindexRescan) {
      nStart = GetTimeMillis();
      pwalletMain->ScanForWalletTransactions(pindexRescan, true);
      pwalletMain->SetBestChain(chainActive.GetLocator());
      nWalletDBUpdated++;
    }
  } // (!fDisableWallet)
#endif // !ENABLE_WALLET
  // ********************************************************* Step 9: import blocks

  // scan for better chains in the block chain database, that are not yet connected in the active best chain
  CValidationState state;
  if (!ActivateBestChain(state)) {
    // Failed to connect best block
    failure = 1;
  }

  std::vector<boost::filesystem::path> vImportFiles;
  if (mapArgs.count("-loadblock")) {
    BOOST_FOREACH(string strFile, mapMultiArgs["-loadblock"]) {
      vImportFiles.push_back(strFile);
    }
  }
  threadGroup.create_thread(boost::bind(&ThreadImport, vImportFiles));

  // ********************************************************* Step 10: load peers

  nStart = GetTimeMillis();

  {
    CAddrDB adb;
    adb.Read(addrman);
  }

  // ********************************************************* Step 11: start node

  if (!CheckDiskSpace()) {
    return 1;
  }

  if (failure) {
    return 1;
  }

  RandAddSeedPerfmon();

  StartNode(threadGroup);

  // InitRPCMining is needed here so getwork/getblocktemplate in the GUI debug console works properly.
  InitRPCMining();
  if (fServer) {
    StartRPCThreads();
  }

#ifdef ENABLE_WALLET
  // Generate coins in the background
  if (pwalletMain) {
    GenerateBitcoins(GetBoolArg("-gen", false), pwalletMain, GetArg("-genproclimit", -1));
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

  //
  // appinit1:
  //

  int fRet = !fRequestShutdown;

  if (!fRet) {
    if (detectShutdownThread)
      detectShutdownThread->interrupt();

    threadGroup.interrupt_all();
    // threadGroup.join_all(); was left out intentionally here, because we didn't re-test all of
    // the startup-failure cases to make sure they don't result in a hang due to some
    // thread-blocking-waiting-for-another-thread-during-startup case
  }

  if (detectShutdownThread) {
    detectShutdownThread->join();
    delete detectShutdownThread;
    detectShutdownThread = NULL;
  }
  Shutdown();

  //
  // main:
  //

  if (fRet && fDaemon) {
    return 0;
  }

  return fRet ? 0 : 1;
}

/**
 * parse_logs(int **out_pipe, int **log_pipe)
 *   Differentiate our logs and bitcoind's logs.
 *   Send bitcoind's logs to a pipe instead.
 */

const char bitcoind_char[256] = {
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, /* <- ' ', */ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ':', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  'b', 'c', 'd', 0, 0, 0, 0, 'i', 0, 0, 0, 0, 'n', 'o', 0, 0, 0, 0, 't', 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0,
};

static void
open_pipes(int **out_pipe, int **log_pipe) {
  pipe(*out_pipe);
  dup2(*out_pipe[1], STDOUT_FILENO);
  dup2(*out_pipe[1], STDERR_FILENO);
  pipe(*log_pipe);
}

static void
parse_logs(int **out_pipe, int **log_pipe) {
  unsigned int rtotal = 0;
  ssize_t r = 0;
  size_t rcount = 80 * sizeof(char);
  char *buf = (char *)malloc(rcount);
  char cur[10];
  unsigned int cp = 0;
  unsigned int reallocs = 0;

  while ((r = read(*out_pipe[0], buf + rtotal, rcount))) {
    unsigned int i;
    char *rbuf;

    if (r == -1) {
      fprintf(stderr, "bitcoind: error=\"parse_logs(): bad read.\"\n");
      sleep(1);
      continue;
    }

    if (r <= 0) continue;

    // Grab the buffer at the start of the bytes that were read:
    rbuf = (char *)(buf + r);

    // If these are our logs, write them to stdout:
    for (i = 0; i < r; i++) {
      // A naive semi-boyer-moore string search (is it a bitcoind: char?):
      unsigned char ch = rbuf[i];
      if (bitcoind_char[ch]) {
        cur[cp] = rbuf[0];
        cp++;
        cur[cp] = '\0';
        if (strcmp(cur, "bitcoind:") == 0) {
          size_t wcount = r;
          ssize_t w = 0;
          ssize_t wtotal = 0;
          // undo redirection
          close(*out_pipe[0]);
          close(*out_pipe[1]);
          w = write(STDOUT_FILENO, cur, cp);
          wtotal += w;
          while ((w = write(STDOUT_FILENO, rbuf + i + wtotal, wcount))) {
            if (w == -1) {
              fprintf(stderr, "bitcoind: error=\"parse_logs(): bad write.\"\n");
              sleep(1);
              break;
            }
            if (w == 0 || (size_t)wtotal == rcount) break;
            wtotal += w;
          }
          // reopen redirection
          pipe(*out_pipe);
          dup2(*out_pipe[1], STDOUT_FILENO);
          dup2(*out_pipe[1], STDERR_FILENO);
          break;
        } else if (cp == sizeof cur - 1) {
          cp = 0;
        }
      }
    }

    // If these logs are from bitcoind, write them to the log pipe:
    for (i = 0; i < r; i++) {
      if ((rbuf[i] == '\r' && rbuf[i] == '\n')
          || rbuf[i] == '\r' || rbuf[i] == '\n') {
        size_t wcount = r;
        ssize_t w = 0;
        ssize_t wtotal = 0;
        while ((w = write(*log_pipe[1], rbuf + i + wtotal + 1, wcount))) {
          if (w == -1) {
            fprintf(stderr, "bitcoind: error=\"parse_logs(): bad write.\"\n");
            sleep(1);
            break;
          }
          if (w == 0 || (size_t)wtotal == rcount) break;
          wtotal += w;
        }
      }
    }

    rtotal += r;
    while (rtotal > rcount) {
      reallocs++;
      rcount = (rcount * 2) / reallocs;
      buf = (char *)realloc(buf, rcount);
    }
  }

  free(buf);
}

static void
async_parse_logs(uv_work_t *req) {
  async_log_data* log_data = static_cast<async_log_data*>(req->data);
  parse_logs(log_data->out_pipe, log_data->log_pipe);
  log_data->err_msg = (char *)strdup("parse_logs(): failed.");
}

static void
async_parse_logs_after(uv_work_t *req) {
  NanScope();
  async_log_data* log_data = static_cast<async_log_data*>(req->data);

  if (log_data->err_msg != NULL) {
    Local<Value> err = Exception::Error(String::New(log_data->err_msg));
    free(log_data->err_msg);
    const unsigned argc = 1;
    Local<Value> argv[argc] = { err };
    TryCatch try_catch;
    log_data->callback->Call(Context::GetCurrent()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  } else {
    assert(0 && "parse_logs(): should never happen.");
  }

  // log_data->callback.Dispose();

  delete log_data;
  delete req;
}

/**
 * StopBitcoind
 * bitcoind.stop(callback)
 */

NAN_METHOD(StopBitcoind) {
  NanScope();

  if (args.Length() < 1 || !args[0]->IsFunction()) {
    return NanThrowError(
        "Usage: bitcoind.stop(callback)");
  }

  Local<Function> callback = Local<Function>::Cast(args[0]);

  //
  // Run bitcoind's StartShutdown() on a separate thread.
  //

  async_node_data* data_stop_node = new async_node_data();
  data_stop_node->err_msg = NULL;
  data_stop_node->result = NULL;
  data_stop_node->callback = Persistent<Function>::New(callback);

  uv_work_t *req_stop_node = new uv_work_t();
  req_stop_node->data = data_stop_node;

  int status_stop_node = uv_queue_work(uv_default_loop(),
    req_stop_node, async_stop_node_work,
    (uv_after_work_cb)async_stop_node_after);

  assert(status_stop_node == 0);

  NanReturnValue(Undefined());
}

/**
 * async_stop_node_work()
 * Call StartShutdown() to join the boost threads, which will call Shutdown().
 */

static void
async_stop_node_work(uv_work_t *req) {
  async_node_data* node_data = static_cast<async_node_data*>(req->data);
  StartShutdown();
  node_data->result = (char *)strdup("stop_node(): bitcoind shutdown.");
}

/**
 * async_stop_node_after()
 * Execute our callback.
 */

static void
async_stop_node_after(uv_work_t *req) {
  NanScope();
  async_node_data* node_data = static_cast<async_node_data*>(req->data);

  if (node_data->err_msg != NULL) {
    Local<Value> err = Exception::Error(String::New(node_data->err_msg));
    free(node_data->err_msg);
    const unsigned argc = 1;
    Local<Value> argv[argc] = { err };
    TryCatch try_catch;
    node_data->callback->Call(Context::GetCurrent()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  } else {
    const unsigned argc = 2;
    Local<Value> argv[argc] = {
      Local<Value>::New(Null()),
      Local<Value>::New(String::New(node_data->result))
    };
    TryCatch try_catch;
    node_data->callback->Call(Context::GetCurrent()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  }

  node_data->callback.Dispose();

  if (node_data->result != NULL) {
    free(node_data->result);
  }

  delete node_data;
  delete req;
}

/**
 * Init
 */

extern "C" void
init(Handle<Object> target) {
  NanScope();
  NODE_SET_METHOD(target, "start", StartBitcoind);
  NODE_SET_METHOD(target, "stop", StopBitcoind);
}

NODE_MODULE(bitcoindjs, init)
