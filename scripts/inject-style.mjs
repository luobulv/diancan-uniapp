#!/usr/bin/env node
/**
 * 把原项目的 .wxss 内容注入到目标 .vue 的 <style scoped> 块里。
 *
 * 项目的 WXSS 几乎可以 1:1 复用到 uni-app（rpx / CSS 变量都支持），
 * 所以样式不需要手写改写，机械搬运即可 —— 用脚本做可以避免大段样式在
 * 对话上下文里来回搬运，也杜绝手抄时的漏行。
 *
 * 用法：node scripts/inject-style.mjs <目标.vue> <原.wxss>
 */
import { readFileSync, writeFileSync } from 'node:fs'

const [vuePath, wxssPath] = process.argv.slice(2)

if (!vuePath || !wxssPath) {
  console.error('用法: node scripts/inject-style.mjs <目标.vue> <原.wxss>')
  process.exit(1)
}

const vue = readFileSync(vuePath, 'utf8')
const css = readFileSync(wxssPath, 'utf8').trim()

if (!/<style scoped>[\s\S]*?<\/style>/.test(vue)) {
  console.error(`✗ ${vuePath} 里没有找到 <style scoped> 块`)
  process.exit(1)
}

const out = vue.replace(
  /<style scoped>[\s\S]*?<\/style>/,
  `<style scoped>\n${css}\n</style>`
)

writeFileSync(vuePath, out, 'utf8')
console.log(`✓ 已注入 ${css.split('\n').length} 行 CSS -> ${vuePath}`)
