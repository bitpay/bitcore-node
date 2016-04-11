# Development & Testing
To run all of the JavaScript tests:

```bash
npm run test
```

If you do not already have mocha installed:

```bash
npm install mocha -g
```

To run the regression tests:

```bash
mocha -R spec regtest/bitcoind.js
```

To be able to debug bitcoind you'll need to have `gdb` and `node` compiled for debugging with gdb using `--gdb` (sometimes called node_g), and you can then run:

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
