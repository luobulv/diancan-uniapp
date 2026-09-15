<script setup lang="ts">
/**
 * 订单管理（店主端）—— 原 pages/admin/orders 迁移
 *
 * 与原实现的差异：
 *  - allOrders + orders 两份数据（一份全量、一份筛选结果）合并为
 *    「allOrders 是唯一数据源，orders 是 computed」，去掉 applyFilter 手工同步。
 *  - timeText / itemsText / statusText 用 computed 预计算，模板里不再调用函数。
 *  - 状态筛选与分页都改走**服务端**（原 order.listAll 硬编码 limit(100)，
 *    店主看不到第 100 单以前的历史；而一分页，前端过滤的条数就是错的）。
 */
import { computed, ref } from 'vue'
import { onPullDownRefresh, onReachBottom, onShow } from '@dcloudio/uni-app'
import { callApi } from '@/utils/cloud'
import { formatTime, statusInfo } from '@/utils/format'
import { useUserStore } from '@/stores/user'
import type { Order, OrderStatus, PagedOrders } from '@/types/api'

interface Filter {
  key: OrderStatus | 'all'
  text: string
}

const FILTERS: Filter[] = [
  { key: 'all', text: '全部' },
  { key: 'pending', text: '待处理' },
  { key: 'completed', text: '已完成' },
  { key: 'cancelled', text: '已取消' }
]

/** 一页拉多少条（与云函数 ORDER_PAGE_DEFAULT 对齐） */
const PAGE_SIZE = 20

const userStore = useUserStore()

const allOrders = ref<Order[]>([])
const filter = ref<Filter['key']>('all')
/** 首屏加载态：模板里排在「列表非空」之后，所以有数据时不会闪骨架屏 */
const loading = ref(true)
/** 底部「加载更多」的进行态 */
const loadingMore = ref(false)
/** 命中当前筛选的总条数（服务端返回，不是已加载条数） */
const total = ref(0)
const hasMore = ref(false)
let page = 0

let busy = false
const filters = FILTERS

/** 视图模型：把格式化结果预先算好，模板只做展示 */
const viewOrders = computed(() =>
  allOrders.value.map((o) => ({
    ...o,
    timeText: formatTime(o.createdAt),
    itemsText: (o.items || []).map((it) => `${it.name}×${it.quantity}`).join('、'),
    statusText: statusInfo(o.status).text
  }))
)

/**
 * 拉一页订单。reset = true 从第 1 页重来（进入页面 / 下拉刷新 / 切筛选）；
 * reset = false 追加下一页（上拉触底或点底部按钮）。
 *
 * ⚠️ status 与 page 都发给云函数：分页之后前端再按 status 过滤，
 * 只会筛「已加载的那一页」，条数是错的。
 */
async function load(reset = true) {
  if (reset) page = 0
  else if (!hasMore.value || loadingMore.value || loading.value) return

  if (reset) loading.value = true
  else loadingMore.value = true

  try {
    await userStore.login()
    const next = page + 1
    const res = await callApi<PagedOrders>('order.listAll', {
      page: next,
      pageSize: PAGE_SIZE,
      status: filter.value === 'all' ? undefined : filter.value
    })
    const data = res.data
    if (res.code !== 0 || !data) throw new Error(res.msg || '加载失败')

    allOrders.value = reset ? data.list : allOrders.value.concat(data.list)
    total.value = data.total
    hasMore.value = data.hasMore
    page = data.page
  } catch (e) {
    console.error(e)
    if (reset) uni.showToast({ title: '订单加载失败', icon: 'none' })
  }
  loading.value = false
  loadingMore.value = false
}

onShow(() => {
  load(true)
})

onPullDownRefresh(() => {
  load(true).then(() => uni.stopPullDownRefresh())
})

/** 上拉触底：与底部按钮走同一条路径 */
onReachBottom(() => {
  load(false)
})

/** 切换状态筛选：筛选条件变了，必须从第 1 页重来 */
function changeFilter(key: Filter['key']) {
  if (key === filter.value) return
  filter.value = key
  load(true)
}

async function changeStatus(status: OrderStatus, id: string) {
  if (busy) return
  busy = true
  uni.showLoading({ title: '更新中...', mask: true })
  try {
    const res = await callApi('order.updateStatus', { id, status })
    uni.hideLoading()
    if (res.code === 0) {
      uni.showToast({ title: '已更新', icon: 'success' })
      // 就地更新这一条，不重新拉列表 —— 否则店主翻了几页之后一改状态就被弹回第一页
      applyStatusLocally(id, status)
    } else {
      uni.showToast({ title: res.msg || '操作失败', icon: 'none' })
    }
  } catch (e) {
    uni.hideLoading()
    uni.showToast({ title: '操作失败', icon: 'none' })
  }
  busy = false
}

/** 改完状态就地更新本地列表：当前筛选下不再匹配的，直接移出并修正总数 */
function applyStatusLocally(id: string, status: OrderStatus) {
  const idx = allOrders.value.findIndex((o) => o._id === id)
  if (idx < 0) return
  if (filter.value === 'all' || filter.value === status) {
    allOrders.value[idx] = { ...allOrders.value[idx], status }
  } else {
    allOrders.value.splice(idx, 1)
    total.value = Math.max(0, total.value - 1)
  }
}
</script>

<template>
  <view class="page">
    <!-- 筛选 -->
    <view class="filter-bar">
      <view
        v-for="f in filters"
        :key="f.key"
        class="filter-item"
        :class="{ active: filter === f.key }"
        hover-class="chip-press"
        hover-stay-time="80"
        @tap="changeFilter(f.key)"
      >{{ f.text }}</view>
    </view>

    <view v-if="!loading" class="count-bar">共 {{ total }} 单</view>

    <template v-if="viewOrders.length > 0">
      <view v-for="o in viewOrders" :key="o._id" class="order-card">
        <view class="order-head">
          <view class="order-user">
            <image v-if="o.avatarUrl" class="user-avatar" :src="o.avatarSrc || o.avatarUrl" mode="aspectFill" />
            <text class="user-name">{{ o.nickname }}</text>
          </view>
          <text class="order-time">{{ o.timeText }}</text>
        </view>
        <view class="order-items">{{ o.itemsText }}</view>
        <view v-if="o.remark" class="order-remark">备注：{{ o.remark }}</view>
        <view class="order-foot">
          <view class="order-actions">
            <template v-if="o.status === 'pending'">
              <view
                class="act done"
                hover-class="cta-press"
                hover-stay-time="80"
                @tap="changeStatus('completed', o._id)"
              >完成</view>
              <view
                class="act cancel"
                hover-class="text-press"
                hover-stay-time="80"
                @tap="changeStatus('cancelled', o._id)"
              >取消</view>
            </template>
            <text v-else class="status-text">{{ o.statusText }}</text>
          </view>
        </view>
      </view>

      <!-- 分页尾巴：上拉会自动加载，也可以点一下 -->
      <view class="more-hint">
        <text v-if="loadingMore">正在加载…</text>
        <text
          v-else-if="hasMore"
          class="more-btn"
          hover-class="text-press"
          hover-stay-time="80"
          @tap="load(false)"
        >加载更多</text>
        <text v-else>已显示全部 {{ total }} 单</text>
      </view>
    </template>

    <view v-else-if="loading" class="sk-panel">
      <view class="sk-head">
        <view class="sk-dots">
          <view class="sk-dot"></view>
          <view class="sk-dot"></view>
          <view class="sk-dot"></view>
        </view>
        <text class="sk-head-text">正在取订单…</text>
      </view>
      <view v-for="n in 3" :key="n" class="sk-card">
        <view class="sk-row">
          <view class="sk-thumb"></view>
          <view class="sk-lines">
            <view class="sk-line sk-w40"></view>
            <view class="sk-line sk-w90"></view>
            <view class="sk-line sk-w60"></view>
          </view>
        </view>
      </view>
    </view>

    <view v-else class="empty">
      <text class="icon">📦</text>
      暂无订单
    </view>
  </view>
</template>

<style scoped>
.page {
  padding: 20rpx;
}
.filter-bar {
  display: flex;
  background: var(--paper);
  border-radius: 40rpx;
  padding: 8rpx;
  margin-bottom: 20rpx;
  border: 2rpx solid var(--line);
  box-shadow: var(--shadow-sm);
}
.filter-item {
  flex: 1;
  text-align: center;
  height: 64rpx;
  line-height: 64rpx;
  font-size: 26rpx;
  color: var(--tan);
  border-radius: 32rpx;
}
.filter-item.active {
  background: linear-gradient(135deg, var(--yellow), var(--amber));
  color: var(--ink);
  font-weight: 700;
  box-shadow: var(--shadow-pop);
}

/* ========== 总数与分页尾巴 ========== */
.count-bar {
  padding: 0 8rpx 16rpx;
  font-size: 24rpx;
  color: var(--tan);
  font-variant-numeric: tabular-nums;
}
.more-hint {
  padding: 8rpx 0 32rpx;
  text-align: center;
  font-size: 24rpx;
  color: var(--tan);
  letter-spacing: 1rpx;
}
.more-btn {
  display: inline-block;
  padding: 12rpx 40rpx;
  border-radius: var(--r-pill);
  background: var(--paper);
  border: 2rpx solid var(--line);
  color: var(--caramel);
  font-weight: 600;
}

.order-card {
  background: var(--paper);
  border-radius: 20rpx;
  padding: 24rpx;
  margin-bottom: 20rpx;
  box-shadow: var(--shadow-sm);
  border: 2rpx solid rgba(241, 227, 188, 0.6);
}
.order-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.order-user {
  display: flex;
  align-items: center;
}
.user-avatar {
  width: 56rpx;
  height: 56rpx;
  border-radius: 50%;
  background: var(--yellow-mist);
  margin-right: 12rpx;
}
.user-name {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--ink);
}
.order-time {
  font-size: 24rpx;
  color: var(--tan);
  font-variant-numeric: tabular-nums;
}
.order-items {
  font-size: 28rpx;
  color: var(--ink);
  margin: 16rpx 0 8rpx;
  line-height: 1.6;
}
.order-remark {
  font-size: 24rpx;
  color: var(--tan);
}
.order-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 2rpx dashed var(--line);
  margin-top: 16rpx;
  padding-top: 16rpx;
}
.order-total {
  display: flex;
  align-items: baseline;
}
.total-label {
  font-size: 24rpx;
  color: var(--tan);
  margin-right: 8rpx;
}
.total-num {
  font-size: 32rpx;
  color: var(--caramel);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.order-actions {
  display: flex;
  align-items: center;
}
.act {
  font-size: 26rpx;
  padding: 10rpx 28rpx;
  border-radius: 28rpx;
  margin-left: 14rpx;
  font-weight: 600;
}
.act.done {
  background: linear-gradient(135deg, var(--yellow), var(--amber));
  color: var(--ink);
  box-shadow: var(--shadow-pop);
}
.act.cancel {
  background: var(--cream-deep);
  color: var(--tan);
}
.status-text {
  font-size: 26rpx;
  color: var(--tan);
}
</style>
