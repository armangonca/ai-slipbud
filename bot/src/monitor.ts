import { type Address, getContract, formatUnits } from "viem";
import { publicClient } from "./client.js";
import { type PoolPair } from "./config.js";
import { logger } from "./logger.js";

// ---- ABI'ler ---- //

const UNISWAP_V2_PAIR_ABI = [
  {
    name: "getReserves",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "reserve0", type: "uint112" },
      { name: "reserve1", type: "uint112" },
      { name: "blockTimestampLast", type: "uint32" },
    ],
  },
  {
    name: "token0",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const UNISWAP_V3_POOL_ABI = [
  {
    name: "slot0",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint8" },
      { name: "unlocked", type: "bool" },
    ],
  },
  {
    name: "token0",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "liquidity",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint128" }],
  },
] as const;

// ---- Types ---- //

export interface V2PoolState {
  reserve0: bigint;
  reserve1: bigint;
  token0: Address;
}

export interface V3PoolState {
  sqrtPriceX96: bigint;
  tick: number;
  liquidity: bigint;
  token0: Address;
}

export interface PoolSnapshot {
  pair: PoolPair;
  uniV2: V2PoolState | null;
  sushiV2: V2PoolState | null;
  uniV3: V3PoolState | null;
  timestamp: number;
}

// ---- V2 Pool Okuma ---- //

async function readV2Pool(pairAddress: Address): Promise<V2PoolState | null> {
  try {
    const pair = getContract({
      address: pairAddress,
      abi: UNISWAP_V2_PAIR_ABI,
      client: publicClient,
    });

    const [reserves, token0] = await Promise.all([
      pair.read.getReserves(),
      pair.read.token0(),
    ]);

    return {
      reserve0: reserves[0],
      reserve1: reserves[1],
      token0: token0 as Address,
    };
  } catch (err) {
    logger.warn(`V2 pool okunamadı: ${pairAddress}`, err);
    return null;
  }
}

// ---- V3 Pool Okuma ---- //

async function readV3Pool(poolAddress: Address): Promise<V3PoolState | null> {
  try {
    const pool = getContract({
      address: poolAddress,
      abi: UNISWAP_V3_POOL_ABI,
      client: publicClient,
    });

    const [slot0, token0, liquidity] = await Promise.all([
      pool.read.slot0(),
      pool.read.token0(),
      pool.read.liquidity(),
    ]);

    return {
      sqrtPriceX96: slot0[0],
      tick: slot0[1],
      liquidity,
      token0: token0 as Address,
    };
  } catch (err) {
    logger.warn(`V3 pool okunamadı: ${poolAddress}`, err);
    return null;
  }
}

// ---- Fiyat Hesaplama ---- //

/**
 * V2 pool'dan tokenA -> tokenB fiyatını hesapla
 * amountIn birim tokenA karşılığında ne kadar tokenB alırsın
 */
export function getV2Price(
  pool: V2PoolState,
  tokenA: Address,
  decimalsA: number,
  decimalsB: number,
): number {
  const isToken0 = tokenA.toLowerCase() === pool.token0.toLowerCase();
  const reserveIn = isToken0 ? pool.reserve0 : pool.reserve1;
  const reserveOut = isToken0 ? pool.reserve1 : pool.reserve0;

  // price = reserveOut / reserveIn (decimal ayarlamalı)
  const priceRaw =
    Number(formatUnits(reserveOut, decimalsB)) /
    Number(formatUnits(reserveIn, decimalsA));

  return priceRaw;
}

/**
 * V2 pool'da belirli bir input için output hesapla (fee dahil)
 * Uniswap V2 formülü: amountOut = (amountIn * 997 * reserveOut) / (reserveIn * 1000 + amountIn * 997)
 */
export function getV2AmountOut(
  pool: V2PoolState,
  tokenIn: Address,
  amountIn: bigint,
): bigint {
  const isToken0 = tokenIn.toLowerCase() === pool.token0.toLowerCase();
  const reserveIn = isToken0 ? pool.reserve0 : pool.reserve1;
  const reserveOut = isToken0 ? pool.reserve1 : pool.reserve0;

  const amountInWithFee = amountIn * 997n;
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * 1000n + amountInWithFee;

  return numerator / denominator;
}

/**
 * V3 pool'dan sqrtPriceX96 üzerinden fiyat hesapla
 */
export function getV3Price(
  pool: V3PoolState,
  tokenA: Address,
  decimalsA: number,
  decimalsB: number,
): number {
  // price = (sqrtPriceX96 / 2^96) ^ 2
  // Bu token0/token1 fiyatını verir
  const sqrtPrice = Number(pool.sqrtPriceX96) / 2 ** 96;
  const priceToken0InToken1 = sqrtPrice * sqrtPrice;

  const isToken0 = tokenA.toLowerCase() === pool.token0.toLowerCase();

  // Decimal ayarlaması
  const decimalAdjustment = 10 ** (decimalsA - decimalsB);

  if (isToken0) {
    return priceToken0InToken1 * decimalAdjustment;
  } else {
    return (1 / priceToken0InToken1) * decimalAdjustment;
  }
}

// ---- Pool Snapshot ---- //

export async function takePoolSnapshot(pair: PoolPair): Promise<PoolSnapshot> {
  const [uniV2, sushiV2, uniV3] = await Promise.all([
    readV2Pool(pair.uniV2Pair),
    readV2Pool(pair.sushiPair),
    readV3Pool(pair.uniV3Pool),
  ]);

  return {
    pair,
    uniV2,
    sushiV2,
    uniV3,
    timestamp: Date.now(),
  };
}

/**
 * Tüm izlenen pool'ların snapshot'ını al
 */
export async function takeAllSnapshots(pools: PoolPair[]): Promise<PoolSnapshot[]> {
  const snapshots = await Promise.all(pools.map(takePoolSnapshot));
  return snapshots;
}
