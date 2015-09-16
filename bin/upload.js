'use strict';

var fs = require('fs');
var AWS = require('aws-sdk');
var bindings = require('bindings');
var index = require('../');
var log = index.log;

var config = require(process.env.HOME + '/.bitcore-node-upload.json');

AWS.config.region = config.region;
AWS.config.update({
  accessKeyId: config.accessKeyId,
  secretAccessKey: config.secretAccessKey
});

var packageRoot = bindings.getRoot(bindings.getFileName());
var tarballName = require('./get-tarball-name')();
var bucketName = 'bitcore-node';
var url = 'https://' + bucketName + '.s3.amazonaws.com/' + tarballName;
var localPath = packageRoot + '/' + tarballName;

log.info('Uploading package: ' + localPath);

var fileStream = fs.createReadStream(localPath);

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
