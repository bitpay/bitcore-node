#include "main.h"
#include "addrman.h"
#include "alert.h"
#include "base58.h"
#include "init.h"
#include "noui.h"
#include "rpcserver.h"
#include "txdb.h"
#include <boost/thread.hpp>
#include <boost/filesystem.hpp>
#include <boost/lexical_cast.hpp>
#include "nan.h"
#include "scheduler.h"
#include "core_io.h"
#include "script/bitcoinconsensus.h"
#include "consensus/validation.h"
#ifdef ENABLE_WALLET
#include "wallet/wallet.h"
#endif

NAN_METHOD(StartBitcoind);
NAN_METHOD(OnBlocksReady);
NAN_METHOD(OnTipUpdate);
NAN_METHOD(StopBitcoind);
NAN_METHOD(GetBlock);
NAN_METHOD(GetBlockIndex);
NAN_METHOD(IsMainChain);
NAN_METHOD(GetTransaction);
NAN_METHOD(GetInfo);
NAN_METHOD(IsSpent);
NAN_METHOD(GetBlockIndex);
NAN_METHOD(GetMempoolOutputs);
NAN_METHOD(AddMempoolUncheckedTransaction);
NAN_METHOD(SendTransaction);
NAN_METHOD(EstimateFee);
NAN_METHOD(StartTxMon);
NAN_METHOD(SyncPercentage);
NAN_METHOD(IsSynced);
NAN_METHOD(GetTxOutSetInfo);
