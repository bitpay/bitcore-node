'use strict';

var Sequelize = require('sequelize');
var Promise = require('bluebird');
var _ = require('bitcore').deps._;

function Schema(database) {
  var defaultProps = {
    underscored: true,
    freezeTableName: true
  };
  var Transaction = database.define('Transaction', {
    hash: {
      type: Sequelize.STRING,
      unique: true
    },
    version: Sequelize.INTEGER,
    nLockTime: Sequelize.BIGINT(11),
    raw: Sequelize.BLOB,

    blockHeight: Sequelize.INTEGER

  }, defaultProps);

  var Input = database.define('Input', {
    inputIndex: Sequelize.BIGINT(11),

    amount: Sequelize.BIGINT(16),
    prevTxId: Sequelize.STRING,
    outputIndex: Sequelize.BIGINT(11),

    sequenceNumber: Sequelize.BIGINT(11),
    script: Sequelize.BLOB,

    blockHeight: Sequelize.INTEGER
  }, defaultProps);

  var Output = database.define('Output', {
    outputIndex: Sequelize.BIGINT(11),

    amount: Sequelize.BIGINT(16),
    script: Sequelize.BLOB,
    outputType: Sequelize.ENUM('NONE', 'P2PKH', 'P2SH', 'OP_RETURN'),

    spentHeight: Sequelize.INTEGER

  }, defaultProps);

  Transaction.hasMany(Input);
  Transaction.hasMany(Output);

  var Address = database.define('Address', {
    base58: Sequelize.STRING
  }, defaultProps);

  Address.belongsToMany(Output, { as: 'outputs', through: 'AddressOutput' });
  Address.belongsToMany(Input, { as: 'inputs', through: 'AddressInput' });
  Transaction.belongsToMany(Address, { as: 'transactions', through: 'TransactionAddress' });
  Address.belongsToMany(Transaction, { as: 'addresses', through: 'TransactionAddress' });

  var Block = database.define('Block', {
    hash: {
      type: Sequelize.STRING,
      unique: true
    },

    version: Sequelize.BIGINT(11),
    height: Sequelize.INTEGER,
    time: Sequelize.BIGINT(11),
    nonce: Sequelize.BIGINT(11),
    merkleRoot: Sequelize.STRING,

    parent: Sequelize.STRING,
    mainChain: Sequelize.BOOLEAN
  }, defaultProps);

  Block.hasMany(Transaction, { as: 'mainBlock' });

  Transaction.belongsToMany(Block, { as: 'blocks', through: 'TransactionBlock' });
  Block.belongsToMany(Transaction, { as: 'transactions', through: 'TransactionBlock' });

  return database.sync().then(function() {
    return _.extend(database, {
      Transaction: Transaction,
      Block: Block,
      Address: Address,
      Input: Input,
      Output: Output
    });
  });
}

module.exports = Schema;
