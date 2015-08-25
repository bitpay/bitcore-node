'use strict';

var async = require('async');
var fs = require('fs');
var path = require('path');
var spawn = require('child_process').spawn;
var bitcore = require('bitcore');
var $ = bitcore.util.preconditions;
var _ = bitcore.deps._;

/**
 * @param {String} configFilePath - The absolute path to the configuration file
 * @param {String} module - The name of the module
 * @param {Function} done
 */
function addConfig(configFilePath, module, done) {
  $.checkState(path.isAbsolute(configFilePath), 'An absolute path is expected');
  fs.readFile(configFilePath, function(err, data) {
    if (err) {
      return done(err);
    }
    var config = JSON.parse(data);
    $.checkState(
      Array.isArray(config.modules),
      'Configuration file is expected to have a modules array.'
    );
    config.modules.push(module);
    config.modules = _.unique(config.modules);
    config.modules.sort(function(a, b) {
      return a > b;
    });
    fs.writeFile(configFilePath, JSON.stringify(config, null, 2), done);
  });
}

/**
 * @param {String} configDir - The absolute configuration directory path
 * @param {String} module - The name of the module
 * @param {Function} done
 */
function addModule(configDir, module, done) {
  $.checkState(path.isAbsolute(configDir), 'An absolute path is expected');
  var npm = spawn('npm', ['install', module, '--save'], {cwd: configDir});

  npm.stdout.on('data', function(data) {
    process.stdout.write(data);
  });

  npm.stderr.on('data', function(data) {
    process.stderr.write(data);
  });

  npm.on('close', function(code) {
    if (code !== 0) {
      return done(new Error('There was an error installing module: ' + module));
    } else {
      return done();
    }
  });
}

/**
 * @param {String} options.cwd - The current working directory
 * @param {String} options.dirname - The bitcore-node configuration directory
 * @param {Array} options.modules - An array of strings of module names
 * @param {Function} done - A callback function called when finished
 */
function add(options, done) {
  $.checkArgument(_.isObject(options));
  $.checkArgument(_.isFunction(done));
  $.checkArgument(
    _.isString(options.path) && path.isAbsolute(options.path),
    'An absolute path is expected'
  );
  $.checkArgument(Array.isArray(options.modules));

  var configPath = options.path;
  var modules = options.modules;

  var bitcoreConfigPath = path.resolve(configPath, 'bitcore-node.json');
  var packagePath = path.resolve(configPath, 'package.json');

  if (!fs.existsSync(bitcoreConfigPath) || !fs.existsSync(packagePath)) {
    return done(
      new Error('Directory does not have a bitcore-node.json and/or package.json file.')
    );
  }

  async.eachSeries(
    modules,
    function(module, next) {
      // npm install <module_name> --save
      addModule(configPath, module, function(err) {
        if (err) {
          return next(err);
        }
        // add module to bitcore-node.json
        addConfig(bitcoreConfigPath, module, next);
      });
    }, done
  );
}

module.exports = add;
