/**
 * 格式化工具 —— 迁移自原项目 miniprogram/utils/util.js
 */

/** 时间戳 / Date / 云数据库 Date 对象 -> 'YYYY-MM-DD HH:mm' */
export function formatTime(
  input?: Date | string | number | { $date: string | number } | null
): string {
  let d: Date
  if (input instanceof Date) {
    d = input
  } else if (input && typeof input === 'object' && '$date' in input) {
    d = new Date(input.$date)
  } else if (input) {
    d = new Date(input as string | number)
  } else {
    d = new Date()
  }
  const p = (n: number) => (n < 10 ? '0' + n : '' + n)
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export type OrderStatus = 'pending' | 'completed' | 'cancelled'

/**
 * 订单状态 -> 文案 + 颜色
 *
 * 注意：原项目 util.js 里 pending 用的是旧橙 #ff6b35，
 * 那是 2026-09-10 色系统一时遗漏的一处（当时只改了 WXSS）。
 * 这里统一到设计令牌 --amber (#F5A623)。
 *
 * 另：原项目 orders.js / admin/orders.js 虽然计算了 statusText / statusColor，
 * 但 WXML 里从未使用（死代码）。这里保留能力，供后续使用。
 */
export const STATUS_MAP: Record<OrderStatus, { text: string; color: string }> = {
  pending: { text: '待处理', color: '#F5A623' },
  completed: { text: '已完成', color: '#07c160' },
  cancelled: { text: '已取消', color: '#999999' }
}

export function statusInfo(status: string): { text: string; color: string } {
  return STATUS_MAP[status as OrderStatus] || { text: status, color: '#999999' }
}
