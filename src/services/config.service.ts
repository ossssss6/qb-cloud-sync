// src/services/config.service.ts
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { IAppConfig, IArchivingRule } from '../interfaces/config.types';

// 加载 .env 文件。应该在模块的最顶部执行，以便 process.env 尽早被填充。
// dotenv.config(); // 基本加载
// 为了能指定.env文件路径（例如在测试中），可以这样做：
const envPath = process.env.NODE_ENV === 'test' ? '.env.test' : '.env';
dotenv.config({ path: path.resolve(process.cwd(), envPath) });

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true';
}

function parseIntOrThrow(
  value: string | undefined,
  keyName: string,
  defaultValue?: number
): number {
  if (value === undefined) {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`Missing required environment variable: ${keyName}`);
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Invalid number for environment variable ${keyName}: ${value}`);
  }
  return parsed;
}

function getStringOrThrow(
  value: string | undefined,
  keyName: string,
  defaultValue?: string
): string {
  if (value === undefined) {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`Missing required environment variable: ${keyName}`);
  }
  return value;
}

function loadArchivingRules(): IArchivingRule[] {
  const rulesJsonString = process.env.ARCHIVING_RULES_JSON;
  const rulesPath = process.env.ARCHIVING_RULES_PATH;

  if (rulesJsonString) {
    try {
      const rules = JSON.parse(rulesJsonString);
      if (!Array.isArray(rules)) {
        throw new Error('ARCHIVING_RULES_JSON must be a JSON array.');
      }
      // TODO: Add more detailed validation for each rule's structure
      return rules as IArchivingRule[];
    } catch (error) {
      console.error('Failed to parse ARCHIVING_RULES_JSON:', error);
      return []; // 或者抛出错误
    }
  } else if (rulesPath) {
    try {
      const fullPath = path.resolve(process.cwd(), rulesPath);
      if (!fs.existsSync(fullPath)) {
        console.warn(`Archiving rules file not found at: ${fullPath}. Using empty rules.`);
        return [];
      }
      const fileContent = fs.readFileSync(fullPath, 'utf-8');
      const rules = JSON.parse(fileContent);
      if (!Array.isArray(rules)) {
        throw new Error(`Archiving rules file ${rulesPath} must contain a JSON array.`);
      }
      // TODO: Add more detailed validation for each rule's structure
      return rules as IArchivingRule[];
    } catch (error) {
      console.error(`Failed to load or parse archiving rules from ${rulesPath}:`, error);
      return []; // 或者抛出错误
    }
  }
  return []; // 默认返回空规则数组
}

const config: IAppConfig = {
  nodeEnv: getStringOrThrow(
    process.env.NODE_ENV,
    'NODE_ENV',
    'development'
  ) as IAppConfig['nodeEnv'],
  logLevel: getStringOrThrow(process.env.LOG_LEVEL, 'LOG_LEVEL', 'info') as IAppConfig['logLevel'],
  databaseUrl: getStringOrThrow(process.env.DATABASE_URL, 'DATABASE_URL'),

  qbittorrent: {
    url: getStringOrThrow(process.env.QB_URL, 'QB_URL'),
    username: process.env.QB_USERNAME,
    password: process.env.QB_PASSWORD,
  },

  rclone: {
    configPath: process.env.RCLONE_CONFIG_PATH,
    remoteName: getStringOrThrow(process.env.RCLONE_REMOTE_NAME, 'RCLONE_REMOTE_NAME'),
    defaultUploadPath: getStringOrThrow(
      process.env.RCLONE_DEFAULT_UPLOAD_PATH,
      'RCLONE_DEFAULT_UPLOAD_PATH',
      '/'
    ),
  },

  mailer: {
    host: process.env.MAILER_HOST,
    port: process.env.MAILER_PORT
      ? parseIntOrThrow(process.env.MAILER_PORT, 'MAILER_PORT')
      : undefined,
    secure: process.env.MAILER_PORT ? parseBoolean(process.env.MAILER_SECURE, false) : undefined,
    user: process.env.MAILER_USER,
    pass: process.env.MAILER_PASS,
    from: process.env.MAILER_FROM,
    to: process.env.MAILER_TO ? process.env.MAILER_TO.split(',').map((email) => email.trim()) : [],
  },

  behavior: {
    deleteLocalFiles: parseBoolean(process.env.DELETE_LOCAL_FILES, true),
    cleanupEmptyDirs: parseBoolean(process.env.CLEANUP_EMPTY_DIRS, true),
    deleteQbTask: parseBoolean(process.env.DELETE_QB_TASK, true),
  },

  taskProcessor: {
    pollIntervalMs: parseIntOrThrow(process.env.POLL_INTERVAL_MS, 'POLL_INTERVAL_MS', 300000),
    maxConcurrentUploads: parseIntOrThrow(
      process.env.MAX_CONCURRENT_UPLOADS,
      'MAX_CONCURRENT_UPLOADS',
      2
    ),
  },

  archivingRules: loadArchivingRules(),
};

// 校验关键配置
if (!config.qbittorrent.url) {
  throw new Error('QB_URL is not defined in your .env file.');
}
if (!config.rclone.remoteName) {
  throw new Error('RCLONE_REMOTE_NAME is not defined in your .env file.');
}
// 可以添加更多针对性的校验，比如邮件配置如果启用了邮件通知等

export default config;
