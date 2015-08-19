#include "libbitcoind.cc"
#include "/test_libbitcoin.h"
#include <boost/test/unit_test.hpp>

//should return a block when a block hash is passed in
//should emit a ready event
//should get info
//should tell us if an outpoint is spent 
//
//NODE_SET_METHOD(target, "start", StartBitcoind);
//NODE_SET_METHOD(target, "onBlocksReady", OnBlocksReady);
//NODE_SET_METHOD(target, "onTipUpdate", OnTipUpdate);
//NODE_SET_METHOD(target, "stop", StopBitcoind);
//NODE_SET_METHOD(target, "stopping", IsStopping);
//NODE_SET_METHOD(target, "stopped", IsStopped);
//NODE_SET_METHOD(target, "getBlock", GetBlock);
//NODE_SET_METHOD(target, "getTransaction", GetTransaction);
//NODE_SET_METHOD(target, "getTransactionWithBlockInfo", GetTransactionWithBlockInfo);
//NODE_SET_METHOD(target, "getInfo", GetInfo);
//NODE_SET_METHOD(target, "isSpent", IsSpent);
//NODE_SET_METHOD(target, "getBlockIndex", GetBlockIndex);
//NODE_SET_METHOD(target, "getMempoolOutputs", GetMempoolOutputs);
//NODE_SET_METHOD(target, "addMempoolUncheckedTransaction", AddMempoolUncheckedTransaction);
//NODE_SET_METHOD(target, "sendTransaction", SendTransaction);
//NODE_SET_METHOD(target, "estimateFee", EstimateFee);
//NODE_SET_METHOD(target, "startTxMon", StartTxMon);
//NODE_SET_METHOD(target, "syncPercentage", SyncPercentage);
//NODE_SET_METHOD(target, "isSynced", IsSynced);

