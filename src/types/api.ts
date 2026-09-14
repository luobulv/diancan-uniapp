/**
 * 与 cloudfunctions/api/index.js 的 18 个 action 一一对应的数据模型
 *
 * action 清单（与云函数 switch-case 完全一致）：
 *   user.updateProfile
 *   category.list / category.add / category.update / category.delete
 *   dish.list / dish.add / dish.update / dish.delete
 *   invite.create / invite.list / invite.accept
 *   order.create / order.listMine / order.listAll / order.updateStatus
 *   stats.heatmap / stats.get
 */

export type Role = 'owner' | 'friend' | 'guest'

export interface User {
  _id: string
  openid: string
  nickname: string
  avatarUrl: string
  role: Role
  invitedBy?: string
}

export interface Category {
  _id: string
  name: string
  sort?: number
}

export interface Dish {
  _id: string
  name: string
  categoryId: string
  imageUrl: string
  /** 推荐指数 0~5，支持半星 */
  rating: number
  /** 累计点餐次数 */
  orderCount: number
}

export type OrderStatus = 'pending' | 'completed' | 'cancelled'

export interface OrderItem {
  dishId: string
  name: string
  quantity: number
}

export interface Order {
  _id: string
  openid: string
  nickname: string
  avatarUrl: string
  items: OrderItem[]
  remark: string
  status: OrderStatus
  /** 订阅消息是否推送成功 */
  notified?: boolean
  createdAt: string
}

export interface Invitation {
  _id: string
  code: string
  createdBy: string
  used: boolean
  usedBy?: string
  usedAt?: string
  /** 云数据库写入时间，admin/invite 页用 formatTime 展示「生成于 …」 */
  createdAt?: string
}

/** stats.heatmap 返回结构 */
export interface HeatmapData {
  counts: Record<string, number>
}

/** 菜品分组的渲染结构（分类 + 该分类下菜品） */
export interface DishGroup {
  _id: string
  name: string
  dishes: Dish[]
}
