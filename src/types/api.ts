/**
 * 与 cloudfunctions/api/index.js 的 action 一一对应的数据模型
 *
 * action 清单（与云函数 switch-case 完全一致）：
 *   user.updateProfile / user.footprint
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
  /** 云存储 fileID（入库值）。只有上传者能直连读取，**不要直接当 <image> 的 src** */
  imageUrl: string
  /**
   * 仅列表接口返回的临时 https 渲染链接（服务端代换，24 小时过期）。
   *
   * ⚠️ 只读、只用于渲染。**永远不要把它回传给 dish.add / dish.update** ——
   * 链接一过期就会被写进库，图片永久失效。入库一律用 imageUrl。
   */
  imageSrc?: string
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
  /** 下单人上传的头像 fileID（入库值）。非上传者读不了，别直接当 <image> 的 src */
  avatarUrl: string
  /**
   * 仅列表接口返回的临时 https 渲染链接（服务端代换，24 小时过期）。
   * 只读、只用于渲染，不可回传保存。用法同 Dish.imageSrc
   */
  avatarSrc?: string
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

/**
 * user.footprint 返回结构（「我的」页的点餐足迹）。
 *
 * 是服务端扫全量算出来的聚合值 —— 不要在客户端拿分页列表自己求和，
 * 那样只能算到第一页。
 */
export interface FootprintData {
  /** 累计下单数 */
  count: number
  /** 累计点了几份菜（各项 quantity 之和） */
  dishes: number
  /** 最近一单的时间；没下过单为 null */
  lastAt: string | Date | null
}

/**
 * 订单列表的请求参数 / 返回结构（order.listMine 与 order.listAll 共用）。
 *
 * ⚠️ 日期范围与状态筛选都在**服务端**生效 —— 分页之后如果还按「已加载的那些数据」
 * 在前端过滤，筛出来的条数是错的（只剩当页）。所以这两个条件必须随请求一起发。
 */
export interface OrderQuery {
  page?: number
  pageSize?: number
  /** 'YYYY-MM-DD'，按 UTC+8 的自然日边界 */
  startDate?: string
  endDate?: string
  status?: OrderStatus
}

export interface PagedOrders {
  list: Order[]
  /** 命中筛选条件的总条数（不是已加载的条数） */
  total: number
  page: number
  pageSize: number
  hasMore: boolean
  /** 仅 order.listAll 返回：全库未推送成功的订单数，不受分页/筛选影响 */
  unnotified?: number
}

/** 菜品分组的渲染结构（分类 + 该分类下菜品） */
export interface DishGroup {
  _id: string
  name: string
  dishes: Dish[]
}
