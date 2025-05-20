// src/core/task-processor.service.ts
import path from 'node:path';
import { PrismaClient, TaskStatus, TorrentTask } from '@prisma/client';
import { IAppConfig, IArchivingRule } from '../interfaces/config.types';
import { createLogger } from '../services/logger.service';
import { Logger as WinstonLogger } from 'winston';
import { QBittorrentService, QBittorrentTorrent } from './qbittorrent.service';
import { UploaderService } from './uploader.service';

export class TaskProcessorService {
  private logger: WinstonLogger;
  private isRunning: boolean = false;
  private pollIntervalId?: NodeJS.Timeout;
  private qbService: QBittorrentService;
  private uploaderService: UploaderService;

  constructor(
    private config: IAppConfig,
    private prisma: PrismaClient
  ) {
    this.logger = createLogger('TaskProcessorService');
    this.qbService = new QBittorrentService(
      this.config.qbittorrent,
      this.logger.child({ module: 'QBittorrentService' })
    );
    this.uploaderService = new UploaderService(
      this.config.rclone,
      this.logger.child({ module: 'UploaderService' })
    );
  }

  public async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('任务处理器已在运行中。');
      return;
    }
    this.isRunning = true;
    this.logger.info('任务处理器已启动。');
    this.logger.info(`每隔 ${this.config.taskProcessor.pollIntervalMs / 1000} 秒轮询。`);
    await this.processTasks();
    this.pollIntervalId = setInterval(async () => {
      if (!this.isRunning) return;
      await this.processTasks();
    }, this.config.taskProcessor.pollIntervalMs);
  }

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

  private calculateRemoteRelativePath(
    torrent: QBittorrentTorrent,
    rules: IArchivingRule[]
  ): string {
    // ... (此方法与上一版本相同，保持不变)
    this.logger.debug(`开始为种子 "${torrent.name}" 计算远程路径...`);
    let defaultRuleActionPathPattern: string | undefined = undefined;
    const torrentTagsArray = torrent.tags
      .split(',')
      .map((tag) => tag.trim().toLowerCase())
      .filter((tag) => tag !== '');
    const primaryTag = torrentTagsArray.length > 0 ? torrentTagsArray[0] : 'UnTagged';
    const category = torrent.category || 'Uncategorized';
    for (const rule of rules) {
      let match = false;
      if (rule.if === 'default') {
        defaultRuleActionPathPattern = rule.then.remotePath;
        continue;
      }
      const conditions = rule.if;
      if (conditions.category && category.toLowerCase() === conditions.category.toLowerCase()) {
        match = true;
      }
      if (!match && conditions.tags) {
        if (Array.isArray(conditions.tags)) {
          if (conditions.tags.some((tag) => torrentTagsArray.includes(tag.toLowerCase()))) {
            match = true;
          }
        } else if (torrentTagsArray.includes(conditions.tags.toLowerCase())) {
          match = true;
        }
      }
      if (!match && conditions.name_matches) {
        try {
          const regex = new RegExp(conditions.name_matches, 'i');
          if (regex.test(torrent.name)) {
            match = true;
          }
        } catch (e) {
          this.logger.warn(`归档规则中的正则表达式无效: "${conditions.name_matches}"`, e);
        }
      }
      if (match) {
        this.logger.info(
          `种子 "${torrent.name}" 匹配规则: ${rule.description || JSON.stringify(rule.if)}`
        );
        let remotePathPattern = rule.then.remotePath;
        remotePathPattern = remotePathPattern.replace(/{tag}/g, primaryTag);
        remotePathPattern = remotePathPattern.replace(/{category}/g, category);
        remotePathPattern = remotePathPattern.replace(/{torrentName}/g, torrent.name);
        const yearMatch = torrent.name.match(/\((\d{4})\)/);
        remotePathPattern = remotePathPattern.replace(
          /{year}/g,
          yearMatch && yearMatch[1] ? yearMatch[1] : 'UnknownYear'
        );
        const finalRelativePath = remotePathPattern.replace(/^\/+|\/+$/g, '').replace(/\\/g, '/');
        this.logger.debug(`规则计算得到的远程相对路径: "${finalRelativePath}"`);
        return finalRelativePath;
      }
    }
    if (defaultRuleActionPathPattern) {
      this.logger.info(`种子 "${torrent.name}" 使用默认归档规则。`);
      let remotePathPattern = defaultRuleActionPathPattern;
      remotePathPattern = remotePathPattern.replace(/{tag}/g, primaryTag);
      remotePathPattern = remotePathPattern.replace(/{category}/g, category);
      remotePathPattern = remotePathPattern.replace(/{torrentName}/g, torrent.name);
      const yearMatch = torrent.name.match(/\((\d{4})\)/);
      remotePathPattern = remotePathPattern.replace(
        /{year}/g,
        yearMatch && yearMatch[1] ? yearMatch[1] : 'UnknownYear'
      );
      const finalRelativePath = remotePathPattern.replace(/^\/+|\/+$/g, '').replace(/\\/g, '/');
      this.logger.debug(`默认规则计算得到的远程相对路径: "${finalRelativePath}"`);
      return finalRelativePath;
    }
    this.logger.warn(
      `种子 "${torrent.name}" 未匹配任何特定规则，也无默认规则提供路径模式。将按 Tag/Category/Name 结构构建路径。`
    );
    const fallbackRelativePath = path.join(primaryTag, category, torrent.name).replace(/\\/g, '/');
    this.logger.debug(`备用逻辑计算得到的远程相对路径: "${fallbackRelativePath}"`);
    return fallbackRelativePath;
  }

  private async processTasks(): Promise<void> {
    this.logger.info('开始任务处理周期...');
    try {
      this.logger.debug('正在从 qBittorrent 获取所有已下载完成的种子...');
      const allDownloadedQbTorrents: QBittorrentTorrent[] =
        await this.qbService.getAllDownloadedTorrents();
      this.logger.info(
        `从 qBittorrent 找到 ${allDownloadedQbTorrents.length} 个已下载完成 (进度100%) 的种子。`
      );

      const torrentsReadyForProcessing: QBittorrentTorrent[] = [];

      // --- 核心筛选逻辑 ---
      // 1. 定义哪些 qB 状态表示种子已完成做种并可以处理
      //    你需要根据你的 qB 客户端实际返回的 API state 字符串来调整这个列表。
      //    'pausedup' 是标准 qB 客户端在做种完成后（通过规则或手动）暂停的状态。
      //    'completed' 是下载100%但可能从未激活做种的状态。
      //    对于 qB Enhanced Edition，如果“已完成”状态在 API 中有特定字符串，请加入。
      const processableStates: string[] = [
        'pausedup', // 标准 qB 手动/规则暂停做种
        'stoppedup', // <--- 假设这是你的 qB EE 自动停止做种后的状态
        'completed', // 下载100%，未激活做种 (可选，但通常包含)
      ];
      // 如果通过调试发现你的 "已完成" 状态在 API 中返回的是，比如说 "finished_seeding" (举例)
      // 那么你应该将它加入: const processableStates = ['pausedup', 'completed', 'finished_seeding'];
      // 或者，如果 API 返回的就是中文 "已完成"，并且你确定这就是你想要的状态：
      // const processableStates = ['pausedup', 'completed', '已完成']; // 注意要用小写比较

      this.logger.info(
        `--- DEBUG: 检查 qB 种子状态 (脚本认为可处理的状态: ${processableStates.join(', ')}) ---`
      );
      for (const qbTorrent of allDownloadedQbTorrents) {
        const originalState = qbTorrent.state; // 保留原始API返回的状态
        const stateLower = originalState.toLowerCase(); // 用于不区分大小写的比较

        // 打印每个种子的原始状态以供调试
        this.logger.debug(
          `  种子: "${qbTorrent.name}", API原始状态: "${originalState}", 小写状态: "${stateLower}", 进度: ${qbTorrent.progress}`
        );

        if (processableStates.includes(stateLower)) {
          this.logger.info(`种子 "${qbTorrent.name}" (状态: ${originalState}) 符合上传条件。`);
          torrentsReadyForProcessing.push(qbTorrent);
        } else if (
          stateLower.includes('up') ||
          stateLower.includes('seeding') ||
          stateLower.includes('uploading') ||
          stateLower.includes('stalled')
        ) {
          // stalledUP, uploading, seeding, forcedUP 等状态表示仍在活动或尝试做种
          this.logger.debug(
            `种子 "${qbTorrent.name}" 状态为 ${originalState} (仍在活动或尝试做种)，等待 qB 客户端自动暂停。`
          );
        } else {
          // 其他状态 (如 error, downloading, checkingDL, etc.)
          this.logger.debug(
            `种子 "${qbTorrent.name}" 状态为 ${originalState}，不符合处理条件，跳过。`
          );
        }
      }
      this.logger.info(`--- END DEBUG ---`);
      // --- 核心筛选逻辑结束 ---

      this.logger.info(`筛选后，有 ${torrentsReadyForProcessing.length} 个种子准备好进行处理。`);

      if (torrentsReadyForProcessing.length > 0) {
        this.logger.debug('准备处理的种子示例:');
        torrentsReadyForProcessing.slice(0, 3).forEach((t) => {
          this.logger.debug(`  - 名称: ${t.name}, 状态: ${t.state}`);
        });
      }

      for (const qbTorrent of torrentsReadyForProcessing) {
        // ... (数据库同步逻辑与之前版本相同，创建新任务) ...
        try {
          const existingTask = await this.prisma.torrentTask.findUnique({
            where: { hash: qbTorrent.hash },
          });
          if (!existingTask) {
            this.logger.info(
              `发现新种子待处理: "${qbTorrent.name}" (哈希: ${qbTorrent.hash}). 正在添加到数据库...`
            );
            const localContentPath =
              qbTorrent.content_path && qbTorrent.content_path !== qbTorrent.save_path
                ? qbTorrent.content_path
                : path.join(qbTorrent.save_path, qbTorrent.name);
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
                calculatedRemotePath: calculatedRemoteRelPath,
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

      this.logger.debug('正在从数据库获取待处理的任务 (上传、验证等)...');
      const tasksToProcessFromDB = await this.prisma.torrentTask.findMany({
        where: {
          OR: [
            { status: TaskStatus.PENDING_UPLOAD },
            { status: TaskStatus.UPLOAD_FAILED, uploadAttempts: { lt: 5 } },
            { status: TaskStatus.PENDING_VERIFICATION },
            { status: TaskStatus.VERIFICATION_FAILED, verificationAttempts: { lt: 3 } },
          ],
        },
        orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
        take: this.config.taskProcessor.maxConcurrentUploads || 1,
      });
      this.logger.info(`从数据库找到 ${tasksToProcessFromDB.length} 个任务待处理。`);

      if (tasksToProcessFromDB.length > 0) {
        this.logger.info(`开始并发处理 ${tasksToProcessFromDB.length} 个任务...`);
        const processingPromises = tasksToProcessFromDB.map((task) => this.handleTask(task));
        const results = await Promise.allSettled(processingPromises);
        results.forEach((result, index) => {
          if (result.status === 'rejected') {
            this.logger.error(
              `处理任务 ${tasksToProcessFromDB[index].name} (ID: ${tasksToProcessFromDB[index].id}) 时发生未捕获的顶层错误:`,
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

  // ... (handleTask, executeUploadStep, executeVerificationStep 方法与上一版本相同，保持不变) ...
  private async handleTask(task: TorrentTask): Promise<void> {
    this.logger.info(`开始处理任务: "${task.name}" (ID: ${task.id}), 当前状态: ${task.status}`);
    try {
      switch (task.status) {
        case TaskStatus.PENDING_UPLOAD:
        case TaskStatus.UPLOAD_FAILED:
          await this.executeUploadStep(task);
          break;
        case TaskStatus.PENDING_VERIFICATION:
        case TaskStatus.VERIFICATION_FAILED:
          await this.executeVerificationStep(task);
          break;
        default:
          this.logger.warn(`任务 "${task.name}" 状态为 ${task.status}，当前无明确处理逻辑。`);
      }
    } catch (error) {
      this.logger.error(`处理任务 "${task.name}" (ID: ${task.id}) 步骤中发生错误:`, error);
      let nextStatusOnError: TaskStatus = TaskStatus.ERROR;
      const currentTaskStatus = task.status;
      if (
        currentTaskStatus === TaskStatus.UPLOADING ||
        currentTaskStatus === TaskStatus.PENDING_UPLOAD ||
        currentTaskStatus === TaskStatus.UPLOAD_FAILED
      ) {
        nextStatusOnError = TaskStatus.UPLOAD_FAILED;
      } else if (
        currentTaskStatus === TaskStatus.VERIFYING ||
        currentTaskStatus === TaskStatus.PENDING_VERIFICATION ||
        currentTaskStatus === TaskStatus.VERIFICATION_FAILED
      ) {
        nextStatusOnError = TaskStatus.VERIFICATION_FAILED;
      }
      await this.prisma.torrentTask.update({
        where: { id: task.id },
        data: {
          status: nextStatusOnError,
          errorMessage: `处理任务时出错 (原始状态 ${currentTaskStatus}): ${error instanceof Error ? error.message : String(error)}`,
          updatedAt: new Date(),
        },
      });
    }
  }
  private async executeUploadStep(task: TorrentTask): Promise<void> {
    this.logger.info(`[上传阶段] 任务: "${task.name}" (已尝试次数: ${task.uploadAttempts})`);
    const updatedTaskAfterStatusChange = await this.prisma.torrentTask.update({
      where: { id: task.id },
      data: {
        status: TaskStatus.UPLOADING,
        uploadAttempts: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    this.logger.info(
      `任务 "${updatedTaskAfterStatusChange.name}" 状态更新为 UPLOADING, 当前尝试次数: ${updatedTaskAfterStatusChange.uploadAttempts}`
    );
    const relativeTargetPath =
      updatedTaskAfterStatusChange.calculatedRemotePath ||
      path.basename(updatedTaskAfterStatusChange.localPath);
    if (!updatedTaskAfterStatusChange.calculatedRemotePath) {
      this.logger.warn(
        `任务 "${updatedTaskAfterStatusChange.name}" 未找到 calculatedRemotePath, 将使用文件名 "${relativeTargetPath}" 作为远程相对路径。`
      );
    }
    this.logger.info(
      `开始上传 "${updatedTaskAfterStatusChange.localPath}" 到远程相对路径 "${relativeTargetPath}" (基础路径: ${this.config.rclone.defaultUploadPath})`
    );
    const uploadResult = await this.uploaderService.upload(
      updatedTaskAfterStatusChange.localPath,
      relativeTargetPath
    );
    if (uploadResult.success && uploadResult.remotePath) {
      this.logger.info(
        `[上传阶段] 任务: "${updatedTaskAfterStatusChange.name}" 初步上传成功到: ${uploadResult.remotePath}`
      );
      await this.prisma.torrentTask.update({
        where: { id: updatedTaskAfterStatusChange.id },
        data: {
          status: TaskStatus.PENDING_VERIFICATION,
          errorMessage: null,
          verificationAttempts: 0,
          updatedAt: new Date(),
        },
      });
    } else {
      this.logger.error(
        `[上传阶段] 任务: "${updatedTaskAfterStatusChange.name}" 上传失败. 原因: ${uploadResult.message}`
      );
      await this.prisma.torrentTask.update({
        where: { id: updatedTaskAfterStatusChange.id },
        data: {
          status: TaskStatus.UPLOAD_FAILED,
          errorMessage: uploadResult.message || '未知的上传错误',
          updatedAt: new Date(),
        },
      });
    }
  }
  private async executeVerificationStep(task: TorrentTask): Promise<void> {
    this.logger.info(`[验证阶段] 任务: "${task.name}" (已尝试次数: ${task.verificationAttempts})`);
    if (!task.calculatedRemotePath) {
      this.logger.error(
        `[验证阶段] 任务 "${task.name}" 缺少 calculatedRemotePath (上传目标相对路径)，无法验证。将任务标记为错误。`
      );
      await this.prisma.torrentTask.update({
        where: { id: task.id },
        data: {
          status: TaskStatus.ERROR,
          errorMessage: '验证失败：任务记录中缺少计算出的远程相对路径。',
          updatedAt: new Date(),
        },
      });
      return;
    }
    const updatedTaskAfterStatusChange = await this.prisma.torrentTask.update({
      where: { id: task.id },
      data: {
        status: TaskStatus.VERIFYING,
        verificationAttempts: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    this.logger.info(
      `任务 "${updatedTaskAfterStatusChange.name}" 状态更新为 VERIFYING, 当前尝试次数: ${updatedTaskAfterStatusChange.verificationAttempts}`
    );
    const remoteBasePath = this.config.rclone.defaultUploadPath.replace(/\/$/, '');
    const relativePath = updatedTaskAfterStatusChange.calculatedRemotePath!.replace(/^\//, '');
    const fullRemotePathForVerification = `${this.config.rclone.remoteName}:${remoteBasePath}/${relativePath}`;
    this.logger.info(
      `开始验证本地 "${updatedTaskAfterStatusChange.localPath}" 与远程 "${fullRemotePathForVerification}"`
    );
    const verificationResult = await this.uploaderService.verifyUpload(
      updatedTaskAfterStatusChange.localPath,
      fullRemotePathForVerification
    );
    if (verificationResult.verified) {
      this.logger.info(
        `[验证阶段] 任务: "${updatedTaskAfterStatusChange.name}" 验证成功! 本地与远程文件一致。`
      );
      await this.prisma.torrentTask.update({
        where: { id: updatedTaskAfterStatusChange.id },
        data: {
          status: TaskStatus.UPLOAD_VERIFIED_SUCCESS,
          errorMessage: null,
          updatedAt: new Date(),
        },
      });
    } else {
      this.logger.error(
        `[验证阶段] 任务: "${updatedTaskAfterStatusChange.name}" 验证失败. 原因: ${verificationResult.message}`
      );
      await this.prisma.torrentTask.update({
        where: { id: updatedTaskAfterStatusChange.id },
        data: {
          status: TaskStatus.VERIFICATION_FAILED,
          errorMessage: verificationResult.message || '未知的验证错误',
          updatedAt: new Date(),
        },
      });
    }
  }
}
