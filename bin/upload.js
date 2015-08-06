'use strict';

var fs = require('fs');
var chainlib = require('chainlib');
var log = chainlib.log;
var AWS = require('aws-sdk');

var config = require(process.env.HOME + '/.bitcore-node-upload.json');

AWS.config.region = config.region;
AWS.config.update({
  accessKeyId: config.accessKeyId,
  secretAccessKey: config.secretAccessKey
});

var bindings = require('bindings');
var packageRoot = bindings.getRoot(bindings.getFileName());
var binaryPath = bindings({
  path: true,
  bindings: 'bitcoind.node'
});

var relativeBinaryPath = binaryPath.replace(packageRoot + '/', '');
var exec = require('child_process').exec;
var version = require(packageRoot + '/package.json').version;
var platform = process.platform;
var arch = process.arch;
var tarballName = 'libbitcoind-' + version + '-' + platform + '-' + arch + '.tgz';
var bucketName = 'bitcore-node';
var url = 'https://' + bucketName + '.s3.amazonaws.com/' + tarballName;

var child = exec('tar -C ' + packageRoot + ' -cvzf ' + tarballName + ' ' + relativeBinaryPath,
  function (error, stdout, stderr) {

    if (error) {
      throw error;
    }

    if (stdout) {
      log.info('Tar:', stdout);
    }

    if (stderr) {
      log.error(stderr);
    }

    var fileStream = fs.createReadStream(packageRoot + '/' + tarballName);

    fileStream.on('error', function(err) {
      if (err) {
        throw err;
      }
    });

    fileStream.on('open', function() {

      var s3 = new AWS.S3();

      var params = {
        ACL: 'public-read',
        Key: tarballName,
        Body: fileStream,
        Bucket: bucketName
      };

       s3.putObject(params, function(err, data) {
         if (err) {
           throw err;
         } else {
           log.info('Successfully uploaded to: ' + url);
         }
       });

    });

  }
);
