<script setup lang="ts">
import { ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { callApi } from '@/utils/cloud'
import { useUserStore } from '@/stores/user'

type Status = 'input' | 'member' | 'success'

const userStore = useUserStore()

const code = ref('')
const status = ref<Status>('input')
const accepting = ref(false)

onLoad((options) => {
  if (options && options.code) {
    code.value = String(options.code)
  }
})

onShow(() => {
  // 与原 invite.js 的 app.login() 语义一致：不强制刷新
  userStore
    .login()
    .then((user) => {
      if (user.role !== 'guest') status.value = 'member'
    })
    .catch(() => {})
})

function onCodeInput(e: { detail: { value: string } }) {
  code.value = (e.detail.value || '').toUpperCase()
}

async function accept() {
  if (accepting.value) return

  const c = code.value.trim()
  if (!c) {
    uni.showToast({ title: '请输入邀请码', icon: 'none' })
    return
  }

  accepting.value = true
  uni.showLoading({ title: '验证中...', mask: true })
  try {
    const res = await callApi('invite.accept', { code: c })
    uni.hideLoading()
    if (res.code === 0) {
      // 角色已变化，强制从云端刷新（对应原 app.refreshUser()）
      await userStore.login(true)
      status.value = 'success'
    } else {
      uni.showToast({ title: res.msg || '接受失败', icon: 'none' })
    }
  } catch (e) {
    uni.hideLoading()
    uni.showToast({ title: '操作失败', icon: 'none' })
  }
  accepting.value = false
}

function goOrder() {
  uni.switchTab({ url: '/pages/index/index' })
}
</script>

<template>
  <view class="page">
    <!-- 已是成员 -->
    <view v-if="status === 'member'" class="status-card">
      <text class="status-icon">🎉</text>
      <text class="status-title">你已是点餐成员</text>
      <text class="status-desc">可以直接去点餐啦</text>
      <view class="btn-primary main-btn" hover-class="cta-press" hover-stay-time="80" @tap="goOrder">去点餐</view>
    </view>

    <!-- 接受成功 -->
    <view v-else-if="status === 'success'" class="status-card">
      <text class="status-icon">✅</text>
      <text class="status-title">邀请接受成功</text>
      <text class="status-desc">你现在可以开始点餐了</text>
      <view class="btn-primary main-btn" hover-class="cta-press" hover-stay-time="80" @tap="goOrder">开始点餐</view>
    </view>

    <!-- 输入邀请码 -->
    <view v-else class="status-card">
      <text class="status-icon">🔑</text>
      <text class="status-title">输入邀请码</text>
      <text class="status-desc">请向店主索取邀请码后填写</text>
      <input
        class="code-input"
        placeholder="6 位邀请码"
        placeholder-class="code-placeholder"
        maxlength="6"
        :value="code"
        @input="onCodeInput"
      />
      <view class="btn-primary main-btn" hover-class="cta-press" hover-stay-time="80" @tap="accept">接受邀请</view>
    </view>
  </view>
</template>

<style scoped>
/* 接受邀请 · 玩趣 × 手作食堂
   原样式是色系统一时漏掉的一页（纯白卡片 + #999 灰字），此处对齐设计令牌 */
.page {
  min-height: 100vh;
  padding: 80rpx 40rpx;
  background-color: var(--cream);
  background-image: radial-gradient(rgba(217, 130, 43, 0.08) 2rpx, transparent 2rpx);
  background-size: 48rpx 48rpx;
}

.status-card {
  position: relative;
  background: var(--paper);
  /* 器皿圆角：左上收紧 + 右下大圆角，制造手作感 */
  border-radius: 20rpx 48rpx 20rpx 48rpx;
  padding: 72rpx 44rpx 56rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  box-shadow: var(--shadow-md);
  overflow: hidden;
}
/* 卡片右上角暖光，呼应首页 banner 双氛围圆 */
.status-card::before {
  content: '';
  position: absolute;
  top: -80rpx;
  right: -80rpx;
  width: 240rpx;
  height: 240rpx;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(247, 201, 72, 0.34), rgba(247, 201, 72, 0));
}

/* 印章式图标底盘 */
.status-icon {
  font-size: 88rpx;
  line-height: 1;
  width: 152rpx;
  height: 152rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--yellow-mist);
  border: 2rpx dashed var(--line);
  border-radius: 50%;
  position: relative;
  z-index: 1;
}

.status-title {
  font-size: 40rpx;
  font-weight: 800;
  letter-spacing: 2rpx;
  color: var(--brown);
  margin-top: 36rpx;
  position: relative;
  z-index: 1;
}
.status-desc {
  font-size: 26rpx;
  color: var(--tan);
  margin-top: 14rpx;
  letter-spacing: 1rpx;
  position: relative;
  z-index: 1;
}

/* 邀请码输入：价签感 —— 浅黄填充 + 虚线框 */
.code-input {
  width: 100%;
  height: 104rpx;
  background: var(--yellow-soft);
  border: 2rpx solid var(--line);
  border-radius: var(--r-bowl);
  text-align: center;
  font-size: 44rpx;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: 14rpx;
  color: var(--brown);
  margin: 48rpx 0 40rpx;
  position: relative;
  z-index: 1;
  box-sizing: border-box;
}
.code-placeholder {
  color: var(--sand);
  font-size: 28rpx;
  font-weight: 400;
  letter-spacing: 2rpx;
}

.main-btn {
  width: 100%;
  height: 92rpx;
  line-height: 92rpx;
  text-align: center;
  position: relative;
  z-index: 1;
}
</style>
