#!/usr/bin/env node
/**
 * 事件处理器体检：确认 .vue 模板里绑定的 @tap / @input / @confirm 等
 * 都能在 <script setup> 里找到对应实现。
 *
 * 为什么需要：uni-app 编译后 bindtap 变成 `bindtap="{{x}}"` 的下标引用，
 * 产物里 grep 不到函数名，写错名字或忘了定义只会在真机点击时才报错。
 * 在源码层面扫一遍最省事。
 *
 * 用法：node scripts/verify-handlers.mjs
 */
import { readFileSync } from 'node:fs'
import { readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pagesDir = resolve(root, 'src/pages')

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.vue') ? [p] : []
  })
}

let problems = 0
const files = walk(pagesDir).sort()

for (const file of files) {
  const src = readFileSync(file, 'utf8')
  const scriptMatch = src.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)
  const templateMatch = src.match(/<template>([\s\S]*)<\/template>/)
  if (!scriptMatch || !templateMatch) continue

  const script = scriptMatch[1]
  const template = templateMatch[1]

  const handlers = new Set()
  for (const m of template.matchAll(/@[a-zA-Z.]+(?:\.\w+)*="([^"]+)"/g)) {
    const expr = m[1].trim()
    // 内联表达式（赋值 / 三元）不需要函数实现
    if (expr.includes('=') || expr.includes('?')) continue
    const ident = expr.split('(')[0].trim()
    if (!ident) continue
    handlers.add(ident)
  }

  const missing = []
  for (const h of handlers) {
    // 带点的是 store action（cart.add）或对象方法，跳过
    if (h.includes('.')) continue
    const defined =
      new RegExp(`function\\s+${h}\\s*\\(`).test(script) ||
      new RegExp(`const\\s+${h}\\s*=`).test(script) ||
      new RegExp(`(?:let|var)\\s+${h}\\s*=`).test(script)
    if (!defined) missing.push(h)
  }

  const rel = relative(root, file).replace(/\\/g, '/')
  if (missing.length) {
    problems++
    console.log(`✗ ${rel}\n    未定义：${missing.join(', ')}`)
  } else {
    console.log(`✓ ${rel}  (${handlers.size} 个绑定)`)
  }
}

console.log(problems ? `\n有 ${problems} 个文件存在未定义的处理器` : '\n全部事件绑定均有实现')
process.exit(problems ? 1 : 0)
