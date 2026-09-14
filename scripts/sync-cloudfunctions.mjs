#!/usr/bin/env node
/**
 * 把云函数目录挂进编译产物，并给生成的 project.config.json 补上 cloudfunctionRoot。
 *
 * 背景：uni-app 的编译产物在 dist/<mode>/mp-weixin/，而 cloudfunctions/ 在项目根目录。
 * 微信开发者工具的云函数面板要求目录必须在小程序项目内，否则看不到、无法右键上传部署。
 * Windows 下用 junction 链接，不需要管理员权限。
 *
 * 用法：node scripts/sync-cloudfunctions.mjs [dev|build]
 */
import { existsSync, mkdirSync, symlinkSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const mode = process.argv[2] || 'build'
const distDir = resolve(root, 'dist', mode, 'mp-weixin')
const linkPath = resolve(distDir, 'cloudfunctions')
const target = resolve(root, 'cloudfunctions')

if (!existsSync(distDir)) {
  console.error(`[sync-cloudfunctions] 编译产物目录不存在：${distDir}`)
  console.error('请先执行 npm run build:mp-weixin')
  process.exit(1)
}

// 1. 把云函数目录链进编译产物
if (!existsSync(target)) {
  console.warn(`[sync-cloudfunctions] 云函数源目录不存在：${target}（跳过）`)
} else if (existsSync(linkPath)) {
  console.log(`[sync-cloudfunctions] 链接已存在：${linkPath}`)
} else {
  try {
    symlinkSync(target, linkPath, 'junction')
    console.log(`[sync-cloudfunctions] 已链接：${linkPath} -> ${target}`)
  } catch (e) {
    console.error(`[sync-cloudfunctions] 链接失败：${e.message}`)
    console.error('  可手动把 cloudfunctions 复制到编译产物目录。')
  }
}

// 2. 给编译产物里的 project.config.json 补 cloudfunctionRoot
const pcfgPath = resolve(distDir, 'project.config.json')
if (existsSync(pcfgPath)) {
  try {
    const cfg = JSON.parse(readFileSync(pcfgPath, 'utf8'))
    if (cfg.cloudfunctionRoot !== 'cloudfunctions/') {
      cfg.cloudfunctionRoot = 'cloudfunctions/'
      writeFileSync(pcfgPath, JSON.stringify(cfg, null, 2), 'utf8')
      console.log('[sync-cloudfunctions] 已写入 cloudfunctionRoot: cloudfunctions/')
    } else {
      console.log('[sync-cloudfunctions] cloudfunctionRoot 已配置')
    }
  } catch (e) {
    console.error(`[sync-cloudfunctions] 写入 project.config.json 失败：${e.message}`)
  }
} else {
  console.warn(`[sync-cloudfunctions] 未找到 ${pcfgPath}`)
}
