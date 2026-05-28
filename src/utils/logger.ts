type LogLevel = "debug" | "info" | "warn" | "error";

interface Logger {
  debug: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
}

function formatMessage(level: LogLevel, module: string, message: string): string {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level.toUpperCase()}] [${module}] ${message}`;
}

/**
 * 创建带模块标识的 logger 实例。
 *
 * 生产环境中可将 debug 级别静默。
 */
export function createLogger(module: string): Logger {
  return {
    debug: (message, ...args) => {
      // debug 级别仅在开发环境输出
      if (typeof window === "undefined" || window.location.hostname === "localhost") {
        console.debug(formatMessage("debug", module, message), ...args);
      }
    },
    info: (message, ...args) => {
      console.info(formatMessage("info", module, message), ...args);
    },
    warn: (message, ...args) => {
      console.warn(formatMessage("warn", module, message), ...args);
    },
    error: (message, ...args) => {
      console.error(formatMessage("error", module, message), ...args);
    },
  };
}
