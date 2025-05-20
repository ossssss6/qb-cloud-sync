// src/main.ts
// ... 其他 imports ...
import prisma from './services/db.service'; // 导入 Prisma Client
import { createLogger } from './services/logger.service';

const mainLogger = createLogger('MainApp');
// ... greet function ...

async function main() {
  mainLogger.info('qb-cloud-sync is starting...');
  // ... (打印配置) ...

  try {
    mainLogger.info('Connecting to database...');
    // 进行一个简单的查询来测试连接
    const taskCount = await prisma.torrentTask.count();
    mainLogger.info(`Successfully connected to database. Found ${taskCount} tasks.`);

    // 示例：创建一个任务 (仅用于测试，后续会由任务处理器创建)
    // const newTask = await prisma.torrentTask.create({
    //   data: {
    //     hash: `test_hash_${Date.now()}`,
    //     name: 'Test Torrent',
    //     addedAt: new Date(),
    //     localPath: '/test/path',
    //   },
    // });
    // mainLogger.info(`Created new task: ${newTask.name} with ID ${newTask.id}`);
  } catch (error) {
    mainLogger.error('Failed to connect to database or execute query:', error);
    process.exit(1); // 数据库连接失败是严重错误，退出
  }

  // ... (TODOs 和 await new Promise) ...
}

// ... (main().catch) ...
