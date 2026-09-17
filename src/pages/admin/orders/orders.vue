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
 *  - 新增「改单 / 删单」：改单走服务端 order.update（整单菜品 + 备注，与下单**共用同一套**
 *    上限校验，否则改单就成了绕过 MAX_ITEM_QTY 的后门）；删单走 order.delete
 *    （真删，并把这一单贡献的份数从菜品「已点次数」里退回）。
 */
import { computed, ref } from 'vue'
import { onLoad, onPullDownRefresh, onReachBottom, onShow, onUnload } from '@dcloudio/uni-app'
import { callApi } from '@/utils/cloud'
import { formatTime, statusInfo } from '@/utils/format'
import { useUserStore } from '@/stores/user'
import type { Dish, Order, OrderItem, OrderStatus, PagedOrders } from '@/types/api'

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

/* ==================== 改单 / 删单 ==================== */

/** 单道菜份数上限，与云函数 MAX_ITEM_QTY 对齐（超出会被服务端拒绝，这里先拦一道） */
const MAX_EDIT_QTY = 99

/** 正在编辑的订单 id：null = 没开改单弹窗 */
const editingId = ref<string | null>(null)
/** 编辑中的菜品行（订单 items 的副本，取消时直接丢弃） */
const editItems = ref<OrderItem[]>([])
const editRemark = ref('')
const saving = ref(false)

/** 菜品选择弹窗（从菜单里挑菜加进这一单） */
const showDishSheet = ref(false)
const dishes = ref<Dish[]>([])
const dishesLoading = ref(false)
/** 菜单只需拉一次，之后一直用缓存 */
let dishesLoaded = false

/** 键盘高度 → 上移弹窗并压低滚动区，与 admin/dishes 同一套处理 */
const keyboardHeight = ref(0)
const bodyMaxHeight = ref('60vh')
let winH = 667

/** 弹窗遮罩用的空函数：配合 @tap.stop 吃掉冒泡，点内容区不会关掉弹窗 */
function noop() {}

/** 可以加进这一单的菜：已经在单里的就不再列出来，列表会随添加实时变短 */
const pickerDishes = computed(() => {
  const used = new Set(editItems.value.map((it) => it.dishId))
  return dishes.value.filter((d) => !used.has(d._id))
})

function handleKeyboard(res: { height?: number }) {
  const kb = res.height || 0
  keyboardHeight.value = kb
  if (kb > 0) {
    bodyMaxHeight.value = Math.max(winH - kb - 180, 200) + 'px'
  } else {
    bodyMaxHeight.value = '60vh'
  }
}

onLoad(() => {
  try {
    const info: any = uni.getWindowInfo ? uni.getWindowInfo() : uni.getSystemInfoSync()
    winH = info.windowHeight || 667
  } catch (e) {
    winH = 667
  }
  uni.onKeyboardHeightChange(handleKeyboard)
})

onUnload(() => {
  uni.offKeyboardHeightChange(handleKeyboard)
})

function openEdit(o: Order) {
  editingId.value = o._id
  // 拷贝一份再改：直接持有列表里的 items 对象的话，点「取消」改动也会留在列表上
  editItems.value = (o.items || []).map((it) => ({ ...it }))
  editRemark.value = o.remark || ''
}

function closeEdit() {
  // 保存中不允许关闭：请求已经发出去了，这时关掉会让界面状态和服务端不一致
  if (saving.value) return
  editingId.value = null
  editItems.value = []
  editRemark.value = ''
  showDishSheet.value = false
}

function onEditRemarkInput(e: { detail: { value: string } }) {
  editRemark.value = e.detail.value
}

function increaseEditItem(idx: number) {
  const it = editItems.value[idx]
  if (!it) return
  if (it.quantity >= MAX_EDIT_QTY) {
    uni.showToast({ title: `每道菜最多 ${MAX_EDIT_QTY} 份`, icon: 'none' })
    return
  }
  it.quantity++
}

/** 减到 0 就是把这行从订单里去掉（与点餐页步进器同一套语义） */
function decreaseEditItem(idx: number) {
  const it = editItems.value[idx]
  if (!it) return
  if (it.quantity <= 1) editItems.value.splice(idx, 1)
  else it.quantity--
}

async function openDishSheet() {
  showDishSheet.value = true
  if (dishesLoaded) return
  dishesLoading.value = true
  try {
    const res = await callApi<Dish[]>('dish.list')
    if (res.code === 0 && res.data) {
      dishes.value = res.data
      dishesLoaded = true
    } else {
      uni.showToast({ title: res.msg || '菜单加载失败', icon: 'none' })
    }
  } catch (e) {
    console.error(e)
    uni.showToast({ title: '菜单加载失败', icon: 'none' })
  }
  dishesLoading.value = false
}

function closeDishSheet() {
  showDishSheet.value = false
}

/** 加进这一单；弹窗**不关** —— 列表里的菜会实时变少，方便连着挑好几道 */
function addDishToEdit(dish: Dish) {
  editItems.value.push({ dishId: dish._id, name: dish.name, quantity: 1 })
}

async function saveEdit() {
  if (saving.value || !editingId.value) return
  if (editItems.value.length === 0) {
    uni.showToast({ title: '订单不能没有菜品，可以改用「删除」整单删掉', icon: 'none' })
    return
  }

  const id = editingId.value
  // 只回传 dishId / name / quantity：菜名服务端会以库里为准重新覆盖一遍
  const items = editItems.value.map((it) => ({
    dishId: it.dishId,
    name: it.name,
    quantity: it.quantity
  }))
  const remark = editRemark.value

  let done = false
  saving.value = true
  uni.showLoading({ title: '保存中...', mask: true })
  try {
    const res = await callApi('order.update', { id, items, remark })
    if (res.code === 0) {
      // 就地替换这一条，不重新拉列表 —— 否则店主翻了几页之后一改单就被弹回第一页
      applyEditLocally(id, items, remark)
      uni.showToast({ title: '已保存', icon: 'success' })
      done = true
    } else {
      uni.showToast({ title: res.msg || '保存失败', icon: 'none' })
    }
  } catch (e) {
    console.error(e)
    uni.showToast({ title: '保存失败', icon: 'none' })
  }
  uni.hideLoading()
  saving.value = false
  if (done) closeEdit()
}

/** 改单成功后就地更新本地列表（itemsText 是 computed 出来的，会自动跟着变） */
function applyEditLocally(id: string, items: OrderItem[], remark: string) {
  const idx = allOrders.value.findIndex((o) => o._id === id)
  if (idx < 0) return
  allOrders.value[idx] = { ...allOrders.value[idx], items, remark }
}

/**
 * 删单先二次确认：真删不可恢复，还会连带退回菜品计数，值得多问一句。
 * confirmColor 用危险红，和「取消订单」这种可逆操作在视觉上区分开。
 */
function confirmDelete(o: Order) {
  if (busy) return
  uni.showModal({
    title: '删除订单',
    content: `确定删除「${o.nickname}」这一单吗？删除后无法恢复，菜品的「已点次数」也会一起退回。`,
    confirmText: '删除',
    confirmColor: '#e64340',
    success: (r) => {
      if (r.confirm) doDelete(o._id)
    }
  })
}

async function doDelete(id: string) {
  if (busy) return
  busy = true
  uni.showLoading({ title: '删除中...', mask: true })
  try {
    const res = await callApi('order.delete', { id })
    if (res.code === 0) {
      removeLocally(id)
      uni.showToast({ title: '已删除', icon: 'success' })
    } else {
      uni.showToast({ title: res.msg || '删除失败', icon: 'none' })
    }
  } catch (e) {
    console.error(e)
    uni.showToast({ title: '删除失败', icon: 'none' })
  }
  uni.hideLoading()
  busy = false
}

/** 删单成功后就地移出该行并修正总数（不整表重拉，避免翻页位置丢失） */
function removeLocally(id: string) {
  const idx = allOrders.value.findIndex((o) => o._id === id)
  if (idx < 0) return
  allOrders.value.splice(idx, 1)
  total.value = Math.max(0, total.value - 1)
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
          <view class="order-time-box">
            <!-- 改过内容的单留个痕：顾客回头说「我没点这个」时能一眼看出被改过 -->
            <text v-if="o.editedAt" class="order-edited">已改过</text>
            <text class="order-time">{{ o.timeText }}</text>
          </view>
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
          <!-- 改单 / 删单：任何状态的订单都能改内容和删除，所以不放进上面那个 status 分支 -->
          <view class="order-tools">
            <text
              class="tool"
              hover-class="text-press"
              hover-stay-time="80"
              @tap="openEdit(o)"
            >编辑</text>
            <text
              class="tool danger"
              hover-class="text-press"
              hover-stay-time="80"
              @tap="confirmDelete(o)"
            >删除</text>
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

    <!-- 修改订单弹窗：整单菜品（加减菜、改份数）+ 备注，不动状态 -->
    <view v-if="editingId" class="mask" :style="{ paddingBottom: keyboardHeight + 'px' }" @tap="closeEdit">
      <view class="form-panel" @tap.stop="noop">
        <view class="form-header">
          <text class="form-title">修改订单</text>
          <text class="form-close" hover-class="text-press" hover-stay-time="80" @tap="closeEdit">✕</text>
        </view>

        <scroll-view scroll-y class="form-body" :style="{ maxHeight: bodyMaxHeight }">
          <!-- 内层容器负责内边距：scroll-view 不参与全局 border-box 规则，横向 padding 会被吞掉 -->
          <view class="form-inner">
            <view class="edit-hint">只改这一单的菜品和备注，订单状态不变</view>

            <view v-if="editItems.length === 0" class="edit-empty">
              这单已经没有菜品了 —— 保存会被拦下，可以用「删除」把整单删掉
            </view>

            <view v-for="(it, idx) in editItems" :key="it.dishId" class="edit-row">
              <text class="edit-name">{{ it.name }}</text>
              <view class="stepper">
                <view
                  class="step-btn"
                  hover-class="btn-press"
                  hover-stay-time="80"
                  @tap="decreaseEditItem(idx)"
                >−</view>
                <text class="step-num">{{ it.quantity }}</text>
                <view
                  class="step-btn add"
                  hover-class="btn-press"
                  hover-stay-time="80"
                  @tap="increaseEditItem(idx)"
                >＋</view>
              </view>
            </view>

            <view class="add-dish" hover-class="chip-press" hover-stay-time="80" @tap="openDishSheet">
              ＋ 添加菜品
            </view>

            <view class="field">
              <text class="label">备注</text>
              <input
                class="input"
                placeholder="口味、忌口等，留空即无备注"
                :value="editRemark"
                :adjust-position="false"
                :cursor-spacing="20"
                @input="onEditRemarkInput"
              />
            </view>
          </view>
        </scroll-view>

        <view class="form-footer">
          <view class="btn-cancel" hover-class="btn-press" hover-stay-time="80" @tap="closeEdit">取消</view>
          <view class="btn-save" hover-class="cta-press" hover-stay-time="80" @tap="saveEdit">保存</view>
        </view>
      </view>
    </view>

    <!-- 添加菜品：只列还没在这单里的菜，点一下就加进去（加完不关，列表会实时变短） -->
    <view v-if="showDishSheet" class="mask sheet-mask" @tap="closeDishSheet">
      <view class="sheet-panel" @tap.stop="noop">
        <view class="sheet-header">
          <text class="sheet-title">添加菜品</text>
          <text class="sheet-close" hover-class="text-press" hover-stay-time="80" @tap="closeDishSheet">✕</text>
        </view>
        <scroll-view scroll-y class="sheet-body">
          <view v-if="dishesLoading" class="sheet-empty">正在取菜单…</view>
          <template v-else>
            <view
              v-for="d in pickerDishes"
              :key="d._id"
              class="sheet-item"
              hover-class="chip-press"
              hover-stay-time="80"
              @tap="addDishToEdit(d)"
            >
              <image
                class="sheet-thumb"
                :src="d.imageSrc || d.imageUrl || '/static/images/placeholder.png'"
                mode="aspectFill"
              />
              <text class="sheet-item-name">{{ d.name }}</text>
              <text class="sheet-add">＋</text>
            </view>
            <view v-if="pickerDishes.length === 0" class="sheet-empty">
              菜单里的菜都在这单里了
            </view>
          </template>
        </scroll-view>
        <view class="sheet-footer">
          <view class="btn-save" hover-class="cta-press" hover-stay-time="80" @tap="closeDishSheet">好了</view>
        </view>
      </view>
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

/* ========== 改单 / 删单的入口 ========== */
.order-time-box {
  display: flex;
  align-items: center;
}
.order-edited {
  font-size: 22rpx;
  color: var(--caramel);
  background: var(--yellow-soft);
  border-radius: 6rpx;
  padding: 2rpx 10rpx;
  margin-right: 10rpx;
}
/* 文字型次级操作：和「完成」那种主行动按钮拉开层级，避免四个按钮糊成一片 */
.order-tools {
  display: flex;
  align-items: center;
}
.tool {
  font-size: 26rpx;
  color: var(--caramel);
  padding: 10rpx 0 10rpx 28rpx;
}
/* 危险红：真删不可恢复，与「取消订单」这种可逆操作区分开 */
.tool.danger {
  color: #e64340;
}

/* ========== 弹窗（与 admin/dishes 同一套版式） ========== */
.mask {
  position: fixed;
  inset: 0;
  background: rgba(74, 47, 24, 0.5);
  z-index: 30;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}
.form-panel {
  background: var(--paper);
  border-radius: 24rpx 24rpx 0 0;
  display: flex;
  flex-direction: column;
  max-height: 85vh;
}
.form-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 30rpx;
  border-bottom: 2rpx dashed var(--line);
}
.form-title {
  font-size: 32rpx;
  font-weight: 700;
  color: var(--ink);
}
.form-close {
  font-size: 32rpx;
  color: var(--tan);
}
/* 注意：scroll-view 不在全局 border-box 名单里，横向 padding 会被内层滚动区吞掉
   → 内边距必须放在 .form-inner 上（同 admin/dishes 的处理） */
.form-body {
  padding: 0;
  box-sizing: border-box;
}
.form-inner {
  padding: 10rpx 30rpx;
}
.form-footer {
  display: flex;
  padding: 20rpx 30rpx calc(20rpx + env(safe-area-inset-bottom));
  border-top: 2rpx dashed var(--line);
}
.btn-cancel {
  flex: 1;
  height: 84rpx;
  line-height: 84rpx;
  text-align: center;
  background: var(--cream-deep);
  color: var(--tan);
  border-radius: 16rpx;
  margin-right: 20rpx;
  font-size: 30rpx;
}
.btn-save {
  flex: 2;
  height: 84rpx;
  line-height: 84rpx;
  text-align: center;
  background: linear-gradient(135deg, var(--yellow), var(--amber));
  color: var(--ink);
  border-radius: 16rpx;
  font-size: 30rpx;
  font-weight: 700;
  letter-spacing: 1rpx;
  box-shadow: var(--shadow-pop);
}

/* ========== 改单：菜品行 ========== */
.edit-hint {
  font-size: 24rpx;
  color: var(--tan);
  padding: 20rpx 0 8rpx;
}
.edit-empty {
  margin-top: 20rpx;
  padding: 30rpx 24rpx;
  background: var(--yellow-soft);
  border-radius: 16rpx;
  font-size: 24rpx;
  line-height: 1.7;
  color: var(--tan);
}
.edit-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 22rpx 0;
  border-bottom: 2rpx dashed var(--line);
}
.edit-name {
  flex: 1;
  min-width: 0;
  font-size: 28rpx;
  color: var(--ink);
  margin-right: 20rpx;
}
.stepper {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}
.step-btn {
  width: 56rpx;
  height: 56rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 34rpx;
  line-height: 1;
  background: var(--cream-deep);
  color: var(--tan);
}
.step-btn.add {
  background: linear-gradient(135deg, var(--yellow), var(--amber));
  color: var(--ink);
  font-weight: 700;
  box-shadow: var(--shadow-pop);
}
.step-num {
  min-width: 72rpx;
  text-align: center;
  font-size: 30rpx;
  font-weight: 700;
  color: var(--caramel);
  font-variant-numeric: tabular-nums;
}
.add-dish {
  margin: 26rpx 0 6rpx;
  height: 84rpx;
  line-height: 84rpx;
  text-align: center;
  border-radius: 16rpx;
  border: 2rpx dashed var(--caramel);
  color: var(--caramel);
  font-size: 28rpx;
  font-weight: 600;
}
.field {
  margin: 26rpx 0;
}
.label {
  display: block;
  font-size: 26rpx;
  color: var(--tan);
  margin-bottom: 14rpx;
}
.input {
  height: 84rpx;
  background: var(--yellow-soft);
  border-radius: 16rpx;
  padding: 0 24rpx;
  font-size: 28rpx;
  color: var(--ink);
}

/* ========== 菜品选择弹窗（叠在改单弹窗之上） ========== */
.sheet-mask {
  z-index: 40;
}
.sheet-panel {
  background: var(--paper);
  border-radius: 24rpx 24rpx 0 0;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  padding-bottom: env(safe-area-inset-bottom);
}
.sheet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 30rpx;
  border-bottom: 2rpx dashed var(--line);
}
.sheet-title {
  font-size: 32rpx;
  font-weight: 700;
  color: var(--ink);
}
.sheet-close {
  font-size: 32rpx;
  color: var(--tan);
}
.sheet-body {
  max-height: 52vh;
  padding: 8rpx 0;
}
.sheet-item {
  display: flex;
  align-items: center;
  padding: 20rpx 30rpx;
  border-bottom: 2rpx dashed var(--line);
}
.sheet-item:last-child {
  border-bottom: none;
}
.sheet-thumb {
  width: 72rpx;
  height: 72rpx;
  border-radius: 14rpx;
  flex-shrink: 0;
  background: var(--yellow-mist);
  border: 2rpx solid #fff;
}
.sheet-item-name {
  flex: 1;
  min-width: 0;
  margin-left: 20rpx;
  font-size: 28rpx;
  color: var(--ink);
}
.sheet-add {
  flex-shrink: 0;
  font-size: 32rpx;
  color: var(--caramel);
  font-weight: 700;
}
.sheet-empty {
  padding: 60rpx 30rpx;
  text-align: center;
  color: var(--tan);
  font-size: 26rpx;
}
.sheet-footer {
  padding: 20rpx 30rpx;
  border-top: 2rpx dashed var(--line);
}
.sheet-footer .btn-save {
  flex: none;
  width: 100%;
}
</style>
