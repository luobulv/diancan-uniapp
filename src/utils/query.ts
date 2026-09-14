import { getCurrentInstance } from 'vue'

/**
 * 节点测量工具 —— 把原项目的 wx.createSelectorQuery() 平滑搬到 uni-app(Vue3)。
 *
 * 为什么需要这层封装：
 * 原项目直接调 `wx.createSelectorQuery()`（页面级，不传作用域）。编译到 uni-app 后
 * 页面会被包装成自定义组件，节点查询能不能看到页面内的节点，取决于运行时版本；
 * 官方论坛（ask.dcloud.net.cn/article/40201）说 Vue3 传 `getCurrentInstance()` 本身，
 * 社区实践却多传 `instance.proxy`，甚至有传 `instance.proxy.$scope` 的。
 * 与其赌一个，不如**探测一次**：拿页面里必然存在的根节点试查询，按
 *   页面级 → $scope → instance → proxy
 * 的顺序找到第一个真能查到节点的作用域并缓存下来，后续复用。
 *
 * 用法：
 *   // setup 同步阶段（必须）
 *   initQueryScope()
 *   // 之后任意时机
 *   const rects = await rectsOf(['#a', '#b'])   // 顺序与入参一致，查不到为 null
 */

let inst: any = null
/** 命中的作用域；undefined = 页面级 */
let scope: any = undefined
/** 探测成功后才置 true，失败则下次重试（首屏 onShow 可能早于节点渲染） */
let scopeReady = false

/** 必须在 setup 同步阶段调用一次 —— getCurrentInstance() 只在 setup 执行期间有效 */
export function initQueryScope() {
  inst = getCurrentInstance()
}

function candidates(): any[] {
  return [undefined, inst?.proxy?.$scope ?? inst?.$scope, inst, inst?.proxy]
}

function buildQuery(c: any) {
  return c === undefined ? uni.createSelectorQuery() : uni.createSelectorQuery().in(c)
}

/**
 * 探测可用作用域。probe 默认用 `.page`（本项目每个页面的根 view 都带这个 class）。
 * 探测总计失败时保持未就绪状态，下次调用会再试。
 */
export function ensureQueryScope(probe = '.page'): Promise<void> {
  if (scopeReady) return Promise.resolve()

  return new Promise((resolve) => {
    const list = candidates()
    let i = 0

    const step = () => {
      if (i >= list.length) return resolve() // 保持未就绪，下次重试
      const c = list[i++]
      let q: UniNamespace.SelectorQuery
      try {
        q = buildQuery(c)
        q.select(probe).boundingClientRect()
        q.exec((res: any[]) => {
          if (res && res[0]) {
            scope = c
            scopeReady = true
            resolve()
          } else {
            step()
          }
        })
      } catch {
        // 传错作用域对象时 wx 层可能直接抛错，跳过该候选
        step()
      }
    }

    step()
  })
}

/**
 * 批量查询多个选择器的 boundingClientRect。
 * 返回数组与入参等长、顺序一致；查不到的项为 null（而非被过滤掉），
 * 这样调用方可以直接用下标和业务数组对齐。
 */
export async function rectsOf(selectors: string[]): Promise<Array<UniNamespace.NodeInfo | null>> {
  await ensureQueryScope()

  return new Promise((resolve) => {
    const q = buildQuery(scope)
    selectors.forEach((s) => q.select(s).boundingClientRect())
    q.exec((res: any[]) => resolve((res || []) as Array<UniNamespace.NodeInfo | null>))
  })
}
