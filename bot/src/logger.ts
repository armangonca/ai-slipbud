const COLORS = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
} as const;

function timestamp(): string {
  return new Date().toISOString();
}

export const logger = {
  info(msg: string, data?: unknown) {
    console.log(`${COLORS.cyan}[INFO]${COLORS.reset} ${COLORS.gray}${timestamp()}${COLORS.reset} ${msg}`, data ?? "");
  },

  success(msg: string, data?: unknown) {
    console.log(`${COLORS.green}[OK]${COLORS.reset}   ${COLORS.gray}${timestamp()}${COLORS.reset} ${msg}`, data ?? "");
  },

  warn(msg: string, data?: unknown) {
    console.warn(`${COLORS.yellow}[WARN]${COLORS.reset} ${COLORS.gray}${timestamp()}${COLORS.reset} ${msg}`, data ?? "");
  },

  error(msg: string, data?: unknown) {
    console.error(`${COLORS.red}[ERR]${COLORS.reset}  ${COLORS.gray}${timestamp()}${COLORS.reset} ${msg}`, data ?? "");
  },

  trade(msg: string, data?: unknown) {
    console.log(`${COLORS.green}[TRADE]${COLORS.reset} ${COLORS.gray}${timestamp()}${COLORS.reset} ${msg}`, data ?? "");
  },
};
