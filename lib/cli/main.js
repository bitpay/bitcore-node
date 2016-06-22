'use strict';

var program = require('commander');
var path = require('path');
var bitcorenode = require('..');
var utils = require('../utils');

function main(servicesPath, additionalServices) {
  /* jshint maxstatements: 100 */

  var version = bitcorenode.version;
  var create = bitcorenode.scaffold.create;
  var add = bitcorenode.scaffold.add;
  var start = bitcorenode.scaffold.start;
  var remove = bitcorenode.scaffold.remove;
  var callMethod = bitcorenode.scaffold.callMethod;
  var findConfig = bitcorenode.scaffold.findConfig;
  var defaultConfig = bitcorenode.scaffold.defaultConfig;

  program
    .version(version);

  program
    .command('create <directory>')
    .description('Create a new node')
    .option('-d, --datadir <dir>', 'Specify the bitcoin database directory')
    .option('-t, --testnet', 'Enable testnet as the network')
    .action(function(dirname, cmd){
      if (cmd.datadir) {
        cmd.datadir = path.resolve(process.cwd(), cmd.datadir);
      }
      var opts = {
        cwd: process.cwd(),
        dirname: dirname,
        datadir: cmd.datadir || './data',
        isGlobal: false
      };
      if (cmd.testnet) {
        opts.network = 'testnet';
      }
      create(opts, function(err) {
        if (err) {
          throw err;
        }
        console.log('Successfully created node in directory: ', dirname);
      });
    });

  program
    .command('start')
    .description('Start the current node')
    .option('-c, --config <dir>', 'Specify the directory with Bitcore Node configuration')
    .action(function(cmd){
      if (cmd.config) {
        cmd.config = path.resolve(process.cwd(), cmd.config);
      }
      var configInfo = findConfig(cmd.config || process.cwd());
      if (!configInfo) {
        configInfo = defaultConfig({
          additionalServices: additionalServices
        });
      }
      if (servicesPath) {
        configInfo.servicesPath = servicesPath;
      }
      start(configInfo);
    });

  program
    .command('install <services...>')
    .description('Install a service for the current node')
    .action(function(services){
      var configInfo = findConfig(process.cwd());
      if (!configInfo) {
        throw new Error('Could not find configuration, see `bitcore-node create --help`');
      }
      var opts = {
        path: configInfo.path,
        services: services
      };
      add(opts, function(err) {
        if (err) {
          throw err;
        }
        console.log('Successfully added services(s):', services.join(', '));
      });
    }).on('--help', function() {
      console.log('  Examples:');
      console.log();
      console.log('    $ bitcore-node add wallet-service');
      console.log('    $ bitcore-node add insight-api');
      console.log();
    });

  program
    .command('uninstall <services...>')
    .description('Uninstall a service for the current node')
    .action(function(services){
      var configInfo = findConfig(process.cwd());
      if (!configInfo) {
        throw new Error('Could not find configuration, see `bitcore-node create --help`');
      }
      var opts = {
        path: configInfo.path,
        services: services
      };
      remove(opts, function(err) {
        if (err) {
          throw err;
        }
        console.log('Successfully removed services(s):', services.join(', '));
      });
    }).on('--help', function() {
      console.log('  Examples:');
      console.log();
      console.log('    $ bitcore-node remove wallet-service');
      console.log('    $ bitcore-node remove insight-api');
      console.log();
    });

  program
    .command('call <method> [params...]')
    .description('Call an API method')
    .action(function(method, paramsArg) {
      var params = utils.parseParamsWithJSON(paramsArg);
      var configInfo = findConfig(process.cwd());
      if (!configInfo) {
        configInfo = defaultConfig();
      }
      var options = {
        protocol: 'http',
        host: 'localhost',
        port: configInfo.config.port
      };
      callMethod(options, method, params, function(err, data) {
        if (err) {
          throw err;
        }
        console.log(JSON.stringify(data, null, 2));
      });
    });

  program.parse(process.argv);

  if (process.argv.length === 2) {
    program.help();
  }

}

module.exports = main;
