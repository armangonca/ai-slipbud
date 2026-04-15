import { type Address } from "viem";
import { x402FetchJson, isX402Enabled, X402DisabledError, X402BudgetError } from "./client.js";
import { logger } from "../logger.js";
import { TOKENS } from "../config.js";

// ---- Types ---- //

export interface PriceQuote {
  token: Address;
  priceUsd: number;
  source: string;
  timestamp: number;
  confidence: number; // 0-100 — kaynağın güvenilirliği
  latencyMs: number; // yanıt süresi
}

/**
 * Price provider arayüzü.
 * Her provider bu interface'i implement eder.
 */
export interface PriceProvider {
  name: string;
  priority: number; // düşük = daha öncelikli
  isAvailable(): boolean;
  fetchPrices(tokens: Address[]): Promise<Map<string, PriceQuote>>;
}

// ---- CoinGecko Provider (Ücretsiz Fallback) ---- //

const COINGECKO_IDS: Record<string, string> = {
  [TOKENS.WETH.toLowerCase()]: "ethereum",
  [TOKENS.WBTC.toLowerCase()]: "wrapped-bitcoin",
  [TOKENS.USDC.toLowerCase()]: "usd-coin",
  [TOKENS.USDT.toLowerCase()]: "tether",
  [TOKENS.DAI.toLowerCase()]: "dai",
};

interface CoinGeckoResponse {
  [id: string]: { usd: number };
}

export const coinGeckoProvider: PriceProvider = {
  name: "coingecko",
  priority: 100, // en düşük öncelik — ücretsiz fallback

  isAvailable(): boolean {
    return true; // Her zaman kullanılabilir
  },

  async fetchPrices(tokens: Address[]): Promise<Map<string, PriceQuote>> {
    const result = new Map<string, PriceQuote>();

    const ids = tokens
      .map((addr) => COINGECKO_IDS[addr.toLowerCase()])
      .filter(Boolean);

    if (ids.length === 0) return result;

    const start = Date.now();

    try {
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd`;
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) {
        logger.warn(`CoinGecko API hatası: ${res.status}`);
        return result;
      }

      const data = (await res.json()) as CoinGeckoResponse;
      const latencyMs = Date.now() - start;

      for (const addr of tokens) {
        const geckoId = COINGECKO_IDS[addr.toLowerCase()];
        if (!geckoId || !data[geckoId]) continue;

        result.set(addr.toLowerCase(), {
          token: addr,
          priceUsd: data[geckoId].usd,
          source: "coingecko",
          timestamp: Date.now(),
          confidence: 70, // Ücretsiz API — gecikme olabilir
          latencyMs,
        });
      }
    } catch (err) {
      logger.warn("CoinGecko fiyat çekilemedi", err);
    }

    return result;
  },
};

// ---- x402 Premium Provider ---- //

/**
 * x402 üzerinden ücretli fiyat servisleriyle iletişim kurar.
 *
 * Server 402 dönerse → x402 client otomatik ödeme yapar → veriyi alır.
 * Server 402 dönmezse → ücretsiz erişim — ödeme yapılmaz.
 *
 * Birden fazla x402 endpoint eklenebilir.
 */

interface X402PriceEndpoint {
  name: string;
  url: string; // {tokens} placeholder'ı token listesinin virgülle ayrılmış hali olur
  confidence: number;
  parseResponse: (data: unknown, tokens: Address[]) => Map<string, PriceQuote>;
}

/**
 * Genel amaçlı x402 fiyat yanıt formatı.
 * x402 destekli fiyat servislerinin dönmesi beklenen format.
 */
interface X402PriceResponse {
  prices: Array<{
    address: string;
    usd: number;
    timestamp?: number;
  }>;
}

// Kayıtlı x402 fiyat endpoint'leri
// Yeni bir x402 destekli fiyat servisi buldun mu? Buraya ekle.
const x402Endpoints: X402PriceEndpoint[] = [];

/**
 * Yeni bir x402 fiyat endpoint'i kaydet.
 * Bot çalışırken veya config'den yüklenirken çağrılır.
 */
export function registerX402PriceEndpoint(endpoint: X402PriceEndpoint): void {
  x402Endpoints.push(endpoint);
  // Öncelik sırasına göre sırala (yüksek confidence = daha öncelikli)
  x402Endpoints.sort((a, b) => b.confidence - a.confidence);
  logger.info(`x402 fiyat endpoint kayıtlandı: ${endpoint.name} (confidence: ${endpoint.confidence})`);
}

/**
 * Env'den x402 fiyat endpoint'lerini yükle.
 * Format: X402_PRICE_ENDPOINTS=name1|url1|confidence1,name2|url2|confidence2
 */
export function loadX402EndpointsFromEnv(): void {
  const raw = process.env["X402_PRICE_ENDPOINTS"] ?? "";
  if (!raw) return;

  const entries = raw.split(",").map((e) => e.trim()).filter(Boolean);

  for (const entry of entries) {
    const [name, url, conf] = entry.split("|");
    if (!name || !url) continue;

    registerX402PriceEndpoint({
      name,
      url,
      confidence: Number(conf ?? "90"),
      parseResponse: defaultParseX402Response,
    });
  }
}

/**
 * Varsayılan x402 fiyat yanıtı parser'ı.
 * Çoğu x402 fiyat servisi bu formatta yanıt döner.
 */
function defaultParseX402Response(
  data: unknown,
  tokens: Address[],
): Map<string, PriceQuote> {
  const result = new Map<string, PriceQuote>();
  const response = data as X402PriceResponse;

  if (!response?.prices || !Array.isArray(response.prices)) return result;

  for (const item of response.prices) {
    const addr = item.address.toLowerCase();

    // İstediğimiz tokenlar arasında mı?
    if (!tokens.some((t) => t.toLowerCase() === addr)) continue;

    result.set(addr, {
      token: addr as Address,
      priceUsd: item.usd,
      source: "x402",
      timestamp: item.timestamp ?? Date.now(),
      confidence: 95,
      latencyMs: 0, // Caller set eder
    });
  }

  return result;
}

export const x402PriceProvider: PriceProvider = {
  name: "x402",
  priority: 10, // En yüksek öncelik

  isAvailable(): boolean {
    return isX402Enabled() && x402Endpoints.length > 0;
  },

  async fetchPrices(tokens: Address[]): Promise<Map<string, PriceQuote>> {
    const result = new Map<string, PriceQuote>();

    if (!this.isAvailable()) return result;

    const tokenList = tokens.map((t) => t.toLowerCase()).join(",");

    // Her endpoint'i dene — ilk başarılı olan kazanır
    for (const endpoint of x402Endpoints) {
      const start = Date.now();

      try {
        const url = endpoint.url.replace("{tokens}", tokenList);
        const data = await x402FetchJson<unknown>(url);
        const latencyMs = Date.now() - start;

        const parsed = endpoint.parseResponse(data, tokens);

        // Latency'yi güncelle
        for (const [key, quote] of parsed) {
          quote.latencyMs = latencyMs;
          result.set(key, quote);
        }

        if (result.size > 0) {
          logger.info(
            `x402 fiyat alındı: ${endpoint.name} | ${result.size} token | ${latencyMs}ms`,
          );
          return result; // İlk başarılı endpoint yeter
        }
      } catch (err) {
        if (err instanceof X402DisabledError || err instanceof X402BudgetError) {
          // Bütçe sorunu — diğer endpoint'leri de deneme
          logger.warn(`x402 fiyat: ${endpoint.name} — ${err.message}`);
          return result;
        }

        // Diğer hatalar — sonraki endpoint'i dene
        logger.warn(`x402 fiyat: ${endpoint.name} başarısız, sonraki deneniyor`);
      }
    }

    return result;
  },
};

// ---- Multi-Source Aggregator ---- //

// Kayıtlı tüm provider'lar (öncelik sırasıyla)
const providers: PriceProvider[] = [
  x402PriceProvider,   // Öncelik 10 — premium, hızlı
  coinGeckoProvider,   // Öncelik 100 — ücretsiz fallback
];

/** Yeni provider kaydet */
export function registerPriceProvider(provider: PriceProvider): void {
  providers.push(provider);
  providers.sort((a, b) => a.priority - b.priority);
  logger.info(`Price provider kayıtlandı: ${provider.name} (öncelik: ${provider.priority})`);
}

/**
 * Tüm provider'lardan fiyat topla — fallback chain.
 *
 * Strateji:
 * 1. En yüksek öncelikli, kullanılabilir provider'dan başla
 * 2. Provider başarısız olursa veya eksik token varsa → sonrakine düş
 * 3. Aynı token için birden fazla fiyat varsa en yüksek confidence'lı kazanır
 * 4. Sonuçta her token için en iyi fiyatı döner
 */
export async function fetchBestPrices(
  tokens: Address[],
): Promise<Map<string, PriceQuote>> {
  const bestPrices = new Map<string, PriceQuote>();
  const remainingTokens = new Set(tokens.map((t) => t.toLowerCase()));

  for (const provider of providers) {
    if (remainingTokens.size === 0) break;
    if (!provider.isAvailable()) continue;

    try {
      const tokensToFetch = tokens.filter((t) => remainingTokens.has(t.toLowerCase()));
      const prices = await provider.fetchPrices(tokensToFetch);

      for (const [key, quote] of prices) {
        const existing = bestPrices.get(key);

        // Daha yüksek confidence'lı kaynağı tercih et
        if (!existing || quote.confidence > existing.confidence) {
          bestPrices.set(key, quote);
          remainingTokens.delete(key);
        }
      }
    } catch (err) {
      logger.warn(`Provider ${provider.name} başarısız, sonrakine geçiliyor`);
    }
  }

  if (remainingTokens.size > 0) {
    logger.warn(
      `${remainingTokens.size} token için fiyat alınamadı: ${[...remainingTokens].join(", ")}`,
    );
  }

  return bestPrices;
}

// ---- Initialization ---- //

/** Env'den x402 endpoint'lerini yükle — bot başlarken çağrılmalı */
export function initializePriceProviders(): void {
  loadX402EndpointsFromEnv();

  if (isX402Enabled()) {
    logger.info(
      `x402 price provider aktif | ${x402Endpoints.length} endpoint kayıtlı`,
    );
  } else {
    logger.info("x402 kapalı — sadece CoinGecko (ücretsiz) kullanılacak");
  }
}
