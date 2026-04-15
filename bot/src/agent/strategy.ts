import { type ArbitrageOpportunity } from "../arbitrage.js";
import { type PairAnalysis } from "./analyst.js";
import {
  checkRisk,
  type RiskCheckResult,
  type RiskConfig,
  DEFAULT_RISK_CONFIG,
} from "./risk.js";
import { getPairWinRate, getRouteWinRate } from "./memory.js";
import { ETH_PRICE_USD } from "../config.js";
import { STRATEGY_CONFIG } from "../strategyConfig.js";
import { logger } from "../logger.js";

// ---- Types ---- //

export type TradeMode = "simple" | "flashloan" | "skip";

export interface TradeDecision {
  execute: boolean;
  mode: TradeMode;
  opportunity: ArbitrageOpportunity;
  analysis: PairAnalysis;
  riskCheck: RiskCheckResult;
  score: number; // 0-100 toplam skor
  reasoning: string[];
}

// ---- Skor Ağırlıkları (strategyConfig'den) ---- //

interface ScoreWeights {
  spread: number;
  confidence: number;
  liquidity: number;
  history: number;
  gasEfficiency: number;
}

const WEIGHTS: ScoreWeights = {
  spread: STRATEGY_CONFIG.WEIGHT_SPREAD,
  confidence: STRATEGY_CONFIG.WEIGHT_CONFIDENCE,
  liquidity: STRATEGY_CONFIG.WEIGHT_LIQUIDITY,
  history: STRATEGY_CONFIG.WEIGHT_HISTORY,
  gasEfficiency: STRATEGY_CONFIG.WEIGHT_GAS_EFFICIENCY,
};

// ---- Skorlama Fonksiyonları ---- //

function scoreSpread(spreadPercent: number): number {
  // %0.1-%2 arası ideal
  if (spreadPercent < 0.05) return 0;
  if (spreadPercent < 0.1) return 30;
  if (spreadPercent < 0.3) return 60;
  if (spreadPercent < 1.0) return 90;
  if (spreadPercent < 2.0) return 70;
  if (spreadPercent < 5.0) return 30;
  return 0; // %5+ spread gerçek dışı
}

function scoreConfidence(confidence: number): number {
  return confidence; // Zaten 0-100
}

function scoreLiquidity(liquidityScore: number): number {
  return liquidityScore; // Zaten 0-100
}

function scoreHistory(pairLabel: string, buyDex: string, sellDex: string): number {
  const pairWinRate = getPairWinRate(pairLabel);
  const routeWinRate = getRouteWinRate(buyDex, sellDex);

  // İki win rate'in ağırlıklı ortalaması
  return pairWinRate * 0.4 + routeWinRate * 0.6;
}

function scoreGasEfficiency(estimatedProfitUsd: number, estimatedGasUsd: number): number {
  if (estimatedGasUsd === 0) return 50;

  const ratio = estimatedProfitUsd / estimatedGasUsd;
  if (ratio > 10) return 100;
  if (ratio > 5) return 80;
  if (ratio > 3) return 60;
  if (ratio > 2) return 40;
  if (ratio > 1.5) return 20;
  return 0; // Gas'tan az kar — değmez
}

// ---- Trade Modu Seçimi ---- //

/**
 * Flashloan mı yoksa basit swap mı kullanılacağını belirle.
 * Flashloan: sermaye gerektirmez, daha yüksek karlar için.
 * Simple: küçük fırsatlar, treasury'den fon çekerek.
 */
function selectTradeMode(
  opp: ArbitrageOpportunity,
  analysis: PairAnalysis,
): TradeMode {
  // Yüksek kar + yüksek güven = flashloan
  if (
    opp.estimatedProfitUsd > STRATEGY_CONFIG.FLASHLOAN_MIN_PROFIT_USD &&
    analysis.confidence > STRATEGY_CONFIG.FLASHLOAN_MIN_CONFIDENCE
  ) {
    return "flashloan";
  }

  // Orta kar + yeterli güven = basit swap
  if (
    opp.estimatedProfitUsd > STRATEGY_CONFIG.SIMPLE_MIN_PROFIT_USD &&
    analysis.confidence > STRATEGY_CONFIG.SIMPLE_MIN_CONFIDENCE
  ) {
    return "simple";
  }

  return "skip";
}

// ---- Ana Strateji Fonksiyonu ---- //

/**
 * Bir fırsat + analiz çiftini değerlendir ve trade kararı ver.
 * Tüm skorları, risk kontrollerini ve geçmiş performansı dikkate alır.
 */
export function evaluateOpportunity(
  opp: ArbitrageOpportunity,
  analysis: PairAnalysis,
  config: RiskConfig = DEFAULT_RISK_CONFIG,
): TradeDecision {
  const reasoning: string[] = [];

  // 1. Risk kontrolü
  const riskCheck = checkRisk(opp, analysis, config);
  if (!riskCheck.approved) {
    reasoning.push(`Risk RED: ${riskCheck.reason}`);
    return {
      execute: false,
      mode: "skip",
      opportunity: opp,
      analysis,
      riskCheck,
      score: 0,
      reasoning,
    };
  }
  reasoning.push("Risk kontrolleri geçti");

  // 2. Bileşen skorları
  const spreadScore = scoreSpread(opp.spreadPercent);
  reasoning.push(`Spread skoru: ${spreadScore}/100 (${opp.spreadPercent.toFixed(4)}%)`);

  const confidenceScore = scoreConfidence(analysis.confidence);
  reasoning.push(`Güven skoru: ${confidenceScore}/100`);

  const liquidityScore = scoreLiquidity(analysis.liquidityScore);
  reasoning.push(`Likidite skoru: ${liquidityScore}/100`);

  const historyScore = scoreHistory(opp.pair.label, opp.buyDex, opp.sellDex);
  reasoning.push(`Geçmiş performans: ${historyScore.toFixed(0)}/100`);

  // Gas tahmini: ~150k gas * gas price (~20 gwei) * ETH price
  const estimatedGasUsd = 0.01 * ETH_PRICE_USD;
  const gasScore = scoreGasEfficiency(opp.estimatedProfitUsd, estimatedGasUsd);
  reasoning.push(`Gas verimliliği: ${gasScore}/100`);

  // 3. Toplam skor hesapla
  const totalScore =
    (spreadScore * WEIGHTS.spread +
      confidenceScore * WEIGHTS.confidence +
      liquidityScore * WEIGHTS.liquidity +
      historyScore * WEIGHTS.history +
      gasScore * WEIGHTS.gasEfficiency) /
    100;

  reasoning.push(`Toplam skor: ${totalScore.toFixed(1)}/100`);

  // 4. Trade modu seç
  const mode = selectTradeMode(opp, analysis);
  reasoning.push(`Mod: ${mode}`);

  // 5. Karar — minimum skor kontrolü
  const execute = totalScore >= STRATEGY_CONFIG.MIN_SCORE && mode !== "skip";

  if (execute) {
    reasoning.push("KARAR: EXECUTE");
  } else {
    reasoning.push(`KARAR: SKIP (skor: ${totalScore.toFixed(1)}, mod: ${mode})`);
  }

  return {
    execute,
    mode,
    opportunity: opp,
    analysis,
    riskCheck,
    score: totalScore,
    reasoning,
  };
}

/**
 * Birden fazla fırsatı değerlendir ve en iyisini seç.
 */
export function selectBestOpportunity(
  opportunities: ArbitrageOpportunity[],
  analyses: PairAnalysis[],
  config: RiskConfig = DEFAULT_RISK_CONFIG,
): TradeDecision | null {
  const decisions: TradeDecision[] = [];

  for (const opp of opportunities) {
    // Fırsatla eşleşen analizi bul
    const analysis = analyses.find((a) => a.label === opp.pair.label);
    if (!analysis) continue;

    const decision = evaluateOpportunity(opp, analysis, config);
    if (decision.execute) {
      decisions.push(decision);
    }
  }

  if (decisions.length === 0) return null;

  // En yüksek skorlu kararı seç
  decisions.sort((a, b) => b.score - a.score);
  const best = decisions[0];

  logger.info(
    `Strateji: ${decisions.length} onaylı fırsat | En iyi: ${best.opportunity.pair.label} (skor: ${best.score.toFixed(1)}) | Mod: ${best.mode}`,
  );

  return best;
}
