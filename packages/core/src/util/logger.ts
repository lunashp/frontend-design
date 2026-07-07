/**
 * Minimal structured logger + progress-event channel. The engine emits progress
 * so transports (host WS, MCP) can surface it without the engine knowing about them.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ProgressEvent {
  readonly phase: string;
  readonly message: string;
  /** 0..1 when known. */
  readonly ratio?: number;
}

export type ProgressListener = (event: ProgressEvent) => void;

export interface Logger {
  log(level: LogLevel, message: string, meta?: Record<string, unknown>): void;
  progress(event: ProgressEvent): void;
}

export interface CreateLoggerOptions {
  readonly level?: LogLevel;
  readonly onProgress?: ProgressListener;
  readonly sink?: (level: LogLevel, message: string, meta?: Record<string, unknown>) => void;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const threshold = LEVEL_ORDER[options.level ?? 'info'];
  const sink =
    options.sink ??
    ((level, message, meta) => {
      const line = `[ce:${level}] ${message}`;
      if (level === 'error') console.error(line, meta ?? '');
      else if (level === 'warn') console.warn(line, meta ?? '');
      else console.log(line, meta ?? '');
    });

  return {
    log(level, message, meta) {
      if (LEVEL_ORDER[level] >= threshold) sink(level, message, meta);
    },
    progress(event) {
      options.onProgress?.(event);
    },
  };
}

/** A no-op logger for tests and headless callers. */
export const NOOP_LOGGER: Logger = {
  log() {},
  progress() {},
};
