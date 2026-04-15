import { logger } from "../logger.js";

// ---- Config ---- //

const BOT_TOKEN = process.env["TELEGRAM_BOT_TOKEN"] ?? "";
const CHAT_ID = process.env["TELEGRAM_CHAT_ID"] ?? "";
const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ---- Telegram API ---- //

async function apiCall(method: string, body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${API_BASE}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json() as { ok: boolean; result?: unknown; description?: string };

  if (!data.ok) {
    logger.warn(`Telegram API hatası: ${data.description}`);
  }

  return data.result;
}

// ---- Mesaj Gönderme ---- //

export async function sendMessage(text: string): Promise<void> {
  if (!BOT_TOKEN || !CHAT_ID) return;

  try {
    await apiCall("sendMessage", {
      chat_id: CHAT_ID,
      text,
      parse_mode: "HTML",
    });
  } catch (err) {
    logger.warn("Telegram mesaj gönderilemedi", err);
  }
}

// ---- Bildirim Fonksiyonları ---- //

export async function notifyStartup(botAddress: string, mode: string): Promise<void> {
  await sendMessage(
    `🤖 <b>SlipBud Agent Başlatıldı</b>\n\n` +
    `📍 Adres: <code>${botAddress}</code>\n` +
    `⚙️ Mod: ${mode}\n` +
    `🕐 ${new Date().toLocaleString("tr-TR")}`,
  );
}

export async function notifyTradeExecuted(
  pair: string,
  buyDex: string,
  sellDex: string,
  spread: number,
  profitUsd: number,
  mode: string,
  txHash?: string,
): Promise<void> {
  const txLink = txHash ? `\n🔗 TX: <code>${txHash}</code>` : "";

  await sendMessage(
    `✅ <b>Trade Gerçekleşti</b>\n\n` +
    `📊 ${pair}\n` +
    `🔄 ${buyDex} → ${sellDex}\n` +
    `📈 Spread: ${spread.toFixed(4)}%\n` +
    `💰 Tahmini kar: ~$${profitUsd.toFixed(2)}\n` +
    `⚡ Mod: ${mode}` +
    txLink,
  );
}

export async function notifyTradeFailed(
  pair: string,
  error: string,
): Promise<void> {
  await sendMessage(
    `❌ <b>Trade Başarısız</b>\n\n` +
    `📊 ${pair}\n` +
    `🚫 Hata: ${error}`,
  );
}

export async function notifyRiskPause(reason: string): Promise<void> {
  await sendMessage(
    `🛑 <b>Agent Durduruldu</b>\n\n` +
    `⚠️ ${reason}\n\n` +
    `Devam ettirmek için /resume gönder`,
  );
}

export async function notifyDailyReport(
  totalTrades: number,
  winRate: number,
  netProfitEth: number,
  netProfitUsd: number,
): Promise<void> {
  await sendMessage(
    `📋 <b>Günlük Rapor</b>\n\n` +
    `📊 Trade: ${totalTrades}\n` +
    `🎯 Win rate: ${winRate.toFixed(1)}%\n` +
    `💰 Net kar: ${netProfitEth.toFixed(4)} ETH (~$${netProfitUsd.toFixed(2)})\n` +
    `🕐 ${new Date().toLocaleString("tr-TR")}`,
  );
}

// ---- Komut Dinleme ---- //

interface TelegramUpdate {
  update_id: number;
  message?: {
    text?: string;
    chat: { id: number };
    from: { id: number; username?: string };
  };
}

export type CommandHandler = (command: string, args: string) => Promise<string>;

let lastUpdateId = 0;

/**
 * Yeni komutları poll et ve handler'a gönder.
 * Agent döngüsünden her cycle'da çağrılır.
 */
export async function pollCommands(handler: CommandHandler): Promise<void> {
  if (!BOT_TOKEN || !CHAT_ID) return;

  try {
    const result = await apiCall("getUpdates", {
      offset: lastUpdateId + 1,
      timeout: 0,
      allowed_updates: ["message"],
    });

    const updates = (result as TelegramUpdate[]) ?? [];

    for (const update of updates) {
      lastUpdateId = update.update_id;

      const msg = update.message;
      if (!msg?.text) continue;

      // Sadece owner'dan gelen komutları kabul et
      if (msg.chat.id.toString() !== CHAT_ID) {
        logger.warn(`Yetkisiz Telegram mesajı: ${msg.from.username} (${msg.chat.id})`);
        continue;
      }

      // Komut mu?
      if (!msg.text.startsWith("/")) continue;

      const parts = msg.text.split(" ");
      const command = parts[0].replace("@" + "slipbud_alert_bot", "");
      const args = parts.slice(1).join(" ");

      logger.info(`Telegram komutu: ${command} ${args}`);

      const response = await handler(command, args);
      await sendMessage(response);
    }
  } catch (err) {
    // Sessiz başarısızlık — Telegram erişilemez olabilir
  }
}

/**
 * HTML özel karakterlerini escape et — injection'ı engeller
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Telegram bot'un aktif olup olmadığını kontrol et
 */
export function isEnabled(): boolean {
  return Boolean(BOT_TOKEN && CHAT_ID);
}
