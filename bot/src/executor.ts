import {
  type Address,
  type Hex,
  type TransactionReceipt,
  encodePacked,
  encodeAbiParameters,
  parseAbiParameters,
  getContract,
  formatUnits,
} from "viem";
import { publicClient, walletClient, account } from "./client.js";
import {
  ROUTER_ADDRESS,
  TREASURY_ADDRESS,
  MAX_GAS_GWEI,
  DRY_RUN,
} from "./config.js";
import { EXECUTOR_CONFIG } from "./strategyConfig.js";
import { type ArbitrageOpportunity } from "./arbitrage.js";
import { logger } from "./logger.js";
import SlipBudRouterABI from "./abi/SlipBudRouter.json" with { type: "json" };
import SlipBudTreasuryABI from "./abi/SlipBudTreasury.json" with { type: "json" };

// ---- Contract Instances ---- //

const treasuryContract = getContract({
  address: TREASURY_ADDRESS,
  abi: SlipBudTreasuryABI,
  client: { public: publicClient, wallet: walletClient },
});

// ---- Gas Kontrolü ---- //

async function isGasSafe(): Promise<boolean> {
  const gasPrice = await publicClient.getGasPrice();
  const gasPriceGwei = Number(formatUnits(gasPrice, 9));

  if (gasPriceGwei > MAX_GAS_GWEI) {
    logger.warn(`Gas çok yüksek: ${gasPriceGwei.toFixed(2)} gwei (limit: ${MAX_GAS_GWEI})`);
    return false;
  }

  return true;
}

// ---- Retry Mekanizması ---- //

function isRetryableError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  const lowerMsg = msg.toLowerCase();
  return EXECUTOR_CONFIG.RETRYABLE_ERRORS.some((pattern) =>
    lowerMsg.includes(pattern.toLowerCase()),
  );
}

async function withRetry<T>(
  operation: () => Promise<T>,
  label: string,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= EXECUTOR_CONFIG.MAX_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;

      if (attempt === EXECUTOR_CONFIG.MAX_RETRIES || !isRetryableError(err)) {
        throw err;
      }

      const delay = EXECUTOR_CONFIG.RETRY_BASE_DELAY_MS * 2 ** attempt;
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.warn(
        `${label} retry ${attempt + 1}/${EXECUTOR_CONFIG.MAX_RETRIES} — ${delay}ms sonra tekrar denenecek: ${errMsg}`,
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

// ---- Path Encoding ---- //

function encodeV2Path(tokenIn: Address, tokenOut: Address): Hex {
  return encodeAbiParameters(parseAbiParameters("address[]"), [
    [tokenIn, tokenOut],
  ]);
}

function encodeV3Path(tokenIn: Address, fee: number, tokenOut: Address): Hex {
  return encodePacked(
    ["address", "uint24", "address"],
    [tokenIn, fee, tokenOut],
  );
}

// ---- SwapParams Helpers ---- //

function swapTypeToEnum(swapType: "V2" | "V3"): number {
  return swapType === "V2" ? 0 : 1;
}

function getDeadline(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + EXECUTOR_CONFIG.DEADLINE_SECONDS);
}

function applySlippage(amount: bigint): bigint {
  const factor = BigInt(10000 - EXECUTOR_CONFIG.SLIPPAGE_BPS);
  return (amount * factor) / 10000n;
}

/**
 * Trade miktarına buffer ekle.
 * Treasury'den çekilecek miktar = amountIn + %buffer
 * Kullanılmayan kısım trade sonunda Treasury'ye geri döner.
 */
function applyBuffer(amount: bigint): bigint {
  const factor = BigInt(10000 + EXECUTOR_CONFIG.TRADE_BUFFER_BPS);
  return (amount * factor) / 10000n;
}

// ---- Receipt Helper ---- //

function extractGasCost(receipt: TransactionReceipt): { gasUsed: string; gasCostEth: number } {
  const gasUsed = receipt.gasUsed.toString();
  const gasCostEth = Number(formatUnits(
    receipt.gasUsed * (receipt.effectiveGasPrice ?? 0n),
    18,
  ));
  return { gasUsed, gasCostEth };
}

// ---- Types ---- //

export interface TradeResult {
  success: boolean;
  txHash?: Hex;
  error?: string;
  gasUsed?: string;
  gasCostEth?: number;
}

// ---- Trade Execution ---- //

/**
 * Pull-based atomik arbitraj — TEK TX:
 *
 * Bot → Router.executeArbitrage(pullAmount, buySwap, sellSwap)
 *   ├── Router → Treasury.pullForBot(token, pullAmount)  ← fon çek
 *   ├── buy swap (amountIn = optimal miktar)
 *   ├── sell swap (amountIn = buy çıktısı)
 *   ├── Router → Treasury.transfer(TÜMÜ)                 ← her şeyi geri gönder
 *   └── Router → Treasury.recordProfit(kar, geri dönen)   ← muhasebe
 *
 * TX revert ederse → pullForBot da revert → Treasury'de hiçbir şey değişmez.
 * Stuck fund riski sıfır.
 */
export async function executeSimpleArbitrage(
  opp: ArbitrageOpportunity,
): Promise<TradeResult> {
  try {
    // 1. Gas kontrolü
    if (!(await isGasSafe())) {
      return { success: false, error: "Gas too high" };
    }

    // 2. Treasury kontrolleri
    const [allowance, treasuryBalance] = await Promise.all([
      treasuryContract.read.getBotAllowance([opp.tokenIn]) as Promise<bigint>,
      treasuryContract.read.getTokenBalance([opp.tokenIn]) as Promise<bigint>,
    ]);

    // pullAmount = amountIn + buffer
    const pullAmount = applyBuffer(opp.optimalAmountIn);

    if (allowance < pullAmount) {
      logger.warn(
        `Yetersiz allowance: ${formatUnits(allowance, 18)} < ${formatUnits(pullAmount, 18)} (buffer dahil)`,
      );
      return { success: false, error: "Insufficient bot allowance" };
    }

    if (treasuryBalance < pullAmount) {
      logger.warn(`Yetersiz treasury bakiye: ${formatUnits(treasuryBalance, 18)}`);
      return { success: false, error: "Insufficient treasury balance" };
    }

    logger.trade(
      `Executing: ${opp.pair.label} | ${opp.buyDex} -> ${opp.sellDex} | amount: ${formatUnits(opp.optimalAmountIn, 18)} | pull: ${formatUnits(pullAmount, 18)} | spread: ${opp.spreadPercent.toFixed(4)}%`,
    );

    if (DRY_RUN) {
      logger.info("[DRY RUN] Trade simüle edildi, gerçek tx gönderilmedi");
      return { success: true };
    }

    const deadline = getDeadline();
    const minAmountOut = applySlippage(opp.expectedAmountOut);

    // 3. Swap path'lerini hazırla
    const buyPath =
      opp.buySwapType === "V2"
        ? encodeV2Path(opp.tokenIn, opp.tokenOut)
        : encodeV3Path(opp.tokenIn, opp.pair.uniV3Fee, opp.tokenOut);

    const sellPath =
      opp.sellSwapType === "V2"
        ? encodeV2Path(opp.tokenOut, opp.tokenIn)
        : encodeV3Path(opp.tokenOut, opp.pair.uniV3Fee, opp.tokenIn);

    // 4. TEK TX: Router.executeArbitrage (pull + buy + sell + return)
    const arbTx = await withRetry(
      () =>
        walletClient.writeContract({
          address: ROUTER_ADDRESS,
          abi: SlipBudRouterABI,
          functionName: "executeArbitrage",
          args: [
            {
              pullAmount,
              buySwap: {
                swapType: swapTypeToEnum(opp.buySwapType),
                tokenIn: opp.tokenIn,
                tokenOut: opp.tokenOut,
                amountIn: opp.optimalAmountIn,
                amountOutMin: minAmountOut,
                router: opp.buyRouter,
                path: buyPath,
                deadline,
              },
              sellSwap: {
                swapType: swapTypeToEnum(opp.sellSwapType),
                tokenIn: opp.tokenOut,
                tokenOut: opp.tokenIn,
                amountIn: 0n, // Kontrat buy çıktısını kullanacak
                amountOutMin: opp.optimalAmountIn,
                router: opp.sellRouter,
                path: sellPath,
                deadline,
              },
              profitToken: opp.tokenIn,
            },
          ],
          account,
        }),
      "executeArbitrage",
    );

    logger.info(`executeArbitrage tx: ${arbTx}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: arbTx });
    const { gasUsed, gasCostEth } = extractGasCost(receipt);

    if (receipt.status === "success") {
      logger.success(
        `Arbitraj tamamlandı: ${opp.pair.label} | ~$${opp.estimatedProfitUsd.toFixed(2)} kar | gas: ${gasCostEth.toFixed(6)} ETH`,
      );
      return { success: true, txHash: arbTx, gasUsed, gasCostEth };
    } else {
      return { success: false, error: "Transaction reverted", gasUsed, gasCostEth };
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error(`Trade başarısız: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

/**
 * Flashloan arbitrajı: Aave'den borç al -> swap zinciri -> borcu öde -> kar treasury'ye
 * Zaten atomik — Aave callback tek TX'te çalışır, fail ederse tüm TX revert olur.
 */
export async function executeFlashLoanArbitrage(
  opp: ArbitrageOpportunity,
): Promise<TradeResult> {
  try {
    if (!(await isGasSafe())) {
      return { success: false, error: "Gas too high" };
    }

    logger.trade(
      `FlashLoan Executing: ${opp.pair.label} | ${opp.buyDex} -> ${opp.sellDex} | amount: ${formatUnits(opp.optimalAmountIn, 18)}`,
    );

    if (DRY_RUN) {
      logger.info("[DRY RUN] FlashLoan simüle edildi, gerçek tx gönderilmedi");
      return { success: true };
    }

    const deadline = getDeadline();
    const minAmountOut = applySlippage(opp.expectedAmountOut);

    const buyPath =
      opp.buySwapType === "V2"
        ? encodeV2Path(opp.tokenIn, opp.tokenOut)
        : encodeV3Path(opp.tokenIn, opp.pair.uniV3Fee, opp.tokenOut);

    const sellPath =
      opp.sellSwapType === "V2"
        ? encodeV2Path(opp.tokenOut, opp.tokenIn)
        : encodeV3Path(opp.tokenOut, opp.pair.uniV3Fee, opp.tokenIn);

    const swapData = encodeAbiParameters(
      parseAbiParameters(
        "(uint8 swapType, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOutMin, address router, bytes path, uint256 deadline)[]",
      ),
      [
        [
          {
            swapType: swapTypeToEnum(opp.buySwapType),
            tokenIn: opp.tokenIn,
            tokenOut: opp.tokenOut,
            amountIn: opp.optimalAmountIn,
            amountOutMin: minAmountOut,
            router: opp.buyRouter,
            path: buyPath,
            deadline,
          },
          {
            swapType: swapTypeToEnum(opp.sellSwapType),
            tokenIn: opp.tokenOut,
            tokenOut: opp.tokenIn,
            amountIn: minAmountOut,
            amountOutMin: opp.optimalAmountIn,
            router: opp.sellRouter,
            path: sellPath,
            deadline,
          },
        ],
      ],
    );

    const flashTx = await withRetry(
      () =>
        walletClient.writeContract({
          address: ROUTER_ADDRESS,
          abi: SlipBudRouterABI,
          functionName: "executeFlashLoan",
          args: [
            {
              token: opp.tokenIn,
              amount: opp.optimalAmountIn,
              swapData,
            },
          ],
          account,
        }),
      "executeFlashLoan",
    );

    logger.info(`FlashLoan tx: ${flashTx}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: flashTx });

    const { gasUsed, gasCostEth } = extractGasCost(receipt);

    if (receipt.status === "success") {
      logger.success(
        `FlashLoan arbitraj tamamlandı: ${opp.pair.label} | ~$${opp.estimatedProfitUsd.toFixed(2)} kar | gas: ${gasCostEth.toFixed(6)} ETH`,
      );
      return { success: true, txHash: flashTx, gasUsed, gasCostEth };
    } else {
      return { success: false, error: "Transaction reverted", gasUsed, gasCostEth };
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error(`FlashLoan başarısız: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

// ---- Treasury Durum Sorgulama ---- //

export async function logTreasuryStatus(token: Address): Promise<void> {
  try {
    const [balance, allowance, totalProfit, totalWithdrawn] = await Promise.all([
      treasuryContract.read.getTokenBalance([token]) as Promise<bigint>,
      treasuryContract.read.getBotAllowance([token]) as Promise<bigint>,
      treasuryContract.read.getTotalProfit([token]) as Promise<bigint>,
      treasuryContract.read.getTotalWithdrawn([token]) as Promise<bigint>,
    ]);

    logger.info(
      `Treasury | bakiye: ${formatUnits(balance, 18)} | allowance: ${formatUnits(allowance, 18)} | toplam kar: ${formatUnits(totalProfit, 18)} | toplam çekim: ${formatUnits(totalWithdrawn, 18)}`,
    );
  } catch (err) {
    logger.warn("Treasury durumu okunamadı", err);
  }
}
