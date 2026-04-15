import { type Address, formatUnits } from "viem";
import {
  type PoolSnapshot,
  type V2PoolState,
  type V3PoolState,
  getV2Price,
  getV3Price,
} from "../monitor.js";
import { getDecimals } from "../tokens.js";
import { ANALYST_CONFIG } from "../strategyConfig.js";
import { logger } from "../logger.js";

// ---- Types ---- //

export interface PricePoint {
  dex: string;
  price: number;
  timestamp: number;
  liquidity: bigint;
}

export interface PairAnalysis {
  label: string;
  tokenA: Address;
  tokenB: Address;
  prices: PricePoint[];
  maxSpread: number;
  avgSpread: number;
  volatility: number;
  bestBuyDex: string;
  bestSellDex: string;
  liquidityScore: number; // 0-100, ne kadar likit
  confidence: number; // 0-100, bu fırsatın gerçek olma olasılığı
}

// ---- Price History (bellek içi) ---- //

const PRICE_HISTORY_LIMIT = ANALYST_CONFIG.PRICE_HISTORY_LIMIT;
const priceHistory: Map<string, PricePoint[]> = new Map();

function recordPrice(pairLabel: string, point: PricePoint): void {
  const history = priceHistory.get(pairLabel) ?? [];
  history.push(point);

  // Eski verileri temizle
  if (history.length > PRICE_HISTORY_LIMIT) {
    history.splice(0, history.length - PRICE_HISTORY_LIMIT);
  }

  priceHistory.set(pairLabel, history);
}

// ---- Volatilite Hesaplama ---- //

/**
 * Son N fiyat noktasının standart sapmasını hesapla.
 * Yüksek volatilite = riskli ama fırsatlı.
 */
function calculateVolatility(pairLabel: string): number {
  const history = priceHistory.get(pairLabel);
  if (!history || history.length < 5) return 0;

  const prices = history.map((p) => p.price);
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  const variance =
    prices.reduce((sum, p) => sum + (p - mean) ** 2, 0) / prices.length;
  const stdDev = Math.sqrt(variance);

  // Yüzde olarak volatilite
  return (stdDev / mean) * 100;
}

// ---- Likidite Skoru ---- //

/**
 * Pool'un likiditesini 0-100 arasında skorla.
 * Düşük likidite = yüksek slippage riski.
 */
function calculateLiquidityScore(snapshot: PoolSnapshot): number {
  let totalLiquidity = 0n;

  if (snapshot.uniV2) {
    totalLiquidity += snapshot.uniV2.reserve0 + snapshot.uniV2.reserve1;
  }

  if (snapshot.sushiV2) {
    totalLiquidity += snapshot.sushiV2.reserve0 + snapshot.sushiV2.reserve1;
  }

  if (snapshot.uniV3) {
    totalLiquidity += snapshot.uniV3.liquidity;
  }

  // ETH cinsinden likidite tahmini (18 decimal)
  const ethLiquidity = Number(formatUnits(totalLiquidity, 18));

  if (ethLiquidity > ANALYST_CONFIG.LIQUIDITY_EXCELLENT) return 100;
  if (ethLiquidity > ANALYST_CONFIG.LIQUIDITY_GOOD) return 80;
  if (ethLiquidity > ANALYST_CONFIG.LIQUIDITY_FAIR) return 60;
  if (ethLiquidity > ANALYST_CONFIG.LIQUIDITY_LOW) return 40;
  if (ethLiquidity > ANALYST_CONFIG.LIQUIDITY_POOR) return 20;
  return 10;
}

// ---- Güven Skoru ---- //

/**
 * Arbitraj fırsatının gerçek olma olasılığını skorla.
 * Faktörler: spread büyüklüğü, likidite, volatilite, geçmiş başarı.
 */
function calculateConfidence(
  spread: number,
  liquidityScore: number,
  volatility: number,
): number {
  let score = 50; // Başlangıç

  // Spread ne kadar büyükse güven o kadar düşük (muhtemelen stale data)
  if (spread > 5) score -= 30; // %5+ spread gerçek dışı
  else if (spread > 2) score -= 15;
  else if (spread > 0.5) score += 10;
  else if (spread > 0.1) score += 20;

  // Yüksek likidite = daha güvenilir fiyat
  score += Math.floor(liquidityScore * 0.2);

  // Düşük volatilite = daha stabil fırsat
  if (volatility < 0.5) score += 10;
  else if (volatility > 2) score -= 10;

  return Math.max(0, Math.min(100, score));
}

// ---- Ana Analiz Fonksiyonu ---- //

/**
 * Bir pool snapshot'ını derinlemesine analiz et.
 * Bot'un ham arbitrage taramasından farklı olarak burada:
 * - Fiyat geçmişi takip edilir
 * - Volatilite hesaplanır
 * - Likidite skorlanır
 * - Güven skoru verilir
 */
export function analyzeSnapshot(snapshot: PoolSnapshot): PairAnalysis {
  const { pair } = snapshot;
  const decimalsA = getDecimals(pair.tokenA);
  const decimalsB = getDecimals(pair.tokenB);
  const now = Date.now();

  const prices: PricePoint[] = [];

  // Fiyatları topla
  if (snapshot.uniV2) {
    const price = getV2Price(snapshot.uniV2, pair.tokenA, decimalsA, decimalsB);
    const point: PricePoint = {
      dex: "UniswapV2",
      price,
      timestamp: now,
      liquidity: snapshot.uniV2.reserve0 + snapshot.uniV2.reserve1,
    };
    prices.push(point);
    recordPrice(pair.label, point);
  }

  if (snapshot.sushiV2) {
    const price = getV2Price(snapshot.sushiV2, pair.tokenA, decimalsA, decimalsB);
    const point: PricePoint = {
      dex: "SushiSwap",
      price,
      timestamp: now,
      liquidity: snapshot.sushiV2.reserve0 + snapshot.sushiV2.reserve1,
    };
    prices.push(point);
    recordPrice(pair.label, point);
  }

  if (snapshot.uniV3) {
    const price = getV3Price(snapshot.uniV3, pair.tokenA, decimalsA, decimalsB);
    const point: PricePoint = {
      dex: "UniswapV3",
      price,
      timestamp: now,
      liquidity: snapshot.uniV3.liquidity,
    };
    prices.push(point);
    recordPrice(pair.label, point);
  }

  // Spread hesapla
  const priceValues = prices.map((p) => p.price);
  const minPrice = Math.min(...priceValues);
  const maxPrice = Math.max(...priceValues);
  const maxSpread = minPrice > 0 ? ((maxPrice - minPrice) / minPrice) * 100 : 0;

  // Ortalama spread (tüm çiftler arası)
  let totalSpread = 0;
  let spreadCount = 0;
  for (let i = 0; i < priceValues.length; i++) {
    for (let j = i + 1; j < priceValues.length; j++) {
      const low = Math.min(priceValues[i], priceValues[j]);
      const high = Math.max(priceValues[i], priceValues[j]);
      if (low > 0) {
        totalSpread += ((high - low) / low) * 100;
        spreadCount++;
      }
    }
  }
  const avgSpread = spreadCount > 0 ? totalSpread / spreadCount : 0;

  // En ucuz ve en pahalı DEX
  const sorted = [...prices].sort((a, b) => a.price - b.price);
  const bestBuyDex = sorted[0]?.dex ?? "N/A";
  const bestSellDex = sorted[sorted.length - 1]?.dex ?? "N/A";

  const volatility = calculateVolatility(pair.label);
  const liquidityScore = calculateLiquidityScore(snapshot);
  const confidence = calculateConfidence(maxSpread, liquidityScore, volatility);

  return {
    label: pair.label,
    tokenA: pair.tokenA,
    tokenB: pair.tokenB,
    prices,
    maxSpread,
    avgSpread,
    volatility,
    bestBuyDex,
    bestSellDex,
    liquidityScore,
    confidence,
  };
}

/**
 * Tüm snapshot'ları analiz et
 */
export function analyzeAllSnapshots(snapshots: PoolSnapshot[]): PairAnalysis[] {
  return snapshots.map(analyzeSnapshot);
}

/**
 * Geçmiş fiyat verilerini temizle
 */
export function clearHistory(): void {
  priceHistory.clear();
}

export function getHistorySize(pairLabel: string): number {
  return priceHistory.get(pairLabel)?.length ?? 0;
}
