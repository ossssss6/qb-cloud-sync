// src/core/task-processor.service.ts
import path from 'node:path'; // 导入 Node.js 的 path 模块
import { PrismaClient, TaskStatus, TorrentTask } from '@prisma/client';
import { IAppConfig, IArchivingRule } from '../interfaces/config.types'; // 导入 IArchivingRule
import { createLogger } from '../services/logger.service';
import { Logger as WinstonLogger } from 'winston';
import { QBittorrentService, QBittorrentTorrent } from './qbittorrent.service';
import { UploaderService } from './uploader.service'; // 导入 UploaderService
// import FileManagerService from './file-manager.service'; // 稍后创建和取消注释
// import MailerService from '../services/mailer.service'; // 稍后创建和取消注释

export class TaskProcessorService {
  private logger: WinstonLogger;
  private isRunning: boolean = false;
  private pollIntervalId?: NodeJS.Timeout;
  private qbService: QBittorrentService;
  private uploaderService: UploaderService; // UploaderService 实例

  constructor(
    private config: IAppConfig,
    private prisma: PrismaClient
    // private fileManagerService: FileManagerService, // 文件管理服务 (稍后注入)
    // private mailerService: MailerService, // 邮件服务 (稍后注入)
  ) {
    this.logger = createLogger('TaskProcessorService');
    this.qbService = new QBittorrentService(
      this.config.qbittorrent,
      this.logger.child({ module: 'QBittorrentService' })
    );
    // 实例化 UploaderService
    this.uploaderService = new UploaderService(
      this.config.rclone, // 传递 rclone 配置
      this.logger.child({ module: 'UploaderService' }) // 为 uploader 服务创建子 logger
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
    this.logger.info(`每隔 ${this.config.taskProcessor.pollIntervalMs / 1000} 秒轮询。`);

    await this.processTasks(); // 立即执行一次

    this.pollIntervalId = setInterval(async () => {
      if (!this.isRunning) {
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
    this.isRunning = false;
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = undefined;
    }
    this.logger.info('任务处理器已停止。');
  }

  /**
   * 根据智能归档规则和种子信息计算远程相对路径。
   * @param torrent qB 种子信息
   * @param rules 归档规则数组
   * @returns 计算出的远程相对路径，如果无匹配规则则为 undefined。
   */
  private calculateRemoteRelativePath(
    torrent: QBittorrentTorrent,
    rules: IArchivingRule[]
  ): string | undefined {
    this.logger.debug(`开始为种子 "${torrent.name}" 计算远程路径...`);
    let defaultRuleActionPath: string | undefined = undefined;

    for (const rule of rules) {
      let match = false;
      if (rule.if === 'default') {
        defaultRuleActionPath = rule.then.remotePath;
        continue; // 默认规则最后处理
      }

      const conditions = rule.if;
      // 检查分类
      if (
        conditions.category &&
        torrent.category.toLowerCase() === conditions.category.toLowerCase()
      ) {
        match = true;
      }
      // 检查标签 (可以是单个标签字符串或字符串数组)
      if (conditions.tags) {
        const torrentTags = torrent.tags.split(',').map((tag) => tag.trim().toLowerCase());
        if (Array.isArray(conditions.tags)) {
          if (conditions.tags.some((tag) => torrentTags.includes(tag.toLowerCase()))) {
            match = true;
          }
        } else if (torrentTags.includes(conditions.tags.toLowerCase())) {
          match = true;
        }
      }
      // 检查名称正则匹配
      if (conditions.name_matches) {
        try {
          const regex = new RegExp(conditions.name_matches, 'i'); // 'i' 表示不区分大小写
          if (regex.test(torrent.name)) {
            match = true;
          }
        } catch (e) {
          this.logger.warn(`归档规则中的正则表达式无效: "${conditions.name_matches}"`, e);
        }
      }
      // 注意: 如果一个种子匹配多个条件 (例如同时匹配分类和标签)，需要定义规则的优先级或只取第一个匹配。
      // 目前的逻辑是，只要任一条件匹配，就认为规则匹配。可以根据需要调整为 AND 或更复杂的逻辑。

      if (match) {
        this.logger.info(
          `种子 "${torrent.name}" 匹配规则: ${rule.description || JSON.stringify(rule.if)}`
        );
        let remotePath = rule.then.remotePath;
        // 替换占位符
        remotePath = remotePath.replace(/{torrentName}/g, torrent.name);
        remotePath = remotePath.replace(/{category}/g, torrent.category || 'Uncategorized');
        // 简单提取年份 (如果存在于种子名中，例如 "Movie Title (2023)")
        const yearMatch = torrent.name.match(/\((\d{4})\)/);
        remotePath = remotePath.replace(
          /{year}/g,
          yearMatch && yearMatch[1] ? yearMatch[1] : 'UnknownYear'
        );
        // TODO: 可以添加更多占位符替换，如 {season}, {episode} 等，需要更复杂的解析

        // 清理路径，移除开头和结尾的斜杠，确保路径分隔符正确
        remotePath = remotePath.replace(/^\/+|\/+$/g, '').replace(/\\/g, '/');
        this.logger.debug(`计算得到的远程相对路径: "${remotePath}"`);
        return remotePath;
      }
    }

    // 如果没有其他规则匹配，使用默认规则 (如果存在)
    if (defaultRuleActionPath) {
      this.logger.info(`种子 "${torrent.name}" 使用默认归档规则。`);
      let remotePath = defaultRuleActionPath;
      remotePath = remotePath.replace(/{torrentName}/g, torrent.name);
      remotePath = remotePath.replace(/{category}/g, torrent.category || 'Uncategorized');
      const yearMatch = torrent.name.match(/\((\d{4})\)/);
      remotePath = remotePath.replace(
        /{year}/g,
        yearMatch && yearMatch[1] ? yearMatch[1] : 'UnknownYear'
      );
      remotePath = remotePath.replace(/^\/+|\/+$/g, '').replace(/\\/g, '/');
      this.logger.debug(`计算得到的默认远程相对路径: "${remotePath}"`);
      return remotePath;
    }

    this.logger.warn(
      `种子 "${torrent.name}" 未匹配任何归档规则，也无默认规则。将使用基础上传路径。`
    );
    return undefined; // 或返回一个默认的基础路径，如 path.basename(torrent.name)
  }

  /**
   * 执行一次任务处理周期。
   */
  private async processTasks(): Promise<void> {
    this.logger.info('开始任务处理周期...');
    try {
      this.logger.debug('正在从 qBittorrent 获取已完成的种子...');
      const completedQbTorrents: QBittorrentTorrent[] = await this.qbService.getCompletedTorrents();
      this.logger.info(`从 qBittorrent 找到 ${completedQbTorrents.length} 个已完成的种子。`);

      if (completedQbTorrents.length > 0) {
        this.logger.debug('获取到的部分种子示例:');
        completedQbTorrents.slice(0, 3).forEach((t) => {
          this.logger.debug(
            `  - 名称: ${t.name}, 哈希: ${t.hash}, 大小: ${(t.size / (1024 * 1024)).toFixed(2)}MB, 保存路径: ${t.save_path}, 内容路径: ${t.content_path}`
          );
        });
      }

      for (const qbTorrent of completedQbTorrents) {
        try {
          const existingTask = await this.prisma.torrentTask.findUnique({
            where: { hash: qbTorrent.hash },
          });

          if (!existingTask) {
            this.logger.info(
              `发现新种子待处理: "${qbTorrent.name}" (哈希: ${qbTorrent.hash}). 正在添加到数据库...`
            );

            // 确定本地文件/目录的准确路径
            const localContentPath =
              qbTorrent.content_path && qbTorrent.content_path !== qbTorrent.save_path
                ? qbTorrent.content_path
                : path.join(qbTorrent.save_path, qbTorrent.name);

            // 根据归档规则计算远程相对路径
            const calculatedRemoteRelPath = this.calculateRemoteRelativePath(
              qbTorrent,
              this.config.archivingRules
            );

            await this.prisma.torrentTask.create({
              data: {
                hash: qbTorrent.hash,
                name: qbTorrent.name,
                localPath: localContentPath,
                addedAt: new Date(qbTorrent.added_on * 1000),
                completedAt:
                  qbTorrent.completion_on > 0 ? new Date(qbTorrent.completion_on * 1000) : null,
                status: TaskStatus.PENDING_UPLOAD,
                uploadSize: BigInt(qbTorrent.size),
                calculatedRemotePath: calculatedRemoteRelPath, // 存储计算出的相对路径
              },
            });
          } else {
            this.logger.debug(
              `种子 "${qbTorrent.name}" (哈希: ${qbTorrent.hash}) 已存在于数据库，状态为 ${existingTask.status}。跳过创建。`
            );
          }
        } catch (dbError) {
          this.logger.error(
            `处理 qB 种子 "${qbTorrent.name}" (哈希: ${qbTorrent.hash}) 同步到数据库时出错:`,
            dbError
          );
        }
      }

      this.logger.debug('正在从数据库获取待处理的任务...');
      const tasksToProcess = await this.prisma.torrentTask.findMany({
        where: {
          OR: [
            { status: TaskStatus.PENDING_UPLOAD },
            {
              status: TaskStatus.UPLOAD_FAILED,
              uploadAttempts: { lt: 5 }, // 示例：最多重试5次
            },
            // { // 验证失败的重试逻辑稍后添加
            //   status: TaskStatus.VERIFICATION_FAILED,
            //   verificationAttempts: { lt: 3 },
            // },
          ],
        },
        orderBy: { createdAt: 'asc' },
        take: this.config.taskProcessor.maxConcurrentUploads || 1,
      });
      this.logger.info(`从数据库找到 ${tasksToProcess.length} 个任务待处理。`);

      if (tasksToProcess.length > 0) {
        this.logger.info(`开始并发处理 ${tasksToProcess.length} 个任务...`);
        const processingPromises = tasksToProcess.map((task) => this.handleTask(task));
        const results = await Promise.allSettled(processingPromises);
        results.forEach((result, index) => {
          if (result.status === 'rejected') {
            this.logger.error(
              `处理任务 ${tasksToProcess[index].name} (ID: ${tasksToProcess[index].id}) 时发生未捕获的顶层错误:`,
              result.reason
            );
          }
        });
        this.logger.info('本轮任务批处理完成。');
      }
    } catch (error) {
      this.logger.error('任务处理周期中发生错误:', error);
    } finally {
      this.logger.info('任务处理周期已结束。');
    }
  }

  /**
   * 处理单个任务的状态转换和操作。
   * @param task 要处理的 TorrentTask 对象
   */
  private async handleTask(task: TorrentTask): Promise<void> {
    this.logger.info(`开始处理任务: "${task.name}" (ID: ${task.id}), 当前状态: ${task.status}`);
    try {
      switch (task.status) {
        case TaskStatus.PENDING_UPLOAD:
        case TaskStatus.UPLOAD_FAILED:
          await this.executeUploadStep(task);
          break;
        case TaskStatus.PENDING_VERIFICATION:
        // case TaskStatus.VERIFICATION_FAILED: // 稍后实现验证步骤
        //   await this.executeVerificationStep(task);
        //   break;
        // TODO: 处理 UPLOAD_VERIFIED_SUCCESS (触发删除等)
        // TODO: 处理 DELETING_LOCAL, DELETING_QB_TASK 等状态
        default:
          this.logger.warn(`任务 "${task.name}" 状态为 ${task.status}，当前无明确处理逻辑。`);
      }
    } catch (error) {
      // 捕获处理单个任务步骤中可能发生的未被子函数捕获的错误
      this.logger.error(`处理任务 "${task.name}" (ID: ${task.id}) 步骤中发生错误:`, error);
      // 更新任务状态为 ERROR 或保持失败状态，记录错误信息
      await this.prisma.torrentTask.update({
        where: { id: task.id },
        data: {
          status:
            task.status === TaskStatus.UPLOADING ? TaskStatus.UPLOAD_FAILED : TaskStatus.ERROR, // 如果正在上传时失败，则为上传失败
          errorMessage: `Error in handleTask: ${error instanceof Error ? error.message : String(error)}`,
          updatedAt: new Date(),
        },
      });
      // TODO: 发送失败通知
    }
  }

  /**
   * 执行任务的上传步骤。
   * @param task 要上传的 TorrentTask 对象
   */
  private async executeUploadStep(task: TorrentTask): Promise<void> {
    this.logger.info(`[上传阶段] 任务: "${task.name}" (尝试次数: ${task.uploadAttempts + 1})`);
    // 更新任务状态为 UPLOADING 并增加尝试次数
    const updatedTask = await this.prisma.torrentTask.update({
      where: { id: task.id },
      data: {
        status: TaskStatus.UPLOADING,
        uploadAttempts: { increment: 1 },
        updatedAt: new Date(),
      },
    });

    // calculatedRemotePath 应该是创建任务时根据归档规则计算好的相对路径
    // 如果它为空，则使用种子名作为备用（这可能不理想，取决于 rclone 的 defaultUploadPath）
    const relativeTargetPath =
      updatedTask.calculatedRemotePath || path.basename(updatedTask.localPath);
    if (!updatedTask.calculatedRemotePath) {
      this.logger.warn(
        `任务 "${updatedTask.name}" 未找到 calculatedRemotePath, 将使用文件名 "${relativeTargetPath}" 作为远程相对路径。`
      );
    }

    this.logger.info(`开始上传 "${updatedTask.localPath}" 到远程相对路径 "${relativeTargetPath}"`);
    const uploadResult = await this.uploaderService.upload(
      updatedTask.localPath,
      relativeTargetPath
    );

    if (uploadResult.success && uploadResult.remotePath) {
      this.logger.info(
        `[上传阶段] 任务: "${updatedTask.name}" 初步上传成功到: ${uploadResult.remotePath}`
      );
      await this.prisma.torrentTask.update({
        where: { id: updatedTask.id },
        data: {
          status: TaskStatus.PENDING_VERIFICATION, // 下一步是验证
          calculatedRemotePath: uploadResult.remotePath, // 如果 uploadService 返回的是绝对路径，确保这里存储的是相对的或处理好
          errorMessage: null, // 清除之前的错误信息
          updatedAt: new Date(),
        },
      });
      // TODO: 可以在这里立即触发验证，或者等待下一个轮询周期处理 PENDING_VERIFICATION 状态
      // await this.executeVerificationStep(await this.prisma.torrentTask.findUniqueOrThrow({ where: { id: task.id } }));
    } else {
      this.logger.error(
        `[上传阶段] 任务: "${updatedTask.name}" 上传失败. 原因: ${uploadResult.message}`
      );
      await this.prisma.torrentTask.update({
        where: { id: updatedTask.id },
        data: {
          status: TaskStatus.UPLOAD_FAILED, // 保持或设置为上传失败
          errorMessage: uploadResult.message || '未知的上传错误',
          updatedAt: new Date(),
        },
      });
      // TODO: 发送上传失败通知
    }
  }

  // TODO: 实现 executeVerificationStep, executeDeleteLocalStep, executeDeleteQbTaskStep, sendNotification 等方法
}
