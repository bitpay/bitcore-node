#!/usr/bin/env node

'use strict';

var program = require('commander');
var version = require(__dirname + '/../package.json').version;
var bitcore = require('bitcore');
var $ = bitcore.util.preconditions;
var path = require('path');
var create = require('../lib/scaffold/create');
var add = require('../lib/scaffold/add');
var start = require('../lib/scaffold/start');
var findConfig = require('../lib/scaffold/find-config');
var defaultConfig = require('../lib/scaffold/default-config');

program
  .version(version);

program
  .command('create <directory> [name]')
  .description('Create a new node')
  .option('-d, --datadir <dir>', 'Specify the bitcoin database directory')
  .action(function(dirname, name, cmd){
    if (cmd.datadir) {
      cmd.datadir = path.resolve(process.cwd(), cmd.datadir);
    }
    var opts = {
      cwd: process.cwd(),
      dirname: dirname,
      name: name,
      datadir: cmd.datadir || './data',
      isGlobal: false
    };
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
      configInfo = defaultConfig();
    }
    start(configInfo);
  });

program
  .command('add <module>')
  .alias('install')
  .description('Install a module for the current node')
  .action(function(module){
    var config = findConfig();
    if (!config) {
      throw new Error('Could not find configuration, see `bitcore-node create --help`');
    }
    add(config, module);
    console.log('Successfully added module: ', module);
    console.log(module);
  }).on('--help', function() {
    console.log('  Examples:');
    console.log();
    console.log('    $ bitcore-node add wallet-service');
    console.log('    $ bitcore-node add insight-api');
    console.log();
  });

program.parse(process.argv);

if (process.argv.length === 2) {
  program.help();
}
