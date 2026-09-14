<script setup lang="ts">
/**
 * 订单管理（店主端）—— 原 pages/admin/orders 迁移
 *
 * 与原实现的差异：
 *  - allOrders + orders 两份数据（一份全量、一份筛选结果）合并为
 *    「allOrders 是唯一数据源，orders 是 computed」，去掉 applyFilter 手工同步。
 *  - timeText / itemsText / statusText 用 computed 预计算，模板里不再调用函数。
 */
import { computed, ref } from 'vue'
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app'
import { callApi } from '@/utils/cloud'
import { formatTime, statusInfo } from '@/utils/format'
import { useUserStore } from '@/stores/user'
import type { Order, OrderStatus } from '@/types/api'

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

const userStore = useUserStore()

const allOrders = ref<Order[]>([])
const filter = ref<Filter['key']>('all')
const loading = ref(true)

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

const orders = computed(() =>
  filter.value === 'all' ? viewOrders.value : viewOrders.value.filter((o) => o.status === filter.value)
)

onShow(() => {
  load()
})

async function load() {
  try {
    await userStore.login()
    const res = await callApi<Order[]>('order.listAll')
    allOrders.value = res.data || []
  } catch (e) {
    console.error(e)
  }
  loading.value = false
}

onPullDownRefresh(() => {
  load().then(() => uni.stopPullDownRefresh())
})

async function changeStatus(status: OrderStatus, id: string) {
  if (busy) return
  busy = true
  uni.showLoading({ title: '更新中...', mask: true })
  try {
    const res = await callApi('order.updateStatus', { id, status })
    uni.hideLoading()
    if (res.code === 0) {
      uni.showToast({ title: '已更新', icon: 'success' })
      await load()
    } else {
      uni.showToast({ title: res.msg || '操作失败', icon: 'none' })
    }
  } catch (e) {
    uni.hideLoading()
    uni.showToast({ title: '操作失败', icon: 'none' })
  }
  busy = false
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
        @tap="filter = f.key"
      >{{ f.text }}</view>
    </view>

    <template v-if="orders.length > 0">
      <view v-for="o in orders" :key="o._id" class="order-card">
        <view class="order-head">
          <view class="order-user">
            <image v-if="o.avatarUrl" class="user-avatar" :src="o.avatarUrl" mode="aspectFill" />
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
    </template>

    <view v-else-if="loading" class="loading-box">
      <view class="loading-icon"></view>
      <text>加载中...</text>
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
