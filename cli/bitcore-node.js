'use strict';

var program = require('commander');
var version = require(__dirname + '/../package.json').version;

program
  .version(version)
  .option('-d, --datadir', 'Database and configuration directory')
  .option('-t, --testnet', 'Enable testnet network');

program
  .command('create <directory> [name]')
  .description('Create a new node')
  .action(function(directory, name){
    console.log(directory, name);
  });

program
  .command('add <module>')
  .alias('install')
  .description('Install a module for the current node')
  .action(function(module){
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
    console.log('start');
  });

program
  .command('stop')
  .description('Stop the current node')
  .action(function(){
    console.log('stop');
  });

program
  .command('*')
  .description('')
  .action(function(env){
    program.help();
  });

program.parse(process.argv);
