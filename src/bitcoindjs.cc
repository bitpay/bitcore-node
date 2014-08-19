/**
 * bitcoind.js
 * Copyright (c) 2014, BitPay (MIT License)
 *
 * bitcoindjs.cc:
 *   A bitcoind node.js binding.
 */

#include "nan.h"

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

void
async_work(uv_work_t *req);

void
async_after(uv_work_t *req);

extern "C" void
init(Handle<Object>);

struct async_data {
  Persistent<Function> callback;
  bool err;
  std::string err_msg;
  char *result;
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

  async_data* data = new async_data();
  data->err = false;
  data->callback = Persistent<Function>::New(callback);

  uv_work_t *req = new uv_work_t();
  req->data = data;

  int status = uv_queue_work(uv_default_loop(),
    req, async_work, (uv_after_work_cb)async_after);

  assert(status == 0);

  NanReturnValue(Undefined());
}

void async_work(uv_work_t *req) {
  async_data* data = static_cast<async_data*>(req->data);
  data->result = (char *)strdup("opened");
}

void async_after(uv_work_t *req) {
  NanScope();
  async_data* data = static_cast<async_data*>(req->data);

  if (data->err) {
    Local<Value> err = Exception::Error(String::New(data->err_msg.c_str()));
    const unsigned argc = 1;
    Local<Value> argv[1] = { err };
    TryCatch try_catch;
    data->callback->Call(Context::GetCurrent()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  } else {
    const unsigned argc = 2;
    Local<Value> argv[2] = {
      Local<Value>::New(Null()),
      Local<Value>::New(String::New(data->result))
    };
    TryCatch try_catch;
    data->callback->Call(Context::GetCurrent()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  }

  data->callback.Dispose();

  if (data->result != NULL) {
    free(data->result);
  }

  delete data;
  delete req;
}

/**
 * Init
 */

extern "C" void
init(Handle<Object> target) {
  NanScope();
  NODE_SET_METHOD(target, "start", StartBitcoind);
}

NODE_MODULE(bitcoindjs, init)
