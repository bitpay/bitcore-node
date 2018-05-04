import { BitcoinTransactionType } from "./Transaction";
export type BlockHeader = {
  prevHash: string;
  hash: string;
  time: number;
  version: string;
  merkleRoot: string;
  bits: string;
  nonce: string;
};
export type BitcoinBlockType = {
  hash: string;
  transactions: BitcoinTransactionType[];
  header: BlockHeader;
  toBuffer: () => Buffer;
};
