// src/core/uploader.service.ts
import { exec } from 'node:child_process'; // 用于执行外部命令
import { promisify } from 'node:util';
import fs from 'node:fs/promises'; // 导入 Node.js 文件系统模块的 Promise版本
// import path from 'node:path'; // 如果确实没有用到 'path' 模块，则删除或注释掉此行
import { IRcloneConfig } from '../interfaces/config.types';
import { Logger } from 'winston';

const execAsync = promisify(exec); // 将 exec 转换为返回 Promise 的函数

// 定义一个接口来描述 execAsync 可能抛出的错误类型
interface ExecError extends Error {
  stdout?: string;
  stderr?: string;
  code?: number; // 退出码
  killed?: boolean;
  signal?: string;
}

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
    private rcloneConfig: IRcloneConfig, // Rclone 相关配置
    private logger: Logger // 日志服务实例
  ) {
    if (!this.rcloneConfig.remoteName) {
      const errMsg = 'Rclone 远程名称 (RCLONE_REMOTE_NAME) 未配置。';
      this.logger.error(errMsg);
      throw new Error(errMsg);
    }
  }

  /**
   * 将本地文件或目录上传到网盘。
   * @param localPath 要上传的本地文件或目录的绝对路径。
   * @param relativeTargetPath 在网盘远程基础路径下的相对目标路径。
   * @param rcloneFlags 可选的额外 rclone 命令行参数数组。
   * @returns Promise<UploadResult> 上传结果。
   */
  public async upload(
    localPath: string,
    relativeTargetPath: string,
    rcloneFlags: string[] = []
  ): Promise<UploadResult> {
    const remoteBase = `${this.rcloneConfig.remoteName}:${this.rcloneConfig.defaultUploadPath.replace(/\/$/, '')}`;
    const fullRemotePath = `${remoteBase}/${relativeTargetPath.replace(/^\//, '')}`;

    this.logger.info(`准备上传: 本地 '${localPath}' -> 远程 '${fullRemotePath}'`);

    const configFileArg = this.rcloneConfig.configPath
      ? `--config "${this.rcloneConfig.configPath}"`
      : '';

    const defaultFlags = [
      '--verbose',
      '--stats=10s',
      '--stats-one-line',
      '--retries=3',
      '--low-level-retries=10',
    ];

    let isLocalPathAFile = false;
    try {
      const stats = await fs.stat(localPath);
      isLocalPathAFile = stats.isFile();
    } catch (statError: unknown) {
      // 使用 unknown 类型
      const errorMessage = statError instanceof Error ? statError.message : String(statError);
      this.logger.error(`无法获取本地路径 '${localPath}' 的状态: ${errorMessage}`, statError);
      return { success: false, message: `无法访问本地路径: ${localPath}. 错误: ${errorMessage}` };
    }

    const rcloneSubCommand = isLocalPathAFile ? 'copyto' : 'copy';
    this.logger.info(
      `本地路径 '${localPath}' 被识别为 [${isLocalPathAFile ? '文件' : '目录'}]。将使用 rclone '${rcloneSubCommand}' 命令。`
    );

    const commandParts = [
      'rclone',
      rcloneSubCommand,
      configFileArg,
      ...defaultFlags,
      ...rcloneFlags,
      `"${localPath}"`,
      `"${fullRemotePath}"`,
    ];
    const command = commandParts.filter((part) => part !== '').join(' ');

    this.logger.debug(`[RCLONE_COMMAND] 执行 rclone 命令: ${command}`);

    try {
      const { stdout, stderr } = await execAsync(command, { timeout: 3 * 60 * 60 * 1000 });

      if (stderr && stderr.trim() !== '') {
        if (stderr.toLowerCase().includes('error')) {
          this.logger.error(`Rclone 上传 '${localPath}' 遇到错误 (stderr): ${stderr}`);
        } else {
          this.logger.warn(
            `Rclone 上传 '${localPath}' 有输出到 stderr (可能为警告或进度信息): ${stderr}`
          );
        }
      }

      this.logger.info(
        `Rclone 上传 '${localPath}' 初步完成。Stdout (部分): ${stdout.slice(0, 300)}...`
      );
      return { success: true, remotePath: fullRemotePath, stdout, stderr };
    } catch (error: unknown) {
      // 使用 unknown 类型
      const execError = error as ExecError; // 断言为我们定义的 ExecError
      const errorMessage = execError.stderr || execError.message || '未知 rclone 执行错误';
      this.logger.error(
        `Rclone 上传 '${localPath}' 失败。退出码: ${execError.code || 'N/A'}. Stderr: ${execError.stderr || 'N/A'}. Stdout: ${execError.stdout || 'N/A'}`,
        execError
      );
      return {
        success: false,
        message: `Rclone 命令执行失败，退出码 ${execError.code || 'N/A'}: ${errorMessage}`,
        stderr: execError.stderr,
        stdout: execError.stdout,
      };
    }
  }

  /**
   * 验证文件是否已成功上传到网盘并与本地一致。
   * @param localPath 本地文件或目录的绝对路径。
   * @param remotePath 已上传到网盘的完整远程路径。
   * @returns Promise<VerificationResult> 验证结果。
   */
  public async verifyUpload(localPath: string, remotePath: string): Promise<VerificationResult> {
    this.logger.info(`准备验证: 本地 '${localPath}' vs 远程 '${remotePath}'`);

    const configFileArg = this.rcloneConfig.configPath
      ? `--config "${this.rcloneConfig.configPath}"`
      : '';

    const commandParts = [
      'rclone',
      'check',
      configFileArg,
      '--verbose',
      `"${localPath}"`,
      `"${remotePath}"`,
    ];
    const command = commandParts.filter((part) => part !== '').join(' ');

    this.logger.debug(`[RCLONE_COMMAND] 执行 rclone check 命令: ${command}`);

    try {
      const { stdout, stderr } = await execAsync(command, { timeout: 30 * 60 * 1000 });

      if (stderr && stderr.trim() !== '') {
        this.logger.warn(
          `Rclone check '${localPath}' vs '${remotePath}' 有输出到 stderr: ${stderr}`
        );
      }

      this.logger.info(
        `Rclone check 成功: '${localPath}' 与 '${remotePath}' 一致。Stdout (部分): ${stdout.slice(0, 300)}...`
      );
      return { verified: true, message: '本地与远程同步一致。', stdout, stderr };
    } catch (error: unknown) {
      // 使用 unknown 类型
      const execError = error as ExecError; // 断言为我们定义的 ExecError
      const errorMessage = execError.stderr || execError.message || '未知 rclone check 错误';
      this.logger.error(
        `Rclone check 失败: '${localPath}' 与 '${remotePath}' 不一致或发生错误。退出码: ${execError.code || 'N/A'}. Stderr: ${execError.stderr || 'N/A'}. Stdout: ${execError.stdout || 'N/A'}`,
        execError
      );
      return {
        verified: false,
        message: `验证失败，退出码 ${execError.code || 'N/A'}: ${errorMessage}`,
        stdout: execError.stdout,
        stderr: execError.stderr,
      };
    }
  }
}
