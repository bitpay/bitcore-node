#!/usr/bin/env node

'use strict';

var program = require('commander');
var version = require(__dirname + '/../package.json').version;
var create = require('../lib/scaffold/create');
var add = require('../lib/scaffold/add');
var start = require('../lib/scaffold/start');
var findConfig = require('../lib/scaffold/find-config');

program
  .version(version)
  .option('-d, --datadir', 'Database and configuration directory')
  .option('-t, --testnet', 'Enable testnet network');

program
  .command('create <directory> [name]')
  .description('Create a new node')
  .action(function(dirname, name){
    var options = {
      cwd: process.cwd(),
      dirname: dirname,
      name: name,
      datadir: './data',
      isGlobal: false
    };
    create(options, function(err) {
      if (err) {
        throw err;
      }
      console.log('Successfully created node in directory: ', dirname);
    });
  });

program
  .command('start')
  .description('Start the current node')
  .action(function(){
    var configInfo = findConfig(process.cwd());
    if (configInfo) {
      start(configInfo);
    } else {
      throw new Error('Can not find bitcore-node.json in current path');
    }
  });

program
  .command('add <module>')
  .alias('install')
  .description('Install a module for the current node')
  .action(function(module){
    var config = findConfig();
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
