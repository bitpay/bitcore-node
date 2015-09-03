'use strict';

var spawn = require('child_process').spawn;
var bitcore = require('bitcore');
var async = require('async');
var $ = bitcore.util.preconditions;
var _ = bitcore.deps._;
var path = require('path');
var packageFile = require('../../package.json');
var mkdirp = require('mkdirp');
var fs = require('fs');
var defaultConfig = require('./default-config');

var version;
if (packageFile.version.match('-dev')) {
  version = '^' + packageFile.lastBuild;
} else {
  version = '^' + packageFile.version;
}

var BASE_PACKAGE = {
  dependencies: {
    'bitcore': '^' + bitcore.version,
    'bitcore-node': version
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
 * @param {String} datadir - The bitcoin database directory
 * @param {Boolean} isGlobal - If the configuration depends on globally installed node services.
 * @param {Function} done - The callback function called when finished
 */
function createConfigDirectory(configDir, name, datadir, isGlobal, done) {
  mkdirp(configDir, function(err) {
    if (err) {
      throw err;
    }

    var configInfo = defaultConfig();
    var config = configInfo.config;

    config.name = name || 'Bitcore Node';
    config.datadir = datadir;
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
 * Will setup a directory with a Bitcore Node directory, configuration file,
 * bitcoin configuration, and will install all necessary dependencies.
 *
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
  $.checkArgument(_.isString(options.name) || _.isUndefined(options.name));
  $.checkArgument(_.isBoolean(options.isGlobal));
  $.checkArgument(_.isString(options.datadir));

  var cwd = options.cwd;
  var dirname = options.dirname;
  var name = options.name;
  var datadir = options.datadir;
  var isGlobal = options.isGlobal;

  var absConfigDir = path.resolve(cwd, dirname);
  var absDataDir = path.resolve(absConfigDir, datadir);

  async.series([
    function(next) {
      // Setup the the bitcore-node directory and configuration
      if (!fs.existsSync(absConfigDir)) {
        createConfigDirectory(absConfigDir, name, datadir, isGlobal, next);
      } else {
        next(new Error('Directory "' + absConfigDir+ '" already exists.'));
      }
    },
    function(next) {
      // Setup the bitcoin directory and configuration
      if (!fs.existsSync(absDataDir)) {
        createBitcoinDirectory(absDataDir, next);
      } else {
        next();
      }
    },
    function(next) {
      // Install all of the necessary dependencies
      if (!isGlobal) {
        var npm = spawn('npm', ['install'], {cwd: absConfigDir});

        npm.stdout.on('data', function (data) {
          process.stdout.write(data);
        });

        npm.stderr.on('data', function (data) {
          process.stderr.write(data);
        });

        npm.on('close', function (code) {
          if (code !== 0) {
            return next(new Error('There was an error installing dependencies.'));
          } else {
            return next();
          }
        });

      } else {
        next();
      }
    }
  ], done);

}

module.exports = create;
