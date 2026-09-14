# 呼噜点餐 · uni-app 版

Vue3 + Vite + Pinia + TypeScript 重构版，编译目标为微信小程序。

> 📌 **本工程是唯一在维护的代码库。** 原生版本 `../diancan-miniprogram` 已于
> **2026-09-14 废除**，源码归档在 `../_legacy/diancan-miniprogram-native-20260914.zip`
> （64 文件 / 392 KB，解压回验逐字节一致）。工作区里那个同名目录现在只剩项目记忆
> 和一份指路 README，不再包含任何小程序源码 —— 别再去那儿找代码。

---

## 当前进度

| 批次 | 内容 | 状态 |
| --- | --- | --- |
| 0 | 工程骨架 + 依赖 + 云开发封装 + Pinia stores + 全局样式 | ✅ 完成 |
| 1 | `invite` / `orders` / `mine` 三页 | ✅ 完成 |
| 2 | `index` 点餐页（两栏滚动联动 + 购物车 + 双弹窗） | ✅ 完成 |
| 3 | `admin` 五页（dishes / categories / orders / stats / invite） | ✅ 完成 |
| 4 | 结构回归核对（脚本自动化） | ✅ 完成 |
| 5 | **真机视觉与交互核对** | ⬜ 需要人工在微信开发者工具完成 |

**9 个页面全部迁移完毕**，构建产物 627K / 61 个文件，无占位页。

代码审查发现的 P0 ~ P4 已全部处理（详见 [`docs/REVIEW-2026-09-14.md`](docs/REVIEW-2026-09-14.md)），
其中 P0 是「订阅消息推送从未生效」—— 店主收不到新订单通知，这个已经修好并补了未推送提示。

### 自动化核对结果

```bash
node scripts/verify-structure.mjs   # 逐页比对基线 WXML 与产物 WXML 的 class 集合
node scripts/verify-handlers.mjs    # 确认模板里的事件绑定在 script 中都有实现
```

```
✓ pages/index/index                  基线  81 类 | 无缺失（有意移除 2） | 产物新增：cate-sk-wrap, cate-sk, sk, …
✓ pages/orders/orders                基线  69 类 | 无缺失 | 产物新增：warn, remind-badge
✓ pages/mine/mine                    基线  43 类 | 无缺失
✓ pages/invite/invite                基线   8 类 | 无缺失 | 产物新增：cta-press, code-placeholder
✓ pages/admin/dishes/dishes          基线  68 类 | 无缺失 | 产物新增：text-press, cta-press, btn-press, chip-press
✓ pages/admin/categories/categories  基线  23 类 | 无缺失
✓ pages/admin/orders/orders          基线  22 类 | 无缺失
✓ pages/admin/stats/stats            基线  19 类 | 无缺失
✓ pages/admin/invite/invite          基线  20 类 | 无缺失
全部页面 class 无缺失 · 全部事件绑定均有实现
```

比对基线是 `scripts/baseline/wxml/`（原生 WXML 的**冻结快照**，拷贝自废除前的原生工程），
不依赖任何外部目录。所以原生工程删掉之后，这道回归仍然有效。

index 页的「有意移除 2」指 `loading-box` / `loading-icon` —— 加载态改成骨架屏后不再使用全局转圈，
已登记在 `verify-structure.mjs` 的 `EXPECTED_MISSING` 白名单里（见文末注意事项 16）。

产物里新增的 class 有两类，都是有意的：按压反馈（`cta-press` / `text-press` / `btn-press` /
`chip-press`）、结构增补（`pane-top` 锚点 / `group-wrap` / `code-placeholder` / 点餐页骨架屏的
`loading-*` 与 `sk-*` 系列 / 订单页店主未推送警示态 `warn` 与 `remind-badge`）。

---

## 环境要求

- Node.js ≥ 16（本项目在 22.22.2 上验证）
- 微信开发者工具

## 安装与编译

```bash
npm install

# 编译到微信小程序（产物在 dist/build/mp-weixin）
npm run build:mp-weixin

# 开发模式（watch，产物在 dist/dev/mp-weixin）
npm run dev:mp-weixin
```

> ⚠️ 不要用 `npx uni`：npm 没有为本工程生成 `.bin` 链接，`uni` 命令不可用。
> `package.json` 里的 scripts 已改为直接调用 `node_modules/@dcloudio/vite-plugin-uni/bin/uni.js`。

`build:mp-weixin` 后面挂了两个收尾脚本：

| 脚本 | 作用 |
| --- | --- |
| `scripts/sync-cloudfunctions.mjs` | 把 `cloudfunctions/` junction 到产物目录，并写入 `cloudfunctionRoot` |
| `scripts/patch-app-json.mjs` | 把 `style: "v2"`、`sitemapLocation` 补回产物的 `app.json`（uni-app 会过滤这两个键） |

## 在微信开发者工具里打开

**导入目录选 `dist/build/mp-weixin`**（不是项目根目录）。

`cloudfunctions/` 通过 junction 链接进产物（Windows 下不需要管理员权限），
这样云函数面板才能识别到 `login` 与 `api`，右键「上传并部署」才可用。
如果产物被清空后云函数不见了，单独执行 `npm run sync:cloud` 即可恢复。

---

## 发布到微信「版本管理」

> AppID `wx2c146bc0f9cf7637`，云环境 `cloud1-d1gxp9yoob9c5add6`。
> **现在只有这一个前端工程**（原生版已于 2026-09-14 废除），所以「版本管理」里
> 只会出现 uni-app 版上传的开发版本，不再有版本混淆的问题。

### 1. 先编译，再上传（顺序不能反）

```bash
cd diancan-uniapp
npm run build:mp-weixin
```

这条命令已经把三件事串好了：uni 编译 → `sync-cloudfunctions.mjs`（junction 链云函数 +
写 `cloudfunctionRoot`）→ `patch-app-json.mjs`（补回 `style` / `sitemapLocation`）。
**产物是 `dist/build/mp-weixin`，上传的就是它，不是工程根目录。**

⚠️ 每次 build 会清空并重建 `dist`，所以在开发者工具里**手改产物的任何文件都是白改**，
下次编译就没了。要改就改 `src/`。

### 2. 确认产物自检项

上传前扫一眼这几处（都是容易忘的）：

| 检查项 | 期望值 |
| --- | --- |
| `dist/build/mp-weixin/project.config.json` 的 `appid` | `wx2c146bc0f9cf7637`（来自 `src/manifest.json`） |
| 同上 `cloudfunctionRoot` | `cloudfunctions/` |
| `dist/build/mp-weixin/app.json` 的 `style` / `sitemapLocation` | 都存在（`patch-app-json.mjs` 负责） |
| `dist/build/mp-weixin/cloudfunctions` | 是指向工程 `cloudfunctions/` 的链接，不是空目录 |
| 产物体积 | 代码约 476KB，主包上限 2MB，余量充足 |

### 3. 上传

1. 开发者工具打开 `dist/build/mp-weixin`，右上角确认 AppID 正确；
2. **云函数面板**里给 `login` 与 `api` 各来一次「上传并部署：云端安装依赖」。
   ⚠️ **2026-09-14 这版必须传**：`api` 修了 P0（订阅消息守卫恒真 → 推送从来没发出去过）、
   服务端入参收口、邀请码原子性、热力图分页、头像地址协议校验；`login` 加了可选的店主白名单。
   源码只有一份，就是 `cloudfunctions/`，从这里传即可。
   可选：想锁死店主身份，给 `login` 云函数加环境变量 `OWNER_OPENID=<你的 openid>`（不配则与旧版一致）；
3. 工具栏「上传」→ 填 **版本号** 与 **项目备注**（例：`1.1.0` / `uni-app 版：点餐页骨架屏加载态`）；
4. 上传成功后，去 <https://mp.weixin.qq.com> → **管理 → 版本管理 → 开发版本**，就能看到刚传的这个版本。

### 4. 从「开发版本」变成能用的版本

- **体验版（熟人小范围用，推荐走这条）**：版本管理 → 开发版本 → 「选为体验版」。
  然后去 **管理（旧版后台叫「用户身份」）→ 成员管理 → 体验成员** 把微信号加进去 ——
  **只有体验成员能扫体验版二维码**，非成员扫码会提示无权限。

  ⚠️ **体验成员有人数上限，且按「主体类型 + 认证/发布状态」分档**，不是固定值：

  | 小程序状态 | 项目成员 | 体验成员 |
  | --- | --- | --- |
  | 个人主体 | 15 | **15** |
  | 非个人、未认证且未发布 | 30 | 30 |
  | 已认证未发布 / 未认证已发布 | 60 | 60 |
  | 已认证且已发布 | 90 | 90 |

  **所以先确认自己的主体类型**（后台 → 设置 → 基本设置 → 主体信息）：
  如果是**个人主体，体验成员只有 15 个名额** —— 朋友圈熟人多于 15 人时，体验版这条路就走不通了，
  得考虑正式发布（见下）。
- **正式版**：提交审核 → 通过后手动点「发布」。有两个前置条件要提前查：
  1. **服务类目**。个人主体**不开放**「线上点餐 / 外卖」这类餐饮经营类目
     （个人主体在餐饮下只能选「点评与推荐」「菜谱」；餐厅排队仅限个体门店线上取号）。
     也就是说，如果这个 AppID 是个人主体，「点餐」这个功能本身就走不了正式发布 ——
     要么换个体工商户/企业主体，要么就用体验版。
  2. **ICP 备案**。2023 年 9 月起小程序上线前需完成备案，走通信管理局审核通道。

### 5. 上传前的真机核对

加载态、双栏布局这类改动**必须真机验证**（模拟器不可靠）。先「预览」扫码过一遍
文末的《验证清单》，确认无误再点上传 —— 体验版发出去再改，版本号就要往上加。

---

## 目录结构

```
diancan-uniapp/
├── cloudfunctions/              # 唯一的云函数源码（原生工程已废除，不存在第二份）
│   ├── login/                   # 登录 + 首位用户自动成为店主（可用 OWNER_OPENID 白名单锁死）
│   └── api/                     # 18 个业务 action（服务端入参收口都在文件顶部常量）
├── docs/
│   ├── REVIEW-2026-09-14.md     # 代码审查报告（P0~P4 + 修复状态）
│   └── VUE3-MIGRATION-PLAN.md   # 迁移方案（历史文档）
├── design-preview.html          # 顾客端三页视觉预览稿（不参与构建）
├── loading-preview.html         # 点餐页加载态预览稿（不参与构建，可删）
├── logo-preview.png             # 空态图片「白底 → 四角透明」前后对照（不参与构建，可删）
├── scripts/
│   ├── sync-cloudfunctions.mjs  # 云函数目录同步到编译产物
│   ├── patch-app-json.mjs       # 补回 app.json 的原生专属字段
│   ├── inject-style.mjs         # 把原 .wxss 注入 .vue（样式搬运工具，日常不需要跑）
│   ├── gen_icons.py             # tabBar / 图标生成脚本
│   ├── gen_transparent_logo.py  # app-logo.jpg（白底 JPEG）→ 四角透明的 app-logo.png
│   ├── baseline/wxml/           # ⭐ 原生 WXML 冻结快照（结构回归的比对基线，只读）
│   ├── verify-structure.mjs     # 结构回归：比对基线 WXML 与产物的 class 集合（含 EXPECTED_MISSING 白名单）
│   └── verify-handlers.mjs      # 事件绑定体检
└── src/
    ├── App.vue                  # 全局设计令牌（原 app.wxss）+ 云开发初始化
    ├── main.ts                  # createSSRApp + Pinia
    ├── env.d.ts                 # *.vue 模块声明（供 tsc 用）
    ├── manifest.json            # 替代 project.config.json（含 appid）
    ├── pages.json               # 替代 app.json（页面/窗口/tabBar）
    ├── sitemap.json             # 原样搬运（已改为全站 disallow）
    ├── config.ts                # 云环境 ID + 订阅模板 ID
    ├── static/images/           # 11 张图片资源
    ├── types/api.ts             # 18 个 action 的数据模型
    ├── utils/
    │   ├── cloud.ts             # wx.cloud 封装（条件编译）
    │   ├── format.ts            # formatTime / statusInfo
    │   ├── image.ts             # 本地临时路径 → 云存储路径（扩展名白名单）
    │   ├── subscribe.ts         # 订阅消息
    │   ├── query.ts             # createSelectorQuery 作用域探测封装
    │   └── rating.ts            # 星级填充（替代 rating.wxs）
    ├── stores/
    │   ├── user.ts              # 替代 app.globalData.user
    │   ├── catalog.ts           # 分类 + 菜品 + 分组（groupList 改为 getter）
    │   └── cart.ts              # 购物车
    └── pages/                   # 9 个页面，全部已迁移
```

---

## 与原生项目的对应关系（历史参考）

原生工程已于 2026-09-14 废除，下表保留用于对照**归档**里的代码
（`../_legacy/diancan-miniprogram-native-20260914.zip`）。

| 原生 | 本工程 |
| --- | --- |
| `app.js` 的云开发初始化 + `login/refreshUser` | `App.vue` 的 `onLaunch` + `stores/user.ts` |
| `app.wxss` | `App.vue` 的 `<style>` |
| `app.json` | `src/pages.json` + `src/manifest.json` + `scripts/patch-app-json.mjs` |
| `config.js` | `src/config.ts` |
| `utils/util.js` | `utils/format.ts` + `utils/cloud.ts` |
| `admin/dishes/rating.wxs` | `utils/rating.ts`（改为 computed 预计算） |
| 各页 `.wxss` | 各页 `.vue` 的 `<style scoped>`（1:1 搬运，未改写） |
| 各页 `.wxml` | `scripts/baseline/wxml/` 的冻结快照（仅作回归基线，不再演进） |

数据库与 18 个 action 的**接口契约完全没变**；但云函数**代码已不是零改动** ——
P0~P4 的修复都落在 `cloudfunctions/` 里（这是有意的，详见审查报告）。

---

## 迁移时的已知事项

### 有意修正的问题（原项目遗留）

1. **index 页的双栏布局从来没成立过**（2026-09-11 真机测试发现）。
   原生版 `.page` 写的是 `min-height: 100vh`，微信渲染引擎不会因此产生确定高度，
   容器被内容撑开 → 整页滚动。三个后果：① 左侧分类栏随页面一起滚走；
   ② 右侧 `scroll-view` 的 `bindscroll` **永不触发**（左侧高亮从来不跟随滚动）；
   ③ `scroll-into-view` 是空操作。
   → 处置：`.page` 改成 **`height: 100vh`**，`.catalog` 的 `flex: 1; min-height: 0`
   才能拿到确定高度，两个 pane 才真正内部滚动；分类点击与高亮跟随随之都成立。
   **⚠️ 不要改回 `min-height`。** 小程序 flex 行为与浏览器不一致，布局结论必须真机验证。
   - 连带的两个小修：`.dish-pane` 转为真正内部滚动后**横向内边距会被吞掉**
     （与 `.popup-body` / `.confirm-list` 同一类问题，scroll-view 不参与全局
     `box-sizing: border-box` 规则）→ 横向内边距下沉到新增的 `.group-wrap`，
     这样 `scroll-into-view` 的锚点 id 仍能挂在 scroll-view 的直接子节点上。
   - 高亮反查的阈值不再写死 `80px`，改为现查 `.dish-pane` 自身的上边界 + 16px 余量 ——
     访客会多出一条 `.guest-tip`，写死常量在那时会失效。
2. **index 页的下拉刷新是死配置**。原 `index.json` 开了 `enablePullDownRefresh` 却没有
   `onPullDownRefresh` 处理函数。本次补上（重新拉角色 + 菜单）。
   注意定高布局后下拉手势落在 scroll-view 上不会被页面接手，实际可能不可达 —— 但菜单
   每次 `onShow` 都会强制重拉，不影响数据新鲜度。
3. **`invite` 页视觉已升级到设计令牌**。原 `invite.wxss` 是纯白卡片 `#fff` + 灰字 `#999`，
   属 2026-09-10 色系统一时漏掉的一页，现对齐「玩趣 × 手作食堂」令牌。
4. **`statusInfo` 的颜色修正**：原 `util.js` 里 `pending` 用的是旧橙 `#ff6b35`，
   本工程统一到 `--amber`（`#F5A623`）。另外 `statusText` / `statusColor` 在原项目里是
   死代码 —— 计算了但 WXML 从未使用。

### 结构性简化

5. **`groupList` 从 data 字段改为 getter**，由 Vue 响应式自动重算，替代原 `index.js` 每次手动重建分组。
6. **购物车的 `computeCart` / `applyCart` / 6 处 `setData` 样板**合并为 `cart` store 的
   `count` / `list` / `quantityOf` getter，模板里直接 `cart.quantityOf(dish._id)`，
   不再需要「先判断 `cart[id]` 存在再取 `.quantity`」。
7. **`categoryName` 从手工维护的 data 字段改为 computed**：原 admin/dishes 的 `openAdd` /
   `openEdit` / `selectCategory` 三处都要同步更新它，现在从 `form.categoryId` 直接推导。
8. **`rating.wxs` → `utils/rating.ts`**：WXS 在小程序里是独立的编译期执行环境，模板内调用无成本；
   Vue 模板里调用函数则每次重渲染都会执行，所以改成 computed 预计算 stars 数组。
9. **admin/categories 的菜品计数**不再单独拉一次 `dish.list` 再手工 map，直接用 store 里的 `dishes`。

### 需要特别小心的地方

10. **`userStore.login(true)` 不要优化掉**：原 index / mine / orders 页的 `onShow` 都会调
    `app.refreshUser()` 强制从云端刷新角色，那是「登录自愈 / 后台改角色」的依赖。
11. **index 页与 admin/dishes 的分类/菜品都用 `catalog.load(true)` 强制拉取**。
    熟人点餐场景下「店主刚加的菜立刻能点」比省一次请求重要；admin 写操作后额外
    `catalog.invalidate()` 再 `load(true)`，保证共享数据不脏。
12. **`utils/query.ts` 是必要的**，不要简化回 `uni.createSelectorQuery()`。
    uni-app 把页面包成自定义组件后，节点查询的作用域在不同版本要求不一致
    （官方论坛说传 `getCurrentInstance()`，社区实践传 `.proxy`），
    该封装用「拿 `.page` 根节点试查询」的方式探测一次并缓存结果。
13. **订阅授权不能放到 `await` 之后**：`wx.requestSubscribeMessage` 只能由用户点击触发，
    admin/invite 的 `generate()` 里 `load()` 故意不 await、直接同步调 `subscribeForOrders()`。
14. ⭐ **身份状态绝不能先置空**（2026-09-11 修「进页面先闪顾客视图」）。
    原生 `refreshUser()` 里 `globalData.user = null` 再拉取，模板读的是 `data.user`（setData 后才变），
    所以只有首次加载会闪；**Pinia 里模板直接绑 store，置空会让 `isOwner` 立刻变 false，
    每次 `onShow` 强制刷新都闪一次**（点餐/订单/我的三页全中招）。
    现在的三条规则，改这块时别破坏：
    - `login(force)` **保留旧值直到新值到位**（stale-while-revalidate），**不允许** `this.user = null`；
    - 加本地缓存 `hl_user`（`uni.getStorageSync/setStorageSync`），state 初始化直接读 → 冷启动首帧角色就是对的；
    - 加 `roleReady` 就绪位，模板里角色分支写 `userStore.roleReady && userStore.isOwner`，
      把「还不知道身份」的窗口渲染成空白而不是错误视图。
    另外 **由角色派生的页面默认状态必须在 `ref()` 初始化时就算好**：orders 页的
    `filter` 初始值是 `userStore.isOwner ? 'all' : 'mine'`（`filterInited` 同理），
    不能等 `await userStore.login(true)` 回来再改，否则店主会先看一遍「我下单的」列表。
    **边界**：首次安装 / 清缓存后的第一次进入没有缓存可用，只能等 `login` 返回（几百毫秒空白），
    这是下限，不要再试图「优化掉」。
15. **点餐页加载态用骨架屏，不用全局转圈**（2026-09-14）。
    `App.vue` 里的 `.loading-box` / `.loading-icon` 是「一颗 48rpx 细圆环 + padding:120rpx 顶在顶部」的
    通用转圈，跟手作食堂的视觉是两套语言，所以 index 页改用与 `.dish-card` **同构的骨架卡片**：
    - 骨架卡片几何（图片 180rpx、圆角 `28/28/28/10`、内边距 20rpx、行高 26rpx）与真实卡片**逐项对齐**，
      数据到位时列表不发生布局跳动；
    - 扫光用 `sk::after` 的线性渐变 + **只动 transform**（`sk-sweep`），走合成层不掉帧，
      四张卡片错峰 100ms 依次亮起；左栏分类同样用骨架行占位，底色要单独调深
      （`--cream-deep` 压在 `--yellow-mist` 上几乎看不见）；
    - 该节点是 scroll-view 的**直接子节点**，横向内边距必须自带 `.loading-wrap`，
      否则会被内层滚动区吞掉（与 `.group-wrap` 同一坑）；
    - **其它页面仍在用全局转圈**，没有跟着改 —— 只有点餐页是「列表 + 左栏」双骨架。
    - 可视化预览稿：`loading-preview.html`（不参与构建，可删）。
16. **`verify-structure.mjs` 的 `EXPECTED_MISSING` 白名单**（2026-09-14 新增）。
    它做的是「**基线** WXML 的 class 在产物里一个不能少」，而**主动替换掉**的 class 会被误报成遗漏
    （点餐页的 `loading-box` / `loading-icon` 就是这种情况）。白名单按页登记并附原因，脚本会单独打印出来。
    **只适用于「已经知道为什么」，不适用于「先让它变绿」** —— 往里加条目等于消音，必须同时写清原因。
    比对基线是 `scripts/baseline/wxml/` 里的**冻结快照**（不是某个外部工程），所以原生工程删掉后
    这个校验照样有效。⚠️ 别去改那些 wxml，它们是参照物。
17. **服务端校验一律收口在 `cloudfunctions/api/index.js` 顶部的常量里**（2026-09-14 加固）。
    客户端表单能伪造的一切都必须在这里卡死：`MAX_ORDER_ITEMS=50` / `MAX_ITEM_QTY=99` /
    `MAX_NAME_LEN=20` / `MAX_REMARK_LEN=200` / `INVITE_TTL_DAYS=7` / `ORDER_STATUS`。
    改上限只改这几个常量，别再散落到各处判断。
    - **订单状态是英式拼写 `cancelled`（两个 l）**，写成 `canceled` 会被白名单拒掉；
    - `order.create` 会把同一 `dishId` 的多行**先合并再校验**，防止拆行绕过数量上限；
    - `invite.create` 会**查重重试**：32 选 6 碰撞概率低但非零，而 `invite.accept` 的
      `where({ code })` 只取 `data[0]`，一旦重码，被遮蔽的那个码会永久不可用且无从排查。
18. **邀请码有效期 7 天。** `invite.accept` 对**修复前创建、没有 `expiresAt` 字段的老码视为不过期**，
    所以存量邀请码不会集体失效（改这块时别把这条兼容分支删了）。
19. **`invite.accept` 的并发保护靠「条件更新」**：`where({ code, used: false }).update(...)`
    之后检查 `stats.updated === 1`。**不要改回「先查 used、再 update」**——两步之间不是原子的，
    两个人同时提交同一邀请码会双双通过。
20. **店主身份可用环境变量加固（可选，默认关闭）**：给 `login` 云函数配 `OWNER_OPENID=<你的 openid>`，
    之后只有这一个 openid 能成为店主，堵住「店主记录被误删 → 下一个打开的访客被静默提拔」。
    **不配则行为与旧版完全一致**。⚠️ 配之前确认 openid 写对了，否则会把自己也挡在门外。
21. **头像必须先传云存储再存库**（2026-09-14 修）。
    `chooseAvatar` 回传的 `e.detail.avatarUrl` 是**本地临时路径**（真机 `wxfile://tmp_xxx`，
    开发者工具 `http://tmp/xxx`），只在当前设备当前会话有效。所以 `mine.vue` 的 `onChooseAvatar`
    必须走 `uploadFile(makeCloudImagePath('avatars', tmpPath), tmpPath)` 换成 `cloud://` fileID。
    **不要改回直接存 `e.detail.avatarUrl`。**
    对应地，`user.updateProfile` 现在会校验协议（只收 `cloud://` / `https://`），
    但**非法值丢弃而不是报错** —— 老库里残留的 `wxfile://` 头像不该把「顺手改个昵称」也一起挡掉
    （客户端保存是昵称+头像一起提交的）。
    ⚠️ 临时路径**不保证带扩展名**，别用 `split('.').pop()` 取扩展名（会把整条路径当扩展名），
    统一用 `utils/image.ts` 的 `makeCloudImagePath()`。
22. ✅ **订阅消息 P0 已修**（2026-09-14）。`notifyOwner()` 的守卫原来写成
    `SUBSCRIBE_TEMPLATE_ID === '<真实模板 ID>'` —— 拿真实值当「未配置」哨兵，条件恒真，
    函数每次在第一行 return，**推送从来没发出去过**。现在哨兵是独立的
    `TEMPLATE_PLACEHOLDER = 'YOUR_TEMPLATE_ID'`。
    - **不要再把哨兵写成真实模板 ID**，也不要为了「省一次网络往返」把 `order.create` 里的
      `await notifyOwner(...)` 改成 fire-and-forget：云函数 return 后执行环境会被冻结，
      异步推送有较大概率随容器一起被掐掉 —— 那正是 P0 的病灶。
    - 配套的「未推送」提示在 `orders.vue`：订阅消息是「授权一次 = 只能推一次」，
      店主点过一次「允许」之后每单 `notified` 都会是 `false`，所以提醒卡会在
      `unnotifiedCount > 0` 时切成浅黄通知条 + `未推送` 徽章，引导补一次授权。
      警示态**刻意不用橙底白字**（`#F5A623` 上白字只有 2:1 对比，违反设计系统的 CTA 规范）。
23. **订单页空态图片用 `app-logo.png`，不是 `app-logo.jpg`**（2026-09-14）。
    `.jpg` 是**真正的 JPEG，没有 alpha 通道**，白底是烤进像素里的 —— 而 `.empty-emoji`
    没有圆角，直接暴露成一个白方块。（banner 的 `.brand-logo` 和「我的」`.avatar` 也有同样
    的白底，但它们带 `border-radius: 50%` + 白底，被容器裁掉了，所以看不出问题，**故未改动**。）
    - 透明版由 `scripts/gen_transparent_logo.py` 生成（纯 Pillow，无 numpy）：从四角泛洪 →
      裁到内容包围盒 → 掩码外扩 1px 吃掉 JPEG 白晕 → 羽化 0.7px → 量化 128 色（160KB → 24KB）。
    - ⚠️ **不能用全局白色阈值去底色**：这张 logo 内部有白色厨师帽和虚线圆，会被一起打穿。
      必须从四角泛洪（`ImageDraw.floodfill` + 哨兵色回读掩码），只吃掉与边角相连的区域。
    - ⚠️ 换图后要重新 build。uni-app 会把 `src/static` 路径**提升到 `common/assets.js` 用变量导出**
      （`app_logo_default` → `.png`、`app_logo_default$1` → `.jpg`），
      所以**在产物里 grep 图片名要去 `common/assets.js` 找**，页面目录里只有 `src="{{F}}"` 占位。
    - 另注：`avatar-default.png` 与 `app-logo.jpg` 的 **MD5 完全相同**，也是个 JPEG 冒充 `.png`；
      因为 `.avatar` 有圆角遮住所以没动它 —— 将来若去掉头像圆角会立刻暴露同一个问题。

---

## 验证清单（请用真机，模拟器不可靠）

> 2026-09-11 首轮真机回归已发现并修掉「双栏布局未成立」的问题（见上），点餐页需要**再验一轮**。
> 2026-09-14 点餐页加载态改为骨架屏，需一并核对。

- [ ] 微信开发者工具导入 `dist/build/mp-weixin`，编译无报错
- [ ] 云函数面板能看到 `login` 与 `api`，两个都已重新部署
- [ ] 打开小程序 → 自动登录，首页 tabBar 三个图标显示正常
- [ ] **点餐页**：整页不再滚动；向下滑时 banner 与左侧分类栏**保持不动**
- [ ] **点餐页**：点左侧分类，右侧列表滚动定位到对应分组
- [ ] **点餐页**：手动滚动右侧列表，左侧分类高亮跟随变化
- [ ] **点餐页**：菜品卡片左右留白与迁移前一致（`.group-wrap` 内边距是否生效）
- [ ] **点餐页**：分类很多时左侧分类栏能独立滚动
- [ ] **点餐页**：加菜/减菜、购物车条角标、购物车弹窗、确认下单弹窗全链路
- [ ] **点餐页**：冷启动/下拉刷新时先出「正在上菜…」+ 骨架卡片，扫光依次亮起
- [ ] **点餐页**：骨架卡片换成真实菜品卡片时**列表不发生跳动**（几何是否对齐）
- [ ] **点餐页**：左栏分类还没到位时是骨架行，不是只有「全部」孤零零一项
- [ ] **点餐页**：底部购物车条不遮挡最后一道菜
- [ ] 下单流程：店主能收到订阅消息推送（**必须真机**）—— 已修 P0，但要求店主**先点过一次
      「开启提醒」授权**；不授权则推送不会发出，属预期行为
- [ ] 「订单」页：店主在有人下单后，顶部提醒卡变成「N 单没推到微信 / 未推送」警示态，
      点「补订阅」能唤起授权弹窗
- [ ] **头像跨设备可见**：换头像后，让店主在「订单管理」里看这一单的头像能否正常显示
      （这是 `wxfile://` 那个 bug 的验收点，换设备/重装后仍应显示）
- [ ] 邀请码：新生成的码 7 天后失效；**修复前生成的存量老码仍可正常接受**
- [ ] 邀请码：同一邀请码被两人同时提交时，只有一人能接受成功
- [ ] 订单：数量改成 0 / 负数 / 小数时无法下单；一次选超过 50 道菜会被拒
- [ ] **菜品管理**：上传图片、半星评分点选（左右半星）、快速改名、键盘弹起时表单不被遮挡
- [ ] **分类管理**：新增/编辑/删除后，点餐页能看到最新分类
- [ ] **订单管理**：筛选切换、完成/取消状态流转、顾客头像能显示
- [ ] **点餐统计**：三个概览数字与排行条宽度正确
- [ ] **邀请好友**：生成邀请码、复制、分享卡片能带 code 进入接受邀请页
- [ ] 「我的」页：角色标签正确（店主 / 点餐成员 / 访客）
- [ ] 「我的」页：店主能看到「订单动态墙」热力图并自动滚到最右
- [ ] 「我的」页：改昵称 / 头像能保存成功；头像上传期间按钮文案变「上传中…」
- [ ] 「订单」页：列表正常、下拉刷新可用、日期范围筛选可用
- [ ] **「订单」页空态**：订单为空时，图片四角透明、与米白底色自然融合，**不出现白色方块**；
      图片仍在上下浮动（`float-y` 动画）
- [ ] **角色不闪**：以店主身份反复切换「点餐 / 订单 / 我的」，不应先出现顾客视图再跳到店主视图
      （冷启动首次安装/清缓存后允许有一次短暂空白）
- [ ] 「订单」页：店主点顶部「开启提醒」能唤起订阅授权弹窗（**必须真机**）
- [ ] 「接受邀请」页：输入邀请码后角色变更，首页立即生效
