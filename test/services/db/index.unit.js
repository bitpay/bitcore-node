'use strict';

var chai = require('chai');
var should = chai.should();
var assert = chai.assert;
var expect = chai.expect;
var DBService = require('../../../lib/services/db');
var sinon = require('sinon');
var Levelup = require('levelup');
var Tx = require('bcoin').tx;

describe('DB', function() {

  var dbService;
  var tx = Tx.fromRaw( '0100000004de9b4bb17f627096a9ee0b4528e4eae17df5b5c69edc29704c2e84a7371db29f010000006b483045022100f5b1a0d33b7be291c3953c25f8ae39d98601aa7099a8674daf638a08b86c7173022006ce372da5ad088a1cc6e5c49c2760a1b6f085eb1b51b502211b6bc9508661f9012102ec5e3731e54475dd2902326f43602a03ae3d62753324139163f81f20e787514cffffffff7a1d4e5fc2b8177ec738cd723a16cf2bf493791e55573445fc0df630fe5e2d64010000006b483045022100cf97f6cb8f126703e9768545dfb20ffb10ba78ae3d101aa46775f5a239b075fc02203150c4a89a11eaf5e404f4f96b62efa4455e9525765a025525c7105a7e47b6db012102c01e11b1d331f999bbdb83e8831de503cd52a01e3834a95ccafd615c67703d77ffffffff9e52447116415ca0d0567418a1a4ef8f27be3ff5a96bf87c922f3723d7db5d7c000000006b483045022100f6c117e536701be41a6b0b544d7c3b1091301e4e64a6265b6eb167b15d16959d022076916de4b115e700964194ce36a24cb9105f86482f4abbc63110c3f537cd5770012102ddf84cc7bee2d6a82ac09628a8ad4a26cd449fc528b81e7e6cc615707b8169dfffffffff5815d9750eb3572e30d6fd9df7afb4dbd76e042f3aa4988ac763b3fdf8397f80010000006a473044022028f4402b736066d93d2a32b28ccd3b7a21d84bb58fcd07fe392a611db94cdec5022018902ee0bf2c3c840c1b81ead4e6c87c88c48b2005bf5eea796464e561a620a8012102b6cdd1a6cd129ef796faeedb0b840fcd0ca00c57e16e38e46ee7028d59812ae7ffffffff0220a10700000000001976a914c342bcd1a7784d9842f7386b8b3b8a3d4171a06e88ac59611100000000001976a91449f8c749a9960dc29b5cbe7d2397cea7d26611bb88ac00000000', 'hex');

  var sandbox;
  beforeEach(function() {
    sandbox = sinon.sandbox.create();
    dbService = new DBService({
      node: {
        services: [],
        datadir: '/tmp',
        network: 'regtest',
        on: sinon.stub()
      }
    });
  });

  afterEach(function() {
    sandbox.restore();
  });

  describe('#start', function() {
    it('should start the db service by creating a db dir, ' +
      ' if necessary, and setting the store', function(done) {

      dbService._setDataPath();

      dbService.start(function() {
        dbService._store.should.be.instanceOf(Levelup);
        done();
      });
    });
  });

  describe('#stop', function() {
    it('should stop if store not open', function(done) {
      dbService.stop(function() {
        var close = sandbox.stub().callsArg(0);
        dbService._store = { close: close };
        dbService._stopping.should.be.true;
        done();
      });
    });

    it('should stop if store open', function(done) {
      dbService.stop(function() {
        var close = sandbox.stub().callsArg(0);
        dbService._store = { close: close, isOpen: sinon.stub().returns(true) };
        dbService._stopping.should.be.true;
        done();
      });
    });
  });

  describe('#_onError', function() {
    it('should stop the db', function() {
      var stop = sandbox.stub();
      dbService.node = { stop: stop };
      dbService._onError(new Error('some error'));
      stop.should.be.calledOnce;
    });
  });

  describe('#_setDataPath', function() {

    it('should set the data path', function() {
      dbService._setDataPath();
      dbService.dataPath.should.equal('/tmp/regtest/bitcorenode.db');
    });

  });

  describe('#_setVersion', function() {
    it('should set the version', function(done) {
      var put = sandbox.stub(dbService, 'put').callsArgWith(2, null);
      dbService._setVersion(function(err) {
        put.should.be.calledOnce;
        put.args[0][0].toString('hex').should.deep.equal('ffff76657273696f6e');
        put.args[0][1].toString('hex').should.deep.equal('00000001');
        done();
      });
    });
  });

  describe('#get', function() {
    it('should get a value from the db', function(done) {
      var get = sandbox.stub().callsArgWith(2, null, 'data');
      dbService._store = { get: get };
      dbService.get('key', function(err, value) {
        if (err) {
          return done(err);
        }
        value.should.equal('data');
        done();
      });
    });

    it('should not get a value while the node is shutting down', function(done) {
      dbService._stopping = true;
      dbService.get('key', function(err, value) {
        err.message.should.equal('Shutdown sequence underway, not able to complete the query');
        done();
      });
    });

  });

  describe('#put', function() {
    it('should put a value in the db', function(done) {
      var put = sandbox.stub().callsArgWith(2, null);
      dbService._store = { put: put };
      dbService.put(new Buffer('key'), new Buffer('value'), function(err) {
        if (err) {
          return done(err);
        }
        put.should.be.calledOnce;
        done();
      });
    });

    it('should not allow an operation while the node is shutting down', function(done) {
      dbService._stopping = true;
      dbService.put(new Buffer('key'), new Buffer('value'), function(err) {
        done();
      });
    });
  });

  describe('#batch', function() {

    it('should save a batch of operations', function(done) {

      var batch = sandbox.stub().callsArgWith(1, null);
      dbService._store = { batch: batch };

      dbService.batch([], function(err) {

        if(err) {
          return done(err);
        }

        batch.callCount.should.equal(1);
        done();


      });
    });

    it('should not call batch whilst shutting down', function(done) {

      dbService._stopping = true;

      var batch = sandbox.stub().callsArgWith(1, null);
      dbService._store = { batch: batch };

      dbService.batch(batch, function(err) {

        if(err) {
          return done(err);
        }

        batch.callCount.should.equal(0);
        done();


      });

    });
  });

  describe('#createReadStream', function() {

    it('should get a read stream', function() {

      var on = sandbox.stub();
      var stream = { on: on };
      var createReadStream = sandbox.stub().returns(stream);
      dbService._store = { createReadStream: createReadStream };
      dbService.createReadStream([]).should.deep.equal(stream);
      createReadStream.callCount.should.equal(1);

    });

    it('should not get a read stream if the node is stopping', function() {

      dbService._stopping = true;

      var on = sandbox.stub();
      var stream = { on: on };
      var createReadStream = sandbox.stub().returns(stream);
      dbService._store = { createReadStream: createReadStream };
      var stream = dbService.createReadStream([]);
      expect(stream).to.be.undefined;

    });

  });

  describe('#createKeyStream', function() {

    it('should get a key stream', function() {

      var on = sandbox.stub();
      var stream = { on: on };
      var createKeyStream = sandbox.stub().returns(stream);
      dbService._store = { createKeyStream: createKeyStream };
      dbService.createKeyStream([]).should.deep.equal(stream);
      createKeyStream.callCount.should.equal(1);

    });

    it('should not get a key stream if the node is stopping', function() {

      dbService._stopping = true;

      var on = sandbox.stub();
      var stream = { on: on };
      var createKeyStream = sandbox.stub().returns(stream);
      dbService._store = { createKeyStream: createKeyStream };
      var stream = dbService.createKeyStream([]);
      expect(stream).to.be.undefined;

    });
  });

  describe('#close', function() {
    this.timeout(3000);
    it('should close the store if there is a store and it is open', function(done) {

      var close = sandbox.stub().callsArgWith(0, null);
      dbService._store = { isClosed: sinon.stub().returns(false), close: close };

      dbService.close(function(err) {
        if(err) {
          return done(err);
        }
        close.callCount.should.equal(1);
        done();
      });
    });
    this.timeout(2000);
  });

  describe('#getServiceTip', function() {
    it('should get service tip for previously saved', function(done) {

      var tipBuf = Buffer.concat([ new Buffer('deadbeef', 'hex'), new Buffer(tx.txid(), 'hex') ]);
      var get = sandbox.stub(dbService, 'get').callsArgWith(1, null, tipBuf);
      dbService.getServiceTip('test', function(err, tip) {

        if(err) {
          return done(err);
        }

        get.callCount.should.equal(1);
        tip.height.should.equal(0xdeadbeef);
        tip.hash.should.equal(tx.txid());
        done();

      });
    });

    it('should get service tip for not previously saved', function(done) {

      var get = sandbox.stub(dbService, 'get').callsArgWith(1, null, null);
      dbService.getServiceTip('test', function(err, tip) {

        if(err) {
          return done(err);
        }

        get.callCount.should.equal(1);
        tip.height.should.equal(0);
        tip.hash.should.equal('0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206');
        done();

      });
    });
  });

  describe('#getPrefix', function() {

   it('should get the db prefix for a service when one already exists', function(done) {
     var get = sandbox.stub(dbService, 'get').callsArgWith(1, null, new Buffer('0000', 'hex'));
     dbService.getPrefix('test', function(err, prefix) {

       if(err) {
         return done(err);
       }

       get.callCount.should.equal(1);
       prefix.toString('hex').should.equal('0000');
       done();
     });
   });

   it('should get the db prefix for a service when one does not already exist', function(done) {
     var put = sandbox.stub(dbService, 'put').callsArgWith(2, null);
     var get = sandbox.stub(dbService, 'get');
     get.onCall(0).callsArgWith(1, null, null);
     get.onCall(1).callsArgWith(1, null, new Buffer('eeee', 'hex'));
     dbService.getPrefix('test', function(err, prefix) {

       if(err) {
         return done(err);
       }

       get.callCount.should.equal(2);
       put.callCount.should.equal(2);
       put.args[1][1].toString('hex').should.equal('eeef');
       prefix.toString('hex').should.equal('eeee');
       done();
     });
   });
  });
});

