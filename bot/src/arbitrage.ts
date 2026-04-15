import { type Address, parseUnits, formatUnits } from "viem";
import {
  type PoolSnapshot,
  type V2PoolState,
  getV2Price,
  getV3Price,
  getV2AmountOut,
} from "./monitor.js";
import { DEX, MIN_PROFIT_USD } from "./config.js";
import { getDecimals } from "./tokens.js";
import { getCachedReference, validateSpotPrice } from "./priceGuard.js";
import { logger } from "./logger.js";

// ---- Types ---- //

export type SwapType = "V2" | "V3";

export interface ArbitrageOpportunity {
  pair: PoolSnapshot["pair"];
  buyDex: string;
  sellDex: string;
  buyRouter: Address;
  sellRouter: Address;
  buySwapType: SwapType;
  sellSwapType: SwapType;
  buyPrice: number;
  sellPrice: number;
  spreadPercent: number;
  estimatedProfitUsd: number;
  optimalAmountIn: bigint;
  expectedAmountOut: bigint;
  tokenIn: Address;
  tokenOut: Address;
}

// ---- DEX Fiyat Çıkarma ---- //

interface DexPrice {
  name: string;
  router: Address;
  swapType: SwapType;
  price: number;
  pool: V2PoolState | null;
}

function extractPrices(snapshot: PoolSnapshot): DexPrice[] {
  const prices: DexPrice[] = [];
  const { pair } = snapshot;

  // WETH/USDC gibi çiftlerde: tokenA = WETH (18 dec), tokenB = USDC (6 dec)
  // Farklı tokenlar için decimal map'i genişlet
  const decimalsA = getDecimals(pair.tokenA);
  const decimalsB = getDecimals(pair.tokenB);

  if (snapshot.uniV2) {
    prices.push({
      name: "UniswapV2",
      router: DEX.UNISWAP_V2,
      swapType: "V2",
      price: getV2Price(snapshot.uniV2, pair.tokenA, decimalsA, decimalsB),
      pool: snapshot.uniV2,
    });
  }

  if (snapshot.sushiV2) {
    prices.push({
      name: "SushiSwap",
      router: DEX.SUSHISWAP,
      swapType: "V2",
      price: getV2Price(snapshot.sushiV2, pair.tokenA, decimalsA, decimalsB),
      pool: snapshot.sushiV2,
    });
  }

  if (snapshot.uniV3) {
    prices.push({
      name: "UniswapV3",
      router: DEX.UNISWAP_V3,
      swapType: "V3",
      price: getV3Price(snapshot.uniV3, pair.tokenA, decimalsA, decimalsB),
      pool: null,
    });
  }

  return prices;
}

// ---- Optimal Trade Miktarı ---- //

/**
 * V2 pool'lar arasında optimal arbitraj miktarını hesapla.
 * Formül: sqrt(reserveA_in * reserveB_out * 997^2 / (1000^2)) - reserveA_in * 997 / 1000
 * Basitleştirilmiş yaklaşım: pool boyutunun %0.1-%1 arasında dene, en karlı olanı seç.
 */
function findOptimalAmountIn(
  buyPool: V2PoolState,
  sellPool: V2PoolState,
  tokenIn: Address,
): { amountIn: bigint; profit: bigint } {
  const buyIsToken0 = tokenIn.toLowerCase() === buyPool.token0.toLowerCase();
  const buyReserveIn = buyIsToken0 ? buyPool.reserve0 : buyPool.reserve1;

  // tokenOut adresi: buy pool'daki diğer token
  // V2 pair'de sadece token0 biliyoruz — tokenIn token0 ise tokenOut token1 (veya tersi)
  // Ancak V2PoolState'de token1 adresi yok. tokenOut'u dışarıdan pair bilgisinden alıyoruz.
  // Bu fonksiyon sadece aynı pair'in farklı DEX'lerdeki pool'ları arasında çalışır,
  // dolayısıyla sell pool'da midAmount (tokenOut) ile ters swap yaparken
  // tokenOut'u "tokenIn olmayan token" olarak tanımlarız.

  const percentages = [1n, 5n, 10n, 50n, 100n];
  let bestAmount = 0n;
  let bestProfit = 0n;

  for (const pct of percentages) {
    const testAmount = (buyReserveIn * pct) / 10000n;
    if (testAmount === 0n) continue;

    // Buy DEX'te tokenIn -> tokenOut
    const midAmount = getV2AmountOut(buyPool, tokenIn, testAmount);
    if (midAmount === 0n) continue;

    // Sell DEX'te tokenOut -> tokenIn
    // midAmount tokenOut cinsinden, sell pool'da bunu tokenIn'e çeviriyoruz.
    // Sell pool'da tokenOut, tokenIn'in karşıt tokeni olduğundan
    // sellPool.token0 == tokenIn ise midAmount token1 cinsinden -> token0 geri almak için
    // getV2AmountOut'a "tokenIn olmayan" taraftan girmeliyiz.
    const sellIsToken0 = tokenIn.toLowerCase() === sellPool.token0.toLowerCase();
    // tokenOut'un adresi yok ama getV2AmountOut token0 eşleşmesine bakıyor.
    // tokenOut, sellPool.token0 ile eşleşmiyorsa -> reserve0 = out, reserve1 = in (doğru)
    // tokenOut, sellPool.token0 ile eşleşiyorsa -> reserve0 = in, reserve1 = out (doğru)
    // Bunu doğru yapmak için: tokenOut sell pool'da token0'IN TERSİ.
    // sellIsToken0 tokenIn == token0 demek, yani tokenOut != token0.
    // getV2AmountOut'a tokenOut vermeliyiz, ama elimizde adresi yok.
    // Workaround: tokenIn'in tersi olarak hesaplıyoruz.

    // Sell pool'da ters swap: midAmount (tokenOut) -> tokenIn
    // getV2AmountOut isToken0 kontrolü yapıyor. tokenOut, sellPool'da
    // sellIsToken0 (tokenIn==token0) ise token1'dir -> isToken0=false -> reserveIn=reserve1, reserveOut=reserve0 (doğru)
    // Ancak getV2AmountOut'a address lazım. tokenIn'i biliyoruz, tokenOut'u bilmiyoruz.
    // Çözüm: reserve'leri direkt kullanarak hesaplama yapalım.
    const sellReserveIn = sellIsToken0 ? sellPool.reserve1 : sellPool.reserve0; // tokenOut tarafı
    const sellReserveOut = sellIsToken0 ? sellPool.reserve0 : sellPool.reserve1; // tokenIn tarafı

    const amountInWithFee = midAmount * 997n;
    const numerator = amountInWithFee * sellReserveOut;
    const denominator = sellReserveIn * 1000n + amountInWithFee;
    const finalAmount = numerator / denominator;

    if (finalAmount > testAmount) {
      const profit = finalAmount - testAmount;
      if (profit > bestProfit) {
        bestProfit = profit;
        bestAmount = testAmount;
      }
    }
  }

  return { amountIn: bestAmount, profit: bestProfit };
}

// ---- Ana Arbitraj Tarayıcı ---- //

/**
 * Bir pool snapshot'ındaki tüm DEX çiftlerini karşılaştır
 * ve karlı arbitraj fırsatlarını döndür.
 */
export function findArbitrageOpportunities(
  snapshots: PoolSnapshot[],
): ArbitrageOpportunity[] {
  const opportunities: ArbitrageOpportunity[] = [];

  for (const snapshot of snapshots) {
    const prices = extractPrices(snapshot);

    // Her DEX çiftini karşılaştır
    for (let i = 0; i < prices.length; i++) {
      for (let j = 0; j < prices.length; j++) {
        if (i === j) continue;

        const buyDex = prices[i];
        const sellDex = prices[j];

        // Düşük fiyattan al, yüksek fiyattan sat
        if (buyDex.price >= sellDex.price) continue;

        const spreadPercent =
          ((sellDex.price - buyDex.price) / buyDex.price) * 100;

        // Minimum spread filtresi — gas maliyetini karşılaması lazım
        if (spreadPercent < 0.05) continue;

        // V2 fiyat manipülasyon kontrolü — referans fiyatla çapraz doğrulama
        if (buyDex.swapType === "V2" || sellDex.swapType === "V2") {
          const refA = getCachedReference(snapshot.pair.tokenA);
          const refB = getCachedReference(snapshot.pair.tokenB);

          // Buy tarafı V2 ise doğrula
          if (buyDex.swapType === "V2") {
            const buyCheck = validateSpotPrice(buyDex.price, refA, refB);
            if (!buyCheck.valid) {
              logger.warn(
                `PriceGuard: ${buyDex.name} ${snapshot.pair.label} reddedildi — ${buyCheck.reason}`,
              );
              continue;
            }
          }

          // Sell tarafı V2 ise doğrula
          if (sellDex.swapType === "V2") {
            const sellCheck = validateSpotPrice(sellDex.price, refA, refB);
            if (!sellCheck.valid) {
              logger.warn(
                `PriceGuard: ${sellDex.name} ${snapshot.pair.label} reddedildi — ${sellCheck.reason}`,
              );
              continue;
            }
          }
        }

        // Optimal miktar hesapla (sadece V2-V2 arası için şimdilik)
        let optimalAmountIn = 0n;
        let expectedAmountOut = 0n;

        if (buyDex.pool && sellDex.pool) {
          const optimal = findOptimalAmountIn(
            buyDex.pool,
            sellDex.pool,
            snapshot.pair.tokenA,
          );
          optimalAmountIn = optimal.amountIn;
          expectedAmountOut = optimal.profit;
        } else {
          // V3 dahilse sabit miktar kullan (0.1 ETH)
          optimalAmountIn = parseUnits("0.1", 18);
        }

        // Tahmini kar hesapla (USD cinsinden)
        const decimalsA = getDecimals(snapshot.pair.tokenA);
        const estimatedProfitUsd =
          Number(formatUnits(expectedAmountOut, decimalsA)) * sellDex.price;

        // Minimum kar filtresi
        if (estimatedProfitUsd < MIN_PROFIT_USD && expectedAmountOut > 0n) continue;

        const opp: ArbitrageOpportunity = {
          pair: snapshot.pair,
          buyDex: buyDex.name,
          sellDex: sellDex.name,
          buyRouter: buyDex.router,
          sellRouter: sellDex.router,
          buySwapType: buyDex.swapType,
          sellSwapType: sellDex.swapType,
          buyPrice: buyDex.price,
          sellPrice: sellDex.price,
          spreadPercent,
          estimatedProfitUsd,
          optimalAmountIn,
          expectedAmountOut,
          tokenIn: snapshot.pair.tokenA,
          tokenOut: snapshot.pair.tokenB,
        };

        opportunities.push(opp);

        logger.info(
          `Fırsat: ${snapshot.pair.label} | ${buyDex.name} -> ${sellDex.name} | spread: ${spreadPercent.toFixed(4)}% | ~$${estimatedProfitUsd.toFixed(2)}`,
        );
      }
    }
  }

  // En karlı fırsatı en başa koy
  opportunities.sort((a, b) => b.estimatedProfitUsd - a.estimatedProfitUsd);

  return opportunities;
}
