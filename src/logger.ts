// ============================================
// Logger utility with colored output
// ============================================

import { LogLevel } from './types';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[90m',   // gray
  info: '\x1b[36m',    // cyan
  warn: '\x1b[33m',    // yellow
  error: '\x1b[31m',   // red
};

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

let currentLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function formatTimestamp(): string {
  return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[currentLevel];
}

export const logger = {
  debug(component: string, message: string, data?: any): void {
    if (!shouldLog('debug')) return;
    const ts = formatTimestamp();
    console.log(`${LEVEL_COLORS.debug}[${ts}] [DEBUG] [${component}]${RESET} ${message}`, data !== undefined ? data : '');
  },

  info(component: string, message: string, data?: any): void {
    if (!shouldLog('info')) return;
    const ts = formatTimestamp();
    console.log(`${LEVEL_COLORS.info}[${ts}] [INFO]  [${component}]${RESET} ${message}`, data !== undefined ? data : '');
  },

  warn(component: string, message: string, data?: any): void {
    if (!shouldLog('warn')) return;
    const ts = formatTimestamp();
    console.warn(`${LEVEL_COLORS.warn}[${ts}] [WARN]  [${component}]${RESET} ${message}`, data !== undefined ? data : '');
  },

  error(component: string, message: string, data?: any): void {
    if (!shouldLog('error')) return;
    const ts = formatTimestamp();
    console.error(`${LEVEL_COLORS.error}[${ts}] [ERROR] [${component}]${RESET} ${message}`, data !== undefined ? data : '');
  },

  banner(text: string): void {
    const line = '═'.repeat(60);
    console.log(`\n${BOLD}\x1b[35m╔${line}╗`);
    console.log(`║  ${text.padEnd(58)}║`);
    console.log(`╚${line}╝${RESET}\n`);
  },

  table(data: Record<string, any>): void {
    const maxKey = Math.max(...Object.keys(data).map(k => k.length));
    for (const [key, value] of Object.entries(data)) {
      console.log(`  ${LEVEL_COLORS.info}${key.padEnd(maxKey)}${RESET}  ${value}`);
    }
  },

  separator(): void {
    console.log(`${LEVEL_COLORS.debug}${'─'.repeat(60)}${RESET}`);
  },
};
