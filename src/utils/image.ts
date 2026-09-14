/**
 * 图片临时路径 → 云存储路径 的工具
 *
 * 为什么需要单独一个文件：`chooseMedia` / `chooseAvatar` 返回的都是**本地临时路径**
 * （真机上形如 `wxfile://tmp_xxx`，开发者工具里是 `http://tmp/xxx.jpeg`）。
 * 这种路径有两个坑：
 *   1. **不保证带扩展名**，所以不能用 `path.split('.').pop()` 取扩展名 ——
 *      那样会把整条路径当成扩展名拼进云存储路径里（`dishes/123.wxfile://tmp_xxx`）；
 *   2. **不能直接存库**。它只在当前设备当前会话有效，重启就失效，
 *      别人（店主在订单列表里）也加载不出来。
 *      必须先用 `wx.cloud.uploadFile` 换成 `cloud://` 的 fileID 才能持久化。
 */

/** 允许的图片扩展名（白名单，其余一律回退） */
const ALLOWED_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp']

/**
 * 从本地临时路径里提取一个可用的图片扩展名。
 *
 * 只认「路径结尾的 .xxx」，且必须在白名单里；否则返回 fallback。
 * 注意不要改成 `split('.').pop()`。
 */
export function pickImageExt(filePath: string, fallback = 'png'): string {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(filePath || '')
  if (!m) return fallback
  const ext = m[1].toLowerCase()
  return ALLOWED_EXT.includes(ext) ? ext : fallback
}

/**
 * 生成一个不会重名的云存储路径，例：`dishes/1757000000000-48213.png`
 *
 * @param dir 云存储目录，菜品图用 `dishes`，头像用 `avatars`
 */
export function makeCloudImagePath(dir: string, filePath: string): string {
  const ext = pickImageExt(filePath)
  const rand = Math.floor(Math.random() * 100000)
  return `${dir}/${Date.now()}-${rand}.${ext}`
}
