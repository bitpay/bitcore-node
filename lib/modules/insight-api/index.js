'use strict';

var BaseModule = require('../../module');
var inherits = require('util').inherits;
var BlockController = require('./blocks');
var TxController = require('./transactions');
var AddressController = require('./addresses');

var InsightAPI = function(options) {
  BaseModule.call(this, options);
};

InsightAPI.info = {
  name: 'insight-api',
  dependencies: ['address']
};

inherits(InsightAPI, BaseModule);

InsightAPI.prototype.setupRoutes = function(app) {
  var apiPrefix = '/api/insight';

  //Block routes
  var blocks = new BlockController(this.db);
  app.get(apiPrefix + '/blocks', blocks.list.bind(blocks));


  app.get(apiPrefix + '/block/:blockHash', blocks.show.bind(blocks));
  app.param('blockHash', blocks.block.bind(blocks));

  app.get(apiPrefix + '/block-index/:height', blocks.blockIndex.bind(blocks));
  app.param('height', blocks.blockIndex.bind(blocks));


  // Transaction routes
  var transactions = new TxController(this.db);
  app.get(apiPrefix + '/tx/:txid', transactions.show.bind(transactions));
  app.param('txid', transactions.transaction.bind(transactions));
  //app.get(apiPrefix + '/txs', transactions.list);
  //app.post(apiPrefix + '/tx/send', transactions.send);

  // Raw Routes
  app.get(apiPrefix + '/rawtx/:txid', transactions.showRaw.bind(transactions));
  app.param('txid', transactions.rawTransaction.bind(transactions));

  // Address routes
  var addresses = new AddressController(this.db);
  app.get(apiPrefix + '/addr/:addr', addresses.show.bind(addresses));
  app.param('addr', addresses.show.bind(addresses));
  // app.get(apiPrefix + '/addr/:addr/utxo', addresses.utxo);
  // app.get(apiPrefix + '/addrs/:addrs/utxo', addresses.multiutxo);
  // app.post(apiPrefix + '/addrs/utxo', addresses.multiutxo);
  // app.get(apiPrefix + '/addrs/:addrs/txs', addresses.multitxs);
  // app.post(apiPrefix + '/addrs/txs', addresses.multitxs);

  // Address property routes
  // app.get(apiPrefix + '/addr/:addr/balance', addresses.balance);
  // app.get(apiPrefix + '/addr/:addr/totalReceived', addresses.totalReceived);
  // app.get(apiPrefix + '/addr/:addr/totalSent', addresses.totalSent);
  // app.get(apiPrefix + '/addr/:addr/unconfirmedBalance', addresses.unconfirmedBalance);

  // Status route
  /*var st = require('../app/controllers/status');
  app.get(apiPrefix + '/status', st.show);

  app.get(apiPrefix + '/sync', st.sync);
  app.get(apiPrefix + '/peer', st.peer);

  // Utils route
  var utils = require('../app/controllers/utils');
  app.get(apiPrefix + '/utils/estimatefee', utils.estimateFee);

  // Currency
  var currency = require('../app/controllers/currency');
  app.get(apiPrefix + '/currency', currency.index);

  // Email store plugin
  if (config.enableEmailstore) {
    var emailPlugin = require('../plugins/emailstore');
    app.get(apiPrefix + '/email/retrieve', emailPlugin.retrieve);
  }

  // Currency rates plugin
  if (config.enableCurrencyRates) {
    var currencyRatesPlugin = require('../plugins/currencyrates');
    app.get(apiPrefix + '/rates/:code', currencyRatesPlugin.getRate);
  }

  // Address routes
  var messages = require('../app/controllers/messages');
  app.get(apiPrefix + '/messages/verify', messages.verify);
  app.post(apiPrefix + '/messages/verify', messages.verify);

  //Home route
  var index = require('../app/controllers/index');
  app.get(apiPrefix + '/version', index.version);
  app.get('*', index.render);*/
};

module.exports = InsightAPI;