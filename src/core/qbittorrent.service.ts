// src/core/qbittorrent.service.ts
import axios, {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosError,
  InternalAxiosRequestConfig, // 导入这个内部类型，如果你的 Axios 版本使用它
} from 'axios';
import FormData from 'form-data';
import https from 'node:https';
import { IQBittorrentConfig } from '../interfaces/config.types';
import { Logger } from 'winston';

// 扩展 Axios 的请求配置类型，以包含我们自定义的 _retry 属性
// 注意: InternalAxiosRequestConfig 可能不是所有 Axios 版本都导出的公共类型。
// 如果找不到 InternalAxiosRequestConfig，可以直接使用 AxiosRequestConfig。
// _retry 属性用于在响应拦截器中标记请求是否已因403错误而重试过。
interface RetryableAxiosRequestConfig extends InternalAxiosRequestConfig {
  // 或 AxiosRequestConfig
  _retry?: boolean;
}

// qBittorrent API 返回的种子信息的部分接口定义
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
        // 将 error.config 断言为我们扩展的 RetryableAxiosRequestConfig 类型
        const originalRequest = error.config as RetryableAxiosRequestConfig;

        if (
          originalRequest &&
          error.response?.status === 403 &&
          !originalRequest._retry &&
          this.sid
        ) {
          originalRequest._retry = true; // 标记为已重试
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
              // 注意: originalRequest 现在包含 _retry 属性。
              // 如果 Axios 的内部类型检查很严格，直接传递 originalRequest 可能仍有问题。
              // 一个更安全的方法是创建一个新的配置对象，只包含标准属性。
              // 但通常情况下，Axios 会忽略它不认识的额外属性。
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

  /**
   * 登录到 qBittorrent WebUI。
   * @param retryCount 当前重试次数
   */
  private async login(retryCount = 0): Promise<void> {
    if (this.sid) {
      this.logger.debug('已登录到 qBittorrent 或 SID 已存在。');
      return;
    }

    if (!this.config.username || !this.config.password) {
      this.logger.info('未配置 qBittorrent 用户名或密码，假设无需认证。');
      try {
        await this.getAppPreferences();
        this.logger.info('成功无认证连接到 qBittorrent (通过获取首选项测试)。');
      } catch (e) {
        this.logger.warn('尝试无认证连接失败，API 可能无响应或需要认证。', e);
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
            } catch (prefError) {
              this.logger.warn(
                '登录后获取应用首选项失败，但 SID 可能仍然有效。将继续尝试。',
                prefError
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
    } catch (error: any) {
      this.logger.error(`qBittorrent 登录尝试 ${retryCount + 1} 失败:`, error.message || error);
      if (retryCount < this.MAX_LOGIN_RETRIES - 1) {
        this.logger.info(`5 秒后重试登录...`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
        return this.login(retryCount + 1);
      }
      throw new Error(`尝试 ${this.MAX_LOGIN_RETRIES} 次后未能登录到 qBittorrent。`);
    }
  }

  /**
   * 获取 qBittorrent Web API 的版本号 (可选调用)。
   * 如果此端点不存在，可能会导致404。
   */
  public async getApiVersion(): Promise<string | null> {
    try {
      this.logger.debug('正在获取 qBittorrent API 版本...');
      await this.ensureLoggedIn();
      const response = await this.apiClient.get<string>(`${this.QB_API_BASE_PATH}/version/api`);
      this.logger.info(`qBittorrent API 版本: ${response.data}`);
      return response.data;
    } catch (error: any) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        this.logger.warn(
          '获取 qBittorrent API 版本失败 (端点 /version/api 返回 404 Not Found)。可能 qB 版本不支持此端点。'
        );
        return null;
      }
      this.logger.error('获取 qBittorrent API 版本时发生其他错误:', error);
      throw error;
    }
  }

  /**
   * 获取 qBittorrent 应用首选项。
   * 通常用于测试连接性和 SID 有效性。
   */
  public async getAppPreferences(): Promise<any> {
    this.logger.debug('正在获取 qBittorrent 应用首选项...');
    return this.request<any>({
      method: 'get',
      url: `${this.QB_API_BASE_PATH}/app/preferences`,
    });
  }

  /**
   * 确保客户端已登录。如果未登录且配置了凭据，则尝试登录。
   */
  private async ensureLoggedIn(): Promise<void> {
    if (!this.sid && this.config.username && this.config.password) {
      this.logger.debug('当前未登录或 SID 未设置，正在尝试登录...');
      await this.login();
    }
  }

  /**
   * 发送 API 请求的通用方法。
   * @param axiosReqConfig Axios 请求配置
   */
  private async request<T>(axiosReqConfig: AxiosRequestConfig): Promise<T> {
    await this.ensureLoggedIn();
    try {
      const method = axiosReqConfig.method?.toUpperCase() || 'GET';
      const urlPath = axiosReqConfig.url; // 这是相对路径，如 /app/preferences
      this.logger.debug(
        `发送 qB API 请求: ${method} ${this.apiClient.defaults.baseURL}${urlPath}`,
        { params: axiosReqConfig.params }
      );
      const response = await this.apiClient.request<T>(axiosReqConfig);
      return response.data;
    } catch (error: any) {
      this.logger.error(
        `qBittorrent API 请求 ${axiosReqConfig.method?.toUpperCase()} ${axiosReqConfig.url} 失败:`,
        axios.isAxiosError(error) && error.response
          ? JSON.stringify(error.response.data)
          : error.message || error // 序列化data以防是对象
      );
      throw error;
    }
  }

  /**
   * 获取种子列表。
   * @param params 各种筛选和排序参数 (可选)
   */
  public async getTorrents(params?: {
    filter?:
      | 'all'
      | 'downloading'
      | 'seeding'
      | 'completed'
      | 'paused'
      | 'active'
      | 'inactive'
      | 'resumed'
      | 'stalled'
      | 'stalled_uploading'
      | 'stalled_downloading';
    category?: string;
    tag?: string;
    sort?: string;
    reverse?: boolean;
    limit?: number;
    offset?: number;
    hashes?: string;
  }): Promise<QBittorrentTorrent[]> {
    this.logger.debug('正在获取种子列表，参数:', params || {});
    return this.request<QBittorrentTorrent[]>({
      method: 'get',
      url: `${this.QB_API_BASE_PATH}/torrents/info`,
      params: params || {},
    });
  }

  /**
   * 获取已完成下载的种子 (进度100%)。
   */
  public async getCompletedTorrents(): Promise<QBittorrentTorrent[]> {
    this.logger.debug('正在获取已完成下载 (进度100%) 的种子...');
    const torrents = await this.getTorrents({ filter: 'completed' });
    const fullyCompleted = torrents.filter((t) => t.progress === 1);
    this.logger.debug(
      `从 'completed' 过滤器中找到 ${torrents.length} 个种子, 其中 ${fullyCompleted.length} 个进度为 100%。`
    );
    return fullyCompleted;
  }

  // TODO: 添加删除种子的方法
  // public async deleteTorrents(hashes: string[], deleteFiles: boolean): Promise<void> { ... }
}
