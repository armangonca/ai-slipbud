import { type PoolSnapshot } from "../monitor.js";
import { findArbitrageOpportunities } from "../arbitrage.js";
import {
  executeSimpleArbitrage,
  executeFlashLoanArbitrage,
  logTreasuryStatus,
  type TradeResult,
} from "../executor.js";
import { analyzeAllSnapshots } from "./analyst.js";
import { selectBestOpportunity, type TradeDecision } from "./strategy.js";
import {
  onTradeStarted,
  onTradeCompleted,
  onTradeFailed,
  getRiskState,
  pauseAgent,
  resumeAgent,
} from "./risk.js";
import {
  loadMemory,
  recordTrade,
  generateTradeId,
  getStats,
  getRecentTrades,
  type TradeRecord,
} from "./memory.js";
import {
  sendMessage,
  notifyStartup,
  notifyTradeExecuted,
  notifyTradeFailed,
  notifyRiskPause,
  notifyDailyReport,
  pollCommands,
  isEnabled as isTelegramEnabled,
  escapeHtml,
  type CommandHandler,
} from "../telegram/bot.js";
import { logger } from "../logger.js";
import { TOKENS, DRY_RUN, ETH_PRICE_USD } from "../config.js";
import { account } from "../client.js";
import { isX402Enabled, getSpendingStatus } from "../x402/client.js";

// ---- Agent Orchestrator ---- //

export class SlipBudAgent {
  private cycleCount = 0;
  private isInitialized = false;
  private lastDailyReport = Date.now();

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    logger.info("=== SlipBud Agent başlatılıyor ===");

    // Trade geçmişini yükle
    loadMemory();

    // Geçmiş istatistikleri göster
    const stats = getStats();
    if (stats.totalTrades > 0) {
      logger.info(
        `Geçmiş: ${stats.totalTrades} trade | Win rate: ${stats.winRate.toFixed(1)}% | Net kar: ${stats.netProfitEth.toFixed(4)} ETH`,
      );
    }

    // Treasury durumunu logla
    await logTreasuryStatus(TOKENS.WETH);

    // Telegram bildirimi
    if (isTelegramEnabled()) {
      logger.info("Telegram bot aktif");
      await notifyStartup(
        account.address,
        DRY_RUN ? "DRY RUN" : "LIVE",
      );
    }

    this.isInitialized = true;
    logger.info("Agent hazır\n");
  }

  /**
   * Tek bir karar döngüsü çalıştır.
   */
  async runCycle(snapshots: PoolSnapshot[]): Promise<void> {
    this.cycleCount++;

    try {
      // Telegram komutlarını kontrol et
      if (isTelegramEnabled()) {
        await pollCommands(this.handleCommand.bind(this));
      }

      // 1. Derinlemesine analiz
      const analyses = analyzeAllSnapshots(snapshots);

      // 2. Ham arbitraj fırsatlarını bul
      const opportunities = findArbitrageOpportunities(snapshots);

      if (opportunities.length === 0) {
        if (this.cycleCount % 20 === 0) {
          logger.info(`Döngü #${this.cycleCount} | Fırsat yok | Tarama devam ediyor...`);
        }
        return;
      }

      // 3. Strateji: en iyi fırsatı seç
      const decision = selectBestOpportunity(opportunities, analyses);

      if (!decision) {
        logger.info(
          `${opportunities.length} fırsat bulundu ama hiçbiri strateji kriterlerini geçmedi`,
        );
        return;
      }

      // 4. Karar logla
      this.logDecision(decision);

      // 5. Execute
      await this.executeTrade(decision);
    } catch (err) {
      logger.error("Agent döngü hatası", err);
    }

    // Her 50 döngüde istatistik göster
    if (this.cycleCount % 50 === 0) {
      this.logPeriodicStats();
    }

    // Günlük rapor (24 saatte bir)
    this.checkDailyReport();
  }

  /**
   * Trade kararını çalıştır
   */
  private async executeTrade(decision: TradeDecision): Promise<void> {
    const tradeId = generateTradeId();
    const startTime = Date.now();

    onTradeStarted();

    let result: TradeResult;

    try {
      if (decision.mode === "flashloan") {
        result = await executeFlashLoanArbitrage(decision.opportunity);
      } else {
        result = await executeSimpleArbitrage(decision.opportunity);
      }
    } catch (err) {
      // Uncaught exception — RPC kopması, timeout vb.
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(`Trade uncaught exception: ${errorMsg}`);
      result = { success: false, error: `Uncaught: ${errorMsg}` };
    }

    const executionTimeMs = Date.now() - startTime;
    const opp = decision.opportunity;

    const record: TradeRecord = {
      id: tradeId,
      timestamp: Date.now(),
      pair: opp.pair.label,
      buyDex: opp.buyDex,
      sellDex: opp.sellDex,
      amountIn: opp.optimalAmountIn.toString(),
      amountOut: opp.expectedAmountOut.toString(),
      profitEth: result.success ? opp.estimatedProfitUsd / ETH_PRICE_USD : 0,
      profitUsd: result.success ? opp.estimatedProfitUsd : 0,
      gasUsed: result.gasUsed ?? "0",
      gasCostEth: result.gasCostEth ?? 0,
      spreadPercent: opp.spreadPercent,
      confidence: decision.analysis.confidence,
      success: result.success,
      error: result.error,
      txHash: result.txHash,
      executionTimeMs,
    };

    recordTrade(record);

    // Telegram bildirimi + risk state güncelleme
    if (result.success) {
      onTradeCompleted(record.profitEth);
      await notifyTradeExecuted(
        opp.pair.label,
        opp.buyDex,
        opp.sellDex,
        opp.spreadPercent,
        opp.estimatedProfitUsd,
        decision.mode,
        result.txHash,
      );
    } else {
      onTradeFailed();
      await notifyTradeFailed(opp.pair.label, result.error ?? "Unknown error");

      // Risk pause tetiklendiyse bildir
      const riskState = getRiskState();
      if (riskState.isPaused) {
        await notifyRiskPause(riskState.pauseReason);
      }
    }
  }

  // ---- Telegram Komut Yönetimi ---- //

  private async handleCommand(command: string, _args: string): Promise<string> {
    switch (command) {
      case "/status":
        return this.cmdStatus();

      case "/stats":
        return this.cmdStats();

      case "/pause":
        pauseAgent("Telegram'dan durduruldu");
        return "🛑 Agent duraklatıldı.";

      case "/resume":
        resumeAgent();
        return "▶️ Agent devam ediyor.";

      case "/recent":
        return this.cmdRecent();

      case "/risk":
        return this.cmdRisk();

      case "/x402":
        return this.cmdX402();

      case "/help":
        return this.cmdHelp();

      default:
        return `❓ Bilinmeyen komut: ${escapeHtml(command)}\n/help yazarak komutları görebilirsin.`;
    }
  }

  private cmdStatus(): string {
    const riskState = getRiskState();
    const x402Status = isX402Enabled() ? "🟢" : "⚫";

    return (
      `📊 <b>Agent Durumu</b>\n\n` +
      `🔄 Döngü: #${this.cycleCount}\n` +
      `⚙️ Mod: ${DRY_RUN ? "DRY RUN" : "LIVE"}\n` +
      `${riskState.isPaused ? "🛑 DURAKLATILDI" : "✅ Aktif"}\n` +
      `📈 Günlük PnL: ${riskState.dailyPnlEth.toFixed(4)} ETH\n` +
      `🔢 Bugün trade: ${riskState.tradesToday}\n` +
      `⚠️ Ardışık fail: ${riskState.consecutiveFails}\n` +
      `💳 x402: ${x402Status}`
    );
  }

  private cmdStats(): string {
    const stats = getStats();

    return (
      `📋 <b>İstatistikler</b>\n\n` +
      `📊 Toplam: ${stats.totalTrades} trade\n` +
      `✅ Başarılı: ${stats.successfulTrades}\n` +
      `❌ Başarısız: ${stats.failedTrades}\n` +
      `🎯 Win rate: ${stats.winRate.toFixed(1)}%\n` +
      `💰 Toplam kar: ${stats.totalProfitEth.toFixed(4)} ETH\n` +
      `⛽ Gas maliyeti: ${stats.totalGasCostEth.toFixed(4)} ETH\n` +
      `📈 Net kar: ${stats.netProfitEth.toFixed(4)} ETH`
    );
  }

  private cmdRecent(): string {
    const recent = getRecentTrades(5);

    if (recent.length === 0) {
      return "📭 Henüz trade yok.";
    }

    let msg = `📜 <b>Son ${recent.length} Trade</b>\n\n`;

    for (const t of recent) {
      const icon = t.success ? "✅" : "❌";
      const date = new Date(t.timestamp).toLocaleString("tr-TR");
      msg += `${icon} ${t.pair} | ${t.success ? "+" + t.profitEth.toFixed(4) : "FAIL"} ETH | ${date}\n`;
    }

    return msg;
  }

  private cmdRisk(): string {
    const riskState = getRiskState();

    return (
      `🛡️ <b>Risk Durumu</b>\n\n` +
      `${riskState.isPaused ? "🛑 DURAKLATILDI: " + riskState.pauseReason : "✅ Aktif"}\n` +
      `📉 Günlük PnL: ${riskState.dailyPnlEth.toFixed(4)} ETH\n` +
      `🔢 Açık trade: ${riskState.openTrades}\n` +
      `⚠️ Ardışık fail: ${riskState.consecutiveFails}\n` +
      `🕐 Son trade: ${riskState.lastTradeTimestamp ? new Date(riskState.lastTradeTimestamp).toLocaleString("tr-TR") : "Yok"}`
    );
  }

  private cmdX402(): string {
    if (!isX402Enabled()) {
      return `💳 <b>x402 Durumu</b>\n\n⚫ Kapalı\n\nAktifleştirmek için .env'de X402_ENABLED=true ayarla.`;
    }

    const status = getSpendingStatus();
    const dailySpentEth = Number(status.dailySpent) / 1e18;
    const dailyBudgetEth = Number(status.dailyBudget) / 1e18;
    const remainingEth = Number(status.remainingBudget) / 1e18;
    const usagePercent = dailyBudgetEth > 0 ? (dailySpentEth / dailyBudgetEth) * 100 : 0;

    return (
      `💳 <b>x402 Durumu</b>\n\n` +
      `🟢 Aktif\n` +
      `💰 Günlük harcama: ${dailySpentEth.toFixed(6)} ETH\n` +
      `📊 Bütçe kullanımı: %${usagePercent.toFixed(1)}\n` +
      `💵 Kalan bütçe: ${remainingEth.toFixed(6)} ETH\n` +
      `🔢 Toplam ödeme: ${status.totalPayments}`
    );
  }

  private cmdHelp(): string {
    return (
      `🤖 <b>SlipBud Agent Komutları</b>\n\n` +
      `/status — Agent durumu\n` +
      `/stats — Trade istatistikleri\n` +
      `/recent — Son 5 trade\n` +
      `/risk — Risk durumu\n` +
      `/x402 — x402 ödeme durumu\n` +
      `/pause — Agent'ı duraklat\n` +
      `/resume — Agent'ı devam ettir\n` +
      `/help — Bu mesaj`
    );
  }

  // ---- Günlük Rapor ---- //

  private async checkDailyReport(): Promise<void> {
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;

    if (now - this.lastDailyReport > oneDayMs) {
      this.lastDailyReport = now;
      const stats = getStats();

      await notifyDailyReport(
        stats.totalTrades,
        stats.winRate,
        stats.netProfitEth,
        stats.netProfitEth * ETH_PRICE_USD,
      );
    }
  }

  // ---- Loglama ---- //

  private logDecision(decision: TradeDecision): void {
    const opp = decision.opportunity;
    logger.info("--- Agent Kararı ---");
    logger.info(`Pair: ${opp.pair.label} | ${opp.buyDex} -> ${opp.sellDex}`);
    logger.info(`Skor: ${decision.score.toFixed(1)}/100 | Mod: ${decision.mode} | Güven: ${decision.analysis.confidence}/100`);
    logger.info(`Spread: ${opp.spreadPercent.toFixed(4)}% | Tahmini kar: ~$${opp.estimatedProfitUsd.toFixed(2)}`);

    if (DRY_RUN) {
      logger.info("[DRY RUN] Gerçek işlem yapılmayacak");
    }

    for (const reason of decision.reasoning) {
      logger.info(`  > ${reason}`);
    }
    logger.info("--------------------");
  }

  private logPeriodicStats(): void {
    const stats = getStats();
    const riskState = getRiskState();

    logger.info("=== Agent İstatistikleri ===");
    logger.info(`Toplam: ${stats.totalTrades} trade | Win: ${stats.successfulTrades} | Fail: ${stats.failedTrades}`);
    logger.info(`Win rate: ${stats.winRate.toFixed(1)}% | Net kar: ${stats.netProfitEth.toFixed(4)} ETH`);
    logger.info(`Günlük PnL: ${riskState.dailyPnlEth.toFixed(4)} ETH | Ardışık fail: ${riskState.consecutiveFails}`);
    logger.info("===========================\n");
  }
}
