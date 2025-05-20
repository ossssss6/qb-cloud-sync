// src/core/uploader.service.ts
import { exec } from 'node:child_process'; // 用于执行外部命令
import { promisify } from 'node:util';
import path from 'node:path';
import { IRcloneConfig } from '../interfaces/config.types';
import { Logger } from 'winston';

const execAsync = promisify(exec);

export interface UploadResult {
  success: boolean;
  message?: string;
  remotePath?: string; // 实际上传到的远程路径
  stdout?: string;
  stderr?: string;
}

export interface VerificationResult {
  verified: boolean;
  message?: string;
  stdout?: string;
  stderr?: string;
}

export class UploaderService {
  constructor(
    private rcloneConfig: IRcloneConfig,
    private logger: Logger
  ) {
    if (!this.rcloneConfig.remoteName) {
      const errMsg = 'Rclone remote name (RCLONE_REMOTE_NAME) is not configured.';
      this.logger.error(errMsg);
      throw new Error(errMsg);
    }
  }

  /**
   * 将本地文件或目录上传到网盘。
   * @param localPath 要上传的本地文件或目录的绝对路径。
   * @param relativeTargetPath 在网盘远程目标下的相对路径，例如 "movies/Action/Movie Name (2023)"。
   *                         最终的远程路径会是 rcloneRemoteName:defaultUploadPath/relativeTargetPath。
   * @param rcloneFlags 可选的额外 rclone 命令行参数数组，例如 ['--bwlimit', '10M']。
   * @returns Promise<UploadResult> 上传结果。
   */
  public async upload(
    localPath: string,
    relativeTargetPath: string,
    rcloneFlags: string[] = []
  ): Promise<UploadResult> {
    // 构建完整的远程路径
    // rclone 通常的格式是 remoteName:path/to/destination
    // 我们使用 defaultUploadPath 作为基础，然后在其下创建 relativeTargetPath
    const remoteBase = `${this.rcloneConfig.remoteName}:${this.rcloneConfig.defaultUploadPath.replace(/\/$/, '')}`; // 确保 defaultUploadPath 末尾没有斜杠
    const fullRemotePath = `${remoteBase}/${relativeTargetPath.replace(/^\//, '')}`; // 确保 relativeTargetPath 开头没有斜杠

    this.logger.info(`准备上传: 本地 '${localPath}' -> 远程 '${fullRemotePath}'`);

    const configFileArg = this.rcloneConfig.configPath
      ? `--config "${this.rcloneConfig.configPath}"`
      : '';

    // 默认的 rclone 参数，可以根据需要调整或从配置读取
    const defaultFlags = [
      '--verbose', // 输出详细信息
      '--stats=10s', // 每10秒打印一次传输状态
      '--stats-one-line', // 状态单行输出
      '--retries=3', // 失败重试3次
      '--low-level-retries=10', // 低级别操作重试次数
      // '--checksum', // 推荐开启，基于checksum而不是大小和修改时间来判断是否需要传输，更可靠但可能稍慢
      // '--fast-list', // 如果远程支持，可以加快列表速度
      // '--transfers=4', // 并发传输数 (rclone 内部的并发)
    ];

    const commandParts = [
      'rclone',
      'copy', // 或者 'move' 如果你想上传后删除本地源 (但我们通常在验证后再删除)
      configFileArg,
      ...defaultFlags,
      ...rcloneFlags, // 用户传入的额外参数
      `"${localPath}"`, // 用引号包裹路径以处理空格等特殊字符
      `"${fullRemotePath}"`,
    ];
    const command = commandParts.filter((part) => part !== '').join(' '); // 过滤空参数并拼接

    this.logger.debug(`执行 rclone 命令: ${command}`);

    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: 3 * 60 * 60 * 1000,
      }); // 设置一个较长的超时，例如3小时，以防大文件上传

      if (stderr && stderr.toLowerCase().includes('error')) {
        // 有些rclone错误可能在stderr中，但退出码仍然是0 (例如某些API限流警告后成功)
        // 但如果明确包含 "error" 字样，我们应该更警惕
        this.logger.warn(`Rclone 上传 '${localPath}' 可能有警告或非致命错误 (stderr): ${stderr}`);
      }
      // rclone copy/move 成功时退出码通常为0
      this.logger.info(`Rclone 上传 '${localPath}' 初步完成。Stdout: ${stdout.slice(0, 200)}...`);
      return { success: true, remotePath: fullRemotePath, stdout, stderr };
    } catch (error: any) {
      this.logger.error(
        `Rclone 上传 '${localPath}' 失败。退出码: ${error.code}. Stderr: ${error.stderr}. Stdout: ${error.stdout}`,
        error
      );
      return {
        success: false,
        message: `Rclone command failed with code ${error.code}: ${error.stderr || error.message}`,
        stderr: error.stderr,
        stdout: error.stdout,
      };
    }
  }

  /**
   * 验证文件是否已成功上传到网盘并与本地一致。
   * @param localPath 本地文件或目录的绝对路径。
   * @param remotePath 已上传到网盘的完整远程路径 (例如 remoteName:path/to/file)。
   * @returns Promise<VerificationResult> 验证结果。
   */
  public async verifyUpload(localPath: string, remotePath: string): Promise<VerificationResult> {
    this.logger.info(`准备验证: 本地 '${localPath}' vs 远程 '${remotePath}'`);

    const configFileArg = this.rcloneConfig.configPath
      ? `--config "${this.rcloneConfig.configPath}"`
      : '';

    const commandParts = [
      'rclone',
      'check', // 使用 rclone check 命令
      configFileArg,
      // '--one-way', // 如果只想检查远程是否存在本地文件，可以加 --one-way (本地 -> 远程)
      //              // 不加的话是双向检查，确保两者完全一致
      '--verbose', // 输出更多信息，有助于调试
      `"${localPath}"`,
      `"${remotePath}"`,
    ];
    const command = commandParts.filter((part) => part !== '').join(' ');

    this.logger.debug(`执行 rclone check 命令: ${command}`);

    try {
      // rclone check 成功 (文件一致) 时退出码为 0
      const { stdout, stderr } = await execAsync(command, {
        timeout: 30 * 60 * 1000,
      }); // 验证超时30分钟

      // 即使退出码是0，也检查stderr是否有内容，可能包含一些非致命的警告
      if (stderr) {
        this.logger.warn(`Rclone check '${localPath}' vs '${remotePath}' stderr: ${stderr}`);
      }
      // 如果 stdout 包含 "0 files differed" 或类似信息，通常表示成功
      this.logger.info(
        `Rclone check 成功: '${localPath}' 与 '${remotePath}' 一致。Stdout: ${stdout.slice(0, 200)}...`
      );
      return { verified: true, message: 'Files are in sync.', stdout, stderr };
    } catch (error: any) {
      // rclone check 退出码非0表示文件不一致或发生错误
      this.logger.error(
        `Rclone check 失败: '${localPath}' 与 '${remotePath}' 不一致或发生错误。退出码: ${error.code}. Stderr: ${error.stderr}. Stdout: ${error.stdout}`,
        error
      );
      return {
        verified: false,
        message: `Verification failed with code ${error.code}: ${error.stderr || error.message}`,
        stdout: error.stdout,
        stderr: error.stderr,
      };
    }
  }
}
