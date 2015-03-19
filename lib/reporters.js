'use strict';

var bitcore = require('bitcore');
var Unit = bitcore.Unit;

var reporters = {};
reporters.none = function() {
  // do nothing
};
reporters.matrix = function(tx) {
  var s = tx.toString();
  for (var i = 0; i < s.length; i++) {
    var slice = s.slice(4 * i, 4 * (i + 1));
    if (slice.length < 4) {
      continue;
    }
    var c = JSON.parse('"\\u' + slice + '"');
    process.stdout.write(c);
  }
};
reporters.simple = function(tx) {
  var tout = Unit.fromSatoshis(tx.outputAmount).toBTC();
  console.log('Transaction:', tx.id);
  console.log('\ttotal_out:', tout, 'BTC');
  console.log('\tinput addresses:');
  tx.inputs.forEach(function(inp) {
    console.log('\t\t' + inp.script.toAddress());
  });
  console.log('\toutput addresses:');
  tx.outputs.forEach(function(out) {
    console.log('\t\t' + out.script.toAddress());
  });
};

module.exports = reporters;
