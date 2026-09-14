<script setup lang="ts">
/**
 * 点餐统计（店主端）—— 原 pages/admin/stats 迁移
 *
 * 与原实现的差异：概览三项 + 排行榜条形宽度改用 computed 预计算
 * （原实现是拿到数据后手工 forEach 回填 barWidth，再 setData 一次）。
 */
import { computed, ref } from 'vue'
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app'
import { callApi } from '@/utils/cloud'
import { useUserStore } from '@/stores/user'

interface RankDish {
  _id: string
  name: string
  orderCount: number
}

interface StatsData {
  totalOrders: number
  totalCount: number
  totalFriends: number
  dishes: RankDish[]
}

const userStore = useUserStore()

const data = ref<StatsData | null>(null)
const loading = ref(true)

const totalOrders = computed(() => data.value?.totalOrders || 0)
const totalCount = computed(() => data.value?.totalCount || 0)
const totalFriends = computed(() => data.value?.totalFriends || 0)

/** 排行榜：条形宽度按最高次数归一化（最大值为 0 时统一按 1 兜底，避免除零） */
const dishes = computed(() => {
  const list = data.value?.dishes || []
  const max = Math.max(1, ...list.map((d) => d.orderCount || 0))
  return list.map((d) => ({
    ...d,
    barWidth: Math.round(((d.orderCount || 0) / max) * 1000) / 10
  }))
})

onShow(() => {
  load()
})

async function load() {
  try {
    await userStore.login()
    const res = await callApi<StatsData>('stats.get')
    data.value = (res.data || {}) as StatsData
  } catch (e) {
    console.error(e)
  }
  loading.value = false
}

onPullDownRefresh(() => {
  load().then(() => uni.stopPullDownRefresh())
})
</script>

<template>
  <view class="page">
    <view v-if="loading" class="loading-box">
      <view class="loading-icon"></view>
      <text>加载中...</text>
    </view>

    <template v-else>
      <!-- 概览 -->
      <view class="overview">
        <view class="ov-card">
          <text class="ov-num">{{ totalOrders }}</text>
          <text class="ov-label">订单总数</text>
        </view>
        <view class="ov-card">
          <text class="ov-num">{{ totalCount }}</text>
          <text class="ov-label">累计点餐次数</text>
        </view>
        <view class="ov-card">
          <text class="ov-num">{{ totalFriends }}</text>
          <text class="ov-label">点餐成员</text>
        </view>
      </view>

      <!-- 菜品点餐次数排行 -->
      <view class="card">
        <view class="section-title">菜品点餐次数排行</view>
        <template v-if="dishes.length > 0">
          <view v-for="(d, i) in dishes" :key="d._id" class="rank-item">
            <view class="rank-top">
              <text class="rank-index" :class="{ top: i < 3 }">{{ i + 1 }}</text>
              <text class="rank-name">{{ d.name }}</text>
              <text class="rank-count">{{ d.orderCount }} 次</text>
            </view>
            <view class="rank-bar-bg">
              <view class="rank-bar" :style="{ width: d.barWidth + '%' }"></view>
            </view>
          </view>
        </template>
        <view v-else class="empty">
          <text class="icon">📊</text>
          暂无数据
        </view>
      </view>
    </template>
  </view>
</template>

<style scoped>
.page {
  padding: 20rpx;
}
.overview {
  display: flex;
  margin-bottom: 20rpx;
}
.ov-card {
  flex: 1;
  background: var(--paper);
  border-radius: 20rpx;
  padding: 30rpx 0;
  text-align: center;
  margin-right: 16rpx;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-sm);
}
.ov-card:last-child {
  margin-right: 0;
}
.ov-num {
  font-size: 44rpx;
  font-weight: 800;
  color: var(--caramel);
  font-variant-numeric: tabular-nums;
  letter-spacing: 1rpx;
}
.ov-label {
  font-size: 24rpx;
  color: var(--tan);
  margin-top: 8rpx;
}

.rank-item {
  padding: 20rpx 0;
  border-bottom: 2rpx dashed var(--line);
}
.rank-item:last-child {
  border-bottom: none;
}
.rank-top {
  display: flex;
  align-items: center;
  margin-bottom: 14rpx;
}
.rank-index {
  width: 44rpx;
  height: 44rpx;
  border-radius: 50%;
  background: var(--yellow-soft);
  color: var(--tan);
  font-size: 24rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 16rpx;
  font-weight: 700;
}
.rank-index.top {
  background: linear-gradient(135deg, var(--yellow), var(--amber));
  color: var(--ink);
  box-shadow: var(--shadow-pop);
}
.rank-name {
  flex: 1;
  font-size: 28rpx;
  color: var(--ink);
}
.rank-count {
  font-size: 26rpx;
  color: var(--caramel);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.rank-bar-bg {
  height: 16rpx;
  background: var(--cream-deep);
  border-radius: 8rpx;
  overflow: hidden;
}
.rank-bar {
  height: 100%;
  background: linear-gradient(90deg, var(--yellow), var(--amber));
  border-radius: 8rpx;
  transition: width 0.5s;
}
</style>
