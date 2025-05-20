// src/core/task-processor.service.ts
import path from 'node:path'; // 导入 Node.js 的 path 模块
import { PrismaClient, TaskStatus, TorrentTask } from '@prisma/client';
import { IAppConfig } from '../interfaces/config.types';
import { createLogger } from '../services/logger.service';
import { Logger as WinstonLogger } from 'winston'; // 从 winston 导入 Logger 类型
import { QBittorrentService, QBittorrentTorrent } from './qbittorrent.service';
// import UploaderService from './uploader.service'; // 稍后创建和取消注释
// import FileManagerService from './file-manager.service'; // 稍后创建和取消注释
// import MailerService from '../services/mailer.service'; // 稍后创建和取消注释

export class TaskProcessorService {
  private logger: WinstonLogger; // 服务自身的 logger 实例
  private isRunning: boolean = false; // 标记服务是否正在运行
  private pollIntervalId?: NodeJS.Timeout; // 轮询定时器的 ID
  private qbService: QBittorrentService; // QBittorrent 服务实例

  constructor(
    private config: IAppConfig, // 应用配置
    private prisma: PrismaClient // Prisma 客户端实例
    // private uploaderService: UploaderService, // 上传服务 (稍后注入)
    // private fileManagerService: FileManagerService, // 文件管理服务 (稍后注入)
    // private mailerService: MailerService, // 邮件服务 (稍后注入)
  ) {
    this.logger = createLogger('TaskProcessorService'); // 创建此服务的 logger
    // 实例化 QBittorrentService
    this.qbService = new QBittorrentService(
      this.config.qbittorrent, // 传递 qB 相关配置
      this.logger.child({ module: 'QBittorrentService' }) // 为 qB 服务创建子 logger，方便区分日志来源
    );
  }

  /**
   * 启动任务处理器。
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('任务处理器已在运行中。');
      return;
    }
    this.isRunning = true;
    this.logger.info('任务处理器已启动。');
    this.logger.info(
      `每隔 ${this.config.taskProcessor.pollIntervalMs / 1000} 秒轮询 qBittorrent。`
    );

    // 立即执行一次任务处理，然后设置定时器进行周期性轮询
    await this.processTasks();

    this.pollIntervalId = setInterval(async () => {
      if (!this.isRunning) {
        // 如果服务已标记为停止，则跳过本次轮询
        this.logger.info('任务处理器正在停止，跳过当前轮询周期。');
        return;
      }
      await this.processTasks();
    }, this.config.taskProcessor.pollIntervalMs);
  }

  /**
   * 停止任务处理器。
   */
  public stop(): void {
    if (!this.isRunning) {
      this.logger.warn('任务处理器未在运行中。');
      return;
    }
    this.logger.info('正在停止任务处理器...');
    this.isRunning = false; // 标记服务为停止状态
    if (this.pollIntervalId) {
      // 清除轮询定时器
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = undefined;
    }
    this.logger.info('任务处理器已停止。');
  }

  /**
   * 执行一次任务处理周期。
   * 包括：从qB获取种子 -> 同步到数据库 -> 从数据库获取待处理任务 -> 处理任务。
   */
  private async processTasks(): Promise<void> {
    this.logger.info('开始任务处理周期...');

    try {
      // 步骤 1: 从 qBittorrent 获取已完成的种子
      this.logger.debug('正在从 qBittorrent 获取已完成的种子...');
      const completedQbTorrents: QBittorrentTorrent[] = await this.qbService.getCompletedTorrents();
      this.logger.info(`从 qBittorrent 找到 ${completedQbTorrents.length} 个已完成的种子。`);

      if (completedQbTorrents.length > 0) {
        this.logger.info('获取到的部分种子示例:');
        completedQbTorrents.slice(0, 3).forEach((t) => {
          // 只打印前3个作为调试示例
          this.logger.info(
            `  - 名称: ${t.name}, 哈希: ${t.hash}, 大小: ${(t.size / (1024 * 1024)).toFixed(2)}MB, 保存路径: ${t.save_path}`
          );
        });
      }

      // 步骤 2: 与数据库同步，对于新发现的已完成种子，在数据库中创建任务记录
      for (const qbTorrent of completedQbTorrents) {
        try {
          // 检查数据库中是否已存在该哈希值的任务
          const existingTask = await this.prisma.torrentTask.findUnique({
            where: { hash: qbTorrent.hash },
          });

          if (!existingTask) {
            // 如果任务不存在，则创建新任务
            this.logger.info(
              `发现新种子待处理: "${qbTorrent.name}" (哈希: ${qbTorrent.hash})。正在添加到数据库...`
            );
            // 确定本地文件/目录的准确路径
            // qB的 save_path 是下载目录，name 是种子显示名称。
            // content_path 是实际内容路径，对于单文件种子可能包含文件名。
            // 我们需要一个指向种子内容根的路径。
            let localContentPath = qbTorrent.save_path; // 默认为保存路径
            if (qbTorrent.content_path && qbTorrent.content_path.startsWith(qbTorrent.save_path)) {
              // 如果 content_path 存在且在 save_path 内或等于它，则 content_path 更精确
              localContentPath = qbTorrent.content_path;
            } else {
              // 对于多文件种子，通常是 save_path + torrent_name (文件夹名)
              // 对于单文件种子，可能是 save_path + file_name (如果qB没有创建子目录)
              // qB API 的 save_path 指向的是种子内容所在的目录。
              // 如果种子是单文件，save_path + name 可能是目录 + 文件名。
              // 如果是多文件，save_path + name 通常是 目录 + 种子创建的子目录名。
              //  safest bet for root is usually save_path if content_path isn't more specific or doesn't exist
              // qB's save_path + name is often the full path to the content (file or folder)
              // Let's assume save_path already points to the root content directory for multi-file torrents
              // or includes the filename for single-file torrents if no subfolder is created by qB.
              // If qB creates a subfolder with the torrent's name, then save_path is the parent,
              // and the actual content is in save_path/torrent_name.
              // The `name` field from qB is the torrent's display name, which is often also the root folder/file name.
              // So, path.join(qbTorrent.save_path, qbTorrent.name) should be the content root for multi-file torrents.
              // For single file torrents, if save_path is just a directory, then save_path/name is the file.
              // If save_path already includes the filename for single file torrents, then qbTorrent.name might be redundant or different.
              // The most reliable way is often to iterate files within the torrent if qB API provides file list per torrent.
              // For now, a common case is that the content is in a folder named after the torrent, inside save_path.
              // Or, if it's a single file, it's directly in save_path.
              // `content_path` is often the most accurate. If not available, `save_path` is the directory, and `name` is the file/folder within it.
              // If qB "Keep incomplete torrents in:" is set, save_path might be that temp path.
              // content_path will be the final path.
              // Let's prioritize content_path if it's valid and different from save_path, otherwise join save_path and name.
              localContentPath =
                qbTorrent.content_path && qbTorrent.content_path !== qbTorrent.save_path
                  ? qbTorrent.content_path
                  : path.join(qbTorrent.save_path, qbTorrent.name);
            }

            await this.prisma.torrentTask.create({
              data: {
                hash: qbTorrent.hash,
                name: qbTorrent.name,
                localPath: localContentPath,
                addedAt: new Date(qbTorrent.added_on * 1000), // qB 时间戳是秒，Date 需要毫秒
                completedAt:
                  qbTorrent.completion_on > 0 ? new Date(qbTorrent.completion_on * 1000) : null,
                status: TaskStatus.PENDING_UPLOAD, // 初始状态
                uploadSize: BigInt(qbTorrent.size), // 存储种子总大小
              },
            });
          } else {
            // 如果任务已存在
            this.logger.debug(
              `种子 "${qbTorrent.name}" (哈希: ${qbTorrent.hash}) 已存在于数据库，状态为 ${existingTask.status}。跳过创建。`
            );
            // TODO: 后续可以根据 existingTask.status 决定是否需要重新处理或更新种子信息 (例如 localPath 变化)
          }
        } catch (dbError) {
          this.logger.error(
            `处理 qB 种子 "${qbTorrent.name}" (哈希: ${qbTorrent.hash}) 以同步到数据库时出错:`,
            dbError
          );
        }
      }

      // 步骤 3: 从数据库获取所有待处理的上传任务
      this.logger.debug('正在从数据库获取 PENDING_UPLOAD 状态的任务...');
      const pendingUploadTasks = await this.prisma.torrentTask.findMany({
        where: {
          status: TaskStatus.PENDING_UPLOAD,
          // uploadAttempts: { lt: 5 } // 示例：可以添加重试次数限制
        },
        orderBy: { createdAt: 'asc' }, // 按创建时间升序处理，保证先完成的先上传
      });
      this.logger.info(`从数据库找到 ${pendingUploadTasks.length} 个 PENDING_UPLOAD 状态的任务。`);

      // 步骤 4: 遍历并处理每个待上传任务 (目前是占位符，后续将实现状态机逻辑)
      // for (const task of pendingUploadTasks) {
      //   this.logger.info(`正在处理任务: ${task.name} (ID: ${task.id}, 状态: ${task.status})`);
      //   await this.handleTask(task); // handleTask 将是状态机实现
      // }
      if (pendingUploadTasks.length > 0) {
        this.logger.info(
          `${pendingUploadTasks.length} 个 PENDING_UPLOAD 任务的后续处理逻辑尚未实现。`
        );
      }
    } catch (error) {
      // 捕获整个处理周期中的错误
      this.logger.error('任务处理周期中发生错误:', error);
    } finally {
      // 无论成功或失败，都记录周期结束
      this.logger.info('任务处理周期已结束。');
    }
  }

  // private async handleTask(task: TorrentTask): Promise<void> {
  //   this.logger.debug(`处理任务 ${task.hash}，当前状态 ${task.status}`);
  //   // 这里将是状态机的主要逻辑实现，根据 task.status 执行不同操作
  //   // 例如：上传、验证、删除本地文件、删除qB任务、发送邮件通知等
  //
  //   // 临时占位符，模拟工作耗时
  //   await new Promise(resolve => setTimeout(resolve, 100));
  // }

  // 后续会添加更多方法，如:
  // private async uploadTask(task: TorrentTask): Promise<void> { ... }
  // private async verifyUpload(task: TorrentTask): Promise<void> { ... }
  // private async deleteLocalContent(task: TorrentTask): Promise<void> { ... }
  // private async deleteQbittorrentTask(task: TorrentTask): Promise<void> { ... }
  // private async sendNotification(task: TorrentTask, success: boolean, message?: string): Promise<void> { ... }
}
