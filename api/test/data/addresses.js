'use strict';

var mockAddresses = {
  '1CT9huFgxMFveRvzZ7zPPJNoaMm2Fo64VH': {
    summary: {
      address: '1CT9huFgxMFveRvzZ7zPPJNoaMm2Fo64VH',
      transactions: [
        'b944ef8c77f9b5f4a4276880f17256988bba4d0125abc54391548061a688ae09'
      ],
      unconfirmed: {
        balance: 5000000000,
        received: 5000000000,
        sent: 0,
      },
      confirmed: {
        balance: 5000000000,
        received: 5000000000,
        sent: 0,
      }
    },
    utxos: [{
      satoshis: 5000000000,
      script: '4104b715afd59b31be928e073e375a6196d654a78d9aa709789665dd4aecf1b85ebc850ffb90a1c04f18565afe0be4a042ff6629c398f674a5c632b017d793dc8e04ac',
      txid: 'b944ef8c77f9b5f4a4276880f17256988bba4d0125abc54391548061a688ae09',
      index: 0
    }]
  },
  '1HZH6zHri1qc68s34MmE5MwG9xstbkFavo': {
    summary: {
      address: '1HZH6zHri1qc68s34MmE5MwG9xstbkFavo',
      transactions: [
        '07ebb557e5782d4b9b7180c5b0b299ab1249d28f3454ccc19d4e7bd819e5ec35',
        '7b309cef1b87471baee38a533c850ce25350f10e88a64e04da1ee08a69dbbba1',
        '0c88e745b5c1dffccc39a96f3e25e9486bcafde82b92441f463859df15685959',
      ],
      unconfirmed: {
        balance: 200000043000,
        received: 200000043000,
        sent: 0,
      },
      confirmed: {
        balance: 200000043000,
        received: 200000043000,
        sent: 0,
      }
    },
    utxos: [{
      satoshis: 200000000000,
      script: '76a914b59cc3ffe416e460a75baaae3d78cafc787e329d88ac',
      txid: '0c88e745b5c1dffccc39a96f3e25e9486bcafde82b92441f463859df15685959',
      index: 1
    }, {
      satoshis: 1000,
      script: '76a914b59cc3ffe416e460a75baaae3d78cafc787e329d88ac',
      txid: '7b309cef1b87471baee38a533c850ce25350f10e88a64e04da1ee08a69dbbba1',
      index: 46
    }, {
      satoshis: 42000,
      script: '76a914b59cc3ffe416e460a75baaae3d78cafc787e329d88ac',
      txid: '07ebb557e5782d4b9b7180c5b0b299ab1249d28f3454ccc19d4e7bd819e5ec35',
      index: 41
    }]

  },
  '1CEXio2gSCozXeSuKQJCDMEpgHfaiT48A3': {
    summary: {
      address: '1CEXio2gSCozXeSuKQJCDMEpgHfaiT48A3',
      transactions: [
        '07ebb557e5782d4b9b7180c5b0b299ab1249d28f3454ccc19d4e7bd819e5ec35',
        'b6025e6835966b31f40a9f0bb4a1717df0976ec23934934d2b2580a884c09b68',
        '6ae158f49c25435c472f1533bce7d090f9edeb75b20fc30297ee78c962f4295a',
        '35dd6607d21b3b0739fc0696d0633eaaa26f5ab10e2cbb0fa12353c2ccff6f83',
        'f14c1e10e8b0657068df4d53d8d93d1eb6b1f699041f7d505d5c482479c59634',
        '9aa72c5b116a12f80b2d38b1f7bb43356d3a4f02637e7ac5abfeebb14862a3f8',
        '9a0a957583f5ea390b2b5573ace7d67a876aeb66c59ada5c0d79a6b7affb34f6',
        '585d59d3223eef73ccdc3c19b4e85cb0cc66ea818f173cf6d54723785c7210a1',
        '2952d4f79d2388c3cb931e92699ded43fe3b92f2a58f03ee0c68a0a5b0d73e46',
        'f4e18bfbd9edc5ac0cfdd5b0869d77ef5cd38908afe106c02d189ac835569c87',
        '4fb1495d114e6853acbe95c38f0acad1b8f790f8979148015e8fbfc3d0c394e9',
      ],
      unconfirmed: {
        balance: 93350245,
        received: 1230747491,
        sent: 1137397246,
      },
      confirmed: {
        balance: 93350245,
        received: 1230747491,
        sent: 1137397246,
      }
    },
    utxos: [{
      'satoshis': 5636607,
      'script': '76a9147b386f749b54b874f8ce5d2a344bd524f2d7c62188ac',
      'txid': '9aa72c5b116a12f80b2d38b1f7bb43356d3a4f02637e7ac5abfeebb14862a3f8',
      'index': 1
    }, {
      'satoshis': 47379701,
      'script': '76a9147b386f749b54b874f8ce5d2a344bd524f2d7c62188ac',
      'txid': 'f14c1e10e8b0657068df4d53d8d93d1eb6b1f699041f7d505d5c482479c59634',
      'index': 1
    }, {
      'satoshis': 17254743,
      'script': '76a9147b386f749b54b874f8ce5d2a344bd524f2d7c62188ac',
      'txid': '35dd6607d21b3b0739fc0696d0633eaaa26f5ab10e2cbb0fa12353c2ccff6f83',
      'index': 1
    }, {
      'satoshis': 8460000,
      'script': '76a9147b386f749b54b874f8ce5d2a344bd524f2d7c62188ac',
      'txid': 'b6025e6835966b31f40a9f0bb4a1717df0976ec23934934d2b2580a884c09b68',
      'index': 0
    }, {
      'satoshis': 8460000,
      'script': '76a9147b386f749b54b874f8ce5d2a344bd524f2d7c62188ac',
      'txid': '6ae158f49c25435c472f1533bce7d090f9edeb75b20fc30297ee78c962f4295a',
      'index': 0
    }, {
      'satoshis': 6159194,
      'script': '76a9147b386f749b54b874f8ce5d2a344bd524f2d7c62188ac',
      'txid': '07ebb557e5782d4b9b7180c5b0b299ab1249d28f3454ccc19d4e7bd819e5ec35',
      'index': 100
    }]

  },
};

module.exports = mockAddresses;
