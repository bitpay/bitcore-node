# Timestamp Service

The timestamp service provides a block timestamp index for the Bitcoin blockchain. The only reason this index needs to exist is to ensure that block timestamps are always strictly greater than all the previous block timestamps. In the native block timestamps, this is not always the case. Without this index, accounting systems that are based on time spans (pretty much all of them), there will be issues accounting for transactions accurately.

- block timestamp
- block hash

This service is generally used to support other services and is not used externally.

## Service Configuration

none

## Other services this service Depends on

- db


