'use strict';

// Local Coded


var initModule = function(node, serivces) {
  // hook to events
};

// createmultisig nrequired ["key",...]
var createMultisig = function(required, keys) {
  // keys array or string.
  // Keys may be addreses (return error).
  // returns: address and hex-enconded redeem script
};

// createrawtransaction [{"txid":"id","vout":n},...] {"address":amount,...}
var createRawTransaction = function(outpoints, outputs) {
  // outpoints. array or outpoint
  // outputs or (Address:amount)
  // returns a raw transaction
};

// decoderawtransaction "hexstring"
var decodeRawTransaction = function(transaction) {
  // hex transaction
  // result: txid, version, locktime, vin, vout
};

// decodescript "hex"
var decodeScript = function(redeemScript) {
  // hex redeemScript
  // result: asm, type, reqSigs, addresses, p2sh
};

// getblock "hash" ( verbose )
var decodeScript = function(redeemScript) {

};

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