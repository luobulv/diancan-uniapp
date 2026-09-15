<script setup lang="ts">
/**
 * 点餐首页 —— 原 pages/index/index.js(268行) + index.wxml(196行) 迁移
 *
 * 关于布局（真机实测后的结论，别再按 CSS 直觉推翻）：
 *   本页是「定高双栏」——`.page` 用 height:100vh（不是 min-height），
 *   `.catalog` flex:1 + min-height:0，两个 scroll-view 各自内部滚动，页面本身不滚动。
 *   原生版写的是 min-height:100vh，容器被内容撑开导致整页滚动，
 *   于是左侧分类栏会随页面滚走、右侧 pane 的 @scroll 永不触发（高亮不跟随）、
 *   页面级 pageScrollTo 与 scroll-into-view 必然有一个是失效的。
 *
 * 与原实现的差异：
 *  1. 布局改为真正的定高双栏（见 style 里 .page 的注释）。
 *  2. 分类点击滚动改用 scroll-view 的 scroll-into-view + 一个 #cat-top 锚点。
 *  3. 高亮反查基于 `.dish-pane` 实时上边界，不再写死 80px。
 *  4. 节点查询走 utils/query.ts 的作用域探测封装（见该文件顶部说明）。
 *  5. 补上 onPullDownRefresh（index.json 原本开了 enablePullDownRefresh 却没有处理函数）。
 */
import { nextTick, ref } from 'vue'
import { onPullDownRefresh, onShareAppMessage, onShow } from '@dcloudio/uni-app'
import { callApi } from '@/utils/cloud'
import { initQueryScope, rectsOf } from '@/utils/query'
import { useUserStore } from '@/stores/user'
import { useCatalogStore, UNCAT_ID } from '@/stores/catalog'
import { useCartStore } from '@/stores/cart'
import type { Dish } from '@/types/api'

// ⚠️ 必须同步执行：getCurrentInstance() 只在 setup 期间有效
initQueryScope()

const userStore = useUserStore()
const catalog = useCatalogStore()
const cart = useCartStore()

const activeCategoryId = ref('all')
/** scroll-view 的 scroll-into-view 目标 id */
const scrollTarget = ref('')
const showCart = ref(false)
const showConfirm = ref(false)
const remark = ref('')
const submitting = ref(false)

/** 程序化滚动期间忽略 @scroll 回传的中间位置，避免高亮跳回上一个分类 */
let scrollLockUntil = 0

onShow(() => {
  init()
})

/* ==================== 数据加载 ==================== */

async function init() {
  // 角色与菜单是两个互不依赖的请求，串行 await 会让首屏白等将近一倍时间。
  // 两者都保留「强制刷新」：角色强刷是登录自愈 / 后台改角色的依赖，
  // 菜单强刷是「店主刚加的菜立刻能点」的要求 —— 只是改成并发，不是省掉。
  // 用 allSettled 而不是 all：其中一个失败不应把另一个也一起丢掉。
  const results = await Promise.allSettled([
    userStore.login(true),
    catalog.load(true)
  ])
  const rejected = results.filter(
    (r): r is PromiseRejectedResult => r.status === 'rejected'
  )
  if (rejected.length > 0) {
    console.error(rejected[0].reason)
    uni.showToast({ title: '加载失败', icon: 'none' })
  }
}

onPullDownRefresh(async () => {
  await init()
  uni.stopPullDownRefresh()
})

/* ==================== 分类与滚动联动 ==================== */

function switchCategory(id: string) {
  activeCategoryId.value = id
  scrollToCategory(id)
}

/**
 * 滚动到指定分类。
 * 先清空再 nextTick 赋值，保证重复点击同一分类也能重新触发。
 */
function scrollToCategory(id: string) {
  const target = id === 'all' ? 'cat-top' : `cat-${id}`
  scrollTarget.value = ''
  nextTick(() => {
    scrollTarget.value = target
    scrollLockUntil = Date.now() + 400
  })
}

/**
 * 右侧列表滚动时反查当前可视分类，更新左侧高亮（双向联动）。
 *
 * 判定基准不用写死的常量，而是现查 `.dish-pane` 自身的上边界：
 * 访客会多出一条 `.guest-tip` 提示，把面板整体往下推，写死 80px 就不成立了。
 * 「分组头贴到面板顶部」即视为该分组激活，多给 16px 余量吸收 scroll-into-view 的落点误差。
 */
let lastScrollCheck = 0

async function onScroll() {
  if (Date.now() < scrollLockUntil) return

  // 节流：一次惯性滑动会触发几十次 scroll，每次都查 1+N 个节点没必要
  const now = Date.now()
  if (now - lastScrollCheck < 60) return
  lastScrollCheck = now

  const groups = catalog.groupList
  if (groups.length === 0) return

  const res = await rectsOf(['.dish-pane', ...groups.map((g) => `#cat-${g._id}`)])
  const pane = res[0]
  const rects = res.slice(1)

  const topThreshold = (pane ? pane.top : 80) + 16
  let active = groups[0]._id
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i]
    if (!rect) continue
    if (rect.top <= topThreshold) {
      active = groups[i]._id
    } else {
      break
    }
  }
  if (active !== activeCategoryId.value) activeCategoryId.value = active
}

/* ==================== 购物车 ==================== */

function toggleCart() {
  if (cart.count === 0) return
  showCart.value = !showCart.value
}

function clearCart() {
  cart.clear()
}

function onRemarkInput(e: { detail: { value: string } }) {
  remark.value = e.detail.value
}

/** 弹窗遮罩用的空函数：配合 @tap.stop 吃掉冒泡，点内容区不会关掉弹窗 */
function noop() {}

function addDish(dish: Dish) {
  cart.add(dish)
}

/* ==================== 提交订单 ==================== */

/** 「去下单」/「提交订单」：先弹确认弹窗展示已选菜品 */
function openConfirm() {
  if (!userStore.user) return

  if (userStore.isGuest) {
    uni.showModal({
      title: '提示',
      content: '请先接受邀请，成为点餐成员后才能下单',
      confirmText: '去接受邀请',
      success: (r) => {
        if (r.confirm) goInvite()
      }
    })
    return
  }

  if (cart.count === 0) {
    uni.showToast({ title: '请先选择菜品', icon: 'none' })
    return
  }

  showCart.value = false
  showConfirm.value = true
}

async function confirmOrder() {
  if (submitting.value) return

  const items = cart.list.map((i) => ({
    dishId: i.dishId,
    name: i.name,
    quantity: i.quantity
  }))
  if (items.length === 0) {
    uni.showToast({ title: '请先选择菜品', icon: 'none' })
    return
  }

  submitting.value = true
  uni.showLoading({ title: '提交中...', mask: true })
  try {
    const res = await callApi('order.create', { items, remark: remark.value })
    uni.hideLoading()
    if (res.code === 0) {
      cart.clear()
      showCart.value = false
      showConfirm.value = false
      remark.value = ''
      uni.showToast({ title: '点餐成功', icon: 'success' })
    } else {
      uni.showToast({ title: res.msg || '提交失败', icon: 'none' })
    }
  } catch (e) {
    uni.hideLoading()
    uni.showToast({ title: '提交失败', icon: 'none' })
  }
  submitting.value = false
}

function goInvite() {
  uni.navigateTo({ url: '/pages/invite/invite' })
}

onShareAppMessage(() => ({ title: '一起点餐吧', path: '/pages/index/index' }))
</script>

<template>
  <view class="page">
    <!-- 顶部品牌 banner -->
    <view class="brand-banner">
      <view class="brand-left">
        <image class="brand-logo" src="/static/images/app-logo.jpg" mode="aspectFit" />
        <view class="brand-text">
          <view class="brand-title">呼噜点餐</view>
          <view class="brand-sub">今日好好吃饭，明天好好生活</view>
        </view>
      </view>
      <!-- 营业印章：手作食堂的记忆点，入场时"盖"下来 -->
      <view class="brand-stamp">
        <text class="stamp-icon">🐷</text>
        <text class="stamp-text">营业中</text>
      </view>
    </view>

    <!-- 访客提示 -->
    <view v-if="userStore.roleReady && userStore.isGuest" class="guest-tip">
      <text>你还不是点餐成员，接受邀请后即可点餐</text>
      <text class="guest-link" @tap="goInvite">立即接受邀请 →</text>
    </view>

    <!-- 双栏：左侧分类菜单 + 右侧分组菜品 -->
    <view class="catalog">
      <!-- 左侧分类 -->
      <scroll-view scroll-y class="cate-menu" enhanced :show-scrollbar="false">
        <view
          class="cate-menu-item"
          :class="{ active: activeCategoryId === 'all' }"
          hover-class="cate-press"
          hover-stay-time="100"
          @tap="switchCategory('all')"
        >全部</view>
        <view
          v-for="c in catalog.categories"
          :key="c._id"
          class="cate-menu-item"
          :class="{ active: activeCategoryId === c._id }"
          hover-class="cate-press"
          hover-stay-time="100"
          @tap="switchCategory(c._id)"
        >{{ c.name }}</view>
        <view
          v-if="catalog.hasUncatGroup"
          class="cate-menu-item"
          :class="{ active: activeCategoryId === UNCAT_ID }"
          hover-class="cate-press"
          hover-stay-time="100"
          @tap="switchCategory(UNCAT_ID)"
        >未分类</view>

        <!-- 分类未到位时的骨架行：避免左栏从「全部」孤零零一项突然被撑开 -->
        <view v-if="catalog.loading && catalog.categories.length === 0" class="cate-sk-wrap">
          <view v-for="n in [1, 2, 3, 4]" :key="n" class="cate-sk sk"></view>
        </view>
      </scroll-view>

      <!-- 右侧分组菜品 -->
      <scroll-view
        scroll-y
        class="dish-pane"
        enhanced
        :show-scrollbar="false"
        :scroll-into-view="scrollTarget"
        scroll-with-animation
        :upper-threshold="0"
        :lower-threshold="0"
        @scroll="onScroll"
      >
        <!-- scroll-into-view 锚点，对应原 scrollToCategory 里「回到顶部」的分支 -->
        <view id="cat-top" class="pane-top"></view>

        <template v-if="catalog.groupList.length > 0">
          <view
            v-for="group in catalog.groupList"
            :key="group._id"
            :id="`cat-${group._id}`"
            class="group-wrap"
          >
            <view class="group-header">
              <text class="group-name">{{ group.name }}</text>
              <view class="group-line"></view>
              <text class="group-count">{{ group.dishes.length }} 道</text>
            </view>

            <view v-for="dish in group.dishes" :key="dish._id" class="dish-card">
              <image
                class="dish-img"
                :src="dish.imageSrc || dish.imageUrl || '/static/images/placeholder.png'"
                mode="aspectFill"
              />
              <view class="dish-info">
                <view class="dish-name-row">
                  <text class="dish-name">{{ dish.name }}</text>
                  <text v-if="dish.orderCount > 0" class="order-count">已点 {{ dish.orderCount }} 次</text>
                </view>

                <view v-if="dish.rating > 0" class="stars">
                  <text
                    v-for="s in [1, 2, 3, 4, 5]"
                    :key="s"
                    class="star"
                    :class="{ on: s <= dish.rating }"
                  >★</text>
                </view>

                <view class="dish-bottom">
                  <view v-if="userStore.roleReady && !userStore.isOwner" class="stepper">
                    <template v-if="cart.quantityOf(dish._id) > 0">
                      <view
                        class="step-btn"
                        hover-class="btn-press"
                        hover-stay-time="80"
                        @tap="cart.decrease(dish._id)"
                      >−</view>
                      <text class="step-num">{{ cart.quantityOf(dish._id) }}</text>
                    </template>
                    <view
                      class="step-btn add"
                      hover-class="btn-press"
                      hover-stay-time="80"
                      @tap="addDish(dish)"
                    >+</view>
                  </view>
                </view>
              </view>
            </view>
          </view>
        </template>

        <!-- 列表未到位：骨架卡片（与 .dish-card 同构）+ 上菜提示 -->
        <view v-else-if="catalog.loading" class="loading-wrap">
          <view class="loading-head">
            <view class="loading-dots">
              <view class="loading-dot"></view>
              <view class="loading-dot"></view>
              <view class="loading-dot"></view>
            </view>
            <text class="loading-text">正在上菜…</text>
          </view>

          <view v-for="n in [1, 2, 3, 4]" :key="n" class="sk-card">
            <view class="sk sk-img"></view>
            <view class="sk-info">
              <view class="sk sk-line sk-line-name"></view>
              <view class="sk sk-line sk-line-sub"></view>
              <view class="sk-info-bottom">
                <view class="sk sk-btn"></view>
              </view>
            </view>
          </view>
        </view>

        <view v-else class="empty">
          <text class="empty-icon">🍽️</text>
          <text class="empty-text">暂无菜品</text>
        </view>
      </scroll-view>
    </view>

    <!-- 底部占位（店主不展示点餐条，也就不需要占位） -->
    <view v-if="userStore.roleReady && !userStore.isOwner" class="cart-placeholder"></view>

    <!-- 购物车条（店主不点餐，隐藏；朋友/访客可见） -->
    <view v-if="userStore.roleReady && !userStore.isOwner" class="cart-bar" @tap="toggleCart">
      <view class="cart-icon-wrap">
        <view class="cart-icon-plate">
          <text class="cart-icon">🛒</text>
        </view>
        <text v-if="cart.count > 0" class="cart-badge">{{ cart.count }}</text>
      </view>
      <view class="cart-total">
        <template v-if="cart.count > 0">
          <text class="cart-total-label">已选</text>
          <text class="cart-total-num">{{ cart.count }} 份</text>
        </template>
        <text v-else class="cart-empty-text">还没有选择菜品</text>
      </view>
      <view
        class="cart-submit"
        :class="{ disabled: cart.count === 0 }"
        hover-class="cta-press"
        hover-stay-time="80"
        @tap.stop="openConfirm"
      >去下单</view>
    </view>

    <!-- 购物车弹窗 -->
    <view v-if="showCart" class="mask" @tap="showCart = false">
      <view class="cart-popup" @tap.stop="noop">
        <view class="popup-handle"></view>
        <view class="popup-header">
          <text class="popup-title">已选菜品</text>
          <text class="popup-clear" hover-class="text-press" hover-stay-time="80" @tap="clearCart">清空</text>
        </view>

        <scroll-view scroll-y class="popup-body">
          <view class="popup-body-inner">
            <view v-for="item in cart.list" :key="item.dishId" class="popup-item">
              <view class="popup-item-info">
                <text class="popup-item-name">{{ item.name }}</text>
              </view>
              <view class="stepper">
                <view
                  class="step-btn"
                  hover-class="btn-press"
                  hover-stay-time="80"
                  @tap="cart.decrease(item.dishId)"
                >−</view>
                <text class="step-num">{{ item.quantity }}</text>
                <view
                  class="step-btn add"
                  hover-class="btn-press"
                  hover-stay-time="80"
                  @tap="addDish(item)"
                >+</view>
              </view>
            </view>
          </view>
        </scroll-view>

        <view class="popup-footer">
          <view class="cart-submit" hover-class="cta-press" hover-stay-time="80" @tap="openConfirm">提交订单</view>
        </view>
      </view>
    </view>

    <!-- 确认下单弹窗 -->
    <view v-if="showConfirm" class="confirm-mask" @tap="showConfirm = false">
      <view class="confirm-dialog" @tap.stop="noop">
        <view class="confirm-title">确认下单</view>

        <scroll-view scroll-y class="confirm-list">
          <view class="confirm-list-inner">
            <view v-for="item in cart.list" :key="item.dishId" class="confirm-item">
              <text class="confirm-item-name">{{ item.name }}</text>
              <text class="confirm-item-qty">×{{ item.quantity }}</text>
            </view>
          </view>
        </scroll-view>

        <input
          class="confirm-remark"
          placeholder="备注（口味、忌口等，可选）"
          :value="remark"
          @input="onRemarkInput"
        />

        <view class="confirm-actions">
          <view class="confirm-btn cancel" hover-class="text-press" hover-stay-time="80" @tap="showConfirm = false">取消</view>
          <view class="confirm-btn ok" hover-class="cta-press" hover-stay-time="80" @tap="confirmOrder">确认下单</view>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
/**
 * 点餐首页 · 手作食堂视觉
 * 记忆点：营业印章（盖下来）· 价签分组头 · 器皿卡片 · 悬浮胶囊购物车条
 * 动效：入场错峰编排，只动 transform / opacity
 */
.page {
  /* ⚠️ 必须是 height 而不是 min-height。
     写 min-height 时容器高度由内容撑开，`.catalog` 的 flex:1 拿不到确定高度，
     两个 scroll-view 就都不会内部滚动 —— 结果是整页滚动、左栏随页面滚走、
     `@scroll` 永不触发（高亮不跟随）、`scroll-into-view` 空操作。
     真机实测确认过这一点，别改回 min-height。 */
  height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: var(--cream);
  /* 氛围层：低透明度圆点纹理，像餐垫纸 */
  background-image: radial-gradient(rgba(245, 166, 35, 0.07) 2rpx, transparent 2rpx);
  background-size: 48rpx 48rpx;
}

/* ========== 顶部品牌 banner ========== */
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
/* 氛围圆：右上暖光、左下浅影，破一下纯色平铺 */
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
  transform: rotate(-6deg); /* 手作感：微微歪头 */
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

/* 营业印章 */
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

/* 访客提示 */
.guest-tip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--yellow-soft);
  border-left: 8rpx solid var(--amber);
  color: var(--tan);
  font-size: 24rpx;
  padding: 16rpx 24rpx;
}
.guest-link {
  color: var(--caramel);
  font-weight: 700;
}

/* ========== 双栏布局 ========== */
.catalog {
  flex: 1;
  display: flex;
  flex-direction: row;
  min-height: 0;
}
.cate-menu {
  width: 184rpx;
  background: var(--yellow-mist);
  flex-shrink: 0;
  animation: fade-right 400ms var(--ease-out) 90ms both;
}
.cate-menu-item {
  padding: 30rpx 12rpx;
  font-size: 26rpx;
  color: var(--tan);
  text-align: center;
  position: relative;
  transition: color var(--dur-fast) ease-out, background-color var(--dur-fast) ease-out;
}
.cate-menu-item.active {
  background: var(--cream);
  color: var(--caramel);
  font-weight: 800;
}
.cate-menu-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 26rpx;
  bottom: 26rpx;
  width: 8rpx;
  border-radius: 0 8rpx 8rpx 0;
  background: linear-gradient(180deg, var(--yellow), var(--amber));
}

.dish-pane {
  flex: 1;
  /* 只留纵向内边距：scroll-view 不参与全局 border-box 规则，
     横向内边距会被内层滚动区吞掉、子元素向右溢出（与 .popup-body 同一处理方式）。
     横向内边距下沉到 .group-wrap，这样锚点 id 仍能挂在 scroll-view 的直接子节点上。 */
  padding: 16rpx 0;
  min-width: 0;
}
/* 分组包裹层：承担原本挂在 .dish-pane 上的横向内边距 */
.group-wrap {
  padding: 0 20rpx;
}

/* ========== 分组标题（价签样式） ========== */
.group-header {
  display: flex;
  align-items: center;
  padding: 18rpx 4rpx 14rpx;
  margin-bottom: 14rpx;
  animation: fade-up 320ms var(--ease-out) 120ms both;
}
.group-name {
  font-size: 28rpx;
  font-weight: 800;
  color: var(--brown);
  letter-spacing: 1rpx;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}
/* 价签小圆标 */
.group-name::before {
  content: '';
  width: 14rpx;
  height: 14rpx;
  border-radius: 50% 50% 4rpx 50%;
  background: var(--amber);
  margin-right: 12rpx;
  transform: rotate(45deg);
}
.group-line {
  flex: 1;
  margin: 0 16rpx;
  border-bottom: 2rpx dashed var(--line);
}
.group-count {
  font-size: 22rpx;
  color: var(--tan);
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

/* ========== 菜品卡片（器皿造型：左下角收紧） ========== */
.dish-card {
  display: flex;
  background: var(--paper);
  border-radius: 28rpx 28rpx 28rpx 10rpx;
  padding: 20rpx;
  margin-bottom: 20rpx;
  box-shadow: var(--shadow-sm);
  border: 2rpx solid rgba(241, 227, 188, 0.6);
  animation: fade-up 420ms var(--ease-out) 150ms both;
}
/* 入场错峰：前几张递进，之后统一，避免长列表等待 */
.dish-card:nth-child(3) { animation-delay: 210ms; }
.dish-card:nth-child(4) { animation-delay: 270ms; }
.dish-card:nth-child(5) { animation-delay: 330ms; }
.dish-card:nth-child(n+6) { animation-delay: 390ms; }

.dish-img {
  width: 180rpx;
  height: 180rpx;
  border-radius: 20rpx;
  flex-shrink: 0;
  background: var(--yellow-mist);
  border: 4rpx solid #fff;
  box-shadow: 0 4rpx 12rpx rgba(180, 120, 50, 0.10);
}
.dish-info {
  flex: 1;
  margin-left: 20rpx;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  overflow: hidden;
}
.dish-name-row {
  display: flex;
  align-items: center;
}
.dish-name {
  font-size: 30rpx;
  font-weight: 700;
  color: var(--ink);
  margin-right: 12rpx;
}
.order-count {
  font-size: 22rpx;
  color: var(--tan);
  font-variant-numeric: tabular-nums;
}
.dish-bottom {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-top: 10rpx;
}

/* ========== 推荐指数星星 ========== */
.stars {
  display: flex;
  align-items: center;
  margin-top: 8rpx;
}
.star {
  font-size: 26rpx;
  color: var(--line);
  margin-right: 4rpx;
}
.star.on {
  color: var(--amber);
}

/* ========== 步进器 ========== */
.stepper {
  display: flex;
  align-items: center;
}
.step-btn {
  width: 56rpx;
  height: 56rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 36rpx;
  line-height: 1;
  background: var(--yellow-mist);
  color: var(--tan);
  transition: transform var(--dur-fast) ease-out;
}
.step-btn.add {
  background: linear-gradient(135deg, var(--yellow), var(--amber));
  color: var(--ink);
  font-weight: 700;
  box-shadow: var(--shadow-pop);
}
.step-num {
  min-width: 56rpx;
  text-align: center;
  font-size: 30rpx;
  font-weight: 700;
  color: var(--caramel);
  font-variant-numeric: tabular-nums;
}

/* ========== 加载态（列表未到位） ========== */
/* 骨架屏而不是转圈：占位块与 .dish-card 同构，数据到位时不会发生布局跳动。
   该节点是 scroll-view 的直接子节点，横向内边距必须自带 —— scroll-view 不参与
   全局 border-box 规则，横向 padding 会被内层滚动区吞掉（与 .group-wrap 同一坑）。 */
.loading-wrap {
  padding: 0 20rpx;
}

/* 「正在上菜」提示：三颗焦糖点错峰弹跳，呼应页面整体的入场错峰语言 */
.loading-head {
  display: flex;
  align-items: center;
  padding: 18rpx 4rpx 24rpx;
  animation: fade-up 320ms var(--ease-out) both;
}
.loading-dots {
  display: flex;
  align-items: center;
  height: 16rpx;
  margin-right: 14rpx;
}
.loading-dot {
  width: 12rpx;
  height: 12rpx;
  border-radius: 50%;
  background: var(--amber);
  margin-right: 8rpx;
  animation: dot-bounce 1.1s ease-in-out infinite;
}
.loading-dot:nth-child(2) { animation-delay: 140ms; }
.loading-dot:nth-child(3) { animation-delay: 280ms; margin-right: 0; }
.loading-text {
  font-size: 26rpx;
  font-weight: 700;
  color: var(--brown);
  letter-spacing: 1rpx;
}

/* 骨架卡片：几何完全对齐 .dish-card */
.sk-card {
  display: flex;
  background: var(--paper);
  border-radius: 28rpx 28rpx 28rpx 10rpx;
  padding: 20rpx;
  margin-bottom: 20rpx;
  box-shadow: var(--shadow-sm);
  border: 2rpx solid rgba(241, 227, 188, 0.6);
}
.sk-info {
  flex: 1;
  margin-left: 20rpx;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  overflow: hidden;
}
.sk-info-bottom {
  display: flex;
  justify-content: flex-end;
}

/* 骨架块：暖色底 + 一道扫过的高光 */
.sk {
  position: relative;
  overflow: hidden;
  background: var(--cream-deep);
}
.sk::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 60%;
  height: 100%;
  background: linear-gradient(
    90deg,
    rgba(255, 253, 246, 0) 0%,
    rgba(255, 253, 246, 0.9) 50%,
    rgba(255, 253, 246, 0) 100%
  );
  animation: sk-sweep 1.5s ease-in-out infinite;
}
.sk-img {
  width: 180rpx;
  height: 180rpx;
  border-radius: 20rpx;
  flex-shrink: 0;
}
.sk-line {
  height: 26rpx;
  border-radius: 8rpx;
}
.sk-line-name { width: 62%; }
.sk-line-sub {
  width: 38%;
  height: 22rpx;
}
.sk-btn {
  width: 56rpx;
  height: 56rpx;
  border-radius: 50%;
}

/* 扫光错峰：四张骨架依次亮起，而不是齐刷刷一起闪 */
.sk-card:nth-child(3) .sk::after { animation-delay: 100ms; }
.sk-card:nth-child(4) .sk::after { animation-delay: 200ms; }
.sk-card:nth-child(5) .sk::after { animation-delay: 300ms; }

/* 左栏骨架行：高度对齐 .cate-menu-item。
   底色要单独调深 —— --cream-deep 压在 --yellow-mist 上几乎看不见。 */
.cate-sk {
  width: 96rpx;
  height: 34rpx;
  margin: 28rpx auto;
  border-radius: 8rpx;
  background: rgba(217, 130, 43, 0.16);
}
.cate-sk::after { animation-duration: 1.8s; }
.cate-sk:nth-child(2)::after { animation-delay: 120ms; }
.cate-sk:nth-child(3)::after { animation-delay: 240ms; }
.cate-sk:nth-child(4)::after { animation-delay: 360ms; }

/* ========== 空状态 ========== */
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 200rpx 0;
  color: var(--tan);
}
.empty-icon {
  font-size: 96rpx;
  margin-bottom: 20rpx;
  animation: float-y 2.4s ease-in-out infinite;
}
.empty-text {
  font-size: 26rpx;
  letter-spacing: 1rpx;
}

/* ========== 底部购物车条（悬浮胶囊） ========== */
.cart-placeholder {
  height: 140rpx;
}
.cart-bar {
  position: fixed;
  left: 20rpx;
  right: 20rpx;
  bottom: calc(20rpx + env(safe-area-inset-bottom));
  height: 110rpx;
  background: var(--paper);
  display: flex;
  align-items: center;
  padding: 0 16rpx 0 20rpx;
  z-index: 20;
  border-radius: var(--r-pill);
  box-shadow: 0 12rpx 40rpx rgba(107, 68, 35, 0.18);
  border: 2rpx solid rgba(241, 227, 188, 0.8);
  animation: bar-rise 480ms var(--ease-spring) 240ms both;
}
.cart-icon-wrap {
  position: relative;
  width: 90rpx;
}
.cart-icon-plate {
  width: 80rpx;
  height: 80rpx;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--yellow), var(--amber));
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--shadow-pop);
  transform: rotate(-6deg);
}
.cart-icon {
  font-size: 44rpx;
}
.cart-badge {
  position: absolute;
  top: -8rpx;
  right: -10rpx;
  min-width: 36rpx;
  height: 36rpx;
  border-radius: 18rpx;
  background: var(--brown);
  color: var(--cream);
  font-size: 22rpx;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 10rpx;
  border: 3rpx solid var(--paper);
  animation: badge-pop 400ms var(--ease-spring) 360ms both;
  font-variant-numeric: tabular-nums;
}
.cart-total {
  flex: 1;
  margin-left: 20rpx;
  color: var(--ink);
}
.cart-total-label {
  font-size: 24rpx;
  color: var(--tan);
  margin-right: 8rpx;
}
.cart-total-num {
  font-size: 36rpx;
  font-weight: 800;
  color: var(--caramel);
  font-variant-numeric: tabular-nums;
}
.cart-empty-text {
  color: var(--tan);
  font-size: 26rpx;
}
.cart-submit {
  width: 208rpx;
  height: 82rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #F7C948, #F5A623);
  color: var(--ink);
  border-radius: var(--r-pill);
  font-size: 30rpx;
  font-weight: 800;
  letter-spacing: 2rpx;
  box-shadow: var(--shadow-pop);
  transition: transform var(--dur-fast) ease-out;
}
.cart-submit.disabled {
  background: var(--cream-deep);
  color: var(--sand);
  box-shadow: none;
}

/* ========== 购物车弹窗 ========== */
.mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background: rgba(74, 47, 24, 0.5);
  z-index: 30;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  animation: mask-fade 240ms ease-out both;
}
.cart-popup {
  background: var(--paper);
  border-radius: 36rpx 36rpx 0 0;
  padding-bottom: calc(16rpx + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  max-height: 70vh;
  animation: popup-rise 420ms var(--ease-spring) both;
}
.popup-handle {
  width: 72rpx;
  height: 8rpx;
  border-radius: 8rpx;
  background: var(--line);
  margin: 16rpx auto 0;
}
.popup-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20rpx 30rpx 20rpx;
  border-bottom: 2rpx dashed var(--line);
}
.popup-title {
  font-size: 30rpx;
  font-weight: 800;
  color: var(--ink);
  letter-spacing: 1rpx;
}
.popup-clear {
  font-size: 26rpx;
  color: var(--caramel);
}
/* 注意：scroll-view 不在 app.wxss 的 border-box 名单里，横向 padding 会被内层滚动区吞掉，
   导致列表项溢出到面板右侧 → 内边距必须放在内层 view 上 */
.popup-body {
  flex: 1;
  max-height: 40vh;
  padding: 0;
  box-sizing: border-box;
}
.popup-body-inner {
  padding: 10rpx 30rpx;
}
.popup-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20rpx 0;
  border-bottom: 2rpx dashed rgba(241, 227, 188, 0.6);
}
.popup-item-info {
  display: flex;
  flex-direction: column;
}
.popup-item-name {
  font-size: 28rpx;
  color: var(--ink);
}
.popup-footer {
  padding: 20rpx 30rpx;
  border-top: 2rpx dashed var(--line);
  display: flex;
  align-items: center;
}
.popup-footer .cart-submit {
  width: 100%;
}

/* ========== 确认下单弹窗 ========== */
.confirm-mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background: rgba(74, 47, 24, 0.5);
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: mask-fade 240ms ease-out both;
}
.confirm-dialog {
  width: 620rpx;
  max-height: 72vh;
  background: var(--paper);
  border-radius: var(--r-plate);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: pop-in 360ms var(--ease-spring) both;
}
.confirm-title {
  text-align: center;
  font-size: 32rpx;
  font-weight: 800;
  color: var(--ink);
  letter-spacing: 2rpx;
  padding: 36rpx 0 12rpx;
}
.confirm-list {
  flex: 1;
  max-height: 38vh;
  padding: 0;
  box-sizing: border-box;
}
.confirm-list-inner {
  padding: 10rpx 40rpx;
}
.confirm-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18rpx 0;
  border-bottom: 2rpx dashed rgba(241, 227, 188, 0.6);
}
.confirm-item-name {
  font-size: 28rpx;
  color: var(--ink);
}
.confirm-item-qty {
  font-size: 28rpx;
  font-weight: 700;
  color: var(--caramel);
  font-variant-numeric: tabular-nums;
}
.confirm-remark {
  flex-shrink: 0;
  margin: 20rpx 40rpx;
  height: 76rpx;
  line-height: 76rpx;
  background: var(--yellow-soft);
  border: 2rpx solid var(--line);
  border-radius: var(--r-pill);
  padding: 0 28rpx;
  font-size: 26rpx;
}
.confirm-actions {
  display: flex;
  padding: 20rpx 40rpx 40rpx;
  border-top: 2rpx dashed var(--line);
}
.confirm-btn {
  flex: 1;
  height: 80rpx;
  line-height: 80rpx;
  text-align: center;
  border-radius: var(--r-pill);
  font-size: 30rpx;
  font-weight: 700;
  transition: transform var(--dur-fast) ease-out;
}
.confirm-btn.cancel {
  background: var(--cream-deep);
  color: var(--tan);
  margin-right: 20rpx;
}
.confirm-btn.ok {
  background: linear-gradient(135deg, #F7C948, #F5A623);
  color: var(--ink);
  box-shadow: var(--shadow-pop);
}

/* ========== 入场与循环动效 ========== */
@keyframes banner-drop {
  from { opacity: 0; transform: translateY(-36rpx); }
  to { opacity: 1; transform: none; }
}
@keyframes stamp-in {
  0% { opacity: 0; transform: rotate(8deg) scale(1.8); }
  60% { opacity: 1; transform: rotate(8deg) scale(0.92); }
  100% { opacity: 1; transform: rotate(8deg) scale(1); }
}
@keyframes fade-right {
  from { opacity: 0; transform: translateX(-28rpx); }
  to { opacity: 1; transform: none; }
}
@keyframes fade-up {
  from { opacity: 0; transform: translateY(32rpx); }
  to { opacity: 1; transform: none; }
}
@keyframes bar-rise {
  from { opacity: 0; transform: translateY(120rpx); }
  to { opacity: 1; transform: none; }
}
@keyframes badge-pop {
  0% { transform: scale(0); }
  70% { transform: scale(1.3); }
  100% { transform: scale(1); }
}
@keyframes popup-rise {
  from { transform: translateY(100%); }
  to { transform: none; }
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
/* 骨架扫光：只动 transform，走合成层，长列表下也不掉帧 */
@keyframes sk-sweep {
  from { transform: translateX(-130%); }
  to { transform: translateX(230%); }
}
@keyframes dot-bounce {
  0%, 100% { transform: translateY(0); opacity: 0.45; }
  50% { transform: translateY(-8rpx); opacity: 1; }
}

/* ========== 迁移新增（以下规则原 WXSS 中没有） ========== */
/* 「全部」分类的滚动锚点：scroll-into-view 需要目标 id 挂在 scroll-view 的直接子节点上 */
.pane-top {
  height: 0;
  overflow: hidden;
}
</style>
