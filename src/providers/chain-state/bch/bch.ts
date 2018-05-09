import { BTCStateProvider }  from '../btc/btc';

export class BCHStateProvider extends BTCStateProvider {
  constructor() {
    super('BCH');
  }
}
