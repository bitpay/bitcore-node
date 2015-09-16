# Bitcoin Service

The bitcoin service adds a native interface to Bitcoin Core for querying information about the Bitcoin blockchain. Bindings are linked to Bitcoin Core compiled as a static library.

## API Documentation

- `bitcoind.start([options], [callback])` - Start the JavaScript Bitcoin node.
- `bitcoind.getBlock(blockHash|blockHeight, callback)` - Get any block asynchronously by block hash or height as a node buffer.
- `bitcoind.isSpent(txid, outputIndex)` - Returns a boolean if a txid and outputIndex is already spent.
- `bitcoind.getBlockIndex(blockHash)` - Will return the block chain work and previous hash.
- `bitcoind.isMainChain(blockHash)` - Returns true if block is on the main chain. Returns false if it is an orphan.
- `bitcoind.estimateFee(blocks)` - Estimates the fees required to have a transaction included in the number of blocks specified as the first argument.
- `bitcoind.sendTransaction(transaction, allowAbsurdFees)` - Will attempt to add a transaction to the mempool and broadcast to peers.
- `bitcoind.getTransaction(txid, queryMempool, callback)` - Get any tx asynchronously by reading it from disk, with an argument to optionally not include the mempool.
- `bitcoind.getTransactionWithBlockInfo(txid, queryMempool, callback)` - Similar to getTransaction but will also include the block timestamp and height.
- `bitcoind.getMempoolTransactions()` - Will return an array of transaction buffers.
- `bitcoind.getInfo()` - Basic information about the chain including total number of blocks.
- `bitcoind.isSynced()` - Returns a boolean if the daemon is fully synced (not the initial block download)
- `bitcoind.syncPercentage()` - Returns the current estimate of blockchain download as a percentage.
- `bitcoind.stop([callback])` - Stop the JavaScript bitcoin node safely, the callback will be called when bitcoind is closed. This will also be done automatically on `process.exit`. It also takes the bitcoind node off the libuv event loop. If the daemon object is the only thing on the event loop. Node will simply close.

