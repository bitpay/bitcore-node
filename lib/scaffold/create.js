'use strict';

var bitcore = require('bitcore');
var $ = bitcore.util.preconditions;
var _ = bitcore.deps._;
var path = require('path');
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

/**
 * Will create a directory and bitcoin.conf file for Bitcoin.
 * @param {String} dataDir - The absolute path
 * @param {Function} done - The callback function called when finished
 */
function createBitcoinDirectory(datadir, done) {
  mkdirp(datadir, function(err) {
    if (err) {
      throw err;
    }

    try {
      fs.writeFileSync(datadir + '/bitcoin.conf', BASE_BITCOIN_CONFIG);
    } catch(e) {
      done(e);
    }
    done();
  });
}

/**
 * Will create a base Bitcore Node configuration directory and files.
 * @param {String} configDir - The absolute path
 * @param {String} name - The name of the node
 * @param {Function} done - The callback function called when finished
 */
function createConfigDirectory(configDir, name, isGlobal, done) {
  mkdirp(configDir, function(err) {
    if (err) {
      throw err;
    }

    var config = BASE_CONFIG;
    config.name = name;
    var configJSON = JSON.stringify(config, null, 2);
    var packageJSON = JSON.stringify(BASE_PACKAGE, null, 2);
    try {
      fs.writeFileSync(configDir + '/bitcore-node.json', configJSON);
      if (!isGlobal) {
        fs.writeFileSync(configDir + '/package.json', packageJSON);
      }
    } catch(e) {
      done(e);
    }
    done();

  });
}

/**
 * @param {Object} options
 * @param {String} options.cwd - The current working directory
 * @param {String} options.dirname - The name of the bitcore node configuration directory
 * @param {String} options.name - The name of the bitcore node
 * @param {String} options.datadir - The path to the bitcoin datadir
 * @param {Function} done - A callback function called when finished
 */
function create(options, done) {
  /* jshint maxstatements:20 */

  $.checkArgument(_.isObject(options));
  $.checkArgument(_.isFunction(done));
  $.checkArgument(_.isString(options.cwd));
  $.checkArgument(_.isString(options.dirname));
  $.checkArgument(_.isString(options.name));
  $.checkArgument(_.isBoolean(options.isGlobal));
  $.checkArgument(_.isString(options.datadir));

  var cwd = options.cwd;
  var dirname = options.dirname;
  var name = options.name;
  var datadir = options.datadir;
  var isGlobal = options.isGlobal;

  if (!cwd) {
    cwd = process.cwd;
  }

  var absConfigDir = path.resolve(cwd, dirname);
  var absDataDir = path.resolve(absConfigDir, datadir);

  if (!fs.existsSync(absConfigDir)) {
    createConfigDirectory(absConfigDir, name, isGlobal, function() {
      if (!fs.existsSync(absDataDir)) {
        createBitcoinDirectory(absDataDir, done);
      } else {
        done();
      }
    });
  } else {
    done(new Error('Directory "' + absConfigDir+ '" already exists.'));
  }

}

module.exports = create;
