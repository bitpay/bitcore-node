'use strict';

var async = require('async');
var fs = require('fs');
var npm = require('npm');
var path = require('path');
var spawn = require('child_process').spawn;
var bitcore = require('bitcore');
var $ = bitcore.util.preconditions;
var _ = bitcore.deps._;

/**
 * Will remove a module from bitcore-node.json
 * @param {String} configFilePath - The absolute path to the configuration file
 * @param {String} module - The name of the module
 * @param {Function} done
 */
function removeConfig(configFilePath, module, done) {
  $.checkArgument(path.isAbsolute(configFilePath), 'An absolute path is expected');
  fs.readFile(configFilePath, function(err, data) {
    if (err) {
      return done(err);
    }
    var config = JSON.parse(data);
    $.checkState(
      Array.isArray(config.modules),
      'Configuration file is expected to have a modules array.'
    );
    // remove the module from the configuration
    for (var i = 0; i < config.modules.length; i++) {
      if (config.modules[i] === module) {
        config.modules.splice(i, 1);
      }
    }
    config.modules = _.unique(config.modules);
    config.modules.sort(function(a, b) {
      return a > b;
    });
    fs.writeFile(configFilePath, JSON.stringify(config, null, 2), done);
  });
}

/**
 * Will uninstall a Node.js module and remove from package.json.
 * @param {String} configDir - The absolute configuration directory path
 * @param {String} module - The name of the module
 * @param {Function} done
 */
function uninstallModule(configDir, module, done) {
  $.checkArgument(path.isAbsolute(configDir), 'An absolute path is expected');
  $.checkArgument(_.isString(module), 'A string is expected for the module argument');

  var child = spawn('npm', ['uninstall', module, '--save'], {cwd: configDir});

  child.stdout.on('data', function(data) {
    process.stdout.write(data);
  });

  child.stderr.on('data', function(data) {
    process.stderr.write(data);
  });

  child.on('close', function(code) {
    if (code !== 0) {
      return done(new Error('There was an error uninstalling module: ' + module));
    } else {
      return done();
    }
  });
}

/**
 * Will remove a Node.js module if it is installed.
 * @param {String} configDir - The absolute configuration directory path
 * @param {String} module - The name of the module
 * @param {Function} done
 */
function removeModule(configDir, module, done) {
  $.checkArgument(path.isAbsolute(configDir), 'An absolute path is expected');
  $.checkArgument(_.isString(module), 'A string is expected for the module argument');

  // check if the module is installed
  npm.load(function(err) {
    if (err) {
      return done(err);
    }
    npm.commands.ls([module], true /*silent*/, function(err, data, lite) {
      if (err) {
        return done(err);
      }
      if (lite.dependencies) {
        uninstallModule(configDir, module, done);
      } else {
        done();
      }
    });
  });

}

/**
 * Will remove the Node.js module and from the bitcore-node configuration.
 * @param {String} options.cwd - The current working directory
 * @param {String} options.dirname - The bitcore-node configuration directory
 * @param {Array} options.modules - An array of strings of module names
 * @param {Function} done - A callback function called when finished
 */
function remove(options, done) {
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
      // if the module is installed remove it
      removeModule(configPath, module, function(err) {
        if (err) {
          return next(err);
        }
        // remove module to bitcore-node.json
        removeConfig(bitcoreConfigPath, module, next);
      });
    }, done
  );
}

module.exports = remove;
