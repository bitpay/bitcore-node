import { Schema, Query, Document, Model, model, DocumentQuery } from "mongoose";
import { TransformOptions } from "../types/TransformOptions";
import { WalletAddressModel } from "../models/walletAddress";

export interface IWallet {
  _id: Schema.Types.ObjectId;
  name: string;
  chain: string;
  network: string;
  singleAddress: boolean;
  pubKey: string;
  path: string;
}
export type WalletQuery = { [key in keyof IWallet]?: any } &
  DocumentQuery<IWallet, Document>;

type IWalletDoc = IWallet & Document;
type IWalletModelDoc = IWallet & Model<IWalletDoc>;
export interface IWalletModel extends IWalletModelDoc {
  updateCoins: (wallet: IWalletModelDoc) => any;
}

const WalletSchema = new Schema({
  name: String,
  chain: String,
  network: String,
  singleAddress: Boolean,
  pubKey: String,
  path: String
});

WalletSchema.index({ pubKey: 1 });

WalletSchema.statics._apiTransform = function(
  wallet: IWalletModelDoc,
  options: TransformOptions
) {
  let transform = {
    name: wallet.name,
    pubKey: wallet.pubKey
  };
  if (options && options.object) {
    return transform;
  }
  return JSON.stringify(transform);
};

WalletSchema.statics.updateCoins = async function(wallet: IWalletModel) {
  let addresses = await WalletAddressModel.find({ wallet: wallet._id });
  return WalletAddressModel.updateCoins({ wallet, addresses });
};

export let WalletModel: IWalletModel = model<IWalletDoc, IWalletModel>(
  "Wallet",
  WalletSchema
);
