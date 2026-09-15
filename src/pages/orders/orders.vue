<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { onPullDownRefresh, onReachBottom, onShow } from '@dcloudio/uni-app'
import { callApi } from '@/utils/cloud'
import { formatTime } from '@/utils/format'
import { SUBSCRIBE_TEMPLATE_ID } from '@/config'
import { requestOrderSubscribe } from '@/utils/subscribe'
import { useUserStore } from '@/stores/user'
import type { Order, PagedOrders } from '@/types/api'

/** 订单的展示态（在原 Order 上补预格式化的字段） */
interface OrderView extends Order {
  timeText: string
  dateKey: string
  itemsText: string
}

type FilterKey = 'mine' | 'all'
type TabKey = 'orders' | 'diary'

/** 一页拉多少条（与云函数 ORDER_PAGE_DEFAULT 对齐） */
const PAGE_SIZE = 20

/**
 * 「我下单的」与「全部」各自维护一份分页状态。
 *
 * ⚠️ 分页之后**不能**再在前端做日期筛选 —— 那只会筛「已加载的那一页」，
 * 条数是错的。所以日期范围随请求发给云函数（见 fetchList），
 * summary 也改用服务端返回的 total，而不是本地数组长度。
 */
interface ListState {
  list: OrderView[]
  total: number
  page: number
  hasMore: boolean
  loading: boolean
  /** 是否成功加载过一次 —— 决定当前显示骨架屏还是空态 */
  loadedOnce: boolean
  /**
   * 请求代号。切换筛选 / 改日期范围会打断正在飞的请求，
   * 回包时用它判断「我这次是不是已经被更新的请求取代了」，
   * 避免旧数据后到把新数据覆盖掉。
   */
  seq: number
}

function makeState(): ListState {
  return {
    list: [],
    total: 0,
    page: 0,
    hasMore: false,
    // ⚠️ 初值必须是 true：loading 计算属性是「还没加载过 && 正在加载」，
    // 若这里给 false，首帧就会先闪一下「还没有订单哦」再换骨架屏。
    loading: true,
    loadedOnce: false,
    seq: 0
  }
}

const states = reactive<Record<FilterKey, ListState>>({
  mine: makeState(),
  all: makeState()
})

const userStore = useUserStore()

/** 未推送订单数：由 order.listAll 单独统计返回，不受分页影响（原实现是数本地数组长度） */
const unnotifiedCount = ref(0)

// ⚠️ 初始值必须直接取本地缓存的角色，不能等 loadOrders() 里 await 登录后再切。
// 否则店主每次进页面都会先渲染一遍「我下单的」列表再跳成「全部」——就是那个角色闪烁。
const filter = ref<FilterKey>(userStore.isOwner ? 'all' : 'mine')
const activeTab = ref<TabKey>('orders')

const dateStart = ref('')
const dateEnd = ref('')
const dateRangeText = ref('')
const showDateRangePopup = ref(false)

/** 当前筛选维度对应的列表状态 */
const activeState = computed(() => states[filter.value])
const orders = computed(() => activeState.value.list)
/** 骨架屏只在「这份列表还没成功加载过」时显示；已有数据时是底部「加载更多」 */
const loading = computed(() => !activeState.value.loadedOnce && activeState.value.loading)
const loadingMore = computed(() => activeState.value.loadedOnce && activeState.value.loading)
/** 当前筛选维度是否还有下一页 */
const hasMore = computed(() => activeState.value.hasMore)

/** 底部「加载更多」：与上拉触底走同一条路径 */
function loadMore() {
  fetchList(filter.value, false)
}

/** 对应原 Page 实例上的 this._initFilter（setup 只执行一次，等价于实例属性） */
let filterInited = userStore.isOwner

function pad(n: number) {
  return n < 10 ? '0' + n : '' + n
}

function toDateKey(input?: string | { $date: string } | Date | null): string {
  let d: Date
  if (input instanceof Date) d = input
  else if (input && typeof input === 'object' && '$date' in input) d = new Date(input.$date)
  else if (input) d = new Date(input as string)
  else d = new Date()
  if (isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function toView(o: Order): OrderView {
  return {
    ...o,
    timeText: formatTime(o.createdAt),
    dateKey: toDateKey(o.createdAt as unknown as string),
    itemsText: (o.items || []).map((it) => `${it.name}×${it.quantity}`).join('、')
  }
}

/** 对应原 data.summary：现在是**服务端**返回的命中总条数（不是已加载条数） */
const summary = computed(() => activeState.value.total)

/**
 * 拉一页订单。
 *
 * reset = true 从第 1 页重来（首次进入 / 下拉刷新 / 切筛选 / 改日期范围）；
 * reset = false 追加下一页（上拉加载更多）。
 *
 * ⚠️ 日期范围必须发给云函数：分页之后如果还在前端 filter，就只筛了「已加载的
 * 那一页」，得出的条数是错的（原来 ≤100 条全加载时没这个问题）。
 */
async function fetchList(key: FilterKey, reset: boolean) {
  const st = states[key]
  // 追加下一页时不允许并发（会重复追加）；重置请求则允许打断上一次
  if (!reset && (st.loading || !st.hasMore || st.page === 0)) return
  if (reset) st.seq += 1
  const seq = st.seq

  st.loading = true
  try {
    const action = key === 'all' ? 'order.listAll' : 'order.listMine'
    const res = await callApi<PagedOrders>(action, {
      page: reset ? 1 : st.page + 1,
      pageSize: PAGE_SIZE,
      startDate: dateStart.value || undefined,
      endDate: dateEnd.value || undefined
    })
    const data = res.data
    if (res.code !== 0 || !data) throw new Error(res.msg || '加载失败')
    // 期间又发起了更新的请求（切筛选 / 改日期）→ 丢弃这次结果
    if (seq !== st.seq) return

    const rows = (data.list || []).map(toView)
    st.list = reset ? rows : st.list.concat(rows)
    st.total = data.total
    st.page = data.page
    st.hasMore = data.hasMore
    st.loadedOnce = true
    // 未推送条数由服务端单独统计（不受分页与日期筛选影响），只有 listAll 会返回。
    // ⚠️ 它通常不为 0，**不代表出错**：订阅消息是「授权一次只能推一单」，
    // 店主授权后第一单就用掉了，之后每单 notified 都是 false —— 这是「该补授权了」的信号。
    if (typeof data.unnotified === 'number') unnotifiedCount.value = data.unnotified
  } catch (e) {
    console.error(e)
    if (seq === st.seq && reset) uni.showToast({ title: '订单加载失败', icon: 'none' })
  } finally {
    // 只有「最新那次请求」才有资格把 loading 关掉，否则会把后发请求的状态提前结束
    if (seq === st.seq) st.loading = false
  }
}

async function loadOrders(reset = true) {
  try {
    // 进入订单页时强制刷新用户，避免「全部」tab 误判店主身份
    const user = await userStore.login(true)

    // 店主不会自己下单，首次进入默认看「全部」；之后尊重用户手动选择
    if (user.role === 'owner' && !filterInited) {
      filterInited = true
      filter.value = 'all'
    }
    // 反向兜底：缓存里是店主、云端已改成普通成员时，把「全部」拉回「我下单的」
    if (user.role !== 'owner' && filter.value === 'all') {
      filter.value = 'mine'
    }

    const tasks = [fetchList('mine', reset)]
    if (user.role === 'owner') tasks.push(fetchList('all', reset))
    await Promise.all(tasks)
  } catch (e) {
    console.error(e)
    uni.showToast({ title: '加载失败', icon: 'none' })
    // 登录就失败时列表请求根本没发出去，得把 loading 收干净，
    // 否则骨架屏会一直转下去（loading 计算属性是「未加载过 && 正在加载」）
    states.mine.loading = false
    states.all.loading = false
  }
}

onShow(() => {
  loadOrders(true)
})

onPullDownRefresh(() => {
  loadOrders(true).then(() => uni.stopPullDownRefresh())
})

/** 上拉触底：给当前列表追加下一页 */
onReachBottom(() => {
  fetchList(filter.value, false)
})

function switchFilter(key: FilterKey) {
  if (key === filter.value) return
  filter.value = key
  // 这份列表还没加载过就先拉第一页（例如店主切到「我下单的」）
  if (!states[key].loadedOnce) fetchList(key, true)
}

function switchTab(key: TabKey) {
  activeTab.value = key
}

function openDateRangePopup() {
  showDateRangePopup.value = true
}

function closeDateRangePopup() {
  showDateRangePopup.value = false
}

function pickDateStart(e: { detail: { value: string } }) {
  dateStart.value = e.detail.value
}

function pickDateEnd(e: { detail: { value: string } }) {
  dateEnd.value = e.detail.value
}

function pickDateQuick(range: 'all' | 'week' | 'month') {
  if (range === 'all') {
    dateStart.value = ''
    dateEnd.value = ''
    return
  }
  const today = new Date()
  const start = new Date()
  if (range === 'week') start.setDate(today.getDate() - 6) // 近一周：含今天共 7 天
  else if (range === 'month') start.setDate(today.getDate() - 29) // 近一月：含今天共 30 天
  dateStart.value = toDateKey(start)
  dateEnd.value = toDateKey(today)
}

function confirmDateRange() {
  if (dateStart.value && dateEnd.value && dateStart.value > dateEnd.value) {
    uni.showToast({ title: '开始日期不能晚于结束日期', icon: 'none' })
    return
  }
  let text = '日期范围'
  if (dateStart.value && dateEnd.value) {
    text =
      dateStart.value === dateEnd.value
        ? dateStart.value
        : `${dateStart.value} ~ ${dateEnd.value}`
  } else if (dateStart.value) {
    text = `${dateStart.value} 起`
  } else if (dateEnd.value) {
    text = `至 ${dateEnd.value}`
  }
  dateRangeText.value = text
  showDateRangePopup.value = false
  // 日期范围是服务端筛选条件，改完必须从第 1 页重新拉
  fetchList(filter.value, true)
}

function clearDate() {
  dateStart.value = ''
  dateEnd.value = ''
  dateRangeText.value = ''
  fetchList(filter.value, true)
}

function resubscribe() {
  if (!SUBSCRIBE_TEMPLATE_ID || SUBSCRIBE_TEMPLATE_ID === 'YOUR_TEMPLATE_ID') {
    uni.showModal({
      title: '未配置模板',
      content: '请先在 src/config.ts 中填入订阅消息模板 ID',
      showCancel: false
    })
    return
  }
  requestOrderSubscribe()
}

function preventTouchMove() {}
</script>

<template>
  <view class="page">
    <!-- 非店主：品牌 banner -->
    <view v-if="userStore.roleReady && !userStore.isOwner" class="brand-banner">
      <view class="brand-left">
        <image class="brand-logo" src="/static/images/app-logo.jpg" mode="aspectFit" />
        <view class="brand-text">
          <view class="brand-title">订单小记</view>
          <view class="brand-sub">每一单，都是日常</view>
        </view>
      </view>
      <view class="brand-stamp">
        <text class="stamp-icon">🧾</text>
        <text class="stamp-text">小账本</text>
      </view>
    </view>

    <!-- 店主：新订单提醒。有未推送订单时切成警示态，引导补一次订阅授权 -->
    <view
      v-if="userStore.roleReady && userStore.isOwner"
      class="remind-card"
      :class="{ warn: unnotifiedCount > 0 }"
      hover-class="cate-press"
      hover-stay-time="100"
      @tap="resubscribe"
    >
      <view class="remind-left">
        <view class="remind-title-row">
          <text class="remind-icon">🔔</text>
          <text class="remind-title">{{ unnotifiedCount > 0 ? `${unnotifiedCount} 单没推到微信` : '新订单提醒' }}</text>
          <text v-if="unnotifiedCount > 0" class="remind-badge">未推送</text>
        </view>
        <text class="remind-desc">{{ unnotifiedCount > 0 ? '订阅授权一次只能推一单，点这里补一次' : '朋友下单后，你的微信会收到服务通知' }}</text>
      </view>
      <view class="remind-btn">{{ unnotifiedCount > 0 ? '补订阅' : '开启提醒' }}</view>
    </view>

    <!-- 筛选 chip 行 -->
    <view class="filter-bar">
      <view
        class="chip filter-chip"
        :class="{ active: filter === 'mine' }"
        hover-class="chip-press"
        hover-stay-time="80"
        @tap="switchFilter('mine')"
      >
        <text>我下单的</text>
      </view>
      <view
        v-if="userStore.roleReady && userStore.isOwner"
        class="chip filter-chip"
        :class="{ active: filter === 'all' }"
        hover-class="chip-press"
        hover-stay-time="80"
        @tap="switchFilter('all')"
      >
        <text>全部</text>
      </view>
      <view
        class="chip date-chip"
        hover-class="chip-press"
        hover-stay-time="80"
        @tap="openDateRangePopup"
      >
        <text class="date-chip-text">{{ dateRangeText || '日期范围' }}</text>
        <text class="chip-arrow">▾</text>
      </view>
      <view
        v-if="dateStart || dateEnd"
        class="chip clear-chip"
        hover-class="chip-press"
        hover-stay-time="80"
        @tap="clearDate"
      >
        <text>清除</text>
      </view>
    </view>

    <!-- 统计 + Tab 切换 -->
    <view class="summary-row">
      <view class="summary-text">
        {{ filter === 'mine' ? '我下单的' : '全部订单' }} · 共
        <text class="summary-num">{{ summary }}</text>
        单
      </view>
      <view class="tab-group">
        <view
          class="tab-pill"
          :class="{ active: activeTab === 'orders' }"
          hover-class="chip-press"
          hover-stay-time="80"
          @tap="switchTab('orders')"
        >订单</view>
        <view
          class="tab-pill"
          :class="{ active: activeTab === 'diary' }"
          hover-class="chip-press"
          hover-stay-time="80"
          @tap="switchTab('diary')"
        >美食日记</view>
      </view>
    </view>

    <!-- 内容区 -->
    <template v-if="orders.length > 0">
      <view v-if="activeTab === 'orders'">
        <view v-for="item in orders" :key="item._id" class="order-card">
          <view class="order-head">
            <view class="order-head-left">
              <view class="order-dot"></view>
              <text class="order-time">{{ item.timeText }}</text>
              <text
                v-if="filter === 'all' && item.nickname"
                class="order-nickname"
              >{{ item.nickname }}</text>
            </view>
          </view>
          <view class="order-items">{{ item.itemsText }}</view>
          <view v-if="item.remark" class="order-foot">
            <text class="order-remark">备注：{{ item.remark }}</text>
          </view>
        </view>
      </view>

      <view v-if="activeTab === 'diary'" class="diary">
        <view v-for="item in orders" :key="item._id" class="diary-card">
          <view class="diary-tape"></view>
          <view class="diary-time">{{ item.timeText }}</view>
          <view class="diary-items">{{ item.itemsText }}</view>
          <view v-if="item.remark" class="diary-remark">「{{ item.remark }}」</view>
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
          @tap="loadMore"
        >加载更多</text>
        <text v-else>已显示全部 {{ summary }} 单</text>
      </view>
    </template>

    <view v-else-if="loading" class="sk-panel">
      <view class="sk-head">
        <view class="sk-dots">
          <view class="sk-dot"></view>
          <view class="sk-dot"></view>
          <view class="sk-dot"></view>
        </view>
        <text class="sk-head-text">正在翻账本…</text>
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
      <image class="empty-emoji" src="/static/images/app-logo.png" mode="aspectFit" />
      <text class="empty-text">还没有订单哦</text>
    </view>

    <!-- 日期范围弹窗 -->
    <view v-if="showDateRangePopup" class="date-mask" @tap="closeDateRangePopup">
      <view class="date-dialog" @tap.stop="preventTouchMove">
        <view class="date-title">选择日期范围</view>

        <view class="date-quick-row">
          <view
            class="date-quick"
            hover-class="chip-press"
            hover-stay-time="80"
            @tap="pickDateQuick('all')"
          >全部</view>
          <view
            class="date-quick"
            hover-class="chip-press"
            hover-stay-time="80"
            @tap="pickDateQuick('week')"
          >近一周</view>
          <view
            class="date-quick"
            hover-class="chip-press"
            hover-stay-time="80"
            @tap="pickDateQuick('month')"
          >近一月</view>
        </view>

        <view class="date-pickers">
          <picker mode="date" :value="dateStart" @change="pickDateStart">
            <view class="date-picker-cell">
              <text class="date-picker-label">开始日期</text>
              <text class="date-picker-value" :class="{ placeholder: !dateStart }">
                {{ dateStart || '不限' }}
              </text>
            </view>
          </picker>
          <text class="date-sep">→</text>
          <picker mode="date" :value="dateEnd" @change="pickDateEnd">
            <view class="date-picker-cell">
              <text class="date-picker-label">结束日期</text>
              <text class="date-picker-value" :class="{ placeholder: !dateEnd }">
                {{ dateEnd || '不限' }}
              </text>
            </view>
          </picker>
        </view>

        <view class="date-actions">
          <view
            class="date-btn cancel"
            hover-class="text-press"
            hover-stay-time="80"
            @tap="closeDateRangePopup"
          >取消</view>
          <view
            class="date-btn ok"
            hover-class="cta-press"
            hover-stay-time="80"
            @tap="confirmDateRange"
          >确认</view>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
/**
 * 订单页 · 手作食堂视觉
 * 记忆点：小账本印章 · 时间线订单卡 · 纸胶带美食日记
 */
.page {
  min-height: 100vh;
  background-color: var(--cream);
  background-image: radial-gradient(rgba(245, 166, 35, 0.07) 2rpx, transparent 2rpx);
  background-size: 48rpx 48rpx;
  padding-bottom: 40rpx;
}

/* ========== 品牌 banner（非店主显示） ========== */
.brand-banner {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28rpx 30rpx 32rpx;
  background: linear-gradient(135deg, #F7C948 0%, #F5A623 100%);
  color: var(--brown);
  overflow: hidden;
  animation: banner-drop 520ms var(--ease-spring) both;
}
.brand-banner::before {
  content: '';
  position: absolute;
  right: -80rpx;
  top: -120rpx;
  width: 320rpx;
  height: 320rpx;
  border-radius: 50%;
  background: rgba(255, 253, 246, 0.18);
}
.brand-banner::after {
  content: '';
  position: absolute;
  left: -60rpx;
  bottom: -110rpx;
  width: 240rpx;
  height: 240rpx;
  border-radius: 50%;
  background: rgba(107, 68, 35, 0.08);
}
.brand-left {
  display: flex;
  align-items: center;
  position: relative;
  z-index: 1;
}
.brand-logo {
  width: 88rpx;
  height: 88rpx;
  border-radius: 50%;
  background: #fff;
  margin-right: 20rpx;
  border: 4rpx solid rgba(255, 253, 246, 0.7);
  box-shadow: 0 6rpx 16rpx rgba(107, 68, 35, 0.18);
  transform: rotate(-6deg);
}
.brand-text {
  display: flex;
  flex-direction: column;
}
.brand-title {
  font-size: 38rpx;
  font-weight: 800;
  letter-spacing: 3rpx;
  color: var(--brown);
}
.brand-sub {
  font-size: 22rpx;
  color: rgba(74, 47, 24, 0.72);
  margin-top: 6rpx;
  letter-spacing: 1rpx;
}
.brand-stamp {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 104rpx;
  height: 104rpx;
  border-radius: 50%;
  border: 3rpx dashed rgba(255, 253, 246, 0.9);
  background: rgba(255, 253, 246, 0.28);
  transform: rotate(8deg);
  animation: stamp-in 500ms var(--ease-spring) 320ms both;
}
.stamp-icon {
  font-size: 38rpx;
  line-height: 1.1;
}
.stamp-text {
  font-size: 20rpx;
  font-weight: 700;
  letter-spacing: 2rpx;
  color: var(--brown);
  margin-top: 2rpx;
}

/* ========== 新订单提醒（店主顶部） ========== */
.remind-card {
  position: relative;
  display: flex;
  align-items: center;
  padding: 28rpx 30rpx 32rpx;
  background: linear-gradient(135deg, #F7C948 0%, #F5A623 100%);
  color: var(--brown);
  overflow: hidden;
  animation: banner-drop 520ms var(--ease-spring) both;
}
.remind-card::before {
  content: '';
  position: absolute;
  right: -80rpx;
  top: -120rpx;
  width: 320rpx;
  height: 320rpx;
  border-radius: 50%;
  background: rgba(255, 253, 246, 0.18);
}
.remind-left {
  flex: 1;
  min-width: 0;
  position: relative;
  z-index: 1;
}
.remind-title-row {
  display: flex;
  align-items: center;
}
.remind-icon {
  font-size: 34rpx;
  margin-right: 10rpx;
  animation: ring-swing 2.8s ease-in-out infinite;
}
.remind-title {
  font-size: 32rpx;
  font-weight: 800;
  letter-spacing: 2rpx;
  color: var(--brown);
  display: block;
}
.remind-desc {
  font-size: 22rpx;
  color: rgba(74, 47, 24, 0.72);
  display: block;
  margin-top: 6rpx;
}
.remind-btn {
  position: relative;
  z-index: 1;
  flex-shrink: 0;
  padding: 14rpx 30rpx;
  background: var(--paper);
  color: var(--caramel);
  border-radius: var(--r-pill);
  font-size: 26rpx;
  font-weight: 700;
  box-shadow: 0 4rpx 12rpx rgba(107, 68, 35, 0.18);
}

/**
 * 警示态：有订单没推到微信。
 *
 * 刻意**不换成橙底白字** —— #F5A623 上放白字对比只有 2:1，达不到标准，
 * 这也是设计系统里明令禁止的组合。改成「浅黄纸面通知条」：底色 --yellow-soft
 * 配 --brown/--ink 深棕字（7.6:1），靠虚线底边 + 棕底奶字徽章做区分，
 * CTA 反而升级成标准黄橙渐变按钮，视线自然落到「补订阅」上。
 */
.remind-card.warn {
  background: var(--yellow-soft);
  border-bottom: 4rpx dashed rgba(217, 130, 43, 0.55);
}
/* 关掉装饰性的暖光圆，保持"通知条"的朴素感 */
.remind-card.warn::before {
  display: none;
}
.remind-card.warn .remind-btn {
  background: linear-gradient(135deg, var(--yellow), var(--amber));
  color: var(--ink);
}
.remind-badge {
  flex-shrink: 0;
  margin-left: 12rpx;
  padding: 2rpx 14rpx;
  font-size: 20rpx;
  font-weight: 700;
  letter-spacing: 1rpx;
  color: var(--cream);
  background: var(--brown);
  border-radius: var(--r-pill);
}

/* ========== 筛选 chip 行 ========== */
.filter-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  padding: 24rpx 24rpx 16rpx;
  gap: 16rpx;
  animation: fade-up 380ms var(--ease-out) 120ms both;
}
.chip {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  padding: 10rpx 24rpx;
  font-size: 26rpx;
  border-radius: var(--r-pill);
  background: var(--paper);
  color: var(--caramel);
  border: 2rpx solid var(--line);
  transition: transform var(--dur-fast) ease-out;
}
.chip.active {
  background: linear-gradient(135deg, var(--yellow), var(--amber));
  color: var(--ink);
  border-color: transparent;
  font-weight: 700;
  box-shadow: var(--shadow-pop);
}
.chip-arrow {
  font-size: 20rpx;
  margin-left: 8rpx;
  color: var(--caramel);
}
.date-chip {
  color: var(--tan);
  border-color: var(--yellow-mist);
  max-width: 100%;
}
.date-chip-text {
  white-space: normal;
  word-break: break-all;
}
.clear-chip {
  color: var(--tan);
  border-color: var(--line);
}

/* ========== 统计 + Tab 切换 ========== */
.summary-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8rpx 30rpx 24rpx;
  animation: fade-up 380ms var(--ease-out) 180ms both;
}
.summary-text {
  font-size: 26rpx;
  color: var(--tan);
}
.summary-num {
  color: var(--caramel);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.tab-group {
  display: flex;
  background: var(--paper);
  border-radius: var(--r-pill);
  padding: 6rpx;
  border: 2rpx solid var(--line);
}
.tab-pill {
  padding: 8rpx 28rpx;
  font-size: 24rpx;
  color: var(--tan);
  border-radius: var(--r-pill);
  transition: color var(--dur-fast) ease-out, background-color var(--dur-fast) ease-out;
}
.tab-pill.active {
  background: linear-gradient(135deg, var(--yellow), var(--amber));
  color: var(--ink);
  font-weight: 700;
}

/* ========== 订单卡片（时间线感） ========== */
.order-card {
  margin: 0 24rpx 20rpx;
  background: var(--paper);
  border-radius: 28rpx 10rpx 28rpx 28rpx; /* 器皿：右上角收紧 */
  padding: 24rpx;
  box-shadow: var(--shadow-sm);
  border: 2rpx solid rgba(241, 227, 188, 0.6);
  animation: fade-up 420ms var(--ease-out) both;
}
/* 入场错峰：前 5 张递进，之后统一 */
.order-card:nth-child(2) { animation-delay: 60ms; }
.order-card:nth-child(3) { animation-delay: 120ms; }
.order-card:nth-child(4) { animation-delay: 180ms; }
.order-card:nth-child(5) { animation-delay: 240ms; }
.order-card:nth-child(n+6) { animation-delay: 300ms; }
.order-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.order-head-left {
  display: flex;
  align-items: center;
  min-width: 0;
}
.order-dot {
  width: 14rpx;
  height: 14rpx;
  border-radius: 50% 50% 4rpx 50%;
  background: var(--amber);
  transform: rotate(45deg);
  margin-right: 12rpx;
  flex-shrink: 0;
}
.order-time {
  font-size: 24rpx;
  color: var(--tan);
  font-variant-numeric: tabular-nums;
}
.order-nickname {
  font-size: 24rpx;
  color: var(--caramel);
  font-weight: 700;
  margin-left: 14rpx;
  padding: 2rpx 14rpx;
  background: var(--yellow-soft);
  border-radius: var(--r-pill);
}
.order-items {
  font-size: 28rpx;
  color: var(--ink);
  margin: 16rpx 0;
  line-height: 1.6;
}
.order-foot {
  border-top: 2rpx dashed var(--line);
  padding-top: 14rpx;
}
.order-remark {
  font-size: 24rpx;
  color: var(--tan);
}

/* ========== 美食日记（纸胶带手账） ========== */
.diary {
  padding: 24rpx 24rpx 0;
}
.diary-card {
  position: relative;
  background: var(--paper);
  border-radius: var(--r-bowl);
  padding: 30rpx 24rpx 24rpx;
  margin-bottom: 28rpx;
  border: 2rpx dashed var(--line);
  box-shadow: var(--shadow-sm);
  animation: fade-up 420ms var(--ease-out) both;
}
.diary-card:nth-child(2) { animation-delay: 80ms; }
.diary-card:nth-child(3) { animation-delay: 160ms; }
.diary-card:nth-child(4) { animation-delay: 240ms; }
.diary-card:nth-child(n+5) { animation-delay: 320ms; }
/* 纸胶带：贴在卡片顶部中央，微微歪斜 */
.diary-tape {
  position: absolute;
  top: -14rpx;
  left: 50%;
  width: 132rpx;
  height: 32rpx;
  margin-left: -66rpx;
  transform: rotate(-3deg);
  background: repeating-linear-gradient(
    45deg,
    rgba(247, 201, 72, 0.85) 0 16rpx,
    rgba(245, 166, 35, 0.7) 16rpx 32rpx
  );
  border-radius: 4rpx;
  box-shadow: 0 2rpx 6rpx rgba(107, 68, 35, 0.12);
}
.diary-time {
  font-size: 22rpx;
  color: var(--tan);
  font-variant-numeric: tabular-nums;
}
.diary-items {
  font-size: 28rpx;
  color: var(--ink);
  margin: 12rpx 0;
  line-height: 1.6;
}
.diary-remark {
  font-size: 24rpx;
  color: var(--caramel);
  font-style: italic;
}

/* ========== 空状态 ========== */
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 200rpx 0;
}
.empty-emoji {
  width: 200rpx;
  height: 200rpx;
  margin-bottom: 16rpx;
  animation: float-y 2.4s ease-in-out infinite;
}
.empty-text {
  font-size: 28rpx;
  color: var(--tan);
  letter-spacing: 1rpx;
}

/* ========== 分页尾巴 ========== */
.more-hint {
  padding: 8rpx 0 40rpx;
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

/* ========== 日期范围弹窗 ========== */
.date-mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background: rgba(74, 47, 24, 0.5);
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: mask-fade 240ms ease-out both;
}
.date-dialog {
  width: 640rpx;
  background: var(--paper);
  border-radius: var(--r-plate);
  padding: 36rpx 40rpx 32rpx;
  display: flex;
  flex-direction: column;
  animation: pop-in 360ms var(--ease-spring) both;
}
.date-title {
  font-size: 32rpx;
  font-weight: 800;
  color: var(--ink);
  letter-spacing: 2rpx;
  text-align: center;
  margin-bottom: 28rpx;
}
.date-quick-row {
  display: flex;
  gap: 16rpx;
  margin-bottom: 28rpx;
}
.date-quick {
  flex: 1;
  text-align: center;
  padding: 16rpx 0;
  font-size: 26rpx;
  color: var(--caramel);
  background: var(--yellow-soft);
  border-radius: 16rpx;
  font-weight: 600;
  transition: transform var(--dur-fast) ease-out;
}
.date-pickers {
  display: flex;
  align-items: center;
  margin-bottom: 32rpx;
}
.date-picker-cell {
  flex: 1;
  background: var(--yellow-soft);
  border-radius: 16rpx;
  padding: 18rpx 20rpx;
}
.date-picker-label {
  display: block;
  font-size: 22rpx;
  color: var(--tan);
  margin-bottom: 6rpx;
}
.date-picker-value {
  display: block;
  font-size: 30rpx;
  font-weight: 700;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.date-picker-value.placeholder {
  color: var(--tan);
  font-weight: 400;
}
.date-sep {
  font-size: 32rpx;
  color: var(--sand);
  margin: 0 14rpx;
}
.date-actions {
  display: flex;
}
.date-btn {
  flex: 1;
  height: 80rpx;
  line-height: 80rpx;
  text-align: center;
  border-radius: var(--r-pill);
  font-size: 30rpx;
  font-weight: 700;
  transition: transform var(--dur-fast) ease-out;
}
.date-btn.cancel {
  background: var(--cream-deep);
  color: var(--tan);
  margin-right: 20rpx;
}
.date-btn.ok {
  background: linear-gradient(135deg, #F7C948, #F5A623);
  color: var(--ink);
  box-shadow: var(--shadow-pop);
}

/* ========== 动效 ========== */
@keyframes banner-drop {
  from { opacity: 0; transform: translateY(-36rpx); }
  to { opacity: 1; transform: none; }
}
@keyframes stamp-in {
  0% { opacity: 0; transform: rotate(8deg) scale(1.8); }
  60% { opacity: 1; transform: rotate(8deg) scale(0.92); }
  100% { opacity: 1; transform: rotate(8deg) scale(1); }
}
@keyframes fade-up {
  from { opacity: 0; transform: translateY(32rpx); }
  to { opacity: 1; transform: none; }
}
@keyframes mask-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes pop-in {
  0% { opacity: 0; transform: scale(0.85); }
  100% { opacity: 1; transform: scale(1); }
}
@keyframes float-y {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10rpx); }
}
@keyframes ring-swing {
  0%, 100% { transform: rotate(0deg); }
  5% { transform: rotate(14deg); }
  10% { transform: rotate(-12deg); }
  15% { transform: rotate(8deg); }
  20% { transform: rotate(0deg); }
}
</style>
