<script setup lang="ts">
/**
 * 邀请好友（店主端）—— 原 pages/admin/invite 迁移
 *
 * 与原实现的差异：
 *  - timeText 用 computed 预计算，模板不再调用函数。
 *  - 订阅提示语改成可配置（utils/subscribe.ts），沿用本页原本的文案。
 *
 * ⚠️ 保留的关键行为：generate() 里成功之后 **不 await** load()，
 * 直接同步调 subscribeForOrders()。wx.requestSubscribeMessage 只能由用户点击触发，
 * 一旦放到 await 之后就可能丢掉用户手势而调用失败。
 */
import { computed, ref } from 'vue'
import { onShareAppMessage, onShow } from '@dcloudio/uni-app'
import { callApi } from '@/utils/cloud'
import { formatTime } from '@/utils/format'
import { requestOrderSubscribe } from '@/utils/subscribe'
import { useUserStore } from '@/stores/user'
import type { Invitation } from '@/types/api'

const userStore = useUserStore()

const invitations = ref<Invitation[]>([])
const loading = ref(true)

let generating = false

const viewInvitations = computed(() =>
  invitations.value.map((i) => ({ ...i, timeText: formatTime(i.createdAt) }))
)

onShow(() => {
  load()
})

async function load() {
  try {
    await userStore.login()
    const res = await callApi<Invitation[]>('invite.list')
    invitations.value = res.data || []
  } catch (e) {
    console.error(e)
  }
  loading.value = false
}

async function generate() {
  if (generating) return
  generating = true
  uni.showLoading({ title: '生成中...', mask: true })
  try {
    const res = await callApi('invite.create')
    uni.hideLoading()
    if (res.code === 0) {
      load()
      // 生成邀请码代表开始一轮点餐，顺手订阅一次「新订单提醒」，
      // 保证朋友下完单店主能收到推送（一次性订阅，需每轮授权一次）
      subscribeForOrders()
    } else {
      uni.showToast({ title: res.msg || '生成失败', icon: 'none' })
    }
  } catch (e) {
    uni.hideLoading()
    uni.showToast({ title: '生成失败', icon: 'none' })
  }
  generating = false
}

function subscribeForOrders() {
  requestOrderSubscribe({
    acceptText: '已开启新订单提醒',
    rejectText: '你拒绝了订阅，订单将无法推送到微信'
  })
}

function copyCode(code: string) {
  uni.setClipboardData({
    data: code,
    success: () => {
      uni.showToast({ title: '邀请码已复制', icon: 'success' })
    }
  })
}

onShareAppMessage((options: any) => {
  // 好友通过分享卡片进来点餐，也顺手订阅一次新订单提醒
  subscribeForOrders()
  // 分享按钮上的 data-code（基础库 2.13.4+ 支持 options.target.dataset）
  let code = options?.target?.dataset?.code
  if (!code && invitations.value.length > 0) {
    const unused = invitations.value.find((i) => !i.used)
    code = unused ? unused.code : invitations.value[0].code
  }
  return {
    title: '邀请你来点餐',
    path: code ? `/pages/invite/invite?code=${code}` : '/pages/index/index'
  }
})
</script>

<template>
  <view class="page">
    <view class="tip-card">
      <text class="tip-title">如何邀请朋友？</text>
      <text class="tip-line">1. 点击下方「生成邀请码」</text>
      <text class="tip-line">2. 把邀请码发给朋友，或点「发送邀请」直接分享小程序</text>
      <text class="tip-line">3. 朋友打开小程序输入邀请码，即可开始点餐</text>
    </view>

    <view class="gen-btn" hover-class="cta-press" hover-stay-time="80" @tap="generate">＋ 生成邀请码</view>

    <view class="list">
      <view v-for="i in viewInvitations" :key="i._id" class="invite-card">
        <view class="invite-main">
          <text class="invite-code">{{ i.code }}</text>
          <text class="invite-state" :class="i.used ? 'used' : 'unused'">{{ i.used ? '已使用' : '未使用' }}</text>
        </view>
        <view class="invite-sub">生成于 {{ i.timeText }}</view>
        <view class="invite-actions">
          <button class="share-btn" open-type="share" :data-code="i.code">发送邀请</button>
          <text class="copy-btn" hover-class="text-press" hover-stay-time="80" @tap="copyCode(i.code)">复制邀请码</text>
        </view>
      </view>
    </view>

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

    <view v-if="viewInvitations.length === 0 && !loading" class="empty">
      <text class="icon">👥</text>
      还没有邀请码
    </view>
  </view>
</template>

<style scoped>
.page {
  padding: 20rpx;
}
.tip-card {
  background: var(--paper);
  border-radius: 20rpx;
  padding: 30rpx;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-sm);
}
.tip-title {
  font-size: 30rpx;
  font-weight: 700;
  color: var(--ink);
  margin-bottom: 16rpx;
}
.tip-line {
  font-size: 26rpx;
  color: var(--tan);
  line-height: 1.9;
}
.gen-btn {
  margin: 30rpx 0;
  height: 88rpx;
  line-height: 88rpx;
  text-align: center;
  background: linear-gradient(135deg, var(--yellow), var(--amber));
  color: var(--ink);
  border-radius: 44rpx;
  font-size: 32rpx;
  font-weight: 700;
  letter-spacing: 1rpx;
  box-shadow: var(--shadow-pop);
}
.invite-card {
  background: var(--paper);
  border-radius: 20rpx;
  padding: 30rpx;
  margin-bottom: 20rpx;
  box-shadow: var(--shadow-sm);
}
.invite-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.invite-code {
  font-size: 44rpx;
  font-weight: 800;
  letter-spacing: 8rpx;
  color: var(--caramel);
  font-variant-numeric: tabular-nums;
}
.invite-state {
  font-size: 24rpx;
  padding: 6rpx 20rpx;
  border-radius: 20rpx;
  font-weight: 600;
}
.invite-state.unused {
  background: #e8f7ef;
  color: #07c160;
}
.invite-state.used {
  background: var(--cream-deep);
  color: var(--tan);
}
.invite-sub {
  font-size: 24rpx;
  color: var(--tan);
  margin-top: 10rpx;
}
.invite-actions {
  display: flex;
  align-items: center;
  margin-top: 20rpx;
}
.share-btn {
  flex: 1;
  background: linear-gradient(135deg, var(--yellow), var(--amber));
  color: var(--ink);
  font-size: 26rpx;
  font-weight: 700;
  border-radius: 32rpx;
  height: 68rpx;
  line-height: 68rpx;
  padding: 0;
  margin: 0;
  box-shadow: var(--shadow-pop);
}
.share-btn::after {
  border: none;
}
.copy-btn {
  margin-left: 24rpx;
  font-size: 26rpx;
  color: var(--caramel);
  font-weight: 600;
}
</style>
