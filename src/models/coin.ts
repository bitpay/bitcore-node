import {Schema, Query, Document, Model, model, DocumentQuery} from 'mongoose';

export interface ICoin {
  network: string,
    chain: string,
    mintTxid: string,
    mintIndex: number,
    mintHeight: number,
    coinbase: boolean,
    value: number,
    address: string,
    script: Buffer,
    wallets: Schema.Types.ObjectId,
    spentTxid: string,
    spentHeight: number
}
export type CoinQuery = {
  [key in keyof ICoin]?: any
} & DocumentQuery<ICoin, Document>;

type ICoinDoc = ICoin & Document;
type ICoinModelDoc = ICoinDoc & Model<ICoinDoc>;
export interface ICoinModel extends ICoinModelDoc{
  getBalance: (params: {query: CoinQuery}) => any
}
const Coin = new Schema({
  network: String,
  chain: String,
  mintTxid: String,
  mintIndex: Number,
  mintHeight: Number,
  coinbase: Boolean,
  value: Number,
  address: String,
  script: Buffer,
  wallets: { type: [Schema.Types.ObjectId] },
  spentTxid: String,
  spentHeight: Number
});

Coin.index({ mintTxid: 1 });
Coin.index(
  { mintTxid: 1, mintIndex: 1 },
  { partialFilterExpression: { spentHeight: { $lt: 0 } } }
);
Coin.index({ address: 1 });
Coin.index({ mintHeight: 1, chain: 1, network: 1 });
Coin.index({ spentTxid: 1 }, { sparse: true });
Coin.index({ spentHeight: 1, chain: 1, network: 1 });
Coin.index({ wallets: 1, spentHeight: 1 }, { sparse: true });


Coin.statics.getBalance = function(params: {query: CoinQuery}) {
  let { query } = params;
  query = Object.assign(query, { spentHeight: { $lt: 0 } });
  return this.aggregate([
    { $match: query },
    {
      $group: {
        _id: null,
        balance: { $sum: '$value' }
      }
    },
    { $project: { _id: false } }
  ]);
};

Coin.statics._apiTransform = function(coin: ICoin, options: {object: boolean}) {
  let script = coin.script || '';
  let transform = {
    txid: coin.mintTxid,
    vout: coin.mintIndex,
    spentTxid: coin.spentTxid,
    address: coin.address,
    script: script.toString('hex'),
    value: coin.value
  };
  if (options && options.object) {
    return transform;
  }
  return JSON.stringify(transform);
};

export let CoinModel: ICoinModel = model<ICoinDoc, ICoinModel>('Coin', Coin);
