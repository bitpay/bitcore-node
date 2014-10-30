#include "config/bitcoin-config.h"

#include "addrman.h"
#include "alert.h"
#include "allocators.h"
#include "amount.h"
#include "base58.h"
#include "bloom.h"
#include "bitcoind.h"
#include "chain.h"
#include "chainparams.h"
#include "chainparamsbase.h"
#include "checkpoints.h"
#include "checkqueue.h"
#include "clientversion.h"
#include "coincontrol.h"
#include "coins.h"
#include "compat.h"
#include "core.h"
#include "core_io.h"
#include "crypter.h"
#include "db.h"
#include "hash.h"
#include "init.h"
#include "key.h"
#include "keystore.h"
#include "leveldbwrapper.h"
#include "limitedmap.h"
#include "main.h"
#include "miner.h"
#include "mruset.h"
#include "netbase.h"
#include "net.h"
#include "noui.h"
#include "pow.h"
#include "protocol.h"
#include "random.h"
#include "rpcclient.h"
#include "rpcprotocol.h"
#include "rpcserver.h"
#include "rpcwallet.h"
#include "script/compressor.h"
#include "script/interpreter.h"
#include "script/script.h"
#include "script/sigcache.h"
#include "script/sign.h"
#include "script/standard.h"
#include "serialize.h"
#include "sync.h"
#include "threadsafety.h"
#include "timedata.h"
#include "tinyformat.h"
#include "txdb.h"
#include "txmempool.h"
#include "ui_interface.h"
#include "uint256.h"
#include "util.h"
#include "utilstrencodings.h"
#include "utilmoneystr.h"
#include "utiltime.h"
#include "version.h"
#include "wallet.h"
#include "wallet_ismine.h"
#include "walletdb.h"
#include "compat/sanity.h"

#include "json/json_spirit.h"
#include "json/json_spirit_error_position.h"
#include "json/json_spirit_reader.h"
#include "json/json_spirit_reader_template.h"
#include "json/json_spirit_stream_reader.h"
#include "json/json_spirit_utils.h"
#include "json/json_spirit_value.h"
#include "json/json_spirit_writer.h"
#include "json/json_spirit_writer_template.h"

#include "crypto/common.h"
#include "crypto/sha2.h"
#include "crypto/sha1.h"
#include "crypto/ripemd160.h"

#include "univalue/univalue_escapes.h"
#include "univalue/univalue.h"

#include <stdint.h>
#include <signal.h>
#include <stdio.h>

#include <boost/algorithm/string/predicate.hpp>
#include <boost/filesystem.hpp>
#include <boost/interprocess/sync/file_lock.hpp>
#include <openssl/crypto.h>

using namespace std;
using namespace boost;

extern void DetectShutdownThread(boost::thread_group*);
extern int nScriptCheckThreads;
extern bool fDaemon;
extern std::map<std::string, std::string> mapArgs;
extern std::string strWalletFile;
extern CWallet *pwalletMain;
extern int64_t nTransactionFee;
extern const std::string strMessageMagic;

#include <string>

#include <string.h>
#include <stdlib.h>
#include <unistd.h>

#include <sys/types.h>
#include <sys/stat.h>
#include <sys/ioctl.h>
#include <fcntl.h>

int
main(int argc, char **argv) {
  boost::thread_group threadGroup;
  boost::thread *detectShutdownThread = NULL;

  const int argc_ = 0;
  const char *argv_[argc_ + 1] = { NULL };
  ParseParameters(argc_, argv_);
  ReadConfigFile(mapArgs, mapMultiArgs);
  if (!SelectParamsFromCommandLine()) {
    return 1;
  }

  detectShutdownThread = new boost::thread(
    boost::bind(&DetectShutdownThread, &threadGroup));

  int fRet = AppInit2(threadGroup);

  if (!fRet) {
    if (detectShutdownThread)
      detectShutdownThread->interrupt();
    threadGroup.interrupt_all();
  }

  if (detectShutdownThread) {
    detectShutdownThread->join();
    delete detectShutdownThread;
    detectShutdownThread = NULL;
  }
  Shutdown();

  return 0;
}
