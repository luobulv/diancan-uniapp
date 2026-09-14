#!/usr/bin/env node
/**
 * 补齐小程序 app.json 的原生专属字段。
 *
 * 背景：uni-app 只把 pages.json 里白名单内的根级键写进 app.json，
 * `style`（是否启用 v2 组件样式）和 `sitemapLocation` 这类字段会被直接丢掉。
 * 而原项目 app.json 里两者都有：
 *   "style": "v2",                 // 组件默认样式版本，影响 button / input 等原生组件外观
 *   "sitemapLocation": "sitemap.json"
 * 不补回来的话，`<button open-type="share">`、`<input>` 的默认外观会与迁移前不一致。
 *
 * 用法：node scripts/patch-app-json.mjs [dist 目录]，默认 dist/build/mp-weixin
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 需要与原生 app.json 对齐的根级字段 */
const EXTRA = {
  style: 'v2',
  sitemapLocation: 'sitemap.json'
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distDir = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : resolve(root, 'dist/build/mp-weixin')
const target = resolve(distDir, 'app.json')

if (!existsSync(target)) {
  console.error(`[patch-app-json] 找不到 ${target}，请先执行构建`)
  process.exit(1)
}

const json = JSON.parse(readFileSync(target, 'utf8'))
const applied = []

for (const [key, value] of Object.entries(EXTRA)) {
  if (json[key] !== value) {
    json[key] = value
    applied.push(key)
  }
}

writeFileSync(target, JSON.stringify(json, null, 2) + '\n', 'utf8')
console.log(
  applied.length
    ? `[patch-app-json] 已写入：${applied.join(', ')}`
    : `[patch-app-json] 无需改动（${Object.keys(EXTRA).join(', ')} 均已就位）`
)
