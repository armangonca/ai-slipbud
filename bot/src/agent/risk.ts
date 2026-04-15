import { type Address, formatUnits } from "viem";
import { logger } from "../logger.js";
import { RISK_CONFIG } from "../strategyConfig.js";
import { type ArbitrageOpportunity } from "../arbitrage.js";
import { type PairAnalysis } from "./analyst.js";

// ---- Types ---- //

export interface RiskConfig {
  maxTradeAmountEth: number;
  maxDailyLossEth: number;
  maxOpenTrades: number;
  minConfidence: number;
  minLiquidity: number;
  maxSlippageBps: number;
  cooldownMs: number;
  maxConsecutiveFails: number;
}

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  maxTradeAmountEth: RISK_CONFIG.MAX_TRADE_AMOUNT_ETH,
  maxDailyLossEth: RISK_CONFIG.MAX_DAILY_LOSS_ETH,
  maxOpenTrades: RISK_CONFIG.MAX_OPEN_TRADES,
  minConfidence: RISK_CONFIG.MIN_CONFIDENCE,
  minLiquidity: RISK_CONFIG.MIN_LIQUIDITY,
  maxSlippageBps: RISK_CONFIG.MAX_SLIPPAGE_BPS,
  cooldownMs: RISK_CONFIG.COOLDOWN_MS,
  maxConsecutiveFails: RISK_CONFIG.MAX_CONSECUTIVE_FAILS,
};

// ---- Risk State ---- //

interface RiskState {
  dailyPnlEth: number;
  openTrades: number;
  consecutiveFails: number;
  lastFailTimestamp: number;
  lastTradeTimestamp: number;
  dailyResetTimestamp: number;
  tradesToday: number;
  isPaused: boolean;
  pauseReason: string;
}

const state: RiskState = {
  dailyPnlEth: 0,
  openTrades: 0,
  consecutiveFails: 0,
  lastFailTimestamp: 0,
  lastTradeTimestamp: 0,
  dailyResetTimestamp: Date.now(),
  tradesToday: 0,
  isPaused: false,
  pauseReason: "",
};

// ---- Günlük Reset ---- //

function checkDailyReset(): void {
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;

  if (now - state.dailyResetTimestamp > oneDayMs) {
    logger.info(
      `Günlük reset | Dünkü PnL: ${state.dailyPnlEth.toFixed(4)} ETH | Trade sayısı: ${state.tradesToday}`,
    );
    state.dailyPnlEth = 0;
    state.tradesToday = 0;
    state.dailyResetTimestamp = now;
  }
}

// ---- Risk Kontrolleri ---- //

export interface RiskCheckResult {
  approved: boolean;
  reason: string;
}

/**
 * Bir arbitraj fırsatını risk açısından değerlendir.
 * Tüm kontrolleri geçerse approved: true döner.
 */
export function checkRisk(
  opp: ArbitrageOpportunity,
  analysis: PairAnalysis,
  config: RiskConfig = DEFAULT_RISK_CONFIG,
): RiskCheckResult {
  checkDailyReset();

  // 1. Agent duraklatılmış mı?
  if (state.isPaused) {
    return { approved: false, reason: `Agent paused: ${state.pauseReason}` };
  }

  // 2. Cooldown kontrolü — başarısız trade sonrası bekleme
  if (state.consecutiveFails > 0) {
    const timeSinceLastFail = Date.now() - state.lastFailTimestamp;
    if (timeSinceLastFail < config.cooldownMs) {
      const remaining = Math.ceil((config.cooldownMs - timeSinceLastFail) / 1000);
      return {
        approved: false,
        reason: `Cooldown: ${remaining}s kaldı (${state.consecutiveFails} ardışık başarısızlık)`,
      };
    }
  }

  // 3. Üst üste fail limiti
  if (state.consecutiveFails >= config.maxConsecutiveFails) {
    state.isPaused = true;
    state.pauseReason = `${config.maxConsecutiveFails} ardışık başarısızlık — manuel müdahale gerekli`;
    logger.error(`RISK: Agent durduruldu — ${state.pauseReason}`);
    return { approved: false, reason: state.pauseReason };
  }

  // 4. Açık trade limiti
  if (state.openTrades >= config.maxOpenTrades) {
    return {
      approved: false,
      reason: `Max açık trade: ${state.openTrades}/${config.maxOpenTrades}`,
    };
  }

  // 5. Günlük zarar limiti
  if (state.dailyPnlEth < -config.maxDailyLossEth) {
    return {
      approved: false,
      reason: `Günlük zarar limiti aşıldı: ${state.dailyPnlEth.toFixed(4)} ETH (limit: -${config.maxDailyLossEth})`,
    };
  }

  // 6. Trade miktarı kontrolü
  const tradeAmountEth = Number(formatUnits(opp.optimalAmountIn, 18));
  if (tradeAmountEth > config.maxTradeAmountEth) {
    return {
      approved: false,
      reason: `Trade miktarı çok yüksek: ${tradeAmountEth.toFixed(4)} ETH (limit: ${config.maxTradeAmountEth})`,
    };
  }

  // 7. Güven skoru kontrolü
  if (analysis.confidence < config.minConfidence) {
    return {
      approved: false,
      reason: `Düşük güven: ${analysis.confidence}/100 (min: ${config.minConfidence})`,
    };
  }

  // 8. Likidite skoru kontrolü
  if (analysis.liquidityScore < config.minLiquidity) {
    return {
      approved: false,
      reason: `Düşük likidite: ${analysis.liquidityScore}/100 (min: ${config.minLiquidity})`,
    };
  }

  // 9. Spread gerçekçilik kontrolü — %5'ten büyük spread muhtemelen stale data
  if (opp.spreadPercent > 5) {
    return {
      approved: false,
      reason: `Spread gerçek dışı: ${opp.spreadPercent.toFixed(2)}% (muhtemelen stale data)`,
    };
  }

  return { approved: true, reason: "Tüm risk kontrolleri geçti" };
}

// ---- State Güncellemeleri ---- //

export function onTradeStarted(): void {
  state.openTrades++;
  state.lastTradeTimestamp = Date.now();
}

export function onTradeCompleted(profitEth: number): void {
  state.openTrades = Math.max(0, state.openTrades - 1);
  state.dailyPnlEth += profitEth;
  state.tradesToday++;
  state.consecutiveFails = 0; // Başarılı trade — fail counter reset

  logger.info(
    `Risk Update | PnL: ${profitEth >= 0 ? "+" : ""}${profitEth.toFixed(4)} ETH | Günlük: ${state.dailyPnlEth.toFixed(4)} ETH | Trade #${state.tradesToday}`,
  );
}

export function onTradeFailed(): void {
  state.openTrades = Math.max(0, state.openTrades - 1);
  state.consecutiveFails++;
  state.lastFailTimestamp = Date.now();

  logger.warn(
    `Risk Update | Trade başarısız | Ardışık fail: ${state.consecutiveFails}/${DEFAULT_RISK_CONFIG.maxConsecutiveFails}`,
  );
}

// ---- Manuel Kontrol ---- //

export function pauseAgent(reason: string): void {
  state.isPaused = true;
  state.pauseReason = reason;
  logger.warn(`Agent duraklatıldı: ${reason}`);
}

export function resumeAgent(): void {
  state.isPaused = false;
  state.pauseReason = "";
  state.consecutiveFails = 0;
  logger.info("Agent devam ediyor");
}

export function getRiskState(): Readonly<RiskState> {
  return { ...state };
}
