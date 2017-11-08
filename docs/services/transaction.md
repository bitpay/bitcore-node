# Transaction Service

The transaction service provides a transaction index for the Bitcoin blockchain. Specifically, it builds and maintains the following information about every transaction on the Bitcoin network:

- transaction ids and transactions
- input values for every transaction
- the timestamp for the block that the transaction appears in
- the block height for the block that the transaction appears in

This service is generally used to support other services and is not used externally.

## Service Configuration

none

## Other services this service Depends on

- p2p
- db
- timestamp
- mempool
