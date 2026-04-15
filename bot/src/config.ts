import "dotenv/config";
import { type Address, type Hex, isAddress, isHex } from "viem";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required env variable: ${key}`);
  }
  return value;
}

function requireAddress(key: string): Address {
  const value = requireEnv(key);
  if (!isAddress(value)) {
    throw new Error(`Invalid address for ${key}: ${value}`);
  }
  return value as Address;
}

// ---- RPC ---- //
export const RPC_URL = requireEnv("RPC_URL");
export const RPC_WSS = process.env["RPC_WSS"] ?? "";

// ---- Bot Wallet ---- //
const rawKey = requireEnv("BOT_PRIVATE_KEY");
if (!isHex(rawKey) || rawKey.length !== 66) {
  throw new Error("BOT_PRIVATE_KEY must be a 0x-prefixed 64-char hex string");
}
export const BOT_PRIVATE_KEY = rawKey as Hex;

// ---- Contract Addresses ---- //
export const TREASURY_ADDRESS = requireAddress("TREASURY_ADDRESS");
export const ROUTER_ADDRESS = requireAddress("ROUTER_ADDRESS");

// ---- Bot Ayarları ---- //
export const POLL_INTERVAL_MS = Number(process.env["POLL_INTERVAL_MS"] ?? "3000");
export const MIN_PROFIT_USD = Number(process.env["MIN_PROFIT_USD"] ?? "5");
export const MAX_GAS_GWEI = Number(process.env["MAX_GAS_GWEI"] ?? "50");
export const DRY_RUN = process.env["DRY_RUN"] !== "false"; // default: true
export const ETH_PRICE_USD = Number(process.env["ETH_PRICE_USD"] ?? "3000");

// ---- Token Adresleri (Ethereum Mainnet) ---- //
// Yeni ağ desteği eklerken buraya chain-specific tokenları ekle
export const TOKENS = {
  WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as Address,
  USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address,
  USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7" as Address,
  DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F" as Address,
  WBTC: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" as Address,
} as const;

// ---- İzlenecek Pool Çiftleri ---- //
export interface PoolPair {
  tokenA: Address;
  tokenB: Address;
  label: string;
  // V2 pair adresleri (Uniswap, SushiSwap)
  uniV2Pair: Address;
  sushiPair: Address;
  // V3 pool adresi + fee tier
  uniV3Pool: Address;
  uniV3Fee: number;
}

// Ethereum mainnet'te en likit çiftler
export const MONITORED_POOLS: PoolPair[] = [
  {
    label: "WETH/USDC",
    tokenA: TOKENS.WETH,
    tokenB: TOKENS.USDC,
    uniV2Pair: "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc" as Address,
    sushiPair: "0x397FF1542f962076d0BFE58eA045FfA2d347ACa0" as Address,
    uniV3Pool: "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640" as Address,
    uniV3Fee: 500, // 0.05%
  },
  {
    label: "WETH/USDT",
    tokenA: TOKENS.WETH,
    tokenB: TOKENS.USDT,
    uniV2Pair: "0x0d4a11d5EEaaC28EC3F61d100daF4d40471f1852" as Address,
    sushiPair: "0x06da0fd433C1A5d7a4faa01111c044910A184553" as Address,
    uniV3Pool: "0x4e68Ccd3E89f51C3074ca5072bbAC773960dFa36" as Address,
    uniV3Fee: 3000, // 0.3%
  },
  {
    label: "WETH/DAI",
    tokenA: TOKENS.WETH,
    tokenB: TOKENS.DAI,
    uniV2Pair: "0xA478c2975Ab1Ea89e8196811F51A7B7Ade33eB11" as Address,
    sushiPair: "0xC3D03e4F041Fd4cD388c549Ee2A29a9E5075882f" as Address,
    uniV3Pool: "0xC2e9F25Be6257c210d7Adf0D4Cd6E3E881ba25f8" as Address,
    uniV3Fee: 3000,
  },
];

// ---- DEX Router Adresleri ---- //
export const DEX = {
  UNISWAP_V2: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D" as Address,
  UNISWAP_V3: "0xE592427A0AEce92De3Edee1F18E0157C05861564" as Address,
  SUSHISWAP: "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F" as Address,
} as const;
