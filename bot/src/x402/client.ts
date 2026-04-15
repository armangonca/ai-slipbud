import {
  type Address,
  type Hex,
  encodePacked,
  keccak256,
  toHex,
  parseEther,
  formatEther,
} from "viem";
import { account } from "../client.js";
import { logger } from "../logger.js";

// ---- Types ---- //

/**
 * x402: HTTP 402 Payment Required protokolü.
 * AI agent'lar web servislerine mikro-ödeme yaparak erişir.
 *
 * Akış:
 * 1. Agent HTTP isteği atar
 * 2. Server 402 + ödeme detayları döner (fiyat, token, adres)
 * 3. Agent ödemeyi imzalar (bütçe kontrolü dahil)
 * 4. Agent isteği payment proof ile tekrar atar
 * 5. Server veriyi döner
 */

export interface PaymentRequirement {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: Address;
  requiredDeadline: string;
  extra?: Record<string, unknown>;
}

export interface PaymentPayload {
  x402Version: number;
  scheme: string;
  network: string;
  payload: {
    signature: Hex;
    authorization: {
      from: Address;
      to: Address;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: Hex;
    };
  };
}

// ---- Config ---- //

export interface X402Config {
  /** x402 aktif mi? Kapalıysa tüm 402 response'lar hata olarak döner */
  enabled: boolean;
  /** Tek ödeme limiti (wei) */
  maxPaymentPerRequest: bigint;
  /** Günlük toplam harcama limiti (wei) */
  dailyBudget: bigint;
  /** x402 ödeme imzası için validity süresi (saniye) */
  paymentValiditySeconds: number;
}

const DEFAULT_CONFIG: X402Config = {
  enabled: process.env["X402_ENABLED"] === "true",
  maxPaymentPerRequest: parseEther(process.env["X402_MAX_PER_REQUEST"] ?? "0.001"),
  dailyBudget: parseEther(process.env["X402_DAILY_BUDGET"] ?? "0.01"),
  paymentValiditySeconds: Number(process.env["X402_PAYMENT_VALIDITY_SECONDS"] ?? "300"),
};

let config: X402Config = { ...DEFAULT_CONFIG };

// ---- Budget Tracking ---- //

interface SpendingRecord {
  timestamp: number;
  amountWei: bigint;
  recipient: Address;
  resource: string;
}

let dailySpent = 0n;
let dailyResetTimestamp = Date.now();
const spendingLog: SpendingRecord[] = [];
const MAX_SPENDING_LOG = 500;

function resetDailyBudgetIfNeeded(): void {
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;

  if (now - dailyResetTimestamp > oneDayMs) {
    if (dailySpent > 0n) {
      logger.info(
        `x402 günlük bütçe reset | Dünkü harcama: ${formatEther(dailySpent)} ETH`,
      );
    }
    dailySpent = 0n;
    dailyResetTimestamp = now;
  }
}

function recordSpending(amount: bigint, recipient: Address, resource: string): void {
  dailySpent += amount;

  spendingLog.push({
    timestamp: Date.now(),
    amountWei: amount,
    recipient,
    resource,
  });

  // Log'u sınırla
  if (spendingLog.length > MAX_SPENDING_LOG) {
    spendingLog.splice(0, spendingLog.length - MAX_SPENDING_LOG);
  }
}

// ---- Payment Signing ---- //

async function signPayment(
  requirement: PaymentRequirement,
): Promise<PaymentPayload> {
  const now = Math.floor(Date.now() / 1000);
  const nonce = keccak256(toHex(now)) as Hex;
  const validBefore = now + config.paymentValiditySeconds;

  const message = encodePacked(
    ["address", "address", "uint256", "uint256", "uint256", "bytes32"],
    [
      account.address,
      requirement.payTo,
      BigInt(requirement.maxAmountRequired),
      BigInt(now),
      BigInt(validBefore),
      nonce,
    ],
  );

  const signature = await account.signMessage({
    message: { raw: keccak256(message) },
  });

  return {
    x402Version: 1,
    scheme: requirement.scheme,
    network: requirement.network,
    payload: {
      signature,
      authorization: {
        from: account.address,
        to: requirement.payTo,
        value: requirement.maxAmountRequired,
        validAfter: now.toString(),
        validBefore: validBefore.toString(),
        nonce,
      },
    },
  };
}

// ---- Core x402 Fetch ---- //

/**
 * x402 destekli HTTP isteği.
 * İlk 402 alırsa bütçe kontrolü yapar, ödeme imzalar, tekrar dener.
 * x402 kapalıysa veya bütçe aşılıyorsa hata fırlatır.
 */
export async function x402Fetch(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const initialResponse = await fetch(url, options);

  // 402 değilse direkt döndür
  if (initialResponse.status !== 402) {
    return initialResponse;
  }

  // x402 kapalıysa ödeme yapma
  if (!config.enabled) {
    throw new X402DisabledError(url);
  }

  logger.info(`x402: Ödeme gerekli — ${url}`);

  // 402 response'tan ödeme detaylarını çıkar
  const requirementsHeader = initialResponse.headers.get("X-PAYMENT");
  if (!requirementsHeader) {
    throw new X402Error("402 response but no X-PAYMENT header", url);
  }

  let requirements: PaymentRequirement[];
  try {
    requirements = JSON.parse(
      Buffer.from(requirementsHeader, "base64").toString(),
    );
  } catch {
    throw new X402Error("Malformed X-PAYMENT header", url);
  }

  if (requirements.length === 0) {
    throw new X402Error("Empty payment requirements", url);
  }

  const requirement = requirements[0];
  const paymentAmount = BigInt(requirement.maxAmountRequired);

  // Tek ödeme limiti kontrolü
  if (paymentAmount > config.maxPaymentPerRequest) {
    throw new X402BudgetError(
      `Tek ödeme limiti aşıldı: ${formatEther(paymentAmount)} ETH (limit: ${formatEther(config.maxPaymentPerRequest)} ETH)`,
      url,
      paymentAmount,
    );
  }

  // Günlük bütçe kontrolü
  resetDailyBudgetIfNeeded();
  if (dailySpent + paymentAmount > config.dailyBudget) {
    throw new X402BudgetError(
      `Günlük bütçe aşılır: harcanan ${formatEther(dailySpent)} + istek ${formatEther(paymentAmount)} > limit ${formatEther(config.dailyBudget)} ETH`,
      url,
      paymentAmount,
    );
  }

  logger.info(
    `x402: Ödeme yapılıyor — ${formatEther(paymentAmount)} ETH -> ${requirement.payTo}`,
  );

  // Ödemeyi imzala
  const payment = await signPayment(requirement);

  // İsteği ödeme proof ile tekrar at
  const paidResponse = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      "X-PAYMENT": Buffer.from(JSON.stringify(payment)).toString("base64"),
    },
  });

  if (!paidResponse.ok) {
    throw new X402Error(
      `Ödeme sonrası hata — ${paidResponse.status}: ${paidResponse.statusText}`,
      url,
    );
  }

  // Başarılı ödemeyi kaydet
  recordSpending(paymentAmount, requirement.payTo, url);

  logger.success(
    `x402: Ödeme başarılı — ${formatEther(paymentAmount)} ETH | Günlük toplam: ${formatEther(dailySpent)} ETH`,
  );

  return paidResponse;
}

/**
 * x402 ile JSON veri çek
 */
export async function x402FetchJson<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await x402Fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      Accept: "application/json",
    },
  });

  return response.json() as Promise<T>;
}

// ---- Error Types ---- //

export class X402Error extends Error {
  public readonly resource: string;
  constructor(message: string, resource: string) {
    super(`x402: ${message}`);
    this.name = "X402Error";
    this.resource = resource;
  }
}

export class X402DisabledError extends X402Error {
  constructor(resource: string) {
    super("x402 kapalı — ödeme yapılmadı", resource);
    this.name = "X402DisabledError";
  }
}

export class X402BudgetError extends X402Error {
  public readonly requestedAmount: bigint;
  constructor(message: string, resource: string, amount: bigint) {
    super(message, resource);
    this.name = "X402BudgetError";
    this.requestedAmount = amount;
  }
}

// ---- Public API ---- //

/** x402'nin aktif olup olmadığını kontrol et */
export function isX402Enabled(): boolean {
  return config.enabled;
}

/** Günlük harcama durumunu getir */
export function getSpendingStatus(): {
  dailySpent: bigint;
  dailyBudget: bigint;
  remainingBudget: bigint;
  totalPayments: number;
} {
  resetDailyBudgetIfNeeded();
  return {
    dailySpent,
    dailyBudget: config.dailyBudget,
    remainingBudget: config.dailyBudget - dailySpent,
    totalPayments: spendingLog.length,
  };
}

/** Son N ödeme kaydını getir */
export function getRecentPayments(count: number = 10): SpendingRecord[] {
  return spendingLog.slice(-count);
}

/** Runtime'da config güncelle */
export function updateX402Config(updates: Partial<X402Config>): void {
  config = { ...config, ...updates };
  logger.info(`x402 config güncellendi: enabled=${config.enabled}, dailyBudget=${formatEther(config.dailyBudget)} ETH`);
}
