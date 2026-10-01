"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = exports.LogLevel = void 0;
var LogLevel;
(function (LogLevel) {
    LogLevel[LogLevel["DEBUG"] = 0] = "DEBUG";
    LogLevel[LogLevel["INFO"] = 1] = "INFO";
    LogLevel[LogLevel["WARN"] = 2] = "WARN";
    LogLevel[LogLevel["ERROR"] = 3] = "ERROR";
})(LogLevel || (exports.LogLevel = LogLevel = {}));
class Logger {
    context;
    level;
    constructor(context, level = LogLevel.INFO) {
        this.context = context;
        this.level = level;
    }
    format(levelStr, message, meta) {
        const timestamp = new Date().toISOString();
        const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
        return `[${timestamp}] [${levelStr}] [${this.context}]: ${message}${metaStr}`;
    }
    debug(message, meta) {
        if (this.level <= LogLevel.DEBUG)
            console.debug(this.format('DEBUG', message, meta));
    }
    info(message, meta) {
        if (this.level <= LogLevel.INFO)
            console.log(this.format('INFO', message, meta));
    }
    warn(message, meta) {
        if (this.level <= LogLevel.WARN)
            console.warn(this.format('WARN', message, meta));
    }
    error(message, error) {
        if (this.level <= LogLevel.ERROR)
            console.error(this.format('ERROR', message, error?.stack || error));
    }
}
exports.Logger = Logger;
