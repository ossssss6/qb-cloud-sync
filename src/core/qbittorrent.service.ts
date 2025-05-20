// src/core/qbittorrent.service.ts
import axios, {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosError,
  InternalAxiosRequestConfig,
} from 'axios';
import FormData from 'form-data';
import https from 'node:https';
import { IQBittorrentConfig } from '../interfaces/config.types';
import { Logger } from 'winston';

// 扩展 Axios 的请求配置类型
interface RetryableAxiosRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

// qBittorrent API 返回的种子信息接口定义
export interface QBittorrentTorrent {
  added_on: number;
  amount_left: number;
  auto_tmm: boolean;
  availability?: number;
  category: string;
  completed: number;
  completion_on: number;
  content_path: string;
  dl_limit: number;
  dlspeed: number;
  download_path?: string;
  downloaded: number;
  downloaded_session: number;
  eta: number;
  f_l_piece_prio: boolean;
  force_start: boolean;
  hash: string;
  inactive_seeding_time_limit?: number;
  infohash_v1?: string;
  infohash_v2?: string;
  last_activity: number;
  magnet_uri: string;
  max_ratio: number;
  max_seeding_time: number;
  name: string;
  num_complete: number;
  num_incomplete: number;
  num_leechs: number;
  num_seeds: number;
  priority: number;
  progress: number;
  ratio: number;
  ratio_limit: number;
  save_path: string;
  seeding_time: number;
  seeding_time_limit?: number;
  seen_complete: number;
  seq_dl: boolean;
  size: number;
  state: string;
  super_seeding: boolean;
  tags: string;
  time_active: number;
  total_size: number;
  tracker: string;
  trackers_count?: number;
  up_limit: number;
  uploaded: number;
  uploaded_session: number;
  upspeed: number;
}

export class QBittorrentService {
  private apiClient: AxiosInstance;
  private sid: string | null = null;
  private readonly MAX_LOGIN_RETRIES = 3;
  private readonly QB_API_BASE_PATH = '/api/v2';

  constructor(
    private config: IQBittorrentConfig,
    private logger: Logger
  ) {
    const baseURL = this.config.url.endsWith('/') ? this.config.url.slice(0, -1) : this.config.url;
    const axiosConfig: AxiosRequestConfig = {
      baseURL: baseURL,
      timeout: 15000,
      withCredentials: true,
    };
    if (baseURL.startsWith('https://')) {
      this.logger.warn(
        'qBittorrent URL 使用 HTTPS。对于本地或自签名证书，将禁用 SSL 证书验证。这对于面向公众的服务是不安全的！'
      );
      axiosConfig.httpsAgent = new https.Agent({
        rejectUnauthorized: false,
      });
    }
    this.apiClient = axios.create(axiosConfig);
    this.apiClient.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const originalRequest = error.config as RetryableAxiosRequestConfig;
        if (
          originalRequest &&
          error.response?.status === 403 &&
          !originalRequest._retry &&
          this.sid
        ) {
          originalRequest._retry = true;
          this.logger.warn(
            '从 qBittorrent 收到 403 Forbidden。SID 可能无效或已过期，尝试重新登录...'
          );
          this.sid = null;
          if (this.apiClient.defaults.headers.common['Cookie']) {
            delete this.apiClient.defaults.headers.common['Cookie'];
          }
          try {
            await this.login();
            if (this.sid && originalRequest.headers) {
              originalRequest.headers['Cookie'] = `SID=${this.sid}`;
              return this.apiClient(originalRequest);
            }
          } catch (loginError) {
            this.logger.error('qBittorrent 403 后重新登录失败:', loginError);
            return Promise.reject(loginError);
          }
        }
        return Promise.reject(error);
      }
    );
  }

  private async login(retryCount = 0): Promise<void> {
    // ... (login 方法内部逻辑保持不变，但确保错误处理中的 error 类型是明确的或 unknown) ...
    if (this.sid) return; // 已有 SID 则不重复登录
    if (!this.config.username || !this.config.password) {
      /* ... 无认证逻辑 ... */
      try {
        await this.getAppPreferences();
        this.logger.info('成功无认证连接到 qBittorrent (通过获取首选项测试)。');
      } catch (e: unknown) {
        // 使用 unknown 类型
        this.logger.warn(
          '尝试无认证连接失败，API 可能无响应或需要认证。',
          e instanceof Error ? e.message : e
        );
        throw new Error('qBittorrent API 无法访问且未提供凭据。');
      }
      return;
    }

    this.logger.info(`尝试登录到 qBittorrent (第 ${retryCount + 1} 次)...`);
    const formData = new FormData();
    formData.append('username', this.config.username);
    formData.append('password', this.config.password);

    try {
      const response = await this.apiClient.post(`${this.QB_API_BASE_PATH}/auth/login`, formData, {
        headers: formData.getHeaders(),
      });
      if (response.data === 'Ok.') {
        /* ... 处理 SID ... */
        const cookies = response.headers['set-cookie'];
        if (cookies && Array.isArray(cookies)) {
          const sidCookie = cookies.find((cookie: string) => cookie.startsWith('SID='));
          if (sidCookie) {
            this.sid = sidCookie.split(';')[0].split('=')[1];
            this.apiClient.defaults.headers.common['Cookie'] = `SID=${this.sid}`;
            this.logger.info('成功登录到 qBittorrent。SID 已获取。');
            try {
              await this.getAppPreferences();
              this.logger.info('登录后连接性测试通过 (通过获取首选项)。');
            } catch (prefError: unknown) {
              // 使用 unknown
              this.logger.warn(
                '登录后获取应用首选项失败，但 SID 可能仍然有效。',
                prefError instanceof Error ? prefError.message : prefError
              );
            }
            return;
          }
        }
        throw new Error('登录响应中未找到 SID cookie。');
      } else if (response.data === 'Fails.') {
        throw new Error('qBittorrent 登录失败：用户名或密码无效。');
      } else {
        this.logger.warn(`qBittorrent 登录收到非预期响应: ${response.data}`);
        throw new Error(`qBittorrent 登录失败：未预期的响应。`);
      }
    } catch (error: unknown) {
      // 使用 unknown 类型
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`qBittorrent 登录尝试 ${retryCount + 1} 失败:`, errorMessage);
      if (retryCount < this.MAX_LOGIN_RETRIES - 1) {
        this.logger.info(`5 秒后重试登录...`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
        return this.login(retryCount + 1);
      }
      throw new Error(`尝试 ${this.MAX_LOGIN_RETRIES} 次后未能登录到 qBittorrent。`);
    }
  }

  public async getApiVersion(): Promise<string | null> {
    // ... (getApiVersion 方法内部逻辑保持不变，但确保错误处理中的 error 类型是明确的或 unknown) ...
    try {
      this.logger.debug('正在获取 qBittorrent API 版本...');
      await this.ensureLoggedIn();
      const response = await this.apiClient.get<string>(`${this.QB_API_BASE_PATH}/version/api`);
      this.logger.info(`qBittorrent API 版本: ${response.data}`);
      return response.data;
    } catch (error: unknown) {
      // 使用 unknown 类型
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        this.logger.warn(
          '获取 qBittorrent API 版本失败 (端点 /version/api 返回 404 Not Found)。可能 qB 版本不支持此端点。'
        );
        return null;
      }
      this.logger.error(
        '获取 qBittorrent API 版本时发生其他错误:',
        error instanceof Error ? error.message : error
      );
      throw error;
    }
  }

  public async getAppPreferences(): Promise<unknown> {
    // 返回类型改为 unknown
    this.logger.debug('正在获取 qBittorrent 应用首选项...');
    return this.request<unknown>({
      // 泛型参数改为 unknown
      method: 'get',
      url: `${this.QB_API_BASE_PATH}/app/preferences`,
    });
  }

  private async ensureLoggedIn(): Promise<void> {
    // ... (ensureLoggedIn 方法内部逻辑保持不变) ...
    if (!this.sid && this.config.username && this.config.password) {
      this.logger.debug('当前未登录或 SID 未设置，正在尝试登录...');
      await this.login();
    }
  }

  private async request<T = unknown>(axiosReqConfig: AxiosRequestConfig): Promise<T> {
    // 泛型 T 默认值为 unknown
    await this.ensureLoggedIn();
    try {
      // ... (request 方法内部逻辑保持不变) ...
      const method = axiosReqConfig.method?.toUpperCase() || 'GET';
      const urlPath = axiosReqConfig.url;
      this.logger.debug(
        `发送 qB API 请求: ${method} ${this.apiClient.defaults.baseURL}${urlPath}`,
        { params: axiosReqConfig.params }
      );
      const response = await this.apiClient.request<T>(axiosReqConfig);
      return response.data;
    } catch (error: unknown) {
      // 使用 unknown 类型
      const errorMessage =
        axios.isAxiosError(error) && error.response
          ? JSON.stringify(error.response.data)
          : error instanceof Error
            ? error.message
            : String(error);
      this.logger.error(
        `qBittorrent API 请求 ${axiosReqConfig.method?.toUpperCase()} ${axiosReqConfig.url} 失败:`,
        errorMessage
      );
      throw error;
    }
  }

  public async getTorrents(params?: {
    /* ... params ... */
  }): Promise<QBittorrentTorrent[]> {
    // ... (getTorrents 方法内部逻辑保持不变) ...
    this.logger.debug('正在获取种子列表，参数:', params || {});
    return this.request<QBittorrentTorrent[]>({
      method: 'get',
      url: `${this.QB_API_BASE_PATH}/torrents/info`,
      params: params || {},
    });
  }

  /**
   * 获取所有下载进度为 100% 的种子。
   * 这些种子可能仍在做种，也可能已暂停。
   */
  public async getAllDownloadedTorrents(): Promise<QBittorrentTorrent[]> {
    // <--- 确保这个方法存在且命名正确
    this.logger.debug('正在获取所有下载进度为 100% 的种子...');
    const torrents = await this.getTorrents({ filter: 'all' });
    const downloadedTorrents = torrents.filter(
      (t) =>
        t.progress === 1 &&
        t.state !== 'error' &&
        t.state !== 'missingFiles' &&
        !t.state.toLowerCase().includes('downloading') &&
        !t.state.toLowerCase().includes('checkingdl')
    );
    this.logger.debug(
      `共获取 ${torrents.length} 个种子, 其中 ${downloadedTorrents.length} 个进度为 100% 且状态适合初步筛选。`
    );
    return downloadedTorrents;
  }
}
