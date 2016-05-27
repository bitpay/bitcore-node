'use strict';

var async = require('async');
var fs = require('fs');
var path = require('path');
var spawn = require('child_process').spawn;
var bitcore = require('bitcore-lib');
var utils = require('../utils');
var $ = bitcore.util.preconditions;
var _ = bitcore.deps._;

/**
 * @param {String} configFilePath - The absolute path to the configuration file
 * @param {String} service - The name of the service
 * @param {Function} done
 */
function addConfig(configFilePath, service, done) {
  $.checkState(utils.isAbsolutePath(configFilePath), 'An absolute path is expected');
  fs.readFile(configFilePath, function(err, data) {
    if (err) {
      return done(err);
    }
    var config = JSON.parse(data);
    $.checkState(
      Array.isArray(config.services),
      'Configuration file is expected to have a services array.'
    );
    config.services.push(service);
    config.services = _.unique(config.services);
    config.services.sort(function(a, b) {
      return a > b;
    });
    fs.writeFile(configFilePath, JSON.stringify(config, null, 2), done);
  });
}

/**
 * @param {String} configDir - The absolute configuration directory path
 * @param {String} service - The name of the service
 * @param {Function} done
 */
function addService(configDir, service, done) {
  $.checkState(utils.isAbsolutePath(configDir), 'An absolute path is expected');
  var npm = spawn('npm', ['install', service, '--save'], {cwd: configDir});

  npm.stdout.on('data', function(data) {
    process.stdout.write(data);
  });

  npm.stderr.on('data', function(data) {
    process.stderr.write(data);
  });

  npm.on('close', function(code) {
    if (code !== 0) {
      return done(new Error('There was an error installing service: ' + service));
    } else {
      return done();
    }
  });
}

/**
 * @param {String} options.cwd - The current working directory
 * @param {String} options.dirname - The bitcore-node configuration directory
 * @param {Array} options.services - An array of strings of service names
 * @param {Function} done - A callback function called when finished
 */
function add(options, done) {
  $.checkArgument(_.isObject(options));
  $.checkArgument(_.isFunction(done));
  $.checkArgument(
    _.isString(options.path) && utils.isAbsolutePath(options.path),
    'An absolute path is expected'
  );
  $.checkArgument(Array.isArray(options.services));

  var configPath = options.path;
  var services = options.services;

  var bitcoreConfigPath = path.resolve(configPath, 'bitcore-node.json');
  var packagePath = path.resolve(configPath, 'package.json');

  if (!fs.existsSync(bitcoreConfigPath) || !fs.existsSync(packagePath)) {
    return done(
      new Error('Directory does not have a bitcore-node.json and/or package.json file.')
    );
  }

  var oldPackage = JSON.parse(fs.readFileSync(packagePath));

  async.eachSeries(
    services,
    function(service, next) {
      // npm install <service_name> --save
      addService(configPath, service, function(err) {
        if (err) {
          return next(err);
        }

        // get the name of the service from package.json
        var updatedPackage = JSON.parse(fs.readFileSync(packagePath));
        var newDependencies = _.difference(
          Object.keys(updatedPackage.dependencies),
          Object.keys(oldPackage.dependencies)
        );
        $.checkState(newDependencies.length === 1);
        oldPackage = updatedPackage;
        var serviceName = newDependencies[0];

        // add service to bitcore-node.json
        addConfig(bitcoreConfigPath, serviceName, next);
      });
    }, done
  );
}

module.exports = add;
