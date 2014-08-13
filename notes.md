# bitcoind

## Important Source Files

- **bitcoind.cpp** - the main entry point, `main()` resides here. This calls
  `Appinit()`.

  - `AppInit()` also resides here, it eventually ends up calling AppInit2()
    which is the most important entry point for what we're doing. AppInit2()
    will be the handler of `$ bitcoind -server -daemon`.

- **init.cpp** - `AppInit2()` resides here - this functions ends up calling
  `StartNode()` which spawns all of the threads for network activity (accepts
  the main `threadGroup`).

- **net.cpp** - `StartNode()` resides here - starts all network threads.

- **main.cpp** - misnamed file which handles all packet handling, framing and
  parsing.

## Plan of Action

### First Pass

- Successfully link to bitcoind from our, currently barebones, c++ binding.
- Expose one function from the c++ binding which essentially starts all the
  net.cpp threads and starts downloading the block chain and connecting to
  peers.

### Second Pass

- Start exposing more functions - a fully function bitcoin library
- Reconcile the issues that may arise making certain calls async (libuv thread pool vs. bitcoind threads?)

## Hurdles

- If we expect people to install and compile this, on one core on an i5,
  bitcoind takes roughly 30 minutes to compile.

``` bash
git clean -xdf
git checkout v0.9.0
date | tee compile_time; ./autogen.sh
./configure --with-incompatible-bdb
make; date | tee -a compile_time
cat compile_time
Wed Aug 13 14:38:14 CDT 2014
Wed Aug 13 15:07:49 CDT 2014
```
