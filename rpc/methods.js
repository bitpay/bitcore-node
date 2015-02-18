'use strict';

// Local Coded
// createmultisig nrequired ["key",...]
// createrawtransaction [{"txid":"id","vout":n},...] {"address":amount,...}
// decoderawtransaction "hexstring"
// decodescript "hex"
// getblock "hash" ( verbose )
// getblockhash index
// getrawtransaction "txid" ( verbose )
// gettxout "txid" n ( includemempool )
// gettxoutsetinfo
// sendrawtransaction "hexstring" ( allowhighfees )
// signrawtransaction "hexstring" ( [{"txid":"id","vout":n,"scriptPubKey":"hex","redeemScript":"hex"},...] ["privatekey1",...] sighashtype )
// validateaddress "bitcoinaddress"
// verifymessage "bitcoinaddress" "signature" "message"
// getchaintips
// GetMemPoolInfo
// help ( "command" )


// Proxied to Bitcoind
// estimatefee
// estimatepriority
// getaddednodeinfo dns ( "node" )
// getbestblockhash
// getblockchaininfo
// getblockcount
// getconnectioncount
// getdifficulty
// getinfo
// getnettotals
// getnetworkhashps ( blocks height )
// getnetworkinfo
// getpeerinfo
// getrawmempool ( verbose ) // this could be done
// ping