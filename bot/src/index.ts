import { MONITORED_POOLS, POLL_INTERVAL_MS, DRY_RUN, TOKENS } from "./config.js";
import { takeAllSnapshots } from "./monitor.js";
import { initializePriceGuard, refreshReferencePrices } from "./priceGuard.js";
import { SlipBudAgent } from "./agent/index.js";
import { account } from "./client.js";
import { logger } from "./logger.js";

// ---- Graceful Shutdown ---- //

let isRunning = true;
let sleepTimer: ReturnType<typeof setTimeout> | null = null;

function shutdown(): void {
  if (!isRunning) return;
  logger.info("\nKapatılıyor...");
  isRunning = false;
  if (sleepTimer) {
    clearTimeout(sleepTimer);
    sleepTimer = null;
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ---- Ana Döngü ---- //

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    sleepTimer = setTimeout(() => {
      sleepTimer = null;
      resolve();
    }, ms);
  });
}

async function main(): Promise<void> {
  logger.info("=== SlipBud Arbitrage System ===");
  logger.info(`Bot adresi: ${account.address}`);
  logger.info(`Mod: ${DRY_RUN ? "DRY RUN (simülasyon)" : "LIVE"}`);
  logger.info(`İzlenen pool sayısı: ${MONITORED_POOLS.length}`);
  logger.info(`Poll aralığı: ${POLL_INTERVAL_MS}ms\n`);

  const agent = new SlipBudAgent();
  await agent.initialize();

  // x402 price provider'ları başlat (env'den endpoint'leri yükler)
  initializePriceGuard();

  logger.info("Tarama başlıyor...\n");

  // İzlenen benzersiz token adreslerini çıkar
  const uniqueTokens = [...new Set(
    MONITORED_POOLS.flatMap((p) => [p.tokenA, p.tokenB]),
  )];

  while (isRunning) {
    try {
      // Referans fiyatları güncelle (CoinGecko, 60s cache)
      await refreshReferencePrices(uniqueTokens);

      const snapshots = await takeAllSnapshots(MONITORED_POOLS);
      await agent.runCycle(snapshots);
    } catch (err) {
      logger.error("Ana döngü hatası", err);
    }

    if (isRunning) {
      await sleep(POLL_INTERVAL_MS);
    }
  }

  logger.info("Bot durduruldu.");
  process.exit(0);
}

main().catch((err) => {
  logger.error("Fatal error", err);
  process.exit(1);
});
