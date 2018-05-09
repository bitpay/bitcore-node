import { SupportedChain } from "./SupportedChain";
export type Chain = { chain: SupportedChain};
export type Network = {network: string};
export type ChainNetwork = Chain & Network;
