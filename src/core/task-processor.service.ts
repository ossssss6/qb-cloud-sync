// src/core/task-processor.service.ts
import { PrismaClient, TaskStatus, TorrentTask } from '@prisma/client';
import { IAppConfig } from '../interfaces/config.types';
import { createLogger } from '../services/logger.service';
import { Logger as WinstonLogger } from 'winston';
// import QBittorrentService from './qbittorrent.service'; // 稍后创建
// import UploaderService from './uploader.service'; // 稍后创建
// import FileManagerService from './file-manager.service'; // 稍后创建
// import MailerService from '../services/mailer.service'; // 稍后创建

export class TaskProcessorService {
  private logger: WinstonLogger;
  private isRunning: boolean = false;
  private pollIntervalId?: NodeJS.Timeout;

  constructor(
    private config: IAppConfig,
    private prisma: PrismaClient
    // private qbService: QBittorrentService, // 稍后取消注释
    // private uploaderService: UploaderService, // 稍后取消注释
    // private fileManagerService: FileManagerService, // 稍后取消注释
    // private mailerService: MailerService, // 稍后取消注释
  ) {
    this.logger = createLogger('TaskProcessorService');
  }

  public async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Task processor is already running.');
      return;
    }
    this.isRunning = true;
    this.logger.info('Task processor started.');
    this.logger.info(
      `Polling qBittorrent every ${this.config.taskProcessor.pollIntervalMs / 1000} seconds.`
    );

    // 立即执行一次，然后设置定时器
    await this.processTasks();

    this.pollIntervalId = setInterval(async () => {
      if (!this.isRunning) {
        this.logger.info('Task processor stopping, skipping current poll cycle.');
        return;
      }
      await this.processTasks();
    }, this.config.taskProcessor.pollIntervalMs);
  }

  public stop(): void {
    if (!this.isRunning) {
      this.logger.warn('Task processor is not running.');
      return;
    }
    this.logger.info('Stopping task processor...');
    this.isRunning = false;
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = undefined;
    }
    this.logger.info('Task processor stopped.');
  }

  private async processTasks(): Promise<void> {
    this.logger.info('Starting task processing cycle...');

    try {
      // 1. 从 qBittorrent 获取已完成的种子 (需要 QBittorrentService)
      this.logger.debug('Fetching completed torrents from qBittorrent...');
      // const completedTorrents = await this.qbService.getCompletedTorrents(); // 示例
      const completedTorrents: any[] = []; // 临时占位符
      this.logger.info(
        `Found ${completedTorrents.length} completed torrent(s) from qBittorrent (placeholder).`
      );

      // 2. 与数据库同步，创建新任务
      // for (const qbTorrent of completedTorrents) {
      //   // 检查数据库中是否已存在该任务
      //   let task = await this.prisma.torrentTask.findUnique({ where: { hash: qbTorrent.hash } });
      //   if (!task) {
      //     this.logger.info(`New torrent found: ${qbTorrent.name} (${qbTorrent.hash}). Adding to database.`);
      //     task = await this.prisma.torrentTask.create({
      //       data: {
      //         hash: qbTorrent.hash,
      //         name: qbTorrent.name,
      //         localPath: qbTorrent.save_path, // 假设 qB API 返回这个字段
      //         addedAt: new Date(qbTorrent.added_on * 1000), // 假设是 Unix 时间戳
      //         completedAt: new Date(qbTorrent.completion_on * 1000), // 假设是 Unix 时间戳
      //         status: TaskStatus.PENDING_UPLOAD,
      //       },
      //     });
      //   } else {
      //     this.logger.debug(`Torrent ${qbTorrent.name} (${qbTorrent.hash}) already in database with status ${task.status}.`);
      //   }
      // }

      // 3. 从数据库获取待处理的任务
      this.logger.debug('Fetching pending tasks from database...');
      // const pendingTasks = await this.prisma.torrentTask.findMany({
      //   where: {
      //     OR: [
      //       { status: TaskStatus.PENDING_UPLOAD },
      //       { status: TaskStatus.UPLOAD_FAILED, uploadAttempts: { lt: 5 } }, // 例如，最多重试5次
      //       { status: TaskStatus.PENDING_VERIFICATION },
      //       { status: TaskStatus.VERIFICATION_FAILED, verificationAttempts: { lt: 3 } },
      //       // ... 其他可重试状态
      //     ],
      //   },
      //   orderBy: { createdAt: 'asc' }, // 按创建时间升序处理
      // });
      const pendingTasks: TorrentTask[] = []; // 临时占位符
      this.logger.info(
        `Found ${pendingTasks.length} task(s) to process from database (placeholder).`
      );

      // 4. 遍历并处理每个任务 (状态机逻辑)
      // for (const task of pendingTasks) {
      //   this.logger.info(`Processing task: ${task.name} (ID: ${task.id}, Status: ${task.status})`);
      //   await this.handleTask(task);
      // }
    } catch (error) {
      this.logger.error('Error during task processing cycle:', error);
    } finally {
      this.logger.info('Task processing cycle finished.');
    }
  }

  // private async handleTask(task: TorrentTask): Promise<void> {
  //   this.logger.debug(`Handling task ${task.hash} with status ${task.status}`);
  //   // 这里将是状态机的主要逻辑，根据 task.status 执行不同操作
  //   // 例如：
  //   // if (task.status === TaskStatus.PENDING_UPLOAD) {
  //   //   await this.uploadTask(task);
  //   // } else if (task.status === TaskStatus.PENDING_VERIFICATION) {
  //   //   await this.verifyTask(task);
  //   // } // ...等等
  //
  //   // 临时占位符
  //   await new Promise(resolve => setTimeout(resolve, 100)); // 模拟工作
  // }

  // 后续会添加更多方法，如 uploadTask, verifyTask, deleteLocalFilesForTask 等
}
