/**
 * Merkezi strateji, risk ve executor konfigürasyonu.
 * Tüm magic number'lar burada toplanır — env'den override edilebilir.
 */

// ---- Executor Ayarları ---- //

export const EXECUTOR_CONFIG = {
  /** Swap deadline offset (saniye) — TX bu süre içinde confirm olmazsa revert */
  DEADLINE_SECONDS: Number(process.env["DEADLINE_SECONDS"] ?? "120"),

  /** Slippage toleransı (bps) — 50 = %0.5, 100 = %1 */
  SLIPPAGE_BPS: Number(process.env["SLIPPAGE_BPS"] ?? "50"),

  /**
   * Treasury'den çekilecek miktara eklenecek tampon (bps).
   * 500 = %5 → 1.0 ETH trade için 1.05 ETH çekilir, kullanılmayan kısım geri döner.
   * Ani fiyat hareketleri ve slippage farkları için güvenlik payı.
   */
  TRADE_BUFFER_BPS: Number(process.env["TRADE_BUFFER_BPS"] ?? "500"),

  /** TX gönderiminde başarısızlık durumunda retry sayısı */
  MAX_RETRIES: Number(process.env["MAX_RETRIES"] ?? "2"),

  /** Retry'ler arası bekleme süresi (ms) — her retry'de 2x artar */
  RETRY_BASE_DELAY_MS: Number(process.env["RETRY_BASE_DELAY_MS"] ?? "1000"),

  /** Retry yapılacak hata pattern'leri (RPC timeout, nonce hatası vb.) */
  RETRYABLE_ERRORS: [
    "timeout",
    "ETIMEDOUT",
    "ECONNREFUSED",
    "nonce too low",
    "replacement transaction underpriced",
    "already known",
    "insufficient funds for gas",
    "header not found",
  ],
} as const;

// ---- Risk Ayarları ---- //

export const RISK_CONFIG = {
  /** Tek trade'de max miktar (ETH cinsinden) */
  MAX_TRADE_AMOUNT_ETH: Number(process.env["MAX_TRADE_AMOUNT_ETH"] ?? "1.0"),

  /** Günlük max zarar limiti (ETH) */
  MAX_DAILY_LOSS_ETH: Number(process.env["MAX_DAILY_LOSS_ETH"] ?? "0.5"),

  /** Aynı anda max açık trade */
  MAX_OPEN_TRADES: Number(process.env["MAX_OPEN_TRADES"] ?? "1"),

  /** Minimum güven skoru (0-100) */
  MIN_CONFIDENCE: Number(process.env["MIN_CONFIDENCE"] ?? "60"),

  /** Minimum likidite skoru (0-100) */
  MIN_LIQUIDITY: Number(process.env["MIN_LIQUIDITY"] ?? "40"),

  /** Max slippage (basis points) */
  MAX_SLIPPAGE_BPS: Number(process.env["MAX_SLIPPAGE_BPS"] ?? "50"),

  /** Başarısız trade sonrası bekleme süresi (ms) */
  COOLDOWN_MS: Number(process.env["COOLDOWN_MS"] ?? "30000"),

  /** Üst üste max başarısız trade — sonra agent durur */
  MAX_CONSECUTIVE_FAILS: Number(process.env["MAX_CONSECUTIVE_FAILS"] ?? "5"),
} as const;

// ---- Strateji Ayarları ---- //

export const STRATEGY_CONFIG = {
  /** Skor ağırlıkları (toplam 100 olmalı) */
  WEIGHT_SPREAD: Number(process.env["WEIGHT_SPREAD"] ?? "25"),
  WEIGHT_CONFIDENCE: Number(process.env["WEIGHT_CONFIDENCE"] ?? "25"),
  WEIGHT_LIQUIDITY: Number(process.env["WEIGHT_LIQUIDITY"] ?? "20"),
  WEIGHT_HISTORY: Number(process.env["WEIGHT_HISTORY"] ?? "20"),
  WEIGHT_GAS_EFFICIENCY: Number(process.env["WEIGHT_GAS_EFFICIENCY"] ?? "10"),

  /** Minimum toplam skor — altında trade yapılmaz */
  MIN_SCORE: Number(process.env["MIN_SCORE"] ?? "45"),

  /** Flashloan modu eşikleri */
  FLASHLOAN_MIN_PROFIT_USD: Number(process.env["FLASHLOAN_MIN_PROFIT_USD"] ?? "10"),
  FLASHLOAN_MIN_CONFIDENCE: Number(process.env["FLASHLOAN_MIN_CONFIDENCE"] ?? "70"),

  /** Simple swap modu eşikleri */
  SIMPLE_MIN_PROFIT_USD: Number(process.env["SIMPLE_MIN_PROFIT_USD"] ?? "2"),
  SIMPLE_MIN_CONFIDENCE: Number(process.env["SIMPLE_MIN_CONFIDENCE"] ?? "50"),
} as const;

// ---- Analyst Ayarları ---- //

export const ANALYST_CONFIG = {
  /** Bellekte tutulacak max fiyat noktası (per pair) */
  PRICE_HISTORY_LIMIT: Number(process.env["PRICE_HISTORY_LIMIT"] ?? "100"),

  /** Likidite skorlama eşikleri (ETH cinsinden) */
  LIQUIDITY_EXCELLENT: 1000,
  LIQUIDITY_GOOD: 500,
  LIQUIDITY_FAIR: 100,
  LIQUIDITY_LOW: 50,
  LIQUIDITY_POOR: 10,
} as const;

// ---- PriceGuard Ayarları ---- //

export const PRICE_GUARD_CONFIG = {
  /** Referans fiyat cache süresi (ms) */
  CACHE_TTL_MS: Number(process.env["PRICE_CACHE_TTL_MS"] ?? "60000"),

  /** V2 spot fiyatı referanstan max sapma (%) */
  MAX_DEVIATION_PERCENT: Number(process.env["MAX_PRICE_DEVIATION_PERCENT"] ?? "2.0"),
} as const;
