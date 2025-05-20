// src/services/logger.service.ts
import winston, { Logform } from 'winston';
import 'winston-daily-rotate-file';
import path from 'node:path';
import config from './config.service';

const { combine, timestamp, printf, colorize, errors, splat } = winston.format;

// 为 Winston 的 info 对象定义一个更具体的接口
interface AppLogInfo extends Logform.TransformableInfo {
  // 从 Logform.TransformableInfo 继承 level (unknown), message (unknown) 等
  module?: string;
  timestamp?: string; // 由 timestamp() format 添加
  stack?: string; // 由 errors() format 添加
  // 注意：不在此处显式声明 Symbol.for('splat')
  // 我们将在使用时通过 info[Symbol.for('splat') as keyof AppLogInfo] 访问
  [key: string]: unknown; // 允许其他字符串键，值为 unknown
}

// --- 控制台 Transport 的格式化程序 ---
const consoleFormat = combine(
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  colorize(),
  errors({ stack: true }),
  splat(),
  printf((info: AppLogInfo) => {
    let processedLevel = info.level as string; // 断言 level 为 string
    const levelTextMatch =
      typeof processedLevel === 'string' ? processedLevel.match(/\x1B\[\d+m(\w+)\x1B\[\d+m/) : null;
    if (levelTextMatch && levelTextMatch[1]) {
      const levelText = levelTextMatch[1];
      processedLevel = processedLevel.replace(levelText, levelText.toUpperCase());
    } else if (typeof processedLevel === 'string' && !processedLevel.includes('\x1B[')) {
      processedLevel = processedLevel.toUpperCase();
    }

    const moduleName = info.module || '';
    const messageContent = typeof info.message === 'string' ? info.message : String(info.message);
    let logMessage = `${info.timestamp || ''} [${processedLevel}]`;

    if (moduleName) {
      logMessage += ` [${moduleName}]`;
    }
    logMessage += `: ${messageContent}`;

    if (info.stack) {
      logMessage += `\n${info.stack}`;
    }

    // 改进附加元数据的打印
    const splatKey = Symbol.for('splat'); // 获取 Symbol
    const splatArray = info[splatKey as keyof AppLogInfo] as unknown[] | undefined;

    if (splatArray && Array.isArray(splatArray) && splatArray.length > 0) {
      const objectsInSplat = splatArray.filter((arg) => typeof arg === 'object' && arg !== null);
      if (objectsInSplat.length > 0) {
        objectsInSplat.forEach((obj) => {
          logMessage += ` ${JSON.stringify(obj)}`;
        });
      }
    } else {
      const metaToLog: Record<string, unknown> = {};
      const knownSymbols = [Symbol.for('level'), Symbol.for('message'), splatKey]; // 使用变量
      const knownStrings = ['level', 'message', 'module', 'timestamp', 'stack', 'splat']; // 'splat' 作为字符串键也排除

      Reflect.ownKeys(info).forEach((key) => {
        if (typeof key === 'string' && !knownStrings.includes(key)) {
          metaToLog[key] = info[key as keyof AppLogInfo];
        } else if (typeof key === 'symbol' && !knownSymbols.includes(key)) {
          metaToLog[key.toString()] = info[key as keyof AppLogInfo];
        }
      });
      if (Object.keys(metaToLog).length > 0) {
        logMessage += ` ${JSON.stringify(metaToLog)}`;
      }
    }
    return logMessage;
  })
);

// --- 文件 Transports 的格式化程序 (无颜色, 级别大写) ---
const fileFormat = combine(
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  errors({ stack: true }),
  splat(),
  printf((info: AppLogInfo) => {
    const moduleName = info.module || '';
    const currentLevel = info.level as string;
    const level =
      typeof currentLevel === 'string'
        ? currentLevel.replace(/\x1B\[\d+m/g, '').toUpperCase()
        : 'UNKNOWN_LEVEL';
    const messageContent = typeof info.message === 'string' ? info.message : String(info.message);
    let logMessage = `${info.timestamp || ''} [${level}]`;

    if (moduleName) {
      logMessage += ` [${moduleName}]`;
    }
    logMessage += `: ${messageContent}`;

    if (info.stack) {
      logMessage += `\n${info.stack}`;
    }

    const splatKey = Symbol.for('splat');
    const splatArray = info[splatKey as keyof AppLogInfo] as unknown[] | undefined;
    if (splatArray && Array.isArray(splatArray) && splatArray.length > 0) {
      const objectsInSplat = splatArray.filter((arg) => typeof arg === 'object' && arg !== null);
      if (objectsInSplat.length > 0) {
        objectsInSplat.forEach((obj) => {
          logMessage += ` ${JSON.stringify(obj)}`;
        });
      }
    } else {
      const metaToLog: Record<string, unknown> = {};
      const knownSymbols = [Symbol.for('level'), Symbol.for('message'), splatKey];
      const knownStrings = ['level', 'message', 'module', 'timestamp', 'stack', 'splat'];
      Reflect.ownKeys(info).forEach((key) => {
        if (typeof key === 'string' && !knownStrings.includes(key)) {
          metaToLog[key] = info[key as keyof AppLogInfo];
        } else if (typeof key === 'symbol' && !knownSymbols.includes(key)) {
          metaToLog[key.toString()] = info[key as keyof AppLogInfo];
        }
      });
      if (Object.keys(metaToLog).length > 0) {
        logMessage += ` ${JSON.stringify(metaToLog)}`;
      }
    }
    return logMessage;
  })
);

const transports: winston.transport[] = [];

if (config.nodeEnv !== 'production' || ['debug', 'silly', 'verbose'].includes(config.logLevel)) {
  transports.push(
    new winston.transports.Console({
      level: config.logLevel,
      format: consoleFormat,
    })
  );
}

transports.push(
  new winston.transports.DailyRotateFile({
    level: 'info',
    filename: path.join(process.cwd(), 'logs', 'app-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '14d',
    format: fileFormat,
  })
);

transports.push(
  new winston.transports.DailyRotateFile({
    level: 'error',
    filename: path.join(process.cwd(), 'logs', 'error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '30d',
    handleExceptions: true,
    handleRejections: true,
    format: fileFormat,
  })
);

const logger = winston.createLogger({
  level: config.logLevel,
  transports: transports,
  exitOnError: false,
});

export const createLogger = (moduleName: string): winston.Logger => {
  return logger.child({ module: moduleName });
};

export default logger;
