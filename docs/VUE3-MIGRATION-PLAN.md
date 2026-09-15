# 呼噜点餐 · Vue3 + Pinia 迁移方案

> **结论**：技术上完全可行，且云函数零改动。真正的成本不在代码迁移（约 1280 行前端 JS + 1000 行 WXML），而在 2400 行手工调优的 WXSS 的**视觉回归核对**。建议采用 uni-app（Vue3 + Vite + TypeScript + Pinia）路线，保留微信云开发，分 5 批迁移。

> 📌 **本文是迁移前的方案快照**，文中的行数与 action 数（18 个、272 行）均为**当时**的数值。
> 迁移完成后又做过架构审查与两轮优化，现状请看 `README.md` 与 `REVIEW-2026-09-14.md`：
> action 已增至 19 个（新增 `user.footprint`），`api/index.js` 约 600 行。

| 项目 | 值 |
| --- | --- |
| 现状规模 | 5234 行 / 9 页面 / 2 云函数 / 18 个 API action |
| AppID | `wx2c146bc0f9cf7637` |
| 云环境 ID | `cloud1-d1gxp9yoob9c5add6` |
| 订阅模板 ID | `9c7BsTLl1hL6bIAJ00J9c36A-NV-KREvOdnyGJvNklg` |
| 基础库 | 3.4.10 |
| 目标栈 | uni-app 3.x + Vue 3.4+ + Vite + Pinia + TypeScript |
| 后端 | **保持微信云开发不变**（不用 uniCloud） |

---

## 1. 结论摘要

**可以重构，且难度低于预期**，理由有三：

1. **云函数是 Node 环境，与前端框架完全无关** —— `login` 和 `api` 两个云函数共 320 行、18 个 action，一行都不用改。
2. **微信 API 触点只有约 70 处，且全是「一行替换」级别** —— `wx.showToast`（45）、`wx.showModal`（5）、`navigateTo/switchTab`（7）、`cloud.*`（4）、`requestSubscribeMessage`（2）、`pageScrollTo/createSelectorQuery`（4）、`onShareAppMessage`（2）、`chooseMedia`（1）。
3. **WXSS 可以 1:1 复用** —— uni-app 编译到小程序端时 `rpx`、CSS 变量、`hover-class` 全部原生支持。

**真正的成本在两处**：
- **视觉回归**（占大头）：2400 行 WXSS 里是手工调优的器皿圆角、黄橙渐变 CTA、按压反馈体系、圆点纹理背景、入场错峰动效，模板结构一变就要逐页像素级复核。
- **工程链路**：云函数目录与编译产物分离，需要额外配置（见 6.11，这是最容易卡住的地方）。

---

## 2. 现状盘点（实测）

### 2.1 规模分布

| 层 | 文件数 | 行数 | 迁移方式 |
| --- | --- | --- | --- |
| 云函数 | 2 | 320 | **零改动** |
| 页面 JS | 9 | 1280 | 改为 `<script setup>` + Pinia |
| WXML | 10 | ~1000 | 改为 Vue 模板 |
| WXSS | 10 | ~2400 | 直接复用 |
| 页面 JSON | 9 | ~40 | 合并进 `pages.json` |
| wxs | 1 | 8 | 改为组合式函数 |
| 图片资源 | 10 | — | 搬到 `static/` |

### 2.2 可直接复用的技术资产

| 资产 | 复用方式 |
| --- | --- |
| `app.wxss` 全部设计令牌（`--cream`/`--yellow`/`--amber`/`--brown`/`--ink`/`--tan`/`--line`、圆角、暖调阴影、缓动令牌） | 原样搬进 `App.vue` 的 `<style>` |
| `.cta-press` / `.btn-press` / `.chip-press` / `.cate-press` / `.text-press` 按压体系 | 原样保留（`hover-class` 在 uni-app 小程序端透传） |
| `.btn-primary` / `.card` / `.empty` / `.section-title` / `.tag` / `.loading-box` | 原样保留 |
| 云函数 18 个 action 接口契约 | 原样保留，前端只换调用方式 |
| 数据库 5 个集合结构 | 完全不动 |
| 订阅消息后端推送逻辑（含 `notified` 回写） | 完全不动 |

### 2.3 各页面迁移难度

| 页面 | JS 行数 | 难度 | 说明 |
| --- | --- | --- | --- |
| `index`（点餐页） | 268 | **高** | 两栏滚动联动 + 购物车 + 双弹窗 |
| `admin/dishes` | 274 | 中 | 表单 + 图片上传 + wxs 评级星 |
| `mine` | 181 | 中 | 热力图布局计算 + 头像昵称编辑 |
| `orders` | 169 | 中 | 订阅消息补授权入口 |
| `admin/categories` | 117 | 低 | 纯增删改 |
| `admin/invite` | 91 | 低 | 列表 + 复制 |
| `admin/orders` | 75 | 低 | 列表 + 状态筛选 |
| `invite` | 60 | 低 | 单个输入框 |
| `admin/stats` | 45 | 低 | 排行榜渲染 |

---

## 3. 技术选型

### 3.1 决策表

| 决策点 | 选择 | 理由 |
| --- | --- | --- |
| 跨端框架 | **uni-app** | Vue3 支持是一等公民；Taro 的 Vue 侧生态明显薄于 React 侧 |
| 构建工具 | Vite | uni-app 官方 CLI 模板 `vite-ts` |
| 状态管理 | Pinia | 官方推荐，组合式 API 友好 |
| 类型系统 | TypeScript | 把 18 个 action 的出入参类型固化下来 |
| 后端 | **微信云开发（沿用）** | 零改动、零迁移成本、免费额度够用 |
| UI 组件库 | **不引入** | 你的设计系统高度定制，通用库的覆写成本大于收益 |
| CSS 方案 | 原生 WXSS 写法 | 保持与现有 2400 行样式一致 |
| 路由 | uni-app 内置 | 替代 `app.json` 的 pages 数组 |

### 3.2 依赖清单

```bash
# 创建工程（官方 Vite + TS 模板）
npx degit dcloudio/uni-preset-vue#vite-ts diancan-uniapp
cd diancan-uniapp
npm install

# 状态管理
npm i pinia

# 微信小程序 API 类型（提供 wx.cloud 的类型定义）
npm i -D miniprogram-api-typings

# 类型检查
npm i -D vue-tsc
```

**版本锁定要求**：`package.json` 里 uni-app 相关依赖会带 `alpha` 标签（`@dcloudio/uni-app` 的版本号形如 `3.0.0-40xxxxx`），**必须提交 `package-lock.json`**，不要用 `^` 放宽，避免升级引入 breaking change。

### 3.3 ⚠️ 必须先想清楚：你要 H5 吗？

这是本次重构最容易被低估的决策点。

**微信云开发的云函数无法从浏览器直接调用。** 云函数依赖 `cloud.getWXContext()` 拿 `OPENID` 做鉴权，浏览器没有这个上下文；`wx.cloud.callFunction` 在 H5 端也不存在。

所以：

| 目标 | 可行性 |
| --- | --- |
| 小程序 + 未来可能的 H5 只读预览（看菜单） | ✅ 用云开发 HTTP 触发器可做 |
| 小程序 + H5 完整点餐下单 | ❌ 需要额外自建 HTTP 层 + token 鉴权 + openid 传递，工作量翻倍 |
| 只要小程序 | ✅ 本方案完全覆盖 |

**建议**：本次重构**只出小程序端**。把 H5 当作「以后可能」而不是「本次目标」。如果确实想要 H5，先做完小程序端迁移，再在稳定基线上评估 HTTP 层。

---

## 4. 目标工程结构

```
diancan-uniapp/
├── cloudfunctions/                  # 云函数（从原项目复制，保持原样）
│   ├── login/{index.js,package.json}
│   └── api/{index.js,package.json}
├── scripts/
│   └── link-cloudfunctions.mjs      # 把云函数挂进编译产物（见 6.11）
├── src/
│   ├── App.vue                      # 全局样式（原 app.wxss）+ 云开发初始化
│   ├── main.ts                      # createSSRApp + Pinia
│   ├── manifest.json                # 替代 project.config.json
│   ├── pages.json                   # 替代 app.json
│   ├── uni.scss
│   ├── config.ts                    # 原 config.js
│   ├── static/
│   │   └── images/                  # 原 miniprogram/images 全部搬入
│   ├── types/
│   │   └── api.d.ts                 # 18 个 action 的出入参类型
│   ├── stores/
│   │   ├── user.ts                  # 替代 app.globalData.user
│   │   ├── catalog.ts               # 分类 + 菜品 + 分组
│   │   └── cart.ts                  # 购物车
│   ├── utils/
│   │   ├── cloud.ts                 # wx.cloud 封装（条件编译）
│   │   ├── subscribe.ts             # 订阅消息
│   │   └── format.ts                # 原 util.js 的 formatTime / statusInfo
│   ├── composables/
│   │   └── useRating.ts             # 替代 rating.wxs
│   ├── components/                  # 【新增收益】抽取复用组件
│   │   ├── DishCard.vue
│   │   ├── QuantityStepper.vue
│   │   ├── RatingStars.vue
│   │   └── OrderStatusTag.vue
│   └── pages/
│       ├── index/index.vue
│       ├── orders/orders.vue
│       ├── mine/mine.vue
│       ├── invite/invite.vue
│       └── admin/
│           ├── dishes/dishes.vue
│           ├── categories/categories.vue
│           ├── orders/orders.vue
│           ├── stats/stats.vue
│           └── invite/invite.vue
├── package.json
├── tsconfig.json
└── vite.config.ts
```

**组件化收益点**（原项目里的重复代码）：

| 组件 | 消除的重复 |
| --- | --- |
| `QuantityStepper` | index 页出现 2 次（菜品列表 + 购物车弹窗），加减逻辑各写一遍 |
| `RatingStars` | index 展示 + dishes 编辑，两套星级渲染 |
| `OrderStatusTag` | orders、admin/orders 各有一套 `statusInfo` 映射 |
| `DishCard` | index 列表项 |

---

## 5. 映射速查表

### 5.1 模板语法

| 原生 WXML | Vue 3 |
| --- | --- |
| `{{ x }}` | `{{ x }}`（不变） |
| `wx:for="{{list}}" wx:key="_id"` | `v-for="item in list" :key="item._id"` |
| `wx:for-item="group"` | `v-for="group in list"`（变量名由 `v-for` 表达式决定） |
| `wx:if` / `wx:elif` / `wx:else` | `v-if` / `v-else-if` / `v-else` |
| `<block wx:if>` | `<template v-if>` |
| `wx:key="*this"` | `:key="s"` |
| `bindtap="fn"` | `@tap="fn"` |
| `catchtap="fn"` | `@tap.stop="fn"` |
| `data-id="{{item._id}}"` + `e.currentTarget.dataset.id` | `@tap="fn(item._id)"` **直接传参** |
| `bindinput="fn"` + `value="{{x}}"` | `v-model="x"` |
| `<wxs src>` | 组合式函数 / `computed` |
| `class="a {{cond ? 'b' : ''}}"` | `:class="['a', { b: cond }]"` |
| `hover-class` / `hover-stay-time` | **保留原样**（uni-app 小程序端透传） |
| `{{groupList[groupList.length-1]._id === '__uncat__'}}` | ⚠️ 模板中禁止复杂表达式，改为 `computed` |

### 5.2 逻辑与生命周期

| 原生 | Vue 3 + uni-app |
| --- | --- |
| `Page({ data: {...} })` | `const x = ref()` / `reactive()` |
| `this.data.x` | `x.value` |
| `this.setData({ a: 1 })` | `a.value = 1` |
| `this.setData({ 'user.nickname': v })` | `user.value.nickname = v` |
| `this.setData({...}, callback)` | `await nextTick()` |
| `app.globalData.user` | `useUserStore().user` |
| `app.refreshUser()` | `useUserStore().login(true)` |
| `onLoad` / `onShow` / `onReady` | `import { onLoad, onShow, onReady } from '@dcloudio/uni-app'` |
| `onPullDownRefresh` | `onPullDownRefresh` from `@dcloudio/uni-app` |
| `onShareAppMessage` | `onShareAppMessage` from `@dcloudio/uni-app` |
| `require('../utils/util')` | `import { formatTime } from '@/utils/format'` |
| `this._submitting` 实例标记 | 模块级 `let submitting = false` 或 `ref` |

### 5.3 API 映射

| 原生 | uni-app |
| --- | --- |
| `wx.showToast` | `uni.showToast` |
| `wx.showModal` | `uni.showModal` |
| `wx.showLoading` / `hideLoading` | `uni.showLoading` / `uni.hideLoading` |
| `wx.navigateTo` | `uni.navigateTo` |
| `wx.switchTab` | `uni.switchTab` |
| `wx.pageScrollTo` | `uni.pageScrollTo` |
| `wx.createSelectorQuery` | `uni.createSelectorQuery().in(instance)` ⚠️ |
| `wx.chooseMedia` | `uni.chooseMedia` |
| `wx.setClipboardData` | `uni.setClipboardData` |
| `wx.cloud.*` | **保留 `wx.cloud.*`** + 条件编译（见 6.2） |
| `wx.requestSubscribeMessage` | **保留原生调用** + 条件编译（见 6.6） |

### 5.4 样式映射

| 原生 | uni-app | 说明 |
| --- | --- | --- |
| `rpx` | `rpx` | 直接复用，H5 端会自动换算 |
| `page { --var: ... }` | `page { }` + `:root { }` 分开写 | 见 6.5 |
| `app.wxss` | `App.vue` 的 `<style>` | 全局样式 |
| 页面 `.wxss` | `<style scoped>` | 注意 `scoped` 会影响穿透写法 |
| `hover-class` | 小程序端有效 | ⚠️ H5 端无效，需改用 `:active` |
| `@import` | `@import` | 支持 |

---

## 6. 关键改造点（含代码）

### 6.1 入口与云开发初始化

```ts
// src/main.ts
import { createSSRApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'

export function createApp() {
  const app = createSSRApp(App)
  app.use(createPinia())
  return { app }
}
```

> ⚠️ uni-app Vue3 必须用 `createSSRApp` 并导出 `createApp` 函数，不能直接用 `createApp().mount()`。

```ts
// src/config.ts
export const CLOUD_ENV = 'cloud1-d1gxp9yoob9c5add6'
export const SUBSCRIBE_TEMPLATE_ID = '9c7BsTLl1hL6bIAJ00J9c36A-NV-KREvOdnyGJvNklg'
```

### 6.2 API 层封装（条件编译）

```ts
// src/utils/cloud.ts
import { CLOUD_ENV } from '@/config'

export interface ApiResult<T = unknown> {
  code: number
  msg?: string
  data?: T
}

// #ifdef MP-WEIXIN
export function initCloud() {
  if (!wx.cloud) {
    console.error('请使用 2.2.3 或以上的基础库以使用云能力')
    return
  }
  wx.cloud.init({ env: CLOUD_ENV, traceUser: true })
}

export function callApi<T = unknown>(
  action: string,
  data: Record<string, unknown> = {}
): Promise<ApiResult<T>> {
  return wx.cloud
    .callFunction({ name: 'api', data: { action, ...data } })
    .then((res) => res.result as ApiResult<T>)
}

export function callLogin<T = unknown>(): Promise<ApiResult<T>> {
  return wx.cloud
    .callFunction({ name: 'login', data: {} })
    .then((res) => res.result as ApiResult<T>)
}

export function uploadFile(cloudPath: string, filePath: string) {
  return wx.cloud.uploadFile({ cloudPath, filePath })
}
// #endif
```

**要点**：`action` 与后端 `cloudfunctions/api/index.js` 的 `case` 完全一致，18 个 action 一个不改：

`user.updateProfile`、`category.list/add/update/delete`、`dish.list/add/update/delete`、`invite.create/list/accept`、`order.create/listMine/listAll/updateStatus`、`stats.heatmap/get`

**建议**：建 `src/types/api.d.ts` 把这 18 个接口的出入参类型写出来，`callApi<Category[]>('category.list')` 就有完整类型提示。

### 6.3 Pinia store 设计

#### `stores/user.ts` —— 替代 `app.globalData`

```ts
import { defineStore } from 'pinia'
import { callLogin } from '@/utils/cloud'

export type Role = 'owner' | 'friend' | 'guest'

export interface User {
  _id: string
  openid: string
  nickname: string
  avatarUrl: string
  role: Role
  invitedBy?: string
}

export const useUserStore = defineStore('user', {
  state: () => ({
    user: null as User | null,
    loading: false
  }),

  getters: {
    isOwner: (s) => s.user?.role === 'owner',
    isGuest: (s) => s.user?.role === 'guest',
    roleText: (s): string => {
      if (!s.user) return ''
      const map: Record<Role, string> = {
        owner: '店主',
        friend: '点餐成员',
        guest: '访客（未接受邀请）'
      }
      return map[s.user.role]
    }
  },

  actions: {
    // 对应原 app.login()；force=true 对应原 app.refreshUser()
    async login(force = false) {
      if (this.user && !force) return this.user
      if (force) this.user = null
      const res = await callLogin<User>()
      if (res.code !== 0 || !res.data) throw new Error(res.msg || '登录失败')
      this.user = res.data
      return this.user
    },

    async updateProfile(profile: Partial<Pick<User, 'nickname' | 'avatarUrl'>>) {
      const res = await callApi<User>('user.updateProfile', profile)
      if (res.code === 0 && res.data) this.user = res.data
      return res
    }
  }
})
```

> **关键行为保持一致**：原 `index.js` 和 `mine.js` 的 `onShow` 都调用了 `app.refreshUser()`（强制从云端刷新角色），迁移后必须继续调 `login(true)`，**不能优化掉**。这是「登录自愈 / 后台改角色」的依赖，注释里写明了。

#### `stores/cart.ts` —— 消灭 `computeCart` / `applyCart` 样板

```ts
import { defineStore } from 'pinia'

export interface Dish {
  _id: string
  name: string
  categoryId: string
  imageUrl: string
  rating: number
  orderCount: number
}

export const useCartStore = defineStore('cart', {
  state: () => ({
    items: {} as Record<string, { dish: Dish; quantity: number }>
  }),

  getters: {
    // 对应原 data.cartCount
    count: (s) => Object.values(s.items).reduce((n, i) => n + i.quantity, 0),
    // 对应原 data.cartList
    list: (s) =>
      Object.keys(s.items).map((id) => ({
        dishId: id,
        ...s.items[id].dish,
        quantity: s.items[id].quantity
      })),
    // 模板里直接 cart.quantityOf(dish._id)，替代原 cart[dish._id] 判断
    quantityOf: (s) => (id: string) => s.items[id]?.quantity ?? 0
  },

  actions: {
    add(dish: Dish) {
      const it = this.items[dish._id]
      if (it) it.quantity++
      else this.items[dish._id] = { dish, quantity: 1 }
    },
    decrease(id: string) {
      const it = this.items[id]
      if (!it) return
      if (it.quantity <= 1) delete this.items[id]
      else it.quantity--
    },
    clear() {
      this.items = {}
    }
  }
})
```

**收益**：原 `index.js` 里 `computeCart` / `applyCart` / 6 个 `setData` 全部消失。模板里 `{{cart[dish._id].quantity}}` 改成 `{{cartStore.quantityOf(dish._id)}}`。

> **不引入持久化**：原项目购物车是页面级状态（`onShow` 时重新 init，不跨启动保留），Pinia 也保持不持久化，行为等价。

#### `stores/catalog.ts` —— 分类 + 菜品 + 分组

```ts
export const useCatalogStore = defineStore('catalog', {
  state: () => ({
    categories: [] as Category[],
    dishes: [] as Dish[],
    loading: true
  }),

  getters: {
    // 对应原 index.js 的 groupList 构建逻辑
    groupList: (s) => {
      const grouped: { _id: string; name: string; dishes: Dish[] }[] = []
      if (s.categories.length > 0) {
        s.categories.forEach((c) => {
          const list = s.dishes.filter((d) => d.categoryId === c._id)
          if (list.length > 0) grouped.push({ _id: c._id, name: c.name, dishes: list })
        })
        const uncat = s.dishes.filter(
          (d) => !s.categories.some((c) => c._id === d.categoryId)
        )
        if (uncat.length > 0) grouped.push({ _id: '__uncat__', name: '未分类', dishes: uncat })
      } else {
        grouped.push({ _id: 'all', name: '全部', dishes: s.dishes })
      }
      return grouped
    }
  },

  actions: {
    async load() {
      this.loading = true
      try {
        const [catRes, dishRes] = await Promise.all([
          callApi<Category[]>('category.list'),
          callApi<Dish[]>('dish.list')
        ])
        this.categories = catRes.data || []
        this.dishes = (dishRes.data || []).map((d) => ({ ...d, rating: d.rating || 0 }))
      } finally {
        this.loading = false
      }
    }
  }
})
```

**注意**：`groupList` 从 `data` 字段改为 **getter**，这是最漂亮的一处简化 —— 原来每次分类/菜品变化都要手动跑一遍 `init()` 重新构建分组，现在 Vue 的响应式会自动重算。

**⚠️ 跨页共享的陷阱**：`catalog.ts` 被 `index` 和 `admin/dishes` 共用。但 admin 页改完菜品后需要 `catalog.load()` 刷新。建议：admin 的增删改操作完成后主动调用 `useCatalogStore().load()`，否则 index 页会显示旧数据。

### 6.4 pages.json 完整配置

```json
{
  "pages": [
    { "path": "pages/index/index",           "style": { "navigationBarTitleText": "点餐",     "enablePullDownRefresh": true } },
    { "path": "pages/orders/orders",         "style": { "navigationBarTitleText": "我的订单", "enablePullDownRefresh": true } },
    { "path": "pages/mine/mine",             "style": { "navigationBarTitleText": "我的" } },
    { "path": "pages/invite/invite",         "style": { "navigationBarTitleText": "接受邀请" } },
    { "path": "pages/admin/dishes/dishes",         "style": { "navigationBarTitleText": "菜品管理" } },
    { "path": "pages/admin/categories/categories", "style": { "navigationBarTitleText": "分类管理" } },
    { "path": "pages/admin/orders/orders",         "style": { "navigationBarTitleText": "订单管理", "enablePullDownRefresh": true } },
    { "path": "pages/admin/stats/stats",           "style": { "navigationBarTitleText": "点餐统计", "enablePullDownRefresh": true } },
    { "path": "pages/admin/invite/invite",         "style": { "navigationBarTitleText": "邀请好友" } }
  ],

  "globalStyle": {
    "navigationBarBackgroundColor": "#F5A623",
    "navigationBarTitleText": "点餐",
    "navigationBarTextStyle": "white",
    "backgroundColor": "#FFF8E7",
    "backgroundTextStyle": "light"
  },

  "tabBar": {
    "color": "#999999",
    "selectedColor": "#F5A623",
    "backgroundColor": "#ffffff",
    "borderStyle": "black",
    "list": [
      { "pagePath": "pages/index/index",   "text": "点餐", "iconPath": "static/images/tab-food.png",  "selectedIconPath": "static/images/tab-food-active.png" },
      { "pagePath": "pages/orders/orders", "text": "订单", "iconPath": "static/images/tab-order.png", "selectedIconPath": "static/images/tab-order-active.png" },
      { "pagePath": "pages/mine/mine",     "text": "我的", "iconPath": "static/images/tab-mine.png",  "selectedIconPath": "static/images/tab-mine-active.png" }
    ]
  },

  "lazyCodeLoading": "requiredComponents"
}
```

**对照原 `app.json` 的差异**：

| 项 | 原值 | 迁移后 |
| --- | --- | --- |
| `pages` | 字符串数组 | 对象数组，原来的 `.json` 配置合并进 `style` |
| `window` | 顶层字段 | 改名为 `globalStyle` |
| `style: "v2"` | 有 | 删除（uni-app 无此配置） |
| `sitemapLocation` | 有 | 删除（uni-app 不生成 sitemap；如需保留，手动放 `src/sitemap.json`） |
| tabBar 图标路径 | `images/xxx.png` | `static/images/xxx.png`（**去掉前导斜杠**） |

> ⚠️ **图片路径规则**：`pages.json` 里的路径**不带**前导斜杠；`.vue` 模板里引用**带**前导斜杠，如 `<image src="/static/images/placeholder.png" />`。

### 6.5 全局样式与 CSS 变量

`App.vue` 承载原 `app.wxss`：

```vue
<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app'
import { initCloud } from '@/utils/cloud'

onLaunch(() => {
  initCloud()
})
</script>

<style>
/* 小程序端 */
page,

/* H5 端 */
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

page {
  background: var(--cream);
  font-size: 28rpx;
  color: var(--ink);
}

view, text, image, button, input, textarea {
  box-sizing: border-box;
}

.pressed, .chip-press, .cate-press, .text-press { opacity: 0.6; }
.cta-press, .btn-press, .sticker-press { transform: scale(0.92); opacity: 0.9; }

.btn-primary {
  background: linear-gradient(135deg, #F7C948, #F5A623);
  color: var(--ink);
  border-radius: var(--r-pill);
  font-size: 30rpx;
  font-weight: 700;
  letter-spacing: 1rpx;
  box-shadow: var(--shadow-pop);
}
.btn-primary::after { border: none; }

.card {
  background: var(--paper);
  border-radius: var(--r-bowl);
  padding: 24rpx;
  margin: 20rpx;
  box-shadow: var(--shadow-sm);
}

.section-title { font-size: 30rpx; font-weight: 700; color: var(--ink); margin-bottom: 20rpx; letter-spacing: 1rpx; }
.tag { display: inline-block; font-size: 22rpx; padding: 4rpx 16rpx; border-radius: var(--r-pill); line-height: 1.6; }

.loading-box { display: flex; flex-direction: column; align-items: center; color: var(--tan); padding: 120rpx 0; font-size: 26rpx; }
.loading-icon {
  width: 48rpx; height: 48rpx;
  border: 6rpx solid var(--yellow-soft);
  border-top-color: var(--amber);
  border-radius: 50%;
  animation: loading-spin 0.8s linear infinite;
  margin-bottom: 16rpx;
}
@keyframes loading-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
</style>
```

> ⚠️ **不要写成 `page, :root { }` 单组选择器**。小程序 WXSS 解析器对未知伪类的容错行为不确定，可能导致整组规则被丢弃。分成两个独立的规则块（如上有 `page` 独立块、`:root` 独立块）最安全。

### 6.6 订阅消息

```ts
// src/utils/subscribe.ts
import { SUBSCRIBE_TEMPLATE_ID } from '@/config'

export function requestOrderSubscribe(): Promise<void> {
  return new Promise((resolve) => {
    // #ifdef MP-WEIXIN
    wx.requestSubscribeMessage({
      tmplIds: [SUBSCRIBE_TEMPLATE_ID],
      success: (res: Record<string, string>) => {
        if (res[SUBSCRIBE_TEMPLATE_ID] === 'accept') {
          uni.showToast({ title: '已补一次推送额度', icon: 'success' })
        } else if (res[SUBSCRIBE_TEMPLATE_ID] === 'reject') {
          uni.showToast({ title: '你拒绝了订阅，订单仍无法推送到微信', icon: 'none' })
        }
        resolve()
      },
      fail: () => {
        uni.showToast({ title: '订阅失败', icon: 'none' })
        resolve()
      }
    })
    // #endif
  })
}
```

> ⚠️ **保持原生 `wx.requestSubscribeMessage`，不要换成 `uni.requestSubscribeMessage`**。uni 的封装在某些版本上对 `res[tmplId]` 的返回结构做了加工，会导致 `'accept'` 判断失效。用条件编译保留原生调用是最稳的。

**后端模板字段名不要动**：`cloudfunctions/api/index.js` 里用的是 `thing15`（菜品摘要）、`time9`（时间）、`thing14`（点餐人），这与你公众平台申请的模板一一对应。（`README.md` 里写的 `thing1/time2/thing3` 是过时描述，以代码为准。）

### 6.7 图片上传

```ts
// src/pages/admin/dishes/dishes.vue
import { uploadFile } from '@/utils/cloud'

const uploading = ref(false)

async function onChooseImage() {
  const res = await uni.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'] })
  const filePath = res.tempFiles[0].tempFilePath
  await uploadImage(filePath)
}

async function uploadImage(filePath: string) {
  uploading.value = true
  uni.showLoading({ title: '上传中...', mask: true })
  try {
    const ext = (filePath.split('.').pop() || 'jpg').toLowerCase()
    const cloudPath = `dishes/${Date.now()}-${Math.floor(Math.random() * 10000)}.${ext}`
    const r = await uploadFile(cloudPath, filePath)
    form.imageUrl = r.fileID
  } catch {
    uni.showToast({ title: '上传失败', icon: 'none' })
  } finally {
    uni.hideLoading()
    uploading.value = false
  }
}
```

**云存储路径 `dishes/` 与权限配置完全不变。**

### 6.8 分享

```ts
import { onShareAppMessage } from '@dcloudio/uni-app'

onShareAppMessage(() => ({
  title: '一起点餐吧',
  path: '/pages/index/index'
}))
```

**邀请分享的 `?code=xxxxxx` 参数逻辑不变**，仍在 `onLoad` 里读 `options.code`：

```ts
import { onLoad } from '@dcloudio/uni-app'
import { getCurrentInstance } from 'vue'

const instance = getCurrentInstance()

onLoad((options) => {
  if (options?.code) {
    code.value = options.code
    // 自动填充邀请码逻辑
  }
})
```

### 6.9 index 页两栏滚动联动（最难的一处）

原实现用 `wx.createSelectorQuery()` + `wx.pageScrollTo()`。迁移要点：

```ts
import { getCurrentInstance } from 'vue'

const instance = getCurrentInstance()
const activeCategoryId = ref('all')
const catalog = useCatalogStore()

function scrollToCategory(id: string) {
  if (id === 'all') {
    uni.pageScrollTo({ scrollTop: 0, duration: 200 })
    return
  }
  // ⚠️ 必须 .in(instance)，否则在 Vue3 组合式 API 里查不到节点
  const query = uni.createSelectorQuery().in(instance)
  query.select(`#cat-${id}`).boundingClientRect()
  query.selectViewport().scrollOffset()
  query.exec((res: any[]) => {
    const rect = res[0]
    const scroll = res[1]
    if (!rect) return
    const scrollTop = (scroll ? scroll.scrollTop : 0) + rect.top - 10
    uni.pageScrollTo({ scrollTop: Math.max(0, scrollTop), duration: 200 })
  })
}

function onScroll() {
  const groups = catalog.groupList
  if (groups.length === 0) return
  const query = uni.createSelectorQuery().in(instance)
  groups.forEach((g) => query.select(`#cat-${g._id}`).boundingClientRect())
  query.exec((res: any[]) => {
    const topThreshold = 80
    let active = groups[0]._id
    for (let i = 0; i < res.length; i++) {
      const rect = res[i]
      if (!rect) continue
      if (rect.top <= topThreshold) active = groups[i]._id
      else break
    }
    if (active !== activeCategoryId.value) activeCategoryId.value = active
  })
}
```

> **⚠️ 迁移时必须复核的行为**：原实现里 `scrollToCategory` 用的是 `wx.pageScrollTo`（页面级滚动），但右侧菜品实际装在 `scroll-view` 里。当前能工作是因为外层页面也发生了滚动。迁移后**必须在真机上实测点击分类是否能正确滚动定位**，如果失效，改用下面这个更可靠的方案。
>
> ✅ **真机复核结果（2026-09-11）**：上面这段判断里的「外层页面也发生了滚动」是对的
> —— 而且**只有**外层页面在滚，右侧 `scroll-view` 根本没有内部滚动。
> 所以 `pageScrollTo` 原本是有效的，而 `scroll-into-view` 换上去之后是空操作。
> 最终选择：**先把 `.page` 的 `min-height:100vh` 改成 `height:100vh`** 让双栏真正定高，
> 再采用下面的 `scroll-into-view` 方案。详见附录 C。

**可选优化（推荐，但需视觉复核）**：`scroll-view` 原生支持 `scroll-into-view`，可以彻底去掉 `scrollToCategory` 里的查询逻辑：

```vue
<scroll-view
  scroll-y
  class="dish-pane"
  :scroll-into-view="scrollTarget"
  :scroll-with-animation="true"
  @scroll="onScroll"
>
  <view v-for="group in catalog.groupList" :key="group._id" :id="`cat-${group._id}`">
    ...
  </view>
</scroll-view>
```

```ts
const scrollTarget = ref('')

function switchCategory(id: string) {
  activeCategoryId.value = id
  nextTick(() => {
    scrollTarget.value = `cat-${id}`
  })
}
```

> 若要保留「点击分类时页面也滚动」的现有行为，此优化需配合视觉复核。**建议批次 2 先做等价迁移（保留 `pageScrollTo`），批次 4 视觉核对时再决定是否换成 `scroll-into-view`。**
>
> ❌ **这条建议最终没有采纳**（2026-09-11）：真机实测证明「外层页面滚动」才是原行为，
> 而它同时带来了左栏随页面滚走、高亮永不跟随两个问题。改用 `scroll-into-view` 的前提是
> 先把 `.page` 改成 `height:100vh`，否则 `scroll-into-view` 是空操作。详见附录 C。

### 6.10 rating.wxs 改写

原 `rating.wxs`：

```js
module.exports = {
  fill: function (rating, star) {
    var r = parseFloat(rating) || 0
    if (r >= star) return '100%'
    if (r >= star - 0.5) return '50%'
    return '0%'
  }
}
```

改为组合式函数 + 预计算（**不要在模板里直接调用函数**，Vue 每次重渲染都会执行）：

```ts
// src/composables/useRating.ts
export function starFill(rating: number, star: number): string {
  const r = Number(rating) || 0
  if (r >= star) return '100%'
  if (r >= star - 0.5) return '50%'
  return '0%'
}

export function useStarList(getRating: () => number) {
  return computed(() =>
    [1, 2, 3, 4, 5].map((s) => ({ s, fill: starFill(getRating(), s) }))
  )
}
```

模板：

```vue
<view class="star-wrap" v-for="item in stars" :key="item.s">
  <text class="star-bg">★</text>
  <text class="star-fill" :style="{ width: item.fill }">★</text>
</view>
```

> **性能说明**：`wxs` 在小程序视图层执行，不跨线程通信；改为 `computed` 后回到逻辑层。本项目星级数量极少（每页 5 颗），可忽略。**但若未来菜品数量上千，需要留意 `setData` 体积。**

### 6.11 ⚠️ 云函数与编译产物共存（最容易卡住的工程问题）

**问题**：uni-app 编译产物在 `dist/dev/mp-weixin/`，而 `cloudfunctions/` 在项目根目录。微信开发者工具的 `cloudfunctionRoot` 要求目录在**小程序项目目录内**，否则云函数面板不显示，无法右键「上传并部署」。

**方案 A（推荐，一次配置长期省事）：软链接**

```js
// scripts/link-cloudfunctions.mjs
import { existsSync, mkdirSync, symlinkSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const mode = process.argv[2] || 'dev'
const distDir = resolve(root, `dist/${mode}/mp-weixin`)
const link = resolve(distDir, 'cloudfunctions')
const target = resolve(root, 'cloudfunctions')

if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true })
if (!existsSync(link)) {
  symlinkSync(target, link, 'junction')  // Windows 下 junction 无需管理员权限
  console.log('[cloud] linked:', link, '->', target)
} else {
  console.log('[cloud] already linked:', link)
}
```

```json
// package.json
{
  "scripts": {
    "dev:mp-weixin": "uni -p mp-weixin & node scripts/link-cloudfunctions.mjs dev",
    "build:mp-weixin": "uni build -p mp-weixin && node scripts/link-cloudfunctions.mjs build"
  }
}
```

> `uni -p mp-weixin` 是 watch 模式不会退出，所以 dev 脚本里用 `&` 让链接脚本并行跑一次。若链接失败，手动执行 `node scripts/link-cloudfunctions.mjs dev` 即可。

配置 `src/manifest.json`：

```json
{
  "mp-weixin": {
    "appid": "wx2c146bc0f9cf7637",
    "setting": {
      "urlCheck": false,
      "es6": true,
      "postcss": true,
      "minified": true
    },
    "usingComponents": true,
    "libVersion": "3.4.10"
  }
}
```

然后在微信开发者工具里**打开的目录是 `dist/dev/mp-weixin`**。

**方案 B（更省事，适合云函数不常改的场景）**：

云函数一年改不了几次。日常前端开发完全不碰云函数；需要改云函数时，回到**原项目目录**用开发者工具上传（或直接在云开发控制台在线编辑）。云函数独立于前端版本部署，两种方式互不影响。

**建议**：先用方案 B 跑通批次 0，等确认整条链路可用后再补方案 A。

---

## 7. 分批迁移路线

### 批次 0 · 搭地基（验证链路）

**范围**
- 创建 `diancan-uniapp` 工程（`vite-ts` 模板）
- 安装 Pinia、`miniprogram-api-typings`
- 迁移 `config.ts`、`App.vue` 全局样式、`static/images/`
- 写 `utils/cloud.ts`、`utils/format.ts`
- 配置 `pages.json`（含 tabBar）
- 复制 `cloudfunctions/` 并解决目录问题（6.11）

**产出**：一个能编译、能调通 `wx.cloud.callFunction`、tabBar 正常显示的空壳。

**验收标准**
- [ ] 微信开发者工具能打开、编译无报错
- [ ] 云函数面板能看到 `login` 和 `api`
- [ ] 页面里能打印出 `login` 云函数返回的用户对象（含 `role`）
- [ ] tabBar 三个图标显示正常，选中色为 `#F5A623`
- [ ] `App.vue` 的 CSS 变量生效（在任意页面写 `color: var(--amber)` 能看到橙色）

> **这一批是整个迁移最关键的风险点验证。** 云开发链路不通，后面全白做。

---

### 批次 1 · 低风险试水三页

**范围**：`mine`（181 行）、`orders`（169 行）、`invite`（60 行）

**为什么先做这三页**
- 涵盖了两个核心技术点：订阅消息（orders）、复杂布局计算（mine 的热力图）
- 都用到 `userStore` 和 `callApi`，能验证 store 设计是否顺手
- 视觉复杂度中等，适合打磨映射规则

**产出**：三页可正常使用，`userStore` 定型。

**验收标准**
- [ ] 我的页：角色标签正确显示（店主 / 点餐成员 / 访客）
- [ ] 我的页：热力图 26 周布局与原来一致，自动滚到最右
- [ ] 我的页：点击方块弹出「日期 + 单数」提示
- [ ] 我的页：改昵称/头像后保存成功，且切到首页角色不变
- [ ] 订单页：我的订单列表 + 状态标签颜色正确
- [ ] 订单页：下拉刷新可用
- [ ] 订单页：补订阅授权弹窗能唤起（**必须真机测试**）
- [ ] 邀请页：输入邀请码后角色变为「点餐成员」，且首页立即生效

---

### 批次 2 · 攻克点餐页

**范围**：`index`（268 行 JS + 196 行 WXML + 648 行 WXSS）

**难点清单**
1. 两栏滚动联动（`scrollToCategory` / `onScroll`）
2. 购物车状态（改造成 `cartStore`）
3. 双弹窗（购物车弹窗 + 确认下单弹窗）
4. 店主/访客/成员三种角色的 UI 分支
5. `isOwner` 控制购物车条显示、`guest` 拦截下单

**产出**：点餐主流程完整可用。

**验收标准**
- [ ] 分类点击 → 菜品区滚动到对应分组
- [ ] 滚动词品区 → 左侧分类高亮跟随（双向联动）
- [ ] 加入购物车 → 底部徽章数字正确
- [ ] 购物车弹窗：加减、清空、数量同步
- [ ] 确认下单弹窗：备注输入、取消、确认
- [ ] 下单成功 → 购物车清空、toast 提示
- [ ] **店主登录时：购物车条和加减按钮不显示**
- [ ] **访客下单时：弹「请先接受邀请」并跳转邀请页**
- [ ] 连续点击「确认下单」不会重复提交（`submitting` 防抖）
- [ ] 菜品图片加载失败时显示 `placeholder.png`

---

### 批次 3 · admin 五页

**范围**：`dishes`（274 行）、`categories`（117）、`invite`（91）、`orders`（75）、`stats`（45）

**这一批是机械劳动**，但有两个点要注意：
- `dishes` 的 `rating.wxs` → `useRating.ts`
- `dishes` 的图片上传 → `uploadFile()` 封装
- 所有写操作完成后要调 `catalogStore.load()` 刷新共享数据

**验收标准**
- [ ] 菜品：新增（含图片上传）、编辑、删除、上下架
- [ ] 菜品：星级选择（支持半星）、列表星级显示正确
- [ ] 分类：增删改，排序正确
- [ ] 订单管理：全部订单 + 状态筛选（待处理/已完成/已取消）
- [ ] 订单管理：标记完成/取消后状态刷新
- [ ] 统计：点餐次数排行榜正确
- [ ] 邀请：生成邀请码、复制、分享
- [ ] **admin 改完菜品后切到点餐页，数据是新的**
- [ ] 非店主进入 admin 页被拦截

---

### 批次 4 · 视觉回归核对（最耗时）

**方法**：双开对照 —— 左边微信开发者工具跑原项目，右边跑新项目，逐页比对。

**对照清单（每页都要过一遍）**

| 检查项 | 关注点 |
| --- | --- |
| 器皿圆角 | 首页左下收紧 / 订单右上收紧 / 我的左上大圆角 |
| CTA 按钮 | 黄橙渐变底 + 深棕粗体字；**绝不能出现橙底白字** |
| 按压反馈 | `cta-press` 缩放、`cate-press` 透明度；`hover-stay-time` 是否生效 |
| 卡片阴影 | 暖调阴影（`rgba(180,120,50,...)`），不是纯黑 |
| 背景纹理 | radial-gradient 圆点纹理 48rpx 网格 |
| banner | 双氛围圆（右上暖光/左下浅影） |
| 营业印章 | 入场「盖」下来的动效 |
| 入场动画 | 错峰入场，只动 `transform`/`opacity` |
| 星级 | 半星显示（`50%` 宽度） |
| 空状态 / 加载态 | `.empty` / `.loading-box` 一致 |
| 文字层级 | 800 字重 + 2-3rpx 字距 + tabular-nums |
| **`scroll-view` 内边距** | ⚠️ 内边距必须放在内层 `<view>`（`.form-inner` / `.popup-body-inner`），见坑清单第 1 条 |

**同步更新** `design-preview.html`，让预览稿与新项目保持一致。

---

## 8. 坑清单

| # | 坑 | 说明 | 规避 |
| --- | --- | --- | --- |
| 1 | **`scroll-view` 横向 padding 被吞** | 平台级特性，**重构不解决**。`box-sizing: border-box` 名单不含 `scroll-view` | 内边距放内层 `<view>`（如 `.form-inner`）。已知位置：`index.wxss` 的 `.popup-body`、`.confirm-list` |
| 2 | **云函数目录不在编译产物内** | 开发者工具看不到云函数 | 见 6.11，软链接或方案 B |
| 3 | **`uni.createSelectorQuery()` 查不到节点** | Vue3 组合式 API 下需绑定实例 | 必须 `.in(getCurrentInstance())` |
| 4 | **CSS 变量在 H5 端失效** | `page` 选择器在 H5 不存在 | `page { }` 和 `:root { }` 分两个规则块写 |
| 5 | **`catchtap` → `@tap.stop`** | 事件冒泡行为要一致 | 遮罩层内的弹窗用 `@tap.stop`，外层遮罩用 `@tap` |
| 6 | **`data-*` 传参改直接传参** | 原 `e.currentTarget.dataset.id` 全部消失 | `@tap="fn(item._id)"`，注意别漏改模板和函数签名 |
| 7 | **tabBar 图标路径** | `pages.json` 里不带前导斜杠，`<image>` 里带 | 见 6.4 的路径规则 |
| 8 | **`enablePullDownRefresh` 丢失** | 原分散在 4 个页面 `.json` 里 | 合并进 `pages.json` 的 `style`；别忘了 `uni.stopPullDownRefresh()` |
| 9 | **模板复杂表达式** | 原 `wx:if="{{groupList[...]._id === '__uncat__'}}"` | 改为 `computed`，Vue 模板不做数组索引运算 |
| 10 | **`setData` 回调变 `nextTick`** | `mine.js` 热力图依赖渲染完成后再设 `scrollLeft` | `await nextTick()` 后再赋值 |
| 11 | **`wxs` 性能优势丢失** | 视图层执行 → 逻辑层 | 本项目可忽略；菜品种类多时留意 |
| 12 | **`hover-class` 在 H5 端无效** | 只影响 H5，小程序端正常 | 若出 H5，按压反馈改用 CSS `:active` |
| 13 | **`this._submitting` 等实例标记** | `Page` 实例属性在 `<script setup>` 里没有 | 用模块级 `let` 或 `ref` |
| 14 | **跨页共享 store 的数据新鲜度** | `catalog` 被 index 和 admin 共用 | admin 写操作后主动 `catalog.load()` |
| 15 | **`uni.showToast` 的 `icon` 取值** | `'none'` / `'success'` / `'error'` | 与原 `wx.showToast` 一致，无需改 |
| 16 | **`README.md` 里的订阅模板字段名过时** | 文档写 `thing1/time2/thing3`，代码实际是 `thing15/time9/thing14` | 以代码为准，迁移后顺手修 README |

---

## 9. 风险登记表

| 风险 | 概率 | 影响 | 缓解措施 |
| --- | --- | --- | --- |
| 视觉细节回归（圆角/动效/阴影） | **高** | 中 | 保留原项目作对照；批次 4 逐页比对 `design-preview.html` |
| 云函数目录配置踩坑卡住进度 | 中 | **高** | 批次 0 就验证云函数调用链路，不通不往下走 |
| 订阅消息推送失效 | 低 | **高** | 保留原生 `wx.requestSubscribeMessage`；批次 1 真机验证 |
| 两栏滚动联动行为变化 | 中 | 中 | 批次 2 真机实测；备选 `scroll-into-view` 方案 |
| uni-app alpha 版本 breaking | 中 | 中 | 锁定版本 + 提交 lockfile |
| H5 端云开发不可用 | **高** | 中 | 明确本次只出小程序端（见 3.3） |
| 微信新能力跟进延迟（Skyline 等） | 低 | 低 | 本项目未使用 Skyline |
| 工具链复杂度上升（编译层） | 中 | 低 | 错误栈偶尔指向产物，用 sourcemap |

---

## 10. 回滚方案

**原项目完整保留，全程零修改。**

```
C:\Users\15596\WorkBuddy\2026-09-07-10-22-49\
├── diancan-miniprogram/          ← 原项目，作为对照和回滚基线，不碰
└── diancan-uniapp/               ← 新项目
```

| 场景 | 回滚动作 |
| --- | --- |
| 批次 0 云函数链路不通 | 直接放弃，原项目毫发无伤 |
| 批次 2 滚动联动做不出理想效果 | 沿用原实现（等价迁移），放弃 `scroll-into-view` 优化 |
| 整体不满意 | 停用新项目，继续用原项目 |
| 已发布后发现严重问题 | 微信后台「版本回退」到上一个线上版本 |

**关键前提**：数据库集合和云函数**从未被修改**，所以任何时点回滚都不涉及数据迁移。

---

## 11. 上线检查清单

### 发布前

- [ ] `manifest.json` 的 `appid` 正确（`wx2c146bc0f9cf7637`）
- [ ] `config.ts` 的 `cloudEnv` 正确（`cloud1-d1gxp9yoob9c5add6`）
- [ ] `SUBSCRIBE_TEMPLATE_ID` 与云函数内保持一致
- [ ] 编译产物中 `cloudfunctions/` 存在，两个云函数已重新部署
- [ ] 主包体积 < 2MB（`dist/build/mp-weixin`）
- [ ] 无 `console.log` 残留（云函数里的 `console.error` 可保留）
- [ ] `project.private.config.json` 未误提交

### 真机测试（必须用真机，模拟器不可靠）

- [ ] 扫码进入 → 自动登录成功
- [ ] 店主账号：能进 admin 五页，点餐页不显示购物车
- [ ] 朋友账号：凭邀请码成为「点餐成员」
- [ ] 访客账号：下单被拦截，引导到邀请页
- [ ] 完整下单 → 店主收到订阅消息推送 → 点开跳「订单管理」
- [ ] 店主标记订单完成 → 朋友端订单状态同步
- [ ] 分享小程序卡片 → 带 `?code=` 参数直达邀请页
- [ ] 图片上传（拍照 + 相册）成功，回到首页显示正确
- [ ] 下拉刷新（index / orders / admin/orders / admin/stats 共 4 页）
- [ ] 弱网环境下的加载态与错误提示
- [ ] 各页面视觉与 `design-preview.html` 一致

### 发布后

- [ ] 云开发控制台查看调用量与错误日志
- [ ] 观察 24 小时，确认无 `code: 401`（登录态问题）批量出现

---

## 附录 A · 逐页改造清单

| 页面 | 原文件 | 目标文件 | 关键改造 | 难度 |
| --- | --- | --- | --- | --- |
| 点餐 | `pages/index/*` | `pages/index/index.vue` | cartStore + 滚动联动 + 双弹窗 | 高 |
| 我的订单 | `pages/orders/*` | `pages/orders/orders.vue` | 订阅消息补授权 + 下拉刷新 | 中 |
| 我的 | `pages/mine/*` | `pages/mine/mine.vue` | 热力图计算 + 资料编辑 | 中 |
| 接受邀请 | `pages/invite/*` | `pages/invite/invite.vue` | `onLoad` 取 code | 低 |
| 菜品管理 | `admin/dishes/*` | `admin/dishes/dishes.vue` | 图片上传 + `rating.wxs` | 中 |
| 分类管理 | `admin/categories/*` | `admin/categories/categories.vue` | 纯 CRUD | 低 |
| 订单管理 | `admin/orders/*` | `admin/orders/orders.vue` | 状态筛选 + 下拉刷新 | 低 |
| 点餐统计 | `admin/stats/*` | `admin/stats/stats.vue` | 排行榜 | 低 |
| 邀请好友 | `admin/invite/*` | `admin/invite/invite.vue` | 生成 + 复制 + 分享 | 低 |

## 附录 B · 明确不动的部分

| 部分 | 说明 |
| --- | --- |
| `cloudfunctions/login/index.js` | 47 行，零改动 |
| `cloudfunctions/api/index.js` | 272 行、18 个 action，零改动 |
| 云数据库 5 个集合 | `users` / `categories` / `dishes` / `orders` / `invitations` 结构与数据全不动 |
| 订阅消息模板字段名 | `thing15` / `time9` / `thing14` |
| 云存储路径规则 | `dishes/{timestamp}-{random}.{ext}` |
| 邀请码生成算法 | 6 位、去除易混淆字符 `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` |
| 评级计算规则 | 0~5，0.5 步进 |
| 10 张图片资源 | 原样搬入 `src/static/images/` |
| 计费口径 | **本小程序不涉及金额**，无价格字段（与 README 里「价格格式」的旧描述不符，以实际数据结构为准） |

---

## 附录 C · 实际落地记录（2026-09-10）

批次 0–4 已全部执行完毕，9 个页面迁移完成，构建产物 627K。以下是**方案与最终实现不一致的地方**，
以本节为准。

### C1 与方案不同的实现选择

| 方案原定 | 实际做法 | 原因 |
| --- | --- | --- |
| `rating.wxs` → `composables/useRating.ts` | `utils/rating.ts`（纯函数 `starFill` / `starList`） | 纯函数就够了，不需要 composable 生命周期；页面用 `computed` 调 `starList` 预计算 |
| index 页批次 2 先保留 `pageScrollTo`，批次 4 再决定是否换 `scroll-into-view` | **先把布局改成真正的定高双栏**（`.page` 的 `min-height:100vh` → `height:100vh`），再换 `scroll-into-view` + `@scroll` 高亮 | 见 C2 第 1 条：真机实测推翻了「页面不滚动」的推断。布局不改的话 `scroll-into-view` 和 `@scroll` 都是空操作 |
| 未提及 | 下拉刷新改为**不可达的正确兜底**：定高双栏后页面不再滚动，下拉手势落在 scroll-view 上不会传给页面 | 保留 `enablePullDownRefresh` + 处理函数（无害）；菜单本来每次 `onShow` 都会强制重拉 |
| `catalog.load()`（缓存优先） | index 与 admin 都用 `load(true)` 强制拉取；admin 写操作后再 `invalidate()` | 熟人点餐场景下「店主刚加的菜立刻能点」是业务正确性问题，省两次请求不值得 |
| 未提及 | 新增 `utils/query.ts` | `createSelectorQuery` 在 uni-app 编译成自定义组件后作用域不确定，做了一次探测并缓存 |
| 未提及 | 新增 `scripts/patch-app-json.mjs` | uni-app 会过滤 `pages.json` 的根级 `style` / `sitemapLocation`，需要构建后补回 |
| 未提及 | 新增 `scripts/verify-structure.mjs` / `verify-handlers.mjs` | 批次 4 的「视觉回归核对」用脚本自动化，逐页比对 class 集合与事件绑定 |

### C2 顺带修掉的原项目遗留问题

1. **`index` 页的双栏布局从来没成立过（真机实测，2026-09-11 修正）**。
   原生版 `.page` 写的是 `min-height: 100vh`，微信渲染引擎不会因此产生确定高度，
   容器被内容撑开 → **整页滚动**。后果有三个：左侧分类栏随页面滚走；
   右侧 `scroll-view` 的 `bindscroll` 永不触发（**左侧高亮从来不跟随滚动**）；
   `scroll-into-view` 是空操作。
   → 处置：`.page` 改成 `height: 100vh`，两个 pane 才真正内部滚动，
   分类点击与高亮跟随才都成立。
   > ⚠️ 教训：小程序 CSS 的 flex 行为**不能**照浏览器规范推断。
   > 这个结论曾被错误地反着写进文档，是交付前真机测试才发现的。
2. `index` 页 `enablePullDownRefresh: true` 但无 `onPullDownRefresh` 处理函数（死配置，已补）。
   注意定高布局后下拉手势落在 scroll-view 上，页面级下拉刷新实际不可达（保留无害）。
3. `invite` 页视觉停留在旧的纯白卡片风格（色系统一时漏掉），已升级到设计令牌。

### C3 自动化核对工具

```bash
# 逐页比对原生 WXML 与产物 WXML 的 class 集合（含 :class 编译进 .js 的情况）
node scripts/verify-structure.mjs

# 确认模板里的 @tap / @input / @confirm 在 <script setup> 里都有实现
node scripts/verify-handlers.mjs
```

两个脚本都已并入工程，后续再动模板时可以直接当回归网用。

### C4 剩余风险（必须真机验证）

| 风险 | 说明 |
| --- | --- |
| 分类点击滚动定位 | **2026-09-11 已真机回归一轮，发现布局问题并修掉**（见 C2 第 1 条）；改完需再验一次落点与动效手感 |
| 左侧高亮跟随滚动 | 同上：改布局前 `@scroll` 根本不触发，属原生遗留 bug，已随布局修复 |
| 定高双栏的横向内边距 | `.dish-pane` 转为真正内部滚动后，横向 padding 会被吞掉 → 已下沉到 `.group-wrap`，需真机确认菜品卡片左右留白与迁移前一致 |
| `createSelectorQuery` 作用域 | 探测机制已做兜底，但需真机确认高亮确实随滚动切换 |
| `style: "v2"` | 补回后 `<button open-type="share">`、`<input>` 的默认外观需与迁移前一致 |
| 图片上传 | `wx.cloud.uploadFile` 在真机上需要网络，模拟器表现可能不同 |

> ⚠️ **定高布局是 uni-app 版与原项目的有意分歧**：原生项目保持 `min-height` 与整页滚动不动
> （它是回滚基线，零改动）。两版在这一页的滚动行为不同，对比测试时注意。
