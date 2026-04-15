import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { logger } from "../logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- Types ---- //

export interface TradeRecord {
  id: string;
  timestamp: number;
  pair: string;
  buyDex: string;
  sellDex: string;
  amountIn: string; // bigint -> string (JSON serileştirme için)
  amountOut: string;
  profitEth: number;
  profitUsd: number;
  gasUsed: string;
  gasCostEth: number;
  spreadPercent: number;
  confidence: number;
  success: boolean;
  error?: string;
  txHash?: string;
  executionTimeMs: number;
}

export interface AgentStats {
  totalTrades: number;
  successfulTrades: number;
  failedTrades: number;
  totalProfitEth: number;
  totalProfitUsd: number;
  totalGasCostEth: number;
  netProfitEth: number;
  winRate: number; // 0-100
  avgProfitPerTrade: number;
  bestTrade: TradeRecord | null;
  worstTrade: TradeRecord | null;
  // Pair bazlı performans
  pairPerformance: Map<string, { wins: number; losses: number; profitEth: number }>;
  // DEX çifti bazlı performans
  routePerformance: Map<string, { wins: number; losses: number; profitEth: number }>;
}

// ---- Memory Store ---- //

const MEMORY_FILE = resolve(__dirname, "../../data/trade_history.json");
const MAX_TRADE_RECORDS = 5000;

let trades: TradeRecord[] = [];

/**
 * Trade geçmişini diskten yükle
 */
export function loadMemory(): void {
  try {
    if (existsSync(MEMORY_FILE)) {
      const raw = readFileSync(MEMORY_FILE, "utf-8");
      trades = JSON.parse(raw) as TradeRecord[];
      logger.info(`Hafıza yüklendi: ${trades.length} trade kaydı`);
    }
  } catch (err) {
    logger.warn("Hafıza yüklenemedi, temiz başlanıyor", err);
    trades = [];
  }
}

/**
 * Trade geçmişini diske kaydet
 */
function saveMemory(): void {
  try {
    mkdirSync(dirname(MEMORY_FILE), { recursive: true });
    writeFileSync(MEMORY_FILE, JSON.stringify(trades, null, 2));
  } catch (err) {
    logger.warn("Hafıza kaydedilemedi", err);
  }
}

/**
 * Yeni trade kaydı ekle
 */
export function recordTrade(record: TradeRecord): void {
  trades.push(record);

  // Eski kayıtları kırp — dosya sınırsız büyümesin
  if (trades.length > MAX_TRADE_RECORDS) {
    trades = trades.slice(-MAX_TRADE_RECORDS);
  }

  saveMemory();

  if (record.success) {
    logger.success(
      `Trade kaydedildi: ${record.pair} | +${record.profitEth.toFixed(4)} ETH | ${record.executionTimeMs}ms`,
    );
  } else {
    logger.warn(
      `Başarısız trade kaydedildi: ${record.pair} | ${record.error}`,
    );
  }
}

/**
 * Benzersiz trade ID oluştur
 */
export function generateTradeId(): string {
  return `trade_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

// ---- İstatistikler ---- //

/**
 * Genel agent istatistiklerini hesapla
 */
export function getStats(): AgentStats {
  const successfulTrades = trades.filter((t) => t.success);
  const failedTrades = trades.filter((t) => !t.success);

  const totalProfitEth = successfulTrades.reduce(
    (sum, t) => sum + t.profitEth,
    0,
  );
  const totalProfitUsd = successfulTrades.reduce(
    (sum, t) => sum + t.profitUsd,
    0,
  );
  const totalGasCostEth = trades.reduce((sum, t) => sum + t.gasCostEth, 0);

  // Pair performansı
  const pairPerformance = new Map<
    string,
    { wins: number; losses: number; profitEth: number }
  >();
  for (const trade of trades) {
    const existing = pairPerformance.get(trade.pair) ?? {
      wins: 0,
      losses: 0,
      profitEth: 0,
    };
    if (trade.success) {
      existing.wins++;
      existing.profitEth += trade.profitEth;
    } else {
      existing.losses++;
    }
    pairPerformance.set(trade.pair, existing);
  }

  // Route performansı (buy->sell DEX çifti)
  const routePerformance = new Map<
    string,
    { wins: number; losses: number; profitEth: number }
  >();
  for (const trade of trades) {
    const route = `${trade.buyDex}->${trade.sellDex}`;
    const existing = routePerformance.get(route) ?? {
      wins: 0,
      losses: 0,
      profitEth: 0,
    };
    if (trade.success) {
      existing.wins++;
      existing.profitEth += trade.profitEth;
    } else {
      existing.losses++;
    }
    routePerformance.set(route, existing);
  }

  // Best/worst trade
  const sortedByProfit = [...successfulTrades].sort(
    (a, b) => b.profitEth - a.profitEth,
  );

  return {
    totalTrades: trades.length,
    successfulTrades: successfulTrades.length,
    failedTrades: failedTrades.length,
    totalProfitEth,
    totalProfitUsd,
    totalGasCostEth,
    netProfitEth: totalProfitEth - totalGasCostEth,
    winRate:
      trades.length > 0
        ? (successfulTrades.length / trades.length) * 100
        : 0,
    avgProfitPerTrade:
      successfulTrades.length > 0
        ? totalProfitEth / successfulTrades.length
        : 0,
    bestTrade: sortedByProfit[0] ?? null,
    worstTrade: sortedByProfit[sortedByProfit.length - 1] ?? null,
    pairPerformance,
    routePerformance,
  };
}

/**
 * Belirli bir pair için geçmiş win rate'ini getir
 */
export function getPairWinRate(pairLabel: string): number {
  const pairTrades = trades.filter((t) => t.pair === pairLabel);
  if (pairTrades.length === 0) return 50; // Veri yoksa nötr

  const wins = pairTrades.filter((t) => t.success).length;
  return (wins / pairTrades.length) * 100;
}

/**
 * Belirli bir DEX route için geçmiş win rate'ini getir
 */
export function getRouteWinRate(buyDex: string, sellDex: string): number {
  const route = `${buyDex}->${sellDex}`;
  const routeTrades = trades.filter(
    (t) => `${t.buyDex}->${t.sellDex}` === route,
  );
  if (routeTrades.length === 0) return 50;

  const wins = routeTrades.filter((t) => t.success).length;
  return (wins / routeTrades.length) * 100;
}

/**
 * Son N trade'i getir
 */
export function getRecentTrades(count: number = 10): TradeRecord[] {
  return trades.slice(-count);
}
