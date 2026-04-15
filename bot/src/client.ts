import {
  createPublicClient,
  createWalletClient,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";
import { RPC_URL, BOT_PRIVATE_KEY } from "./config.js";

export const account = privateKeyToAccount(BOT_PRIVATE_KEY);

export const publicClient = createPublicClient({
  chain: mainnet,
  transport: http(RPC_URL),
});

export const walletClient = createWalletClient({
  account,
  chain: mainnet,
  transport: http(RPC_URL),
});
