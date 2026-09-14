/**
 * 微信云开发封装
 *
 * 编译到 mp-weixin 时直接调用 wx.cloud；
 * 其他端给出明确报错，避免 H5 端静默失败。
 *
 * 注意：云函数所在目录不会进入编译产物，需要在微信开发者工具里
 * 通过 cloudfunctionRoot 指向它（见 scripts/sync-cloudfunctions.mjs）。
 */
import { CLOUD_ENV } from '@/config'

export interface ApiResult<T = unknown> {
  code: number
  msg?: string
  data?: T
}

// #ifdef MP-WEIXIN
export function initCloud(): void {
  if (!wx.cloud) {
    console.error('请使用 2.2.3 或以上的基础库以使用云能力')
    return
  }
  wx.cloud.init({
    env: CLOUD_ENV,
    traceUser: true
  })
}

/** 统一调用业务云函数 api，传入 action 与参数 */
export function callApi<T = unknown>(
  action: string,
  data: Record<string, unknown> = {}
): Promise<ApiResult<T>> {
  return wx.cloud
    .callFunction({ name: 'api', data: { action, ...data } })
    .then((res) => res.result as ApiResult<T>)
}

/** 登录并获取当前用户（含角色 owner / friend / guest） */
export function callLogin<T = unknown>(): Promise<ApiResult<T>> {
  return wx.cloud
    .callFunction({ name: 'login', data: {} })
    .then((res) => res.result as ApiResult<T>)
}

/** 上传文件到云存储，返回 fileID */
export function uploadFile(cloudPath: string, filePath: string): Promise<{ fileID: string }> {
  return wx.cloud.uploadFile({ cloudPath, filePath })
}
// #endif

// #ifndef MP-WEIXIN
const NOT_SUPPORTED = '当前工程仅支持编译到微信小程序端'

export function initCloud(): void {
  console.warn(NOT_SUPPORTED)
}

export function callApi<T = unknown>(): Promise<ApiResult<T>> {
  return Promise.reject(new Error(NOT_SUPPORTED))
}

export function callLogin<T = unknown>(): Promise<ApiResult<T>> {
  return Promise.reject(new Error(NOT_SUPPORTED))
}

export function uploadFile(): Promise<{ fileID: string }> {
  return Promise.reject(new Error(NOT_SUPPORTED))
}
// #endif
