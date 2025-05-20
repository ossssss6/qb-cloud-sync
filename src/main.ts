// src/main.ts
import config from './services/config.service';
// 导入默认 logger 和创建模块 logger 的函数
import logger, { createLogger } from './services/logger.service';

// 为 main.ts 创建一个特定的 logger
const mainLogger = createLogger('MainApp');

function greet(name: string): void {
  mainLogger.info(`Hello, ${name}! Welcome to qb-cloud-sync.`); // 使用 logger.info
  mainLogger.info(`Running in ${config.nodeEnv} mode.`);
  mainLogger.debug(`Log level set to: ${config.logLevel}`); // 使用 logger.debug
  if (config.archivingRules.length > 0) {
    mainLogger.info(`Loaded ${config.archivingRules.length} archiving rules.`);
  } else {
    mainLogger.info('No archiving rules loaded.');
  }
}

greet('Developer');

async function main() {
  mainLogger.info('qb-cloud-sync is starting with config:');
  mainLogger.info(`  qBittorrent URL: ${config.qbittorrent.url}`);
  mainLogger.info(`  Rclone Remote: ${config.rclone.remoteName}`);
  mainLogger.info(`  Delete local files: ${config.behavior.deleteLocalFiles}`);

  // 示例：记录一个调试信息和一个错误信息
  mainLogger.debug('This is a debug message from main.', { someData: 'value' });
  // mainLogger.error('This is a test error message from main.');
  // 模拟一个未捕获的错误，看看是否被winston记录
  // setTimeout(() => {
  //   throw new Error("Simulated unhandled exception!");
  // }, 2000);
  // 模拟一个未处理的Promise rejection
  // Promise.reject(new Error("Simulated unhandled promise rejection!"));

  // TODO: Initialize db (using config.databaseUrl), etc.
  // TODO: Start task processor

  // 为了让日志有机会写入，并且观察nodemon的行为，我们可以让main函数不立即退出
  // 在实际应用中，这里会是主循环或服务启动逻辑
  await new Promise((resolve) => setTimeout(resolve, 5000)); // 等待5秒后退出
  mainLogger.info('Main function finished execution (for now).');
}

main()
  .then(() => {
    // logger.info('Application finished successfully.'); // 如果main函数有明确的成功退出点
  })
  .catch((error) => {
    // 使用 logger 记录未处理的错误 (虽然 winston 的 rejectionHandler 也会处理)
    logger.error('Unhandled error in main promise chain:', error);
    process.exit(1);
  });
