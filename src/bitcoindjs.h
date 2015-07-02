/**
 * bitcoind.js
 * Copyright (c) 2015, BitPay (MIT License)
 *
 * bitcoindjs.h:
 *   A bitcoind node.js binding header file.
 */

#include "nan.h"
#include "addrman.h"
#include "alert.h"
#include "base58.h"
#include "init.h"
#include "noui.h"
#include "rpcserver.h"
#include "txdb.h"
#include <boost/thread.hpp>
#include <boost/filesystem.hpp>

NAN_METHOD(StartBitcoind);
NAN_METHOD(IsStopping);
NAN_METHOD(IsStopped);
NAN_METHOD(StopBitcoind);
NAN_METHOD(GetBlock);
NAN_METHOD(GetTransaction);
NAN_METHOD(BroadcastTx);
NAN_METHOD(VerifyBlock);
NAN_METHOD(VerifyTransaction);
NAN_METHOD(GetInfo);
NAN_METHOD(GetPeerInfo);
NAN_METHOD(GetAddresses);
NAN_METHOD(GetProgress);
NAN_METHOD(GetMiningInfo);
NAN_METHOD(GetAddrTransactions);
NAN_METHOD(GetBestBlock);
NAN_METHOD(GetChainHeight);
NAN_METHOD(GetBlockByTx);
NAN_METHOD(GetBlocksByTime);
NAN_METHOD(GetFromTx);
NAN_METHOD(GetLastFileIndex);
NAN_METHOD(GetBlockHex);
NAN_METHOD(GetTxHex);
NAN_METHOD(BlockFromHex);
NAN_METHOD(TxFromHex);
NAN_METHOD(HookPackets);


