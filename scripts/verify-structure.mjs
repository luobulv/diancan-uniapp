#!/usr/bin/env node
/**
 * 结构回归核对：逐页比对「原生 WXML 基线」与「uni-app 构建产物 WXML」的 class 集合。
 *
 * 迁移最容易出的问题是「漏掉一个元素 / 少写一个 class」——肉眼比对 9 个页面
 * 几百行模板不现实，用脚本卡一遍最快。只要基线用到的 class 在产物里一个不少，
 * 就能排除「元素整体丢失」这类事故（样式本身是整文件注入的，天然一致）。
 *
 * ⚠️ 基线读的是 scripts/baseline/wxml/ 里的**冻结快照**，不是原生工程。
 * 原生工程（../diancan-miniprogram）已于 2026-09-14 废除，快照是那之前拷进来的，
 * 它与原生工程逐字节相同。这样回归工具不再依赖已删除的目录。
 * 仍然支持显式传参（node scripts/verify-structure.mjs <原生根目录>）用于临时比对。
 *
 * 用法：
 *   node scripts/verify-structure.mjs [原生小程序根目录]
 * 默认基线取 scripts/baseline/wxml
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const baselineDir = resolve(root, 'scripts/baseline/wxml')
const legacyNativeDir = resolve(root, '../diancan-miniprogram/miniprogram')
const nativeRoot = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : existsSync(baselineDir)
    ? baselineDir
    : legacyNativeDir
const distRoot = resolve(root, 'dist/build/mp-weixin')

const PAGES = [
  'pages/index/index',
  'pages/orders/orders',
  'pages/mine/mine',
  'pages/invite/invite',
  'pages/admin/dishes/dishes',
  'pages/admin/categories/categories',
  'pages/admin/orders/orders',
  'pages/admin/stats/stats',
  'pages/admin/invite/invite'
]

/**
 * 抽出 wxml 里所有 class="..." 中的类名。
 *
 * 需要同时处理两种写法（uni-app 编译 :class 后会产出第二种）：
 *   class="cate-menu-item {{active ? 'active' : ''}}"
 *   class="{{['cate-menu-item', 'data-v-x', d && 'active']}}"
 * 所以除了原文里未被 {{}} 包裹的词，还要捞一遍表达式里的单引号字符串字面量。
 */
function classSet(wxml) {
  const out = new Set()
  const re = /class="/g
  let m
  while ((m = re.exec(wxml))) {
    const end = wxml.indexOf('"', m.index + 7)
    if (end < 0) continue
    const raw = wxml.slice(m.index + 7, end)

    // 1) {{}} 之外的普通类名（可能带动态后缀，如 heatmap-level-）
    raw
      .replace(/\{\{[\s\S]*?\}\}/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .forEach((c) => out.add(c))

    // 2) {{}} 表达式里的字符串字面量。
    //    先剥掉比较运算的右操作数（=== 'all' 这种是判断值，不是类名），
    //    剩下的字面量再按空白拆开（可能一次写了多个类，如 'heatmap-day heatmap-level-'）。
    const expr = raw.replace(/[!=]==?\s*'[^']*'/g, ' ')
    for (const lit of expr.matchAll(/'([^']*)'/g)) {
      lit[1]
        .split(/\s+/)
        .filter(Boolean)
        .forEach((c) => out.add(c))
    }
  }
  return out
}

/**
 * 有意为之的产物差异：迁移落地后「主动替换掉」的 class，不是遗漏。
 *
 * 加进这里必须写清原因 —— 脚本会把它单独打印出来，避免它变成消音器：
 * 白名单只适用于「已经知道为什么」，不适用于「先让它变绿」。
 */
const SK_SKELETON = '加载态改为骨架屏（App.vue 的 .sk-panel 一族），不再使用全局转圈'
const EXPECTED_MISSING = {
  'pages/index/index': {
    'loading-box': '点餐页加载态改为骨架屏，不再使用全局转圈（见 index.vue 加载态样式）',
    'loading-icon': '同上'
  },
  // 2026-09-14 第二轮：其余页面的全局转圈也统一换成骨架屏（全局样式在 App.vue）
  'pages/orders/orders': { 'loading-box': SK_SKELETON, 'loading-icon': SK_SKELETON },
  'pages/mine/mine': { 'loading-box': SK_SKELETON, 'loading-icon': SK_SKELETON },
  'pages/admin/dishes/dishes': { 'loading-box': SK_SKELETON, 'loading-icon': SK_SKELETON },
  'pages/admin/categories/categories': { 'loading-box': SK_SKELETON, 'loading-icon': SK_SKELETON },
  'pages/admin/orders/orders': { 'loading-box': SK_SKELETON, 'loading-icon': SK_SKELETON },
  'pages/admin/stats/stats': { 'loading-box': SK_SKELETON, 'loading-icon': SK_SKELETON },
  'pages/admin/invite/invite': { 'loading-box': SK_SKELETON, 'loading-icon': SK_SKELETON }
}

let failed = 0
console.log(`基线：${nativeRoot}\n产物：${distRoot}\n`)

for (const page of PAGES) {
  const nativeFile = resolve(nativeRoot, `${page}.wxml`)
  const distFile = resolve(distRoot, `${page}.wxml`)

  if (!existsSync(nativeFile)) {
    console.log(`✗ ${page}: 找不到基线 ${nativeFile}`)
    failed++
    continue
  }
  if (!existsSync(distFile)) {
    console.log(`✗ ${page}: 产物缺失（尚未迁移？）`)
    failed++
    continue
  }

  const nativeSet = classSet(readFileSync(nativeFile, 'utf8'))
  const distSet = classSet(readFileSync(distFile, 'utf8'))
  // uni-app 会把 :class 的三元结果提升到渲染函数里，字面量只留在 .js 中；
  // 模板字符串写法（`heatmap-level-${level}`）则只有前缀留在 js 里。
  // 两种情况都在同页 .js 里再确认一次。
  const distJs = existsSync(distFile.replace(/\.wxml$/, '.js'))
    ? readFileSync(distFile.replace(/\.wxml$/, '.js'), 'utf8')
    : ''
  const inJs = (c) =>
    distJs.includes(`'${c}'`) || distJs.includes(`"${c}"`) || distJs.includes('`' + c)
  const absent = [...nativeSet].filter((c) => !distSet.has(c) && !inJs(c))
  const allowed = EXPECTED_MISSING[page] || {}
  const expected = absent.filter((c) => allowed[c])
  const missing = absent.filter((c) => !allowed[c])
  const added = [...distSet].filter((c) => !nativeSet.has(c) && !c.startsWith('data-v-'))

  if (missing.length) failed++
  console.log(
    `${missing.length ? '✗' : '✓'} ${page.padEnd(30)} 基线 ${String(nativeSet.size).padStart(3)} 类` +
      (missing.length
        ? ` | 缺失 ${missing.length}：${missing.join(', ')}`
        : ` | 无缺失${expected.length ? `（有意移除 ${expected.length}）` : ''}`) +
      (added.length ? ` | 产物新增：${added.join(', ')}` : '')
  )
  for (const c of expected) console.log(`      · 有意移除 ${c} —— ${allowed[c]}`)
}

console.log(failed ? `\n有 ${failed} 个页面需要复核` : '\n全部页面 class 无缺失')
process.exit(failed ? 1 : 0)
