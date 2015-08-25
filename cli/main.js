'use strict';

var program = require('commander');
var path = require('path');
var bitcorenode = require('..');

function main() {

  // local commands
  var version = bitcorenode.version;
  var create = bitcorenode.scaffold.create;
  var add = bitcorenode.scaffold.add;
  var start = bitcorenode.scaffold.start;
  var findConfig = bitcorenode.scaffold.findConfig;
  var defaultConfig = bitcorenode.scaffold.defaultConfig;

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
    .command('add <modules...>')
    .alias('install')
    .description('Install a module for the current node')
    .action(function(modules){
      var configInfo = findConfig(process.cwd());
      if (!configInfo) {
        throw new Error('Could not find configuration, see `bitcore-node create --help`');
      }
      var opts = {
        path: configInfo.path,
        modules: modules
      };
      add(opts, function() {
        console.log('Successfully added modules: ', modules.join(', '));
      });
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

}

module.exports = main;
