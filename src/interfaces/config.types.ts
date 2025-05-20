// src/interfaces/config.types.ts

export interface IQBittorrentConfig {
  url: string;
  username?: string; // 用户名和密码可以是可选的，如果qB不需要认证
  password?: string;
}

export interface IRcloneConfig {
  configPath?: string; // 如果 rclone.conf 在默认位置，这个可以不填
  remoteName: string;
  defaultUploadPath: string;
}

export interface IMailerConfig {
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  pass?: string;
  from?: string;
  to?: string[]; // 接收者可以是多个
}

export interface IBehaviorConfig {
  deleteLocalFiles: boolean;
  cleanupEmptyDirs: boolean;
  deleteQbTask: boolean;
}

export interface ITaskProcessorConfig {
  pollIntervalMs: number;
  maxConcurrentUploads: number;
}

// 智能归档规则的类型定义
export interface IArchivingRuleCondition {
  category?: string;
  tags?: string[] | string; // 可以是单个标签或标签数组
  name_matches?: string; // 正则表达式字符串
  // 可以添加更多条件，如 minSize, maxAge等
}

export interface IArchivingRuleAction {
  remotePath: string; // 支持占位符如 {torrentName}, {category}, {year} 等
  // 可以添加其他动作，如 setTagsOnRemote 等
}

export interface IArchivingRule {
  if: IArchivingRuleCondition | 'default'; // 'default' 作为备用规则
  then: IArchivingRuleAction;
  description?: string; // 可选的规则描述
}

export interface IAppConfig {
  nodeEnv: 'development' | 'production' | 'test';
  logLevel: 'error' | 'warn' | 'info' | 'verbose' | 'debug' | 'silly';
  qbittorrent: IQBittorrentConfig;
  rclone: IRcloneConfig;
  mailer: IMailerConfig;
  behavior: IBehaviorConfig;
  taskProcessor: ITaskProcessorConfig;
  archivingRules: IArchivingRule[];
  databaseUrl: string;
}
