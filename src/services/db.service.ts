// src/services/db.service.ts
import { PrismaClient } from '@prisma/client';
import logger from './logger.service'; // 导入我们的 logger

const dbLogger = logger.child({ module: 'PrismaClient' });

const prisma = new PrismaClient({
  // 可选：配置日志记录
  log: [
    { emit: 'event', level: 'query' }, // 记录查询事件
    { emit: 'stdout', level: 'info' }, // 将 info 日志输出到 stdout
    { emit: 'stdout', level: 'warn' },
    { emit: 'stdout', level: 'error' },
  ],
});

// 可选：监听 Prisma Client 的日志事件，并使用我们的 Winston logger 记录它们
prisma.$on('query', (e) => {
  dbLogger.debug(`Query: ${e.query}`, {
    params: e.params,
    duration: `${e.duration}ms`,
  });
});
// prisma.$on('info', (e) => { dbLogger.info(e.message); }); // 可能过于冗余，如果上面 stdout 已配置
// prisma.$on('warn', (e) => { dbLogger.warn(e.message); });
// prisma.$on('error', (e) => { dbLogger.error(e.message); });

// 确保在应用关闭时断开 Prisma Client 连接 (优雅退出)
async function gracefulShutdown(signal: string) {
  dbLogger.info(`Received ${signal}. Disconnecting Prisma Client...`);
  await prisma.$disconnect();
  dbLogger.info('Prisma Client disconnected. Exiting.');
  process.exit(0);
}

// 监听退出信号
process.on('SIGINT', () => gracefulShutdown('SIGINT')); // Ctrl+C
process.on('SIGTERM', () => gracefulShutdown('SIGTERM')); // kill 命令

export default prisma;
