'use strict';

var program = require('commander');
var version = require(__dirname + '/../package.json').version;
var create = require('../lib/scaffold/create');
var add = require('../lib/scaffold/add');
var start = require('../lib/scaffold/start');
var stop = require('../lib/scaffold/stop');
var findConfig = require('../lib/scaffold/find-config');

program
  .version(version)
  .option('-d, --datadir', 'Database and configuration directory')
  .option('-t, --testnet', 'Enable testnet network');

program
  .command('create <directory> [name]')
  .description('Create a new node')
  .action(function(directory, name){
    var config = findConfig();
    create(config, directory, name);
    console.log('Successfully created node in directory: ', directory);
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

program
  .command('start')
  .option('-b', '--background', 'Will start in the background')
  .description('Start the current node')
  .action(function(){
    var config = findConfig();
    start(config);
  });

program
  .command('stop')
  .description('Stop the current node')
  .action(function(){
    var config = findConfig();
    stop(config);
  });

program
  .command('*')
  .description('')
  .action(function(env){
    program.help();
  });

program.parse(process.argv);
