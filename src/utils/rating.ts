/**
 * 推荐指数（星级）渲染工具 —— 替代原 pages/admin/dishes/rating.wxs
 *
 * 原实现是 WXS 模块，在模板里 `ratingWxs.fill(item.rating, s)` 实时调用；
 * WXS 在小程序里是编译期优化的独立运行环境，开销可忽略，但 Vue 模板里
 * 直接调用函数会在每次重渲染时重复执行，所以这里改成「提前算好」的纯函数：
 * 调用方用 computed 一次性生成 starList，模板只做取值。
 */

/** 返回第 star 颗星的填充宽度：整星 '100%'、半星 '50%'、空 '0%' */
export function starFill(rating: number, star: number): string {
  const r = parseFloat(String(rating)) || 0
  if (r >= star) return '100%'
  if (r >= star - 0.5) return '50%'
  return '0%'
}

/** 1~5 颗星的填充宽度列表，供 v-for 直接渲染 */
export function starList(rating: number): Array<{ star: number; fill: string }> {
  return [1, 2, 3, 4, 5].map((star) => ({ star, fill: starFill(rating, star) }))
}
