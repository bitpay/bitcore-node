# Development & Testing
To run all of the JavaScript tests:

```bash
npm run test
```

To run tests against the bindings, as defined in `bindings.gyp` the regtest feature of Bitcoin Core is used, and to enable this feature we currently need to build with the wallet enabled _(not a part of the regular build)_. To do this, export an environment variable and recompile:

```bash
export BITCORENODE_ENV=test
npm run build
```

If you do not already have mocha installed:

```bash
npm install mocha -g
```

To run the integration tests:

```bash
mocha -R spec integration/regtest.js
```

If any changes have been made to the bindings in the "src" directory, manually compile the Node.js bindings, as defined in `bindings.gyp`, you can run (-d for debug):

```bash
$ node-gyp -d rebuild
```

Note: `node-gyp` can be installed with `npm install node-gyp -g`

To be able to debug you'll need to have `gdb` and `node` compiled for debugging with gdb using `--gdb` (sometimes called node_g), and you can then run:

```bash
$ gdb --args node examples/node.js
```

To be able to debug directly on an ARM device such as a Raspberry Pi or Android device, perform the same steps as above, except you will need to inform gdb that it should not halt on OpenSSL's SIGILL signal:

```bash
$ gdb --args node examples/node.js
(gdb) handle SIGILL nostop
```

The output from the 'handle SIGILL nostop' should look similar to:

> Signal        Stop      Print   Pass to program Description

> SIGILL        No        Yes     Yes             Illegal instruction

```bash
(gdb) run
```

```bash
$ gdb --args node examples/node.js
```

To run mocha from within gdb (notice `_mocha` and not `mocha` so that the tests run in the same process):

```bash
$ gdb --args node /path/to/_mocha -R spec integration/regtest.js
```

To run the benchmarks:

```bash
$ cd benchmarks
$ node index.js
```
