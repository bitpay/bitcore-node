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
#include "nan.h"
#include "scheduler.h"
#include "core_io.h"
#include "script/bitcoinconsensus.h"
#include "consensus/validation.h"

NAN_METHOD(StartBitcoind);
NAN_METHOD(OnBlocksReady);
NAN_METHOD(OnTipUpdate);
NAN_METHOD(IsStopping);
NAN_METHOD(IsStopped);
NAN_METHOD(StopBitcoind);
NAN_METHOD(GetBlock);
NAN_METHOD(GetTransaction);
NAN_METHOD(GetInfo);
NAN_METHOD(IsSpent);
NAN_METHOD(GetBlockIndex);
NAN_METHOD(GetMempoolOutputs);
NAN_METHOD(AddMempoolUncheckedTransaction);
NAN_METHOD(VerifyScript);
NAN_METHOD(SendTransaction);
NAN_METHOD(EstimateFee);
NAN_METHOD(StartTxMon);
