# Block Service

The block service provides a block index for the Bitcoin blockchain. Specifically, there are two data points this service tracks:

- block hash
- raw block

This service is generally used to support other services and is not used externally.

## Service Configuration

none

## Other services this service Depends on

- header
- timestamp
- p2p
- db

