export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export class Logger {
  constructor(private context: string, private level: LogLevel = LogLevel.INFO) {}

  private format(levelStr: string, message: string, meta?: any): string {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${levelStr}] [${this.context}]: ${message}${metaStr}`;
  }

  debug(message: string, meta?: any): void {
    if (this.level <= LogLevel.DEBUG) console.debug(this.format('DEBUG', message, meta));
  }

  info(message: string, meta?: any): void {
    if (this.level <= LogLevel.INFO) console.log(this.format('INFO', message, meta));
  }

  warn(message: string, meta?: any): void {
    if (this.level <= LogLevel.WARN) console.warn(this.format('WARN', message, meta));
  }

  error(message: string, error?: any): void {
    if (this.level <= LogLevel.ERROR) console.error(this.format('ERROR', message, error?.stack || error));
  }
}
