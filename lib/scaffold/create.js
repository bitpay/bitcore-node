'use strict';

var bitcore = require('bitcore');
var version = require('../../package.json').version;
var mkdirp = require('mkdirp');
var fs = require('fs');

var BASE_CONFIG = {
  name: 'My Node',
  modules: [
    'address'
  ],
  datadir: './data',
  network: 'livenet'
};

var BASE_PACKAGE = {
  dependencies: {
    'bitcore': '^' + bitcore.version,
    'bitcore-node': '^' + version
  }
};

var BASE_BITCOIN_CONFIG = 'whitelist=127.0.0.1\n' + 'txindex=1\n';

function create(baseDirectory, dirname, name, done) {

  if (!baseDirectory) {
    baseDirectory = process.cwd;
  }

  var directory = baseDirectory + '/' + dirname;

  mkdirp(directory, function(err) {
    if (err) {
      throw err;
    }

    // setup the configuration files
    var config = BASE_CONFIG;
    config.name = name;
    var configJSON = JSON.stringify(config, null, 2);
    var packageJSON = JSON.stringify(BASE_PACKAGE, null, 2);
    try {
      fs.writeFileSync(directory + '/bitcore-node.json', configJSON);
      fs.writeFileSync(directory + '/package.json', packageJSON);
    } catch(e) {
      done(e);
    }

    // setup the bitcoin data directory
    mkdirp(directory + '/data', function(err) {
      if (err) {
        throw err;
      }

      try {
        fs.writeFileSync(directory + '/data/bitcoin.conf', BASE_BITCOIN_CONFIG);
      } catch(e) {
        done(e);
      }

      done();

    });

  });

}

module.exports = create;
