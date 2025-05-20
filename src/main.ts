// src/main.ts
import config from './services/config.service'; // 导入配置

function greet(name: string): void {
  console.log(`Hello, ${name}! Welcome to qb-cloud-sync.`);
  console.log(`Running in ${config.nodeEnv} mode.`);
  console.log(`Log level set to: ${config.logLevel}`);
  if (config.archivingRules.length > 0) {
    console.log(`Loaded ${config.archivingRules.length} archiving rules.`);
  } else {
    console.log('No archiving rules loaded.');
  }
}

greet('Developer');

async function main() {
  console.log('qb-cloud-sync is starting with config:');
  // 为了避免打印敏感信息，选择性打印
  console.log(`  qBittorrent URL: ${config.qbittorrent.url}`);
  console.log(`  Rclone Remote: ${config.rclone.remoteName}`);
  console.log(`  Delete local files: ${config.behavior.deleteLocalFiles}`);

  // TODO: Initialize logger (using config.logLevel), db (using config.databaseUrl), etc.
  // TODO: Start task processor
}

main().catch((error) => {
  console.error('Unhandled error in main function:', error);
  // 在实际应用中，这里应该也使用 logger 服务来记录错误
  process.exit(1);
});
