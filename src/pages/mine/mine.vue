<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { callApi, uploadFile } from '@/utils/cloud'
import { makeCloudImagePath } from '@/utils/image'
import { useUserStore } from '@/stores/user'
import type { FootprintData, HeatmapData } from '@/types/api'

interface HeatmapDay {
  date: string
  count: number
  level: number
}
interface HeatmapWeek {
  days: HeatmapDay[]
}
interface HeatmapMonth {
  name: string
  left: number
}

const userStore = useUserStore()

const loading = ref(true)
const heatmapWeeks = ref<HeatmapWeek[]>([])
const heatmapMonths = ref<HeatmapMonth[]>([])
const scrollLeft = ref(0)
/** 点餐足迹（非店主） */
const footprint = ref({ count: 0, dishes: 0, lastText: '' })
const saving = ref(false)
/** 头像正在上传云存储（防连点重复上传） */
const uploadingAvatar = ref(false)

function pad(n: number) {
  return n < 10 ? '0' + n : '' + n
}

async function load() {
  try {
    // 每次进入都从云端拉取最新角色，避免缓存导致角色标签显示错误
    const user = await userStore.login(true)
    loading.value = false
    if (user.role === 'owner') loadHeatmap()
    else loadFootprint()
  } catch (e) {
    console.error(e)
    loading.value = false
  }
}

onShow(() => {
  load()
})

/** 非店主：拉取点餐足迹（服务端聚合，不依赖分页列表） */
async function loadFootprint() {
  try {
    const res = await callApi<FootprintData>('user.footprint')
    const data = res.data
    if (res.code !== 0 || !data) throw new Error(res.msg || '加载失败')

    let lastText = ''
    if (data.lastAt) {
      const t = new Date(data.lastAt as unknown as string)
      const now = new Date()
      const diffDay = Math.floor((now.getTime() - t.getTime()) / 86400000)
      if (diffDay <= 0) lastText = '今天'
      else if (diffDay === 1) lastText = '昨天'
      else if (diffDay < 30) lastText = `${diffDay} 天前`
      else lastText = '一个月前'
    }
    footprint.value = { count: data.count, dishes: data.dishes, lastText }
  } catch (e) {
    console.error('加载点餐足迹失败：', e)
  }
}

async function loadHeatmap() {
  try {
    const res = await callApi<HeatmapData>('stats.heatmap', { days: 180 })
    const counts = (res.data && res.data.counts) || {}
    const { weeks, months } = buildHeatmap(counts, 26)
    heatmapWeeks.value = weeks
    heatmapMonths.value = months
    scrollLeft.value = 0
    // 渲染完成后滚到最右侧，让今天的数据直接可见
    await nextTick()
    scrollLeft.value = 999999
  } catch (e) {
    console.error('加载热力图失败：', e)
  }
}

function buildHeatmap(counts: Record<string, number>, totalWeeks: number) {
  const today = new Date()
  const start = new Date(today)
  start.setDate(today.getDate() - totalWeeks * 7 + 1)
  // 对齐到周一
  const dow = start.getDay()
  const diff = (dow + 6) % 7
  start.setDate(start.getDate() - diff)

  const weeks: HeatmapWeek[] = []
  for (let w = 0; w < totalWeeks + 1; w++) {
    const days: HeatmapDay[] = []
    for (let d = 0; d < 7; d++) {
      const date = new Date(start)
      date.setDate(start.getDate() + w * 7 + d)
      if (date > today) continue
      const key = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
      const count = counts[key] || 0
      let level = 0
      if (count >= 1) level = 1
      if (count >= 2) level = 2
      if (count >= 4) level = 3
      if (count >= 6) level = 4
      days.push({ date: key, count, level })
    }
    if (days.length) weeks.push({ days })
  }

  const months: HeatmapMonth[] = []
  let prevMonth = ''
  weeks.forEach((week, idx) => {
    const first = week.days[0]
    if (!first) return
    const label = `${parseInt(first.date.slice(5, 7), 10)}月`
    if (label !== prevMonth) {
      months.push({ name: label, left: idx * 28 + 4 })
      prevMonth = label
    }
  })

  return { weeks, months }
}

function showHeatmapHelp() {
  uni.showModal({
    title: '订单动态墙',
    content: '颜色越深表示当天订单越多，方块越密集说明生意越红火～',
    showCancel: false
  })
}

function onHeatmapDayTap(day: HeatmapDay) {
  uni.showToast({ title: `${day.date} 共 ${day.count || 0} 单`, icon: 'none' })
}

/**
 * 选头像 → **先传云存储，再保存 fileID**。
 *
 * ⚠️ 这里绝不能再直接存 `e.detail.avatarUrl`。
 * chooseAvatar 回传的是**本地临时路径**（真机 `wxfile://tmp_xxx`，开发者工具
 * `http://tmp/xxx.jpeg`），它只在当前设备当前会话有效：
 *   · 换手机 / 清缓存 / 重启后自己看不到了；
 *   · 订单会把这一串路径一起写库，店主在订单列表里也加载不出来。
 * 所以必须先 uploadFile 换成 `cloud://` 的 fileID，这个才是跨设备持久可访问的。
 */
async function onChooseAvatar(e: { detail: { avatarUrl: string } }) {
  const tmpPath = e.detail.avatarUrl
  if (!tmpPath || uploadingAvatar.value) return

  uploadingAvatar.value = true
  uni.showLoading({ title: '上传中...', mask: true })
  try {
    const r = await uploadFile(makeCloudImagePath('avatars', tmpPath), tmpPath)
    userStore.patchLocal({ avatarUrl: r.fileID })
    uni.hideLoading()
    await saveProfile()
  } catch (err) {
    uni.hideLoading()
    uni.showToast({ title: '头像上传失败', icon: 'none' })
    console.error('头像上传失败：', err)
  } finally {
    uploadingAvatar.value = false
  }
}

function onNicknameInput(e: { detail: { value: string } }) {
  userStore.patchLocal({ nickname: e.detail.value })
}

function onNicknameBlur() {
  saveProfile()
}

async function saveProfile() {
  const u = userStore.user
  if (!u || saving.value) return

  saving.value = true
  uni.showLoading({ title: '保存中...', mask: true })
  try {
    const res = await userStore.updateProfile({
      nickname: u.nickname,
      avatarUrl: u.avatarUrl
    })
    uni.hideLoading()
    if (res.code === 0) {
      uni.showToast({ title: '已保存', icon: 'success' })
    }
  } catch (e) {
    uni.hideLoading()
    uni.showToast({ title: '保存失败', icon: 'none' })
    console.error(e)
  }
  saving.value = false
}

const ADMIN_ENTRIES = [
  { url: '/pages/admin/dishes/dishes', icon: '🍲', name: '菜品管理' },
  { url: '/pages/admin/categories/categories', icon: '🗂️', name: '分类管理' },
  { url: '/pages/admin/orders/orders', icon: '📦', name: '订单管理' },
  { url: '/pages/admin/stats/stats', icon: '📊', name: '点餐统计' },
  { url: '/pages/admin/invite/invite', icon: '👥', name: '邀请好友' }
]

function goAdmin(url: string) {
  if (!userStore.isOwner) {
    uni.showToast({ title: '仅店主可管理', icon: 'none' })
    return
  }
  uni.navigateTo({ url })
}

function goInvite() {
  uni.navigateTo({ url: '/pages/invite/invite' })
}
</script>

<template>
  <view class="page">
    <view v-if="loading" class="sk-panel">
      <view class="sk-head">
        <view class="sk-dots">
          <view class="sk-dot"></view>
          <view class="sk-dot"></view>
          <view class="sk-dot"></view>
        </view>
        <text class="sk-head-text">加载中…</text>
      </view>
      <view v-for="n in 3" :key="n" class="sk-card">
        <view class="sk-row">
          <view class="sk-thumb"></view>
          <view class="sk-lines">
            <view class="sk-line sk-w60"></view>
            <view class="sk-line sk-w90"></view>
            <view class="sk-line sk-w40"></view>
          </view>
        </view>
      </view>
    </view>

    <template v-else>
      <!-- 个人信息（贴纸卡片） -->
      <view class="profile-card">
        <button class="avatar-btn" open-type="chooseAvatar" @chooseavatar="onChooseAvatar">
          <image
            class="avatar"
            :src="userStore.user?.avatarUrl || '/static/images/avatar-default.png'"
            mode="aspectFill"
          />
          <text class="avatar-edit">{{ uploadingAvatar ? '上传中…' : '修改头像' }}</text>
        </button>
        <view class="profile-info">
          <input
            class="nickname-input"
            type="nickname"
            placeholder="点击设置昵称"
            placeholder-class="nickname-placeholder"
            :maxlength="20"
            :value="userStore.user?.nickname"
            @input="onNicknameInput"
            @blur="onNicknameBlur"
          />
          <text class="role-tag" :class="userStore.user?.role">{{ userStore.roleText }}</text>
        </view>
      </view>

      <!-- 访客提示 -->
      <view v-if="userStore.roleReady && userStore.isGuest" class="guest-card">
        <text>你是访客，接受店主邀请后即可点餐</text>
        <view class="btn-primary invite-btn" @tap="goInvite">接受邀请</view>
      </view>

      <!-- 非店主：点餐足迹卡（呼应店主的热力图） -->
      <view v-if="userStore.roleReady && !userStore.isOwner && !userStore.isGuest" class="footprint-card">
        <view class="footprint-header">
          <view class="section-title">我的点餐足迹</view>
          <text class="footprint-tag">🍽️ 干饭人</text>
        </view>
        <view class="footprint-stats">
          <view class="fp-stat">
            <text class="fp-num">{{ footprint.count }}</text>
            <text class="fp-label">累计下单</text>
          </view>
          <view class="fp-divider"></view>
          <view class="fp-stat">
            <text class="fp-num">{{ footprint.dishes }}</text>
            <text class="fp-label">共点份数</text>
          </view>
          <view class="fp-divider"></view>
          <view class="fp-stat">
            <text class="fp-num">{{ footprint.lastText || '—' }}</text>
            <text class="fp-label">最近下单</text>
          </view>
        </view>
      </view>

      <!-- 店主：管理菜单（贴纸墙） -->
      <view v-if="userStore.roleReady && userStore.isOwner" class="card admin-card">
        <view class="section-title">店铺管理</view>
        <view class="admin-grid">
          <view
            v-for="entry in ADMIN_ENTRIES"
            :key="entry.url"
            class="admin-item"
            hover-class="sticker-press"
            hover-stay-time="80"
            @tap="goAdmin(entry.url)"
          >
            <view class="admin-icon-box">{{ entry.icon }}</view>
            <text class="admin-name">{{ entry.name }}</text>
          </view>
        </view>
      </view>

      <!-- 订单动态墙 -->
      <view v-if="userStore.roleReady && userStore.isOwner" class="card heatmap-card">
        <view class="heatmap-header">
          <view class="section-title">订单动态墙</view>
          <view
            class="heatmap-help"
            hover-class="chip-press"
            hover-stay-time="80"
            @tap="showHeatmapHelp"
          >?</view>
        </view>
        <scroll-view
          class="heatmap-scroll"
          scroll-x
          enhanced
          :show-scrollbar="false"
          :scroll-left="scrollLeft"
          :scroll-with-animation="false"
        >
          <view class="heatmap-body" :style="`width:${heatmapWeeks.length * 28 + 8}rpx`">
            <view class="heatmap-months">
              <view
                v-for="(m, i) in heatmapMonths"
                :key="i"
                class="heatmap-month"
                :style="`left:${m.left}rpx`"
              >{{ m.name }}</view>
            </view>
            <view class="heatmap-grid">
              <view
                v-for="(week, wi) in heatmapWeeks"
                :key="wi"
                class="heatmap-week"
              >
                <view
                  v-for="day in week.days"
                  :key="day.date"
                  class="heatmap-day"
                  :class="`heatmap-level-${day.level}`"
                  @tap="onHeatmapDayTap(day)"
                ></view>
              </view>
            </view>
          </view>
        </scroll-view>
      </view>

      <view class="footer-tip">本小程序仅供我和朋友之间点餐使用</view>
    </template>
  </view>
</template>

<style scoped>
/**
 * 我的页 · 手作食堂视觉
 * 记忆点：贴纸墙（管理图标交错微旋转）· 印章式角色标签 · 食堂会员卡头图
 */
.page {
  padding-bottom: 40rpx;
  background-color: var(--cream);
  background-image: radial-gradient(rgba(245, 166, 35, 0.07) 2rpx, transparent 2rpx);
  background-size: 48rpx 48rpx;
  min-height: 100vh;
}

/* ========== 个人信息（食堂会员卡） ========== */
.profile-card {
  position: relative;
  display: flex;
  align-items: center;
  padding: 44rpx 30rpx 40rpx;
  background: linear-gradient(135deg, #F7C948 0%, #F5A623 100%);
  color: var(--brown);
  overflow: hidden;
  animation: banner-drop 520ms var(--ease-spring) both;
}
.profile-card::before {
  content: '';
  position: absolute;
  right: -80rpx;
  top: -120rpx;
  width: 320rpx;
  height: 320rpx;
  border-radius: 50%;
  background: rgba(255, 253, 246, 0.18);
}
.profile-card::after {
  content: '';
  position: absolute;
  left: -60rpx;
  bottom: -110rpx;
  width: 240rpx;
  height: 240rpx;
  border-radius: 50%;
  background: rgba(107, 68, 35, 0.08);
}
.avatar-btn {
  position: relative;
  z-index: 1;
  background: transparent;
  padding: 0;
  margin: 0;
  line-height: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  border: none;
}
.avatar-btn::after {
  border: none;
}
.avatar {
  width: 140rpx;
  height: 140rpx;
  border-radius: 50%;
  background: #fff;
  border: 6rpx solid rgba(255, 253, 246, 0.85);
  box-shadow: 0 8rpx 20rpx rgba(107, 68, 35, 0.22);
  transform: rotate(-4deg); /* 贴纸感 */
}
.avatar-edit {
  font-size: 22rpx;
  color: rgba(74, 47, 24, 0.72);
  margin-top: 12rpx;
}
.profile-info {
  position: relative;
  z-index: 1;
  margin-left: 30rpx;
  flex: 1;
}
.nickname-input {
  font-size: 38rpx;
  font-weight: 800;
  letter-spacing: 2rpx;
  color: var(--brown);
  border-bottom: 3rpx dashed rgba(255, 253, 246, 0.6);
  padding-bottom: 10rpx;
}
.nickname-placeholder {
  color: rgba(74, 47, 24, 0.5);
  font-weight: 600;
}
/* 印章式角色标签 */
.role-tag {
  display: inline-block;
  font-size: 22rpx;
  padding: 6rpx 20rpx;
  border-radius: var(--r-pill);
  margin-top: 16rpx;
  letter-spacing: 2rpx;
  transform: rotate(2deg);
}
.role-tag.owner {
  background: rgba(255, 253, 246, 0.35);
  border: 2rpx dashed rgba(255, 253, 246, 0.9);
  color: var(--brown);
  font-weight: 800;
}
.role-tag.friend {
  background: rgba(255, 253, 246, 0.25);
  border: 2rpx dashed rgba(255, 253, 246, 0.7);
  color: var(--brown);
  font-weight: 600;
}
.role-tag.guest {
  background: rgba(255, 253, 246, 0.9);
  border: 2rpx dashed var(--sand);
  color: var(--tan);
}

/* ========== 访客卡片 ========== */
.guest-card {
  margin: 24rpx 20rpx 0;
  background: var(--yellow-soft);
  border: 2rpx dashed var(--line);
  border-radius: var(--r-bowl);
  padding: 30rpx;
  font-size: 26rpx;
  color: var(--tan);
  display: flex;
  align-items: center;
  justify-content: space-between;
  animation: fade-up 420ms var(--ease-out) 140ms both;
}
.invite-btn {
  padding: 0 30rpx;
  height: 64rpx;
  line-height: 64rpx;
  font-size: 26rpx;
  flex-shrink: 0;
  margin-left: 20rpx;
}

/* ========== 点餐足迹卡（非店主） ========== */
.footprint-card {
  margin: 24rpx 20rpx 0;
  background: var(--paper);
  border-radius: var(--r-plate) var(--r-bowl) var(--r-bowl) var(--r-plate);
  padding: 28rpx;
  box-shadow: var(--shadow-sm);
  border: 2rpx solid rgba(241, 227, 188, 0.6);
  animation: fade-up 420ms var(--ease-out) 200ms both;
}
.footprint-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24rpx;
}
.footprint-header .section-title {
  margin-bottom: 0;
}
.footprint-tag {
  font-size: 22rpx;
  color: var(--caramel);
  font-weight: 700;
  padding: 6rpx 18rpx;
  background: var(--yellow-soft);
  border: 2rpx dashed var(--line);
  border-radius: var(--r-pill);
  transform: rotate(2deg);
}
.footprint-stats {
  display: flex;
  align-items: center;
}
.fp-stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.fp-num {
  font-size: 44rpx;
  font-weight: 800;
  color: var(--caramel);
  letter-spacing: 1rpx;
  font-variant-numeric: tabular-nums;
}
.fp-label {
  font-size: 22rpx;
  color: var(--tan);
  margin-top: 8rpx;
  letter-spacing: 1rpx;
}
.fp-divider {
  width: 2rpx;
  height: 48rpx;
  background: var(--line);
  flex-shrink: 0;
}

/* ========== 卡片通用（本页覆盖为器皿造型） ========== */
.card {
  margin: 24rpx 20rpx 0;
  background: var(--paper);
  border-radius: var(--r-plate) var(--r-bowl) var(--r-bowl) var(--r-plate);
  padding: 28rpx;
  box-shadow: var(--shadow-sm);
  border: 2rpx solid rgba(241, 227, 188, 0.6);
}
.admin-card {
  animation: fade-up 420ms var(--ease-out) 200ms both;
}
.heatmap-card {
  padding-bottom: 32rpx;
  animation: fade-up 420ms var(--ease-out) 280ms both;
}
/* 区块标题：左侧琥珀小竖条 */
.section-title {
  display: flex;
  align-items: center;
  font-size: 28rpx;
  font-weight: 800;
  color: var(--ink);
  letter-spacing: 1rpx;
  margin-bottom: 8rpx;
}
.section-title::before {
  content: '';
  width: 10rpx;
  height: 26rpx;
  border-radius: 6rpx;
  background: linear-gradient(180deg, var(--yellow), var(--amber));
  margin-right: 12rpx;
}

/* ========== 店铺管理（贴纸墙） ========== */
.admin-grid {
  display: flex;
  flex-wrap: wrap;
  padding-top: 20rpx;
}
.admin-item {
  width: 25%;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20rpx 0 24rpx;
  box-sizing: border-box;
  transition: transform var(--dur-fast) var(--ease-spring);
}
.admin-icon-box {
  width: 100rpx;
  height: 100rpx;
  border-radius: 30rpx;
  background: var(--yellow-soft);
  border: 2rpx solid rgba(241, 227, 188, 0.9);
  box-shadow: var(--shadow-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 48rpx;
  margin-bottom: 14rpx;
}
/* 贴纸墙：交错微旋转，手作感 */
.admin-item:nth-child(odd) .admin-icon-box {
  transform: rotate(-4deg);
}
.admin-item:nth-child(even) .admin-icon-box {
  transform: rotate(3deg);
}
.admin-name {
  font-size: 24rpx;
  color: var(--ink);
}

/* ========== 订单动态墙 ========== */
.heatmap-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16rpx;
}
.heatmap-help {
  width: 40rpx;
  height: 40rpx;
  border-radius: 50%;
  border: 2rpx solid var(--sand);
  color: var(--tan);
  font-size: 22rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}
.heatmap-scroll {
  width: 100%;
  white-space: nowrap;
}
.heatmap-body {
  display: inline-block;
  vertical-align: top;
}
.heatmap-months {
  position: relative;
  height: 36rpx;
  margin-bottom: 8rpx;
}
.heatmap-month {
  position: absolute;
  top: 0;
  font-size: 20rpx;
  color: var(--tan);
}
.heatmap-grid {
  display: flex;
  flex-direction: row;
  padding-left: 4rpx;
}
.heatmap-week {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  margin-right: 8rpx;
}
.heatmap-day {
  width: 20rpx;
  height: 20rpx;
  border-radius: 5rpx;
  background: #f3efe2;
}
.heatmap-level-0 { background: #f3efe2; }
.heatmap-level-1 { background: #fde8c6; }
.heatmap-level-2 { background: #fbd28d; }
.heatmap-level-3 { background: #f5a623; }
.heatmap-level-4 { background: #d9822b; }

/* ========== 页脚 ========== */
.footer-tip {
  text-align: center;
  color: var(--tan);
  font-size: 24rpx;
  letter-spacing: 1rpx;
  margin-top: 48rpx;
  animation: fade-up 420ms var(--ease-out) 360ms both;
}
.footer-tip::before {
  content: '~ ';
  color: var(--sand);
}
.footer-tip::after {
  content: ' ~';
  color: var(--sand);
}

/* ========== 动效 ========== */
@keyframes banner-drop {
  from { opacity: 0; transform: translateY(-36rpx); }
  to { opacity: 1; transform: none; }
}
@keyframes fade-up {
  from { opacity: 0; transform: translateY(32rpx); }
  to { opacity: 1; transform: none; }
}
</style>
