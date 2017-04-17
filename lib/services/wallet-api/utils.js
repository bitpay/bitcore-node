'use strict';

var Writable = require('stream').Writable;
var assert = require('assert');
var crypto = require('crypto');
var fs = require('fs');
var inherits = require('util').inherits;
var path = require('path');
var spawn = require('child_process').spawn;

var BitcoinRPC = require('bitcoind-rpc');
var _ = require('lodash');
var async = require('async');
var bitcore = require('bitcore-lib');
var mkdirp = require('mkdirp');
var ttyread = require('ttyread');

var exports = {};

exports.isInteger = function(value) {
  return typeof value === 'number' &&
    isFinite(value) &&
    Math.floor(value) === value;
};

exports.normalizeTimeStamp = function(value) {
  if (value > 0xffffffff) {
    value = Math.round(value/1000);
  }
  return value;
};
/**
 * Will create a directory if it does not already exist.
 *
 * @param {String} directory - An absolute path to the directory
 * @param {Function} callback
 */
exports.setupDirectory = function(directory, callback) {
  fs.access(directory, function(err) {
    if (err && err.code === 'ENOENT') {
      return mkdirp(directory, callback);
    } else if (err) {
      return callback(err);
    }
    callback();
  });
};

/**
 * This will split a range of numbers "a" to "b" by sections
 * of the length "max".
 *
 * Example:
 * > var range = utils.splitRange(1, 10, 3);
 * > [[1, 3], [4, 6], [7, 9], [10, 10]]
 *
 * @param {Number} a - The start index (lesser)
 * @param {Number} b - The end index (greater)
 * @param {Number} max - The maximum section length
 */
exports.splitRange = function(a, b, max) {
  assert(b > a, '"b" is expected to be greater than "a"');
  var sections = [];
  var delta = b - a;
  var first = a;
  var last = a;

  var length = Math.floor(delta / max);
  for (var i = 0; i < length; i++) {
    last = first + max - 1;
    sections.push([first, last]);
    first += max;
  }

  if (last <= b) {
    sections.push([first, b]);
  }

  return sections;
};

/**
 * getFileStream: Checks for the file's existence and returns a readable stream or stdin
 * @param {String} path - The path to the file
 * @param {Function} callback
 */
exports.getFileStream = function(filePath, callback) {
  callback(null, fs.createReadStream(filePath));
};

exports.readWalletDatFile = function(filePath, network, callback) {
  assert(_.isString(network), 'Network expected to be a string.');
  var datadir = path.dirname(filePath).replace(/(\/testnet3|\/regtest)$/, '');
  var name = path.basename(filePath);
  var options = ['-datadir=' + datadir, '-wallet=' + name];
  if (network === 'testnet') {
    options.push('-testnet');
  } else if (network === 'regtest') {
    options.push('-regtest');
  }
  // TODO use ../node_modules/.bin/wallet-utility
  var exec = path.resolve(__dirname, '../node_modules/bitcore-node/bin/bitcoin-0.12.1/bin/wallet-utility');
  var wallet = spawn(exec, options);

  var result = '';

  wallet.stdout.on('data', function(data) {
    result += data.toString('utf8');
  });

  var error;

  wallet.stderr.on('data', function(data) {
    error = data.toString();
  });

  wallet.on('close', function(code) {
    if (code === 0) {
      var addresses;
      try {
        addresses = JSON.parse(result);
        addresses = addresses.map(function(entry) {
          return entry.addr ? entry.addr : entry;
        });
      } catch(err) {
        return callback(err);
      }
      return callback(null, addresses);
    } else if (error) {
      return callback(new Error(error));
    } else {
      var message = 'wallet-utility exited (' + code + '): ' + result;
      return callback(new Error(message));
    }
  });
};

exports.readWalletFile = function(filePath, network, callback) {
  if (/\.dat$/.test(filePath)) {
    exports.readWalletDatFile(filePath, network, callback);
  } else {
    exports.getFileStream(filePath, callback);
  }
};

/**
 * This will split an array into smaller arrays by size
 *
 * @param {Array} array
 * @param {Number} size - The length of resulting smaller arrays
 */
exports.splitArray = function(array, size) {
  var results = [];
  while (array.length) {
    results.push(array.splice(0, size));
  }
  return results;
};

/**
 * Utility to get the remote ip address from cloudflare headers.
 *
 * @param {Object} req - An express request object
 */
exports.getRemoteAddress = function(req) {
  if (req.headers['cf-connecting-ip']) {
    return req.headers['cf-connecting-ip'];
  }
  return req.socket.remoteAddress;
};

/**
 * A middleware to enable CORS
 *
 * @param {Object} req - An express request object
 * @param {Object} res - An express response object
 * @param {Function} next
 */
exports.enableCORS = function(req, res, next) {
  res.header('access-control-allow-origin', '*');
  res.header('access-control-allow-methods', 'GET, HEAD, PUT, POST, OPTIONS');
  var allowed = [
    'origin',
    'x-requested-with',
    'content-type',
    'accept',
    'content-length',
    'cache-control',
    'cf-connecting-ip'
  ];
  res.header('access-control-allow-headers', allowed.join(', '));

  var method = req.method && req.method.toUpperCase && req.method.toUpperCase();

  if (method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
  } else {
    next();
  }
};

/**
 * Will send error to express response
 *
 * @param {Error} err - error object
 * @param {Object} res - express response object
 */
exports.sendError = function(err, res) {
  if (err.statusCode)  {
    res.status(err.statusCode).send(err.message);
  } else {
    console.error(err.stack);
    res.status(503).send(err.message);
  }
};

/**
 * Will create a writeable logger stream
 *
 * @param {Function} logger - Function to log information
 * @returns {Stream}
 */
exports.createLogStream = function(logger) {
  function Log(options) {
    Writable.call(this, options);
  }
  inherits(Log, Writable);

  Log.prototype._write = function (chunk, enc, callback) {
    logger(chunk.slice(0, chunk.length - 1)); // remove new line and pass to logger
    callback();
  };
  var stream = new Log();

  return stream;
};

exports.getWalletId = exports.generateJobId = function() {
  return crypto.randomBytes(16).toString('hex');
};

exports.getClients = function(clientsConfig) {
  var clients = [];
  for (var i = 0; i < clientsConfig.length; i++) {
    var config = clientsConfig[i];
    var remoteClient = new BitcoinRPC({
      protocol: config.rpcprotocol || 'http',
      host: config.rpchost || '127.0.0.1',
      port: config.rpcport,
      user: config.rpcuser,
      pass: config.rpcpassword,
      rejectUnauthorized: _.isUndefined(config.rpcstrict) ? true : config.rpcstrict
    });
    clients.push(remoteClient);
  }
  return clients;
};

exports.setClients = function(obj, clients) {
  obj._clients = clients;
  obj._clientsIndex = 0;
  Object.defineProperty(obj, 'clients', {
    get: function() {
      var client = obj._clients[obj._clientsIndex];
      obj._clientsIndex = (obj._clientsIndex + 1) % obj._clients.length;
      return client;
    },
    enumerable: true,
    configurable: false
  });
};

exports.tryAllClients = function(obj, func, options, callback) {
  if (_.isFunction(options)) {
    callback = options;
    options = {};
  }
  var clientIndex = obj._clientsIndex;
  var retry = function(done) {
    var client = obj._clients[clientIndex];
    clientIndex = (clientIndex + 1) % obj._clients.length;
    func(client, done);
  };
  async.retry({times: obj._clients.length, interval: options.interval || 1000}, retry, callback);
};

exports.wrapRPCError = function(errObj) {
  var err = new Error(errObj.message);
  err.code = errObj.code;
  return err;
};

var PUBKEYHASH = new Buffer('01', 'hex');
var SCRIPTHASH = new Buffer('02', 'hex');

exports.getAddressTypeString  = function(bufferArg) {
  var buffer = bufferArg;
  if (!Buffer.isBuffer(bufferArg)) {
    buffer = new Buffer(bufferArg, 'hex');
  }
  var type = buffer.slice(0, 1);
  if (type.compare(PUBKEYHASH) === 0) {
    return 'pubkeyhash';
  } else if (type.compare(SCRIPTHASH) === 0) {
    return 'scripthash';
  } else {
    throw new TypeError('Unknown address type');
  }
};

exports.getAddressTypeBuffer = function(address) {
  var type;
  if (address.type === 'pubkeyhash') {
    type = PUBKEYHASH;
  } else if (address.type === 'scripthash') {
    type = SCRIPTHASH;
  } else {
    throw new TypeError('Unknown address type');
  }
  return type;
};

exports.splitBuffer = function(buffer, size) {
  var pos = 0;
  var buffers = [];
  while (pos < buffer.length) {
    buffers.push(buffer.slice(pos, pos + size));
    pos += size;
  }
  return buffers;
};

exports.exitWorker = function(worker, timeout, callback) {
  assert(worker, '"worker" is expected to be defined');
  var exited = false;
  worker.once('exit', function(code) {
    if (!exited) {
      exited = true;
      if (code !== 0) {
        var error = new Error('Worker did not exit cleanly: ' + code);
        error.code = code;
        return callback(error);
      } else {
        return callback();
      }
    }
  });
  worker.kill('SIGINT');
  setTimeout(function() {
    if (!exited) {
      exited = true;
      worker.kill('SIGKILL');
      return callback(new Error('Worker exit timeout, force shutdown'));
    }
  }, timeout).unref();
};

exports.timestampToISOString = function(timestamp) {
  return new Date(this.toIntIfNumberLike(timestamp) * 1000).toISOString();
};

exports.satoshisToBitcoin = function(satoshis) {
  return satoshis / 100000000;
};

exports.getPassphrase = function(callback) {
  ttyread('Enter passphrase: ', {silent: true}, callback);
};

exports.acquirePassphrase = function(callback) {
  var first;
  var second;
  async.doWhilst(function(next) {
    ttyread('Enter passphrase: ', {silent: true}, function(err, result) {
      if (err) {
        return callback(err);
      }
      first = result;
      ttyread('Re-enter passphrase: ', {silent: true}, function(err, result) {
        second = result;
        next();
      });
    });
  }, function() {
    if (first !== second) {
      console.log('Passphrases do not match, please re-enter.');
      return true;
    }
    return false;
  }, function(err) {
    if (err) {
      return callback(err);
    }
    callback(null, first);
  });
};

/*
   Important notes:

   How the encryption/decryption schemes work.
   1. The user's passphrase and salt are hashed using scrypt algorithm. You must store the salt.
   On modern hardware this hashing function should take 1-2 seconds.
   2. The resulting hash is 48 bytes. The first 32 bytes of this hash is the "key" and the last
   16 bytes is the "iv" to decrypt the master key using AES256-cbc.
   3. The plaintext "master key" is always 32 bytes and should be as random as possible.
   You may pass in the plaintext master key to encryptSecret -or- /dev/random will be consulted.
   4. The cipherText of the master key must be stored just like the salt. For added security, you
   might store the cipherText of the master key separate from the cipherText.
   For example, if an attacker discovers your passphrase and salt (the most likely scenario), they would
   still require the cipherText of the master key in order to decrypt the cipherText of your private keys.
   Storing your encrypted master key on another device would be a better choice than keeping your salt,
   the cipherText of your master key and the cipherText of your private keys on the same computer system.
   5. The plaintext master key is then used to encrypt/decrypt the bitcoin private keys. The private keys'
   corresponding public key is used as the IV for the procedure.


   Specific notes regarding how private keys are transferred from a traditional "wallet.dat" file used with
   Bitcoin Core's Wallet:

   1. Bitcoin Core's Wallet uses Berkeley DB version 4.8 to store secp256k1 elliptic curve private keys in WIF format.
   2. The same Berkeley DB, internally called "main", also stores compressed public keys for the above private keys,
   the master keys used to encrypt the above private keys and bitcoin transaction details relevant to those private keys
   3. The underlying data structure for the Berkeley database is the B-Tree (balanced tree). This is a key-value data
   structure, therefore the database is a key-value database.
   Berkeley DB documentation also refers to this as "key-record"
   This means that the data contained in this B-Tree is organized for high speed retrieval based on a key.
   In other words the database is optimized for lookups.
   4. The filename for this database file is called "wallet.dat" historically,
   but you can rename it to whatever suits you

*/
//this function depends on the derivation method and its params that were originally used to hash the passphrase
//this could be SHA512, scrypt, etc.
exports.sha512KDF = function(passphrase, salt, derivationOptions, callback) {
  if (!derivationOptions || derivationOptions.method !== 0 || !derivationOptions.rounds) {
    return callback(new Error('SHA512 KDF method was called for, ' +
      'yet the derivations options for it were not supplied.'));
  }
  var rounds =  derivationOptions.rounds || 1;
  //if salt was sent in as a string, we will have to assume the default encoding type
  if (!Buffer.isBuffer(salt)) {
    salt = new Buffer(salt, 'utf-8');
  }
  var derivation = Buffer.concat([new Buffer(''), new Buffer(passphrase), salt]);
  for(var i = 0; i < rounds; i++) {
    derivation = crypto.createHash('sha512').update(derivation).digest();
  }
  callback(null, derivation);
};

exports.hashPassphrase = function() {
  return exports.sha512KDF;
};

exports.decryptPrivateKey = function(opts, callback) {
  exports.decryptSecret(opts, function(err, masterKey) {
    if(err) {
      return callback(err);
    }
    opts.cipherText = opts.pkCipherText;
    //decrypt the private here using the plainText master key as the "key"
    //and the double sha256 compressed pub key as the "IV"
    opts.key = masterKey;
    opts.iv = bitcore.crypto.Hash.sha256sha256(new Buffer(opts.pubkey, 'hex'));
    exports.decrypt(opts, function(err, privateKey) {
      if(err) {
        return callback(err);
      }
      callback(null, privateKey);
    });
  });
};

//call decryptSecret first
exports.encryptPrivateKeys = function(opts, callback) {
  if (!opts.masterKey || !opts.keys) {
    return callback(new Error('A decrypted master key, ' +
    'compressed public keys and private keys are required for encryption.'));
  }
  if (!Buffer.isBuffer(opts.masterKey)) { //we'll have to assume the master key is utf-8 encoded
    opts.masterKey = new Buffer(opts.masterKey);
  }
  assert(opts.masterKey.length === 32, 'Master Key must be 32 bytes in length, ' +
    'if you have a hex string, please pass master key in as a buffer');
  //if the master key is not 32 bytes, then take the sha256 hash
  var ret = [];
  async.mapLimit(opts.keys, 5, function(key, next) {
    var iv = bitcore.crypto.Hash.sha256sha256(new Buffer(key.pubKey, 'hex')).slice(0, 16);
    //do we want to encrypt WIF's or RAW private keys or does it matter?
    exports.encrypt({
      secret: key.privKey,
      iv: iv,
      key: opts.masterKey
    }, next);
  }, function(err, results) {
    if(err) {
      return callback(err);
    }
    for(var i = 0; i < results.length; i++) {
      ret.push({
        cipherText: results[i],
        checkHash: bitcore.crypto.Hash.sha256(new Buffer(opts.keys[i].pubKey + results[i])).toString('hex'),
        type: 'encrypted private key',
        pubKey: opts.keys[i].pubKey
      });
    }
    callback(null, ret);
  });
};

exports.encrypt = function(opts, callback) {
  if (!opts.key ||
    !opts.iv ||
    !opts.secret ||
    opts.key.length !== 32 ||
    opts.iv.length !== 16 ||
    opts.secret.length < 1) {
    return callback(new Error('Key, IV, and something to encrypt is required.'));
  }
  var cipher = crypto.createCipheriv('aes-256-cbc', opts.key, opts.iv);
  var cipherText;
  try {
    cipherText = Buffer.concat([cipher.update(opts.secret), cipher.final()]).toString('hex');
  } catch(e) {
    return callback(e);
  }
  return callback(null, cipherText);

};
exports.encryptSecret = function(opts, callback) {
  var hashFunc = exports.hashPassphrase(opts.derivationOptions);
  hashFunc(opts.passphrase, opts.salt, opts.derivationOptions, function(err, hashedPassphrase) {
    if (err) {
      return callback(err);
    }
    var secret = opts.secret || crypto.randomBytes(32);
    assert(Buffer.isBuffer(secret), 'secret is expected to be a buffer');
    secret = bitcore.crypto.Hash.sha256sha256(secret);
    var firstHalf = hashedPassphrase.slice(0, 32); //AES256-cbc shared key
    var secondHalf = hashedPassphrase.slice(32, 48); //AES256-cbc IV, for cbc mode, the IV will be 16 bytes
    exports.encrypt({
      secret: secret,
      key: firstHalf,
      iv: secondHalf
    }, callback);
  });
};

exports.decryptSecret = function(opts, callback) {
  var hashFunc = exports.hashPassphrase(opts.derivationOptions);
  hashFunc(opts.passphrase, opts.salt, opts.derivationOptions, function(err, hashedPassphrase) {
    if (err) {
      return callback(err);
    }
    opts.key = hashedPassphrase;
    exports.decrypt(opts, callback);
  });
};

exports.decrypt = function(opts, callback) {
  if (!Buffer.isBuffer(opts.key)) {
    opts.key = new Buffer(opts.key, 'hex');
  }
  var secondHalf;
  if (opts.iv) {
    secondHalf = opts.iv.slice(0, 16);
  } else {
    secondHalf = opts.key.slice(32, 48); //AES256-cbc IV
  }
  var cipherText = new Buffer(opts.cipherText, 'hex');
  var firstHalf = opts.key.slice(0, 32); //AES256-cbc shared key
  var AESDecipher = crypto.createDecipheriv('aes-256-cbc', firstHalf, secondHalf);
  var plainText;
  try {
    plainText = Buffer.concat([AESDecipher.update(cipherText), AESDecipher.final()]).toString('hex');
  } catch(e) {
    return callback(e);
  }
  callback(null, plainText);
};

exports.confirm = function(question, callback) {
  ttyread(question + ' (y/N): ', function(err, answer) {
    if (err) {
      return callback(err, false);
    }
    if (answer === 'y') {
      return callback(null, true);
    }
    callback(null, false);
  });
};

exports.encryptSecretWithPassphrase = function(secret, callback) {
  exports.acquirePassphrase(function(err, passphrase) {
    if (err) {
      return callback(err);
    }
    var salt = crypto.randomBytes(32).toString('hex');
    exports.encryptSecret({
      secret: secret,
      passphrase: passphrase,
      salt: salt
    }, function(err, cipherText) {
      if (err) {
        return callback(err);
      }
      callback(null, cipherText, salt);
    });
  });
};

exports.generateNonce = function() {
  var nonce = new Buffer(new Array(12));
  nonce.writeDoubleBE(Date.now());
  nonce.writeUInt32BE(process.hrtime()[1], 8);
  return nonce;
};

exports.generateHashForRequest = function(method, url, nonce) {
  nonce = nonce || new Buffer(0);
  assert(Buffer.isBuffer(nonce), 'nonce must a buffer');
  var dataToSign = Buffer.concat([nonce, new Buffer(method), new Buffer(url)]);
  return bitcore.crypto.Hash.sha256sha256(dataToSign);
};

exports.getWalletIdFromName = function(walletName) {
  if (!Buffer.isBuffer(walletName)) {
    walletName = new Buffer(walletName, 'utf8');
  }
  return bitcore.crypto.Hash.sha256sha256(walletName).toString('hex');
};

exports.isRangeMoreThan = function(a, b) {
  if (a && !b) {
    return true;
  }
  if (!a && !b) {
    return false;
  }
  if (!a && b) {
    return false;
  }
  if (a.height > b.height) {
    return true;
  } else if (a.height < b.height) {
    return false;
  } else {
    return a.index > b.index;
  }
};

exports.toHexBuffer = function(a) {
  if (!Buffer.isBuffer(a)) {
    a = new Buffer(a, 'hex');
  }
  return a;
};

exports.toIntIfNumberLike = function(a) {
  if (!/[^\d]+/.test(a)) {
    return parseInt(a);
  }
  return a;
};

exports.delimitedStringParse = function(delim, str) {
  function tryJSONparse(str) {
    try {
      return JSON.parse(str);
    } catch(e) {
      return false;
    }
  }
  var ret = [];

  if (delim === null) {
    return tryJSONparse(str);
  }

  var list = str.split(delim);
  for(var i = 0; i < list.length; i++) {
    ret.push(tryJSONparse(list[i]));
  }
  ret = _.compact(ret);
  return ret.length === 0 ? false : ret;

};

exports.diffTime = function(time) {
  var diff = process.hrtime(time);
  return (diff[0] * 1E9 + diff[1])/(1E9 * 1.0);
};

/*
* input: string representing a number + multiple of bytes, e.g. 500MB, 200KB, 100B
* output: integer representing the byte count
*/
exports.parseByteCount = function(byteCountString) {

  function finish(n, m) {
    var num = parseInt(n);
    if (num > 0) {
      return num * m;
    }
    return null;
  }

  if (!_.isString(byteCountString)) {
    return byteCountString;
  }
  var str = byteCountString.replace(/\s+/g, '');
  var map = { 'MB': 1E6, 'kB': 1000, 'KB': 1000, 'MiB': (1024 * 1024),
    'KiB': 1024, 'GiB': Math.pow(1024, 3), 'GB': 1E9 };
  var keys = Object.keys(map);
  for(var i = 0; i < keys.length; i++) {
    var re = new RegExp(keys[i] + '$');
    var match = str.match(re);
    if (match) {
      var num = str.slice(0, match.index);
      return finish(num, map[keys[i]]);
    }
  }
  return finish(byteCountString, 1);
};

/*
 * input: arguments passed into originating function (whoever called us)
 * output: bool args are valid for encoding a key to the database
*/
exports.hasRequiredArgsForEncoding = function(args) {
  function exists(arg) {
    return !(arg === null || arg === undefined);
  }

  if (!exists(args[0])) {
    return false;
  }

  var pastArgMissing;

  for(var i = 1; i < args.length; i++) {
    var argMissing = exists(args[i]);
    if (argMissing && pastArgMissing) {
      return false;
    }
    pastArgMissing = argMissing;
  }

  return true;
};

exports.toJSONL = function(obj) {
  //this should be a standard obj that JSON.stringify will handle
  //general newlines within key values or data values are not permitted
  //this is intended to be used for bitcoin tx's that don't have newlines
  //within keys or values themselves
  var str = JSON.stringify(obj);
  str = str.replace(/\n/g, '');
  return str + '\n';
};

module.exports = exports;
