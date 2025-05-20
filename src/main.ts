// src/main.ts
import config from './services/config.service';
import logger, { createLogger } from './services/logger.service';
import prisma from './services/db.service';
import { TaskProcessorService } from './core/task-processor.service'; // <--- 导入服务

const appLogger = createLogger('Application');

// ... (initializeApp 函数保持不变) ...
async function initializeApp() {
  appLogger.info('------------------------------------------------------------');
  appLogger.info('Initializing qb-cloud-sync...');
  appLogger.info(`Environment: ${config.nodeEnv}`);
  appLogger.info(`Log Level: ${config.logLevel}`);

  appLogger.info('Key Configurations:');
  appLogger.info(`  qBittorrent URL: ${config.qbittorrent.url}`);
  appLogger.info(`  Rclone Remote: ${config.rclone.remoteName}`);
  appLogger.info(`  Poll Interval: ${config.taskProcessor.pollIntervalMs / 1000} seconds`);
  appLogger.info(`  Delete Local Files: ${config.behavior.deleteLocalFiles}`);

  if (config.archivingRules.length > 0) {
    appLogger.info(`Loaded ${config.archivingRules.length} archiving rules.`);
  } else {
    appLogger.info('No archiving rules loaded.');
  }

  try {
    appLogger.info('Attempting to connect to the database...');
    const taskCount = await prisma.torrentTask.count();
    appLogger.info(
      `Successfully connected to database. Found ${taskCount} tasks in TorrentTask table.`
    );
  } catch (dbError) {
    appLogger.error('Failed to connect to the database or execute initial query.', dbError);
    appLogger.error(
      'Please ensure your DATABASE_URL in .env is correct and migrations have been run.'
    );
    process.exit(1);
  }
}

let taskProcessor: TaskProcessorService | null = null; // <--- 声明变量

async function startApp() {
  // 创建 TaskProcessorService 实例
  // 注意：目前我们只传入了 config 和 prisma，其他服务是占位符
  taskProcessor = new TaskProcessorService(
    config,
    prisma
    // new QBittorrentService(config.qbittorrent, createLogger('QBittorrentService')), // 示例
    // new UploaderService(config.rclone, createLogger('UploaderService')),
    // new FileManagerService(createLogger('FileManagerService')),
    // new MailerService(config.mailer, createLogger('MailerService'))
  );

  // 启动任务处理器
  await taskProcessor.start(); // <--- 启动服务

  appLogger.info('qb-cloud-sync application started and running.');
  appLogger.info('Press Ctrl+C to exit.');

  // 应用将保持运行，因为 TaskProcessorService 的轮询会阻止 Node.js 进程退出
  // 我们不再需要之前那个 new Promise 来模拟保持运行了
}

async function main() {
  try {
    await initializeApp();
    await startApp();
  } catch (error) {
    appLogger.error('Unhandled error during application startup or main execution:', error);
    if (taskProcessor) {
      taskProcessor.stop(); // 尝试停止任务处理器
    }
    // Prisma Client 会在 db.service.ts 中的 gracefulShutdown 中断开连接
    process.exit(1);
  }
}

// 修改优雅退出处理，确保 taskProcessor 也能停止
async function gracefulShutdown(signal: string) {
  appLogger.info(`Received ${signal}. Shutting down gracefully...`);
  if (taskProcessor) {
    appLogger.info('Stopping Task Processor...');
    taskProcessor.stop(); // 停止轮询
  }
  // Prisma Client 的 $disconnect 会在 db.service.ts 中被调用
  // 等待 Prisma 断开可能需要一点时间，或者让 process.on('SIGINT') 在 db.service.ts 中处理完 Prisma 后再 exit
  // 为了简单，我们依赖 db.service.ts 中的 process.exit(0)
  // 如果需要更复杂的协调，可以使用事件或回调
}

// 移除 db.service.ts 中的 process.on 监听，统一在 main.ts 管理，或者确保它们不冲突
// 如果 db.service.ts 处理了 prisma.$disconnect() 和 process.exit()，这里就不需要再次 process.exit()
// 但为了确保 taskProcessor.stop() 被调用，我们在这里监听。
// 让我们假设 db.service.ts 中的 gracefulShutdown 只负责 prisma.$disconnect() 而不退出。
// 那么 main.ts 的监听器就需要负责 process.exit()。

// 在 db.service.ts 中，将 process.on(...) 里的 process.exit(0) 移除或注释掉。
// 然后在这里处理退出：
// (如果 db.service.ts 的 process.on 监听器也被触发，可能会有竞争或重复日志)
// 一个更好的方式是在 db.service.ts 的 gracefulShutdown 中返回一个 Promise
// 然后在这里 await prisma.disconnectPromiseFromDbService(); process.exit(0);

// 为了简单起见，暂时假设 db.service.ts 的 gracefulShutdown 会处理 Prisma 断开。
// 我们在这里只负责停止 TaskProcessor。
// process.on('SIGINT', () => gracefulShutdown('SIGINT')); // 保持在 db.service.ts 中
// process.on('SIGTERM', () => gracefulShutdown('SIGTERM')); // 保持在 db.service.ts 中
// 但为了确保 TaskProcessorService 被停止，我们需要一个地方来调用它的 stop()。
// 可以在 db.service.ts 的 gracefulShutdown 之前触发一个事件，或者直接在这里修改。

// --- 推荐的优雅退出处理 (整合) ---
// 1. 在 db.service.ts 中:
//    - 移除 process.on('SIGINT'/'SIGTERM') 监听器。
//    - 导出一个 async function disconnectPrisma() { await prisma.$disconnect(); }
// 2. 在 main.ts 中:
async function shutdownHandler(signal: string) {
  appLogger.info(`Received ${signal}. Shutting down gracefully...`);
  if (taskProcessor) {
    appLogger.info('Stopping Task Processor...');
    taskProcessor.stop();
  }
  try {
    appLogger.info('Disconnecting Prisma Client...');
    await prisma.$disconnect(); // 直接在这里调用
    appLogger.info('Prisma Client disconnected.');
  } catch (e) {
    appLogger.error('Error disconnecting Prisma Client:', e);
  }
  appLogger.info('Exiting application.');
  process.exit(0);
}

process.on('SIGINT', () => shutdownHandler('SIGINT'));
process.on('SIGTERM', () => shutdownHandler('SIGTERM'));
// --- 结束推荐的优雅退出处理 ---

main();
