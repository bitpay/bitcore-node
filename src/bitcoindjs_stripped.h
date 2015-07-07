/**
 * bitcoind.js
 * Copyright (c) 2014, BitPay (MIT License)
 *
 * bitcoindjs.h:
 *   A bitcoind node.js binding header file.
 */
#include "nan.h"
#include "addrman.h"
#include "base58.h"
#include "init.h"
#include "noui.h"
#include <boost/thread.hpp>
#include <boost/filesystem.hpp>

NAN_METHOD(StartBitcoind);
NAN_METHOD(IsStopping);
NAN_METHOD(IsStopped);
NAN_METHOD(StopBitcoind);
