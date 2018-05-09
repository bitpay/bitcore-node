import { BTCStateProvider } from "./btc/btc";
import { BCHStateProvider } from "./bch/bch";
import { CSP } from "../../types/namespaces/ChainStateProvider";
import { Chain } from "../../types/ChainNetwork";

const providers: CSP.ChainStateProviders = {
  BTC: new BTCStateProvider(),
  BCH: new BCHStateProvider()
};

class ChainStateProvider implements CSP.ChainStateProvider {
  get({ chain }: Chain) {
    return providers[chain];
  }

  streamAddressUtxos(params: CSP.StreamAddressUtxosParams) {
    return this.get(params).streamAddressUtxos(params);
  }

  async getBalanceForAddress(params: CSP.GetBalanceForAddressParams) {
    return this.get(params).getBalanceForAddress(params);
  }

  async getBalanceForWallet(params: CSP.GetBalanceForWalletParams) {
    return this.get(params).getBalanceForWallet(params);
  }

  async getBlock(params: CSP.GetBlockParams) {
    return this.get(params).getBlock(params);
  }

  async getBlocks(params: CSP.GetBlocksParams) {
    return this.get(params).getBlocks(params);
  }

  streamTransactions(params: CSP.StreamTransactionsParams) {
    return this.get(params).streamTransactions(params);
  }

  streamTransaction(params: CSP.StreamTransactionParams) {
    return this.get(params).streamTransaction(params);
  }

  async createWallet(params: CSP.CreateWalletParams) {
    return this.get(params).createWallet(params);
  }

  async getWallet(params: CSP.GetWalletParams) {
    return this.get(params).getWallet(params);
  }

  streamWalletAddresses(params: CSP.StreamWalletAddressesParams) {
    return this.get(params).streamWalletAddresses(params);
  }

  async updateWallet(params: CSP.UpdateWalletParams) {
    return this.get(params).updateWallet(params);
  }

  streamWalletTransactions(params: CSP.StreamWalletTransactionsParams) {
    return this.get(params).streamWalletTransactions(params);
  }

  async getWalletBalance(params: CSP.GetWalletBalanceParams) {
    return this.get(params).getWalletBalance(params);
  }

  streamWalletUtxos(params: CSP.StreamWalletUtxosParams) {
    return this.get(params).streamWalletUtxos(params);
  }

  async broadcastTransaction(params: CSP.BroadcastTransactionParams) {
    return this.get(params).broadcastTransaction(params);
  }
}

export default new ChainStateProvider();
