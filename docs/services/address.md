# Address Service

The address service provides an address index for the Bitcoin blockchain. Specifically, it builds and maintains the following information about every address ever used on the Bitcoin network:

- block heights the address appeared in
- transaction ids and the index in the transaction
- whether the address appeared in an input or output
- the timestamp for the block

Additionally, the address index also maintains the unspent transaction output index for the Bitcoin blockchain. Example queries for this type of data is provided by 'getAddressUnspentOutputs', 'getAddressSummary', and 'getAddressHistory'.

This service is generally used to support other services and is not used externally.

## Service Configuration

none

## Other services this service Depends on

- db
- header
- transaction
- timestamp
