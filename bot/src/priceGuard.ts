import { type Address } from "viem";
import { PRICE_GUARD_CONFIG } from "./strategyConfig.js";
import {
  fetchBestPrices,
  initializePriceProviders,
} from "./x402/priceProvider.js";

// ---- Types ---- //

export interface ReferencePrice {
  token: Address;
  priceUsd: number;
  source: string;
  timestamp: number;
}

export interface PriceValidation {
  valid: boolean;
  reason: string;
  deviationPercent: number;
  referencePrice: number;
  spotPrice: number;
}

// ---- Config ---- //

const PRICE_CACHE_TTL_MS = PRICE_GUARD_CONFIG.CACHE_TTL_MS;
const MAX_DEVIATION_PERCENT = PRICE_GUARD_CONFIG.MAX_DEVIATION_PERCENT;

// ---- Price Cache ---- //

const priceCache: Map<string, ReferencePrice> = new Map();

// ---- Provider-Based Fetching ---- //

/**
 * Multi-source price provider üzerinden referans fiyatları çek.
 *
 * Kaynak önceliği:
 * 1. x402 premium endpoint'ler (aktifse) — hızlı, güvenilir, ücretli
 * 2. CoinGecko free API — yavaş, rate limited, ücretsiz fallback
 *
 * Provider chain otomatik fallback yapar:
 * x402 fail → CoinGecko'ya düşer, ikisi de fail → cache'deki eski veriyi kullanır.
 */
async function fetchReferencePrices(tokenAddresses: Address[]): Promise<Map<string, ReferencePrice>> {
  const result = new Map<string, ReferencePrice>();
  const now = Date.now();

  // Cache'de taze olanları kullan
  const staleTokens: Address[] = [];
  for (const addr of tokenAddresses) {
    const cached = priceCache.get(addr.toLowerCase());
    if (cached && now - cached.timestamp < PRICE_CACHE_TTL_MS) {
      result.set(addr.toLowerCase(), cached);
    } else {
      staleTokens.push(addr);
    }
  }

  if (staleTokens.length === 0) return result;

  // Multi-source provider'dan fiyatları çek
  const quotes = await fetchBestPrices(staleTokens);

  for (const [addr, quote] of quotes) {
    const ref: ReferencePrice = {
      token: quote.token,
      priceUsd: quote.priceUsd,
      source: quote.source,
      timestamp: quote.timestamp,
    };

    priceCache.set(addr, ref);
    result.set(addr, ref);
  }

  return result;
}

// ---- Validation ---- //

/**
 * On-chain spot fiyatı referans fiyatla karşılaştır.
 *
 * spotPriceTokenAInB: 1 tokenA kaç tokenB eder (ör: 1 WETH = 3200 USDC)
 * tokenA ve tokenB adresleri → provider'dan USD fiyat alınır → oran hesaplanır.
 *
 * Sapma %MAX_DEVIATION_PERCENT'i geçerse → muhtemel manipülasyon.
 */
export function validateSpotPrice(
  spotPrice: number,
  refPriceA: ReferencePrice | undefined,
  refPriceB: ReferencePrice | undefined,
): PriceValidation {
  if (!refPriceA || !refPriceB) {
    return {
      valid: true,
      reason: "Referans fiyat yok — doğrulama atlandı",
      deviationPercent: 0,
      referencePrice: 0,
      spotPrice,
    };
  }

  const referencePrice = refPriceA.priceUsd / refPriceB.priceUsd;

  if (referencePrice === 0) {
    return {
      valid: false,
      reason: "Referans fiyat sıfır",
      deviationPercent: 100,
      referencePrice: 0,
      spotPrice,
    };
  }

  const deviationPercent = Math.abs((spotPrice - referencePrice) / referencePrice) * 100;

  if (deviationPercent > MAX_DEVIATION_PERCENT) {
    return {
      valid: false,
      reason: `Spot fiyat referanstan %${deviationPercent.toFixed(2)} sapıyor (limit: %${MAX_DEVIATION_PERCENT})`,
      deviationPercent,
      referencePrice,
      spotPrice,
    };
  }

  return {
    valid: true,
    reason: "Fiyat referans aralığında",
    deviationPercent,
    referencePrice,
    spotPrice,
  };
}

// ---- Public API ---- //

/**
 * Price provider'ları başlat — bot açılışında bir kez çağrılmalı.
 * x402 endpoint'lerini env'den yükler.
 */
export function initializePriceGuard(): void {
  initializePriceProviders();
}

/**
 * Belirli token çiftleri için referans fiyatları güncelle.
 * Her poll döngüsünde bir kez çağrılır.
 */
export async function refreshReferencePrices(tokens: Address[]): Promise<void> {
  await fetchReferencePrices(tokens);
}

/**
 * Bir token için cache'deki referans fiyatı getir.
 */
export function getCachedReference(token: Address): ReferencePrice | undefined {
  return priceCache.get(token.toLowerCase());
}

/**
 * Cache'deki tüm referans fiyatları getir (debug/logging için).
 */
export function getAllCachedPrices(): Map<string, ReferencePrice> {
  return new Map(priceCache);
}
