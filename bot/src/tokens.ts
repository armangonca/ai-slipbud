import { type Address } from "viem";

/**
 * Token decimal map — bilinen tokenların decimal değerleri.
 * Bilinmeyen tokenlar için fallback: 18.
 */
const DECIMAL_MAP: Record<string, number> = {
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": 18, // WETH
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": 6,  // USDC
  "0xdac17f958d2ee523a2206206994597c13d831ec7": 6,  // USDT
  "0x6b175474e89094c44da98b954eedeac495271d0f": 18, // DAI
  "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599": 8,  // WBTC
};

export function getDecimals(token: Address): number {
  return DECIMAL_MAP[token.toLowerCase()] ?? 18;
}
