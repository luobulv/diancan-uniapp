<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app'
import { initCloud } from '@/utils/cloud'

onLaunch(() => {
  initCloud()
})
</script>

<style>
/**
 * 呼噜点餐 · 全局设计令牌与通用组件
 * 主题：手作食堂 —— 米白底 60% / 黄棕辅助 30% / 焦糖橙强调 10%
 * 字体说明：小程序无法引入 Web 字体，展示层级用「超粗字重 + 字距」制造个性
 */
page {
  /* —— 色彩令牌 —— */
  --cream: #FFF8E7;        /* 全局底色（米白） */
  --cream-deep: #FBF0D2;   /* 次级浅底 */
  --paper: #FFFDF6;        /* 卡片近白（暖调） */
  --yellow: #F7C948;       /* 品牌黄 */
  --yellow-mist: #FBEEC9;  /* 黄雾底（分类栏等） */
  --yellow-soft: #FDF3D6;  /* 浅黄填充 */
  --amber: #F5A623;        /* 焦糖橙（行动色） */
  --caramel: #D9822B;      /* 数字 / 强调棕橙 */
  --brown: #6B4423;        /* 标题棕 */
  --ink: #4A2F18;          /* 正文深棕 */
  --tan: #8B5A2B;          /* 次要信息（白底对比 4.6:1） */
  --sand: #B98A4A;         /* 装饰性弱化（仅非信息小字） */
  --line: #F1E3BC;         /* 分隔线 */

  /* 兼容旧引用：统一为品牌行动色 */
  --primary: #F5A623;
  --primary-light: #FDF3D6;

  /* —— 圆角 —— */
  --r-plate: 32rpx;        /* 器皿大圆角 */
  --r-bowl: 24rpx;
  --r-pill: 999rpx;

  /* —— 暖调阴影（带环境色，不用纯黑） —— */
  --shadow-sm: 0 2rpx 8rpx rgba(180, 120, 50, 0.08);
  --shadow-md: 0 8rpx 24rpx rgba(180, 120, 50, 0.12);
  --shadow-pop: 0 12rpx 32rpx rgba(245, 166, 35, 0.30);

  /* —— 动效令牌 —— */
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);  /* 弹性过冲 */
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --dur-fast: 160ms;
  --dur-base: 320ms;

  background: var(--cream);
  font-size: 28rpx;
  color: var(--ink);
}

/* H5 端变量兜底（小程序端不会有这段产物） */
/* #ifdef H5 */
:root {
  --cream: #FFF8E7;
  --cream-deep: #FBF0D2;
  --paper: #FFFDF6;
  --yellow: #F7C948;
  --yellow-mist: #FBEEC9;
  --yellow-soft: #FDF3D6;
  --amber: #F5A623;
  --caramel: #D9822B;
  --brown: #6B4423;
  --ink: #4A2F18;
  --tan: #8B5A2B;
  --sand: #B98A4A;
  --line: #F1E3BC;
  --primary: #F5A623;
  --primary-light: #FDF3D6;
  --r-plate: 32rpx;
  --r-bowl: 24rpx;
  --r-pill: 999rpx;
  --shadow-sm: 0 2rpx 8rpx rgba(180, 120, 50, 0.08);
  --shadow-md: 0 8rpx 24rpx rgba(180, 120, 50, 0.12);
  --shadow-pop: 0 12rpx 32rpx rgba(245, 166, 35, 0.30);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --dur-fast: 160ms;
  --dur-base: 320ms;
}
/* #endif */

view, text, image, button, input, textarea {
  box-sizing: border-box;
}

/* ========== 按压反馈（配合 hover-class 使用） ========== */
.pressed, .chip-press, .cate-press, .text-press {
  opacity: 0.6;
}
.cta-press, .btn-press, .sticker-press {
  transform: scale(0.92);
  opacity: 0.9;
}

/* ========== 通用按钮 ========== */
.btn-primary {
  background: linear-gradient(135deg, #F7C948, #F5A623);
  color: var(--ink);
  border-radius: var(--r-pill);
  font-size: 30rpx;
  font-weight: 700;
  letter-spacing: 1rpx;
  box-shadow: var(--shadow-pop);
}
.btn-primary::after {
  border: none;
}

/* ========== 卡片 ========== */
.card {
  background: var(--paper);
  border-radius: var(--r-bowl);
  padding: 24rpx;
  margin: 20rpx;
  box-shadow: var(--shadow-sm);
}

/* ========== 空状态 ========== */
.empty {
  text-align: center;
  color: var(--tan);
  padding: 120rpx 0;
  font-size: 28rpx;
}
.empty .icon {
  font-size: 80rpx;
  display: block;
  margin-bottom: 20rpx;
}

/* ========== 区块标题 ========== */
.section-title {
  font-size: 30rpx;
  font-weight: 700;
  color: var(--ink);
  margin-bottom: 20rpx;
  letter-spacing: 1rpx;
}

/* ========== 标签 ========== */
.tag {
  display: inline-block;
  font-size: 22rpx;
  padding: 4rpx 16rpx;
  border-radius: var(--r-pill);
  line-height: 1.6;
}

/* ========== 骨架屏（列表页通用） ==========
 * 与点餐页骨架屏同一套语言：焦糖 16% 底色 + 只动 transform 的扫光 + 错峰。
 * 点餐页那份是 scoped 的（几何与 .dish-card 逐项对齐），这里只做通用版本，
 * 供 orders / mine / admin 五页复用 —— 不合并是为了不动已定稿的点餐页。
 * 用法：
 *   <view v-if="loading" class="sk-panel">
 *     <view class="sk-head">
 *       <view class="sk-dots"><view class="sk-dot"></view><view class="sk-dot"></view><view class="sk-dot"></view></view>
 *       <text class="sk-head-text">加载中…</text>
 *     </view>
 *     <view v-for="n in 3" :key="n" class="sk-card">
 *       <view class="sk-row">
 *         <view class="sk-thumb"></view>
 *         <view class="sk-lines">
 *           <view class="sk-line sk-w60"></view>
 *           <view class="sk-line sk-w90"></view>
 *           <view class="sk-line sk-w40"></view>
 *         </view>
 *       </view>
 *     </view>
 *   </view>
 */
.sk-panel {
  padding: 24rpx;
}
.sk-head {
  display: flex;
  align-items: center;
  padding: 18rpx 4rpx 24rpx;
}
.sk-dots {
  display: flex;
  align-items: center;
  height: 16rpx;
  margin-right: 14rpx;
}
.sk-dot {
  width: 12rpx;
  height: 12rpx;
  border-radius: 50%;
  background: var(--amber);
  margin-right: 8rpx;
  animation: hl-dot-bounce 1.2s ease-in-out infinite;
}
.sk-dot:nth-child(2) { animation-delay: 160ms; }
.sk-dot:nth-child(3) { animation-delay: 320ms; }
.sk-head-text {
  font-size: 26rpx;
  color: var(--tan);
  letter-spacing: 1rpx;
}
.sk-card {
  position: relative;
  overflow: hidden;
  background: var(--paper);
  border-radius: var(--r-bowl);
  padding: 24rpx;
  margin-bottom: 20rpx;
  border: 2rpx solid rgba(241, 227, 188, 0.6);
  box-shadow: var(--shadow-sm);
}
/* 扫光：只动 transform（走合成层），不用 background-position 之类的重绘属性 */
.sk-card::after {
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
  animation: hl-sk-sweep 1.5s ease-in-out infinite;
}
/* 面板里第 1 个子节点是 .sk-head，所以三张卡片是 nth-child(2|3|4) */
.sk-card:nth-child(3)::after { animation-delay: 120ms; }
.sk-card:nth-child(4)::after { animation-delay: 240ms; }
.sk-row {
  display: flex;
  align-items: center;
}
.sk-thumb {
  width: 88rpx;
  height: 88rpx;
  border-radius: 20rpx;
  background: rgba(217, 130, 43, 0.16);
  flex-shrink: 0;
}
.sk-lines {
  flex: 1;
  min-width: 0;
}
.sk-row .sk-lines {
  margin-left: 20rpx;
}
.sk-line {
  height: 24rpx;
  border-radius: var(--r-pill);
  background: rgba(217, 130, 43, 0.16);
}
.sk-line + .sk-line {
  margin-top: 16rpx;
}
.sk-w30 { width: 30%; }
.sk-w40 { width: 40%; }
.sk-w60 { width: 60%; }
.sk-w90 { width: 90%; }
@keyframes hl-sk-sweep {
  from { transform: translateX(-130%); }
  to { transform: translateX(230%); }
}
@keyframes hl-dot-bounce {
  0%, 100% { transform: translateY(0); opacity: 0.45; }
  50% { transform: translateY(-8rpx); opacity: 1; }
}
</style>
