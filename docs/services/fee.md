# Fee Service

The fee service is a requirement of the insight-api service (not a bitcore-node built-in service). Its primary purpose is to query a bitcoin full node for the most up-to-date miner fees for transactions. A bitcoin full node such as [BTC1](https://github.com/btc1/bitcoin) or [bcoin](https://github.com/bcoin-org/bcoin) with an available RPC interface is required.

## Service Configuration

```json
"fee": {
  "rpc": {
    "user": "user",
      "pass": "pass",
      "host": "localhost",
      "protocol": "http",
      "port": 8332
  }
}
```
## Usage Example

```bash
curl http://localhost:3001/insight-api/estimateFee
```
