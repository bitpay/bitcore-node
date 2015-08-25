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
#ifdef ENABLE_WALLET
#include "wallet/wallet.h"
#endif

static bool
set_cooked(void);

static void
tx_notifier(uv_async_t *handle);

static void
async_tip_update(uv_work_t *req);

static void
async_tip_update_after(uv_work_t *req);

static void
async_start_node(uv_work_t *req);

static void
async_start_node_after(uv_work_t *req);

static void
async_blocks_ready(uv_work_t *req);

static void
async_blocks_ready_after(uv_work_t *req);

static void
async_stop_node(uv_work_t *req);

static void
async_stop_node_after(uv_work_t *req);

static int
start_node(void);

static void
start_node_thread(void);

static void
async_get_block(uv_work_t *req);

static void
async_get_block_after(uv_work_t *req);

static void
async_get_tx(uv_work_t *req);

static void
async_get_tx_after(uv_work_t *req);

static void
async_get_tx_and_info(uv_work_t *req);

static void
async_get_tx_and_info_after(uv_work_t *req);

static bool
scan_messages(CNode* pfrom);

static bool
scan_messages_after(CNode* pfrom);

NAN_METHOD(StartBitcoind);
NAN_METHOD(OnBlocksReady);
NAN_METHOD(OnTipUpdate);
NAN_METHOD(StopBitcoind);
NAN_METHOD(GetBlock);
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
