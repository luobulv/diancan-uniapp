const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// 订阅消息模板 ID —— 需与 src/config.ts 的 SUBSCRIBE_TEMPLATE_ID 保持一致。
// 尚未在公众平台申请到模板时，把它留成 TEMPLATE_PLACEHOLDER 即可自动跳过推送。
const SUBSCRIBE_TEMPLATE_ID = '9c7BsTLl1hL6bIAJ00J9c36A-NV-KREvOdnyGJvNklg'

// ⚠️ 「还没配模板」的哨兵值必须是一个**和真实模板 ID 不同**的占位符。
// 修复前这里写的是 `SUBSCRIBE_TEMPLATE_ID === '9c7Bs...Nklg'` —— 拿真实模板 ID
// 自己当哨兵，条件恒为真，于是 notifyOwner 每次都在第一行 return，
// 订阅消息一条都没发出去过（所有订单的 notified 永远是 false，且不报任何错）。
const TEMPLATE_PLACEHOLDER = 'YOUR_TEMPLATE_ID'

// 店主 openid（可选加固项，与 cloudfunctions/login 读的是同一个环境变量）。
// 配了它，notifyOwner 就不必再查一次 users 去确认收件人是谁。
const OWNER_OPENID = process.env.OWNER_OPENID || ''

// ==================== 服务端业务上限 ====================
// 下面这些量客户端全都可以伪造（云函数是唯一可信边界），所以必须在这里收口，
// 不能指望前端表单校验。
const MAX_ORDER_ITEMS = 50   // 单笔订单最多几个菜品行
const MAX_ITEM_QTY = 99      // 单个菜品最多几份
const MAX_NAME_LEN = 20      // 菜品名 / 分类名 / 昵称长度上限
const MAX_REMARK_LEN = 200   // 备注长度上限
const MAX_ID_LEN = 64        // 文档 id 长度上限
const MAX_URL_LEN = 512      // 图片地址长度上限
const INVITE_TTL_DAYS = 7    // 邀请码有效期（天）

// 允许的订单状态。与 pages/admin/orders/orders.vue 的筛选项一致，
// 注意是英式拼写 cancelled（两个 l），别写成 canceled。
const ORDER_STATUS = ['pending', 'completed', 'cancelled']

// 订单列表的分页参数。默认 20 条一页，与前端 onReachBottom 的「加载更多」配套。
const ORDER_PAGE_DEFAULT = 20
const ORDER_PAGE_MAX = 50

// ==================== 取全量用的分页常量 ====================
// ⚠️ 微信云函数端单次 get() **默认且最多返回 100 条**（小程序端是 20 条）。
// 所以任何「把整个集合拿出来」的查询都必须自己分页，否则会在数据过百之后
// **静默截断** —— 不报错，只是列表慢慢变短，极难察觉。
// 统一收口成 fetchAll()，避免以后又有人漏写 .limit()。
const SCAN_PAGE = 100
const MAX_SCAN = 2000   // 单次 action 最多扫描多少条，防止集合无限增长后把云函数拖垮

// ==================== 时区 ====================
// 云函数进程时区不受我们控制（可能是 UTC）。凡是把时间戳转成「当地日期 / 时刻」的地方
// （热力图的日期格子、订阅消息里的时间字段），一律显式按 UTC+8 计算，
// 不用 getFullYear / getHours 这类跟随进程时区的接口 —— 否则凌晨 0~8 点的单子会落到前一天。
const TZ_OFFSET_MS = 8 * 3600 * 1000

/** 把任意时间值换算成「UTC+8 的挂钟时间」，之后统一用 getUTC* 读取 */
function localDate(input) {
  const d = input instanceof Date ? input : new Date(input || Date.now())
  return new Date(d.getTime() + TZ_OFFSET_MS)
}

const pad = n => (n < 10 ? '0' + n : '' + n)

/** UTC+8 下的 YYYY-MM-DD（热力图日期格子的 key） */
function dayKey(input) {
  const d = localDate(input)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** UTC+8 下的 YYYY-MM-DD HH:mm（订阅消息 time9 字段用） */
function formatTime(input) {
  const d = localDate(input)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 'YYYY-MM-DD'（UTC+8 当天 00:00:00.000）→ 真实时间戳 */
function dayStart(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) - TZ_OFFSET_MS)
}

/** 'YYYY-MM-DD'（UTC+8 当天 23:59:59.999）→ 真实时间戳 */
function dayEnd(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1) - TZ_OFFSET_MS - 1)
}

/** 文本裁剪：null / undefined 归空串，再 trim + 截断 */
function clip(v, max) {
  return String(v === undefined || v === null ? '' : v).trim().slice(0, max)
}

/**
 * 分页取全量。
 *
 * 云函数端单次最多 100 条，所以「拿整个集合」必须 count() 出总数再并发翻页。
 * MAX_SCAN 是兜底：熟人场景数据量很小，真触顶说明有别的问题，
 * 宁可能少也不能把云函数拖到超时。
 */
async function fetchAll(collectionName, options = {}) {
  const { where, orderBy } = options
  const build = (withOrder) => {
    let q = db.collection(collectionName)
    if (where && Object.keys(where).length > 0) q = q.where(where)
    if (withOrder && orderBy) q = q.orderBy(orderBy.field, orderBy.order)
    return q
  }
  // count 不带 orderBy：排序对计数没有意义，也免得某些版本上两者不兼容
  const totalRes = await build(false).count()
  const total = Math.min(totalRes.total, MAX_SCAN)
  const pages = Math.max(1, Math.ceil(total / SCAN_PAGE))
  const tasks = []
  for (let i = 0; i < pages; i++) {
    // 每次都重新构造查询，不复用同一个 Query 对象
    tasks.push(build(true).skip(i * SCAN_PAGE).limit(SCAN_PAGE).get())
  }
  const results = await Promise.all(tasks)
  const out = []
  results.forEach(res => res.data.forEach(doc => out.push(doc)))
  return out
}

async function getUser(openid) {
  const res = await db.collection('users').where({ openid }).limit(1).get()
  return res.data[0] || null
}

// 生成 6 位邀请码（去除易混淆字符）
function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)]
  return code
}

/**
 * 生成一个当前未被占用的邀请码。
 *
 * 32 个字符取 6 位约 10.7 亿种组合，碰撞概率很低但**不为零**。
 * 而 invite.accept 用 where({ code }) 只取 data[0]；一旦出现重码，
 * 被遮蔽的那个码会永久无法使用，且从后台完全看不出原因。
 * 查重一次的成本可以忽略，所以这里必须重试。
 */
async function genUniqueCode() {
  for (let i = 0; i < 5; i++) {
    const code = genCode()
    const dup = await db.collection('invitations').where({ code }).count()
    if (dup.total === 0) return code
  }
  throw new Error('邀请码生成失败，请重试')
}

// 推荐指数：0~5，支持半星（0.5 步进），默认 0
function clampRating(v) {
  const n = Number(v)
  if (isNaN(n)) return 0
  return Math.max(0, Math.min(5, Math.round(n * 2) / 2))
}

/**
 * 图片地址是否可以入库。
 *
 * 只认两类：云存储 fileID（`cloud://`）与 https 外链。
 * 其余（尤其 `wxfile://` 和开发者工具的 `http://tmp/`）都是本地临时路径，
 * 换设备/重启即失效 —— 存进库只会得到一个加载不出来的破图。
 */
function isStorableImage(url) {
  return url.startsWith('cloud://') || url.startsWith('https://')
}

/** 校验并归一化图片地址：'' = 允许留空；null = 非法 */
function normalizeImage(v) {
  const url = clip(v, MAX_URL_LEN)
  if (!url) return ''
  return isStorableImage(url) ? url : null
}

/** 分类是否存在 */
async function categoryExists(id) {
  const res = await db.collection('categories').where({ _id: id }).count()
  return res.total > 0
}

// ==================== 图片临时链接 ====================
// ⚠️ 背景：云存储权限被设成了「仅创建者可读写」（免费开发环境不允许修改），
// 于是 `cloud://` 的 fileID **只有上传者本人**能读。顾客端 `<image src="cloud://...">`
// 会被 403 拒绝，表现为「店主看得见、所有朋友都看不见」—— 与手机机型无关，
// 换安卓的朋友来看同样看不到。
//
// 服务端是这条规则的例外，官方原文：
//   「云后台和服务端始终有所有文件读写权限，安全规则的配置仅对客户端发起的请求有效」
// 所以由云函数代全体用户换取带签名的 https 临时链接，前端直接渲染那个链接。
const TMP_URL_BATCH = 50      // getTempFileURL 单次最多 50 个 fileID，超出必须分片
const TMP_URL_MAX_AGE = 86400 // 临时链接有效期（秒）。私有读的文件默认 24 小时

/**
 * 给一批文档挂上可直接渲染的 https 临时链接。
 *
 * @param {Array} list       文档数组（原地修改）
 * @param {string} field     从哪个字段读 fileID：菜品用 'imageUrl'，订单头像用 'avatarUrl'
 * @param {string} outField  写到哪个字段：分别配 'imageSrc' / 'avatarSrc'
 *
 * ⚠️ **只新增字段，绝不替换原字段**。原字段是入库用的 fileID：
 * 店主在 admin 页编辑菜品时会原样回传保存，一旦把临时链接写进去，
 * 24 小时过期后那条链接就永久失效，图片再也回不来 —— 必须双字段并存。
 *
 * 失败一律静默降级（不挂 outField，调用方回退到 fileID）：
 * 换个链接而已，不能让整个列表拉不出来。
 */
async function attachImageSrc(list, field = 'imageUrl', outField = 'imageSrc') {
  const fileIds = []
  const seen = new Set()
  list.forEach(doc => {
    const v = doc[field]
    if (typeof v === 'string' && v.startsWith('cloud://') && !seen.has(v)) {
      seen.add(v)
      fileIds.push(v)
    }
  })
  if (fileIds.length === 0) return list

  const urlMap = new Map()
  try {
    const tasks = []
    for (let i = 0; i < fileIds.length; i += TMP_URL_BATCH) {
      tasks.push(cloud.getTempFileURL({
        fileList: fileIds.slice(i, i + TMP_URL_BATCH).map(fileID => ({ fileID, maxAge: TMP_URL_MAX_AGE }))
      }))
    }
    const results = await Promise.all(tasks)
    results.forEach(res => {
      (res.fileList || []).forEach(item => {
        // status === 0 才表示这个 fileID 换链接成功
        if (item && item.status === 0 && item.tempFileURL) {
          urlMap.set(item.fileID, item.tempFileURL)
        }
      })
    })
  } catch (e) {
    console.error('换取图片临时链接失败：', e)
  }

  if (urlMap.size === 0) return list
  list.forEach(doc => {
    const url = urlMap.get(doc[field])
    if (url) doc[outField] = url
  })
  return list
}

// 新订单通知店主。推送成功后会回写订单 notified: true，
// 前端据此展示「未通知」横幅，引导店主补一次授权。
async function notifyOwner(items, orderId, orderer) {
  if (!SUBSCRIBE_TEMPLATE_ID || SUBSCRIBE_TEMPLATE_ID === TEMPLATE_PLACEHOLDER) return
  try {
    // 配了 OWNER_OPENID 就直接用，省掉每单一次的 users 查询
    let touser = OWNER_OPENID
    if (!touser) {
      const ownerRes = await db.collection('users').where({ role: 'owner' }).limit(1).get()
      if (ownerRes.data.length === 0) return
      touser = ownerRes.data[0].openid
    }

    const names = items.map(it => `${it.name}x${it.quantity}`).join('、')
    const detail = names.length > 20 ? names.slice(0, 20) + '…' : names
    // thing 类字段最长 20 字，昵称过长会被微信拒绝，这里做个保护
    const clippedOrderer = orderer && orderer.length > 20 ? orderer.slice(0, 20) + '…' : orderer

    await cloud.openapi.subscribeMessage.send({
      touser,
      templateId: SUBSCRIBE_TEMPLATE_ID,
      page: 'pages/admin/orders/orders',
      // 字段名需与你在公众平台申请的模板字段一一对应（不带 .DATA 后缀）
      data: {
        thing15: { value: detail },
        time9: { value: formatTime(new Date()) },
        thing14: { value: clippedOrderer }
      }
    })
    // 推送成功，标记订单已通知（失败也不抛，保持订单创建成功）
    await db.collection('orders').doc(orderId).update({
      data: { notified: true }
    }).catch(() => {})
  } catch (e) {
    console.error('通知店主失败：', e)
  }
}

/** 读取订单列表的分页参数 */
function readPageParams(event) {
  const page = Math.max(1, parseInt(event.page, 10) || 1)
  const pageSize = Math.min(
    ORDER_PAGE_MAX,
    Math.max(1, parseInt(event.pageSize, 10) || ORDER_PAGE_DEFAULT)
  )
  return { page, pageSize }
}

/**
 * 订单列表（order.listMine / order.listAll 共用）。
 *
 * 分页是必需的：原来两个 action 都硬编码 limit(100)，店主永远看不到第 100 单
 * 以前的历史。改成服务端分页后，**日期范围与状态筛选也必须一起挪到服务端** ——
 * 否则筛选只会作用在「已加载的那一页」上，得出的条数是错的。
 *
 * ⚠️ 建议在云开发控制台给 orders 建复合索引（不建也能跑，但会全表扫描）：
 *      openid  + createdAt(desc)   → order.listMine
 *      status  + createdAt(desc)   → order.listAll 带状态筛选
 *      createdAt(desc)             → order.listAll 不带筛选
 */
async function listOrders(baseWhere, event) {
  const { page, pageSize } = readPageParams(event)

  const where = Object.assign({}, baseWhere)
  if (event.status && ORDER_STATUS.includes(event.status)) where.status = event.status

  const hasStart = typeof event.startDate === 'string' && DATE_RE.test(event.startDate)
  const hasEnd = typeof event.endDate === 'string' && DATE_RE.test(event.endDate)
  if (hasStart && hasEnd) {
    where.createdAt = _.gte(dayStart(event.startDate)).and(_.lte(dayEnd(event.endDate)))
  } else if (hasStart) {
    where.createdAt = _.gte(dayStart(event.startDate))
  } else if (hasEnd) {
    where.createdAt = _.lte(dayEnd(event.endDate))
  }

  const totalRes = await db.collection('orders').where(where).count()
  const total = totalRes.total
  const res = await db.collection('orders')
    .where(where)
    .orderBy('createdAt', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get()

  // 订单里的 avatarUrl 是**顾客自己上传的头像**。按云存储「仅创建者可读写」的规则，
  // 非上传者（店主）读不了 —— 同样由服务端代换临时链接后挂在 avatarSrc 上。
  await attachImageSrc(res.data, 'avatarUrl', 'avatarSrc')

  return {
    list: res.data,
    total,
    page,
    pageSize,
    hasMore: page * pageSize < total
  }
}

/**
 * 取单个订单。
 *
 * ⚠️ `doc(id).get()` 在文档不存在时的行为**不稳定**（老版本抛异常、新版本回 data:null），
 * 所以统一 catch 成 null —— 调用方只判断 null，不用去猜是哪一种。
 */
async function getOrderById(id) {
  try {
    const res = await db.collection('orders').doc(id).get()
    return res && res.data ? res.data : null
  } catch (e) {
    return null
  }
}

/**
 * 订单菜品行的归一化 + 校验（order.create 与 order.update 共用）。
 *
 * 抽出来是为了让「改单」走和「下单」**完全同一套**规则 —— 否则店主改单会变成
 * 绕过上限校验的后门（比如把某道菜改成 9999 份，把 dishes.orderCount 刷爆）。
 *
 * 返回 { error } 表示校验未通过，{ items } 是归一化结果：
 * 同 dishId 已合并、名称一律取**服务端**菜名（客户端传的不可信）。
 */
async function normalizeOrderItems(rawItems) {
  const list = Array.isArray(rawItems) ? rawItems : []
  if (list.length === 0) return { error: '订单为空' }
  if (list.length > MAX_ORDER_ITEMS) {
    return { error: `一次最多点 ${MAX_ORDER_ITEMS} 道菜` }
  }

  // 逐项归一化。原来 quantity 完全不校验 —— 客户端可以传 999999 把
  // dishes.orderCount 刷爆，也可以提交超长数组让下面那个循环连打几千次库。
  const merged = new Map()
  for (const it of list) {
    const dishId = clip(it && it.dishId, MAX_ID_LEN)
    const name = clip(it && it.name, MAX_NAME_LEN)
    const quantity = Number(it && it.quantity)
    if (!dishId || !name) return { error: '订单数据不完整' }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_ITEM_QTY) {
      return { error: `每道菜数量需为 1~${MAX_ITEM_QTY} 的整数` }
    }
    // 同一道菜出现多次就合并，避免拆成多行绕过上面的数量上限
    const prev = merged.get(dishId)
    const total = (prev ? prev.quantity : 0) + quantity
    if (total > MAX_ITEM_QTY) {
      return { error: `每道菜最多 ${MAX_ITEM_QTY} 份` }
    }
    merged.set(dishId, { dishId, name, quantity: total })
  }
  const normItems = Array.from(merged.values())

  // 校验菜品是否还在库，并**用服务端的菜名覆盖客户端传来的名字**。
  // 原来这里只判断 dishId 非空：店主把菜删掉之后，顾客购物车里的旧数据
  // 仍然能下单成功（订单里留着一条永远点不到的菜），名字也可以随便伪造。
  const ids = normItems.map(it => it.dishId)
  const dishRes = await db.collection('dishes')
    .where({ _id: _.in(ids) })
    .limit(ids.length)
    .get()
  const dishMap = new Map(dishRes.data.map(d => [d._id, d]))
  // 顺手把「缺了哪几道」也带回去：顾客下单时用不上，但店主改单时
  // 光看到「请刷新菜单后重新下单」是不知道该怎么办的（见 order.update）
  const missing = normItems.filter(it => !dishMap.has(it.dishId)).map(it => it.name)
  if (missing.length > 0) {
    return { error: '订单里有菜品已被删除，请刷新菜单后重新下单', missing }
  }

  return {
    items: normItems.map(it => ({
      dishId: it.dishId,
      name: clip(dishMap.get(it.dishId).name, MAX_NAME_LEN) || it.name,
      quantity: it.quantity
    }))
  }
}

/**
 * 按订单改动调整菜品的「已点 N 次」计数。
 *
 * 传 (旧 items, 新 items)，只对**变化量**做增减：
 *  - 改单：同一道菜改份数只动差值，不会重复计数；只改备注时 delta 全为 0，直接返回；
 *  - 删单：新 items 传空数组，等于把这一单贡献的份数全额退回。
 *
 * 计数只能靠 `_.inc()` 原子自增，不能一律「读出来算好再写回」：
 * 下单那条路径用的就是 `_.inc`，如果这里用绝对值写回，两边同时发生就会互相盖掉。
 * 但 `_.inc` 又无法夹到 0，而历史订单本来就没累加过计数（老数据），
 * 直接 inc 负数会把计数打穿。所以分两路：
 *   结果 >= 0 → 走 `_.inc(delta)`，原子、不会覆盖并发写入；
 *   结果 < 0  → 才退回绝对值写回，把计数夹在 0（极少数情况，慢一点无所谓）。
 */
async function applyOrderCountDelta(oldItems, newItems) {
  const delta = new Map()
  const bump = (id, n) => {
    if (!id) return
    delta.set(id, (delta.get(id) || 0) + n)
  }
  ;(oldItems || []).forEach(it => bump(it.dishId, -(Number(it.quantity) || 0)))
  ;(newItems || []).forEach(it => bump(it.dishId, Number(it.quantity) || 0))

  const ids = [...delta.keys()].filter(id => delta.get(id) !== 0)
  if (ids.length === 0) return

  const res = await db.collection('dishes')
    .where({ _id: _.in(ids) })
    .limit(ids.length)
    .get()
  const dishMap = new Map(res.data.map(d => [d._id, d]))

  await Promise.all(ids.map(id => {
    const dish = dishMap.get(id)
    // 菜品已被删掉：没有计数可调，静默跳过（不能让删单因为一道菜没了就失败）
    if (!dish) return Promise.resolve()
    const d = delta.get(id)
    const cur = Number(dish.orderCount) || 0
    if (cur + d >= 0) {
      return db.collection('dishes').doc(id).update({ data: { orderCount: _.inc(d) } }).catch(() => {})
    }
    return db.collection('dishes').doc(id).update({ data: { orderCount: 0 } }).catch(() => {})
  }))
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const action = event.action

  const user = await getUser(OPENID)
  if (!user) return { code: 401, msg: '请先登录' }
  const isOwner = user.role === 'owner'

  try {
    switch (action) {
      // ==================== 用户 ====================
      case 'user.updateProfile': {
        const data = {}
        // 昵称/头像都由客户端传入，必须在服务端截断 —— 否则可以写入超长字符串，
        // 之后会跟着订单流进店主的订单列表与订阅消息字段（thing 类限 20 字）。
        if (event.nickname !== undefined) {
          data.nickname = clip(event.nickname, MAX_NAME_LEN)
        }
        // 头像只接受可跨设备访问的地址（云存储 fileID / https 外链）。
        // 非法协议**丢弃而不是报错**：老库里残留的 wxfile:// 头像不该把
        // 「顺手改个昵称」也一起挡掉（客户端每次保存是昵称+头像一起提交的）。
        if (event.avatarUrl !== undefined) {
          const avatar = normalizeImage(event.avatarUrl)
          if (avatar) data.avatarUrl = avatar
        }
        if (Object.keys(data).length === 0) return { code: 400, msg: '没有需要更新的内容' }
        await db.collection('users').doc(user._id).update({ data })
        const fresh = await getUser(OPENID)
        return { code: 0, data: fresh }
      }
      case 'user.footprint': {
        // 「点餐足迹」要的是「一共下了多少单、一共点了多少份菜」——
        // 必须扫全量。原来它是在前端拿 order.listMine 的返回数组自己求和的，
        // 那个接口现在分页了（且以前也硬编码 limit(100)），
        // 前端求和只能算到第一页，订单一多就静默偏小。
        const list = await fetchAll('orders', {
          where: { openid: OPENID },
          orderBy: { field: 'createdAt', order: 'desc' }
        })
        let dishes = 0
        list.forEach(o => {
          (o.items || []).forEach(it => { dishes += Number(it.quantity) || 0 })
        })
        return {
          code: 0,
          data: {
            count: list.length,
            dishes,
            lastAt: list.length > 0 ? list[0].createdAt : null
          }
        }
      }

      // ==================== 分类 ====================
      case 'category.list': {
        // 分页取全量：云函数端不写 limit 时最多只返回 100 条
        const list = await fetchAll('categories', { orderBy: { field: 'sort', order: 'asc' } })
        return { code: 0, data: list }
      }
      case 'category.add': {
        if (!isOwner) return { code: 403, msg: '无权限' }
        // 分类名同样收口：太长会把分类栏撑变形（原来这里完全没有截断）
        const name = clip(event.name, MAX_NAME_LEN)
        if (!name) return { code: 400, msg: '分类名不能为空' }
        const cnt = await db.collection('categories').count()
        const addRes = await db.collection('categories').add({
          data: { name, sort: cnt.total, createdAt: db.serverDate() }
        })
        return { code: 0, data: { _id: addRes._id } }
      }
      case 'category.update': {
        if (!isOwner) return { code: 403, msg: '无权限' }
        const name = clip(event.name, MAX_NAME_LEN)
        if (!name) return { code: 400, msg: '分类名不能为空' }
        await db.collection('categories').doc(event.id).update({ data: { name } })
        return { code: 0 }
      }
      case 'category.delete': {
        if (!isOwner) return { code: 403, msg: '无权限' }
        const dishCnt = await db.collection('dishes').where({ categoryId: event.id }).count()
        if (dishCnt.total > 0) return { code: 400, msg: '该分类下还有菜品，请先删除或移动菜品' }
        await db.collection('categories').doc(event.id).remove()
        return { code: 0 }
      }

      // ==================== 菜品 ====================
      case 'dish.list': {
        // 分页取全量：菜品超过 100 道时，原来那行会让点餐页**静默少掉最老的一批菜**
        const list = await fetchAll('dishes', { orderBy: { field: 'createdAt', order: 'desc' } })
        // 云存储是「仅创建者可读写」，fileID 只有上传者（店主）能直连读取。
        // 必须由服务端代换临时链接，否则顾客端的 <image> 一律 403 空白。
        await attachImageSrc(list)
        return { code: 0, data: list }
      }
      case 'dish.add': {
        if (!isOwner) return { code: 403, msg: '无权限' }
        const name = clip(event.name, MAX_NAME_LEN)
        const categoryId = clip(event.categoryId, MAX_ID_LEN)
        if (!name || !categoryId) return { code: 400, msg: '菜品名和分类必填' }
        if (!await categoryExists(categoryId)) {
          return { code: 400, msg: '所选分类不存在，请刷新后重试' }
        }
        const imageUrl = normalizeImage(event.imageUrl)
        if (imageUrl === null) return { code: 400, msg: '图片地址无效，请重新上传' }
        const addRes = await db.collection('dishes').add({
          data: {
            name,
            categoryId,
            imageUrl,
            rating: clampRating(event.rating),
            orderCount: 0,
            createdAt: db.serverDate()
          }
        })
        return { code: 0, data: { _id: addRes._id } }
      }
      case 'dish.update': {
        if (!isOwner) return { code: 403, msg: '无权限' }
        const id = clip(event.id, MAX_ID_LEN)
        if (!id) return { code: 400, msg: '缺少菜品 id' }
        const exists = await db.collection('dishes').where({ _id: id }).count()
        if (exists.total === 0) return { code: 404, msg: '菜品不存在' }

        const data = {}
        if (event.name !== undefined) {
          const name = clip(event.name, MAX_NAME_LEN)
          if (!name) return { code: 400, msg: '菜品名不能为空' }
          data.name = name
        }
        if (event.categoryId !== undefined) {
          const categoryId = clip(event.categoryId, MAX_ID_LEN)
          if (!categoryId) return { code: 400, msg: '分类不能为空' }
          if (!await categoryExists(categoryId)) {
            return { code: 400, msg: '所选分类不存在，请刷新后重试' }
          }
          data.categoryId = categoryId
        }
        if (event.imageUrl !== undefined) {
          const imageUrl = normalizeImage(event.imageUrl)
          if (imageUrl === null) return { code: 400, msg: '图片地址无效，请重新上传' }
          data.imageUrl = imageUrl
        }
        if (event.rating !== undefined) data.rating = clampRating(event.rating)
        if (Object.keys(data).length === 0) return { code: 400, msg: '没有需要更新的内容' }

        await db.collection('dishes').doc(id).update({ data })
        return { code: 0 }
      }
      case 'dish.delete': {
        if (!isOwner) return { code: 403, msg: '无权限' }
        await db.collection('dishes').doc(event.id).remove()
        return { code: 0 }
      }

      // ==================== 邀请 ====================
      case 'invite.create': {
        if (!isOwner) return { code: 403, msg: '无权限' }
        const code = await genUniqueCode()
        const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86400000)
        await db.collection('invitations').add({
          data: {
            code,
            createdBy: OPENID,
            used: false,
            usedBy: '',
            usedAt: null,
            expiresAt,
            createdAt: db.serverDate()
          }
        })
        return { code: 0, data: { code, expiresAt } }
      }
      case 'invite.list': {
        if (!isOwner) return { code: 403, msg: '无权限' }
        // 邀请码会一直累积，同样分页取全量
        // （原来固定 limit(100)，第 101 个码之后生成的邀请就再也看不见了）
        const list = await fetchAll('invitations', { orderBy: { field: 'createdAt', order: 'desc' } })
        return { code: 0, data: list }
      }
      case 'invite.accept': {
        const code = (event.code || '').trim().toUpperCase()
        if (!code) return { code: 400, msg: '请输入邀请码' }
        if (user.role !== 'guest') return { code: 400, msg: '你已是点餐成员，无需重复接受邀请' }

        // 先读一次：只用来判断「是否存在 / 是否过期 / 邀请人是谁」，**不承担并发保护**。
        // 修复前创建的老邀请码没有 expiresAt 字段 —— 视为不过期，否则存量码会集体失效。
        const inv = await db.collection('invitations').where({ code }).limit(1).get()
        if (inv.data.length === 0) return { code: 404, msg: '邀请码不存在' }
        const invDoc = inv.data[0]
        if (invDoc.expiresAt && new Date(invDoc.expiresAt).getTime() < Date.now()) {
          return { code: 400, msg: '邀请码已过期，请让店主重新生成' }
        }

        // 再用「条件更新」抢占邀请码 —— 把 used:false 写进 where 条件，
        // 两人同时提交同一邀请码时只有一个人能拿到 updated === 1。
        // 原来的「先查 used 再 update」两步之间不是原子的，会双双通过。
        const claim = await db.collection('invitations')
          .where({ code, used: false })
          .update({ data: { used: true, usedBy: OPENID, usedAt: db.serverDate() } })
        if (!claim.stats || claim.stats.updated !== 1) {
          return { code: 400, msg: '该邀请码已被使用' }
        }

        await db.collection('users').doc(user._id).update({
          data: { role: 'friend', invitedBy: invDoc.createdBy || '' }
        })
        return { code: 0, msg: '接受成功，开始点餐吧' }
      }

      // ==================== 订单 ====================
      case 'order.create': {
        if (user.role === 'guest') return { code: 403, msg: '请先接受邀请后再点餐' }

        const { remark } = event
        // 菜品行的归一化与校验走 normalizeOrderItems —— 与 order.update 共用同一套规则，
        // 免得「改单」变成绕过上限的后门。
        const norm = await normalizeOrderItems(event.items)
        if (norm.error) return { code: 400, msg: norm.error }
        const finalItems = norm.items

        const orderRes = await db.collection('orders').add({
          data: {
            openid: OPENID,
            nickname: user.nickname || '朋友',
            avatarUrl: user.avatarUrl || '',
            items: finalItems,
            remark: clip(remark, MAX_REMARK_LEN),
            status: 'pending',
            notified: false,  // 推送成功后会由 notifyOwner 置为 true
            createdAt: db.serverDate()
          }
        })
        // 累加每个菜品的点餐次数。原来是一条 for 循环里的串行 await ——
        // 点 10 道菜就要串行等 10 个来回，改成并发后总耗时约等于最慢的那一条。
        await Promise.all(finalItems.map(it =>
          db.collection('dishes').doc(it.dishId).update({
            data: { orderCount: _.inc(it.quantity) }
          }).catch(() => {})
        ))
        // 通知店主（推送成功会把订单 notified 置为 true）。
        // 这里是**刻意 await** 的：云函数 return 之后执行环境会被冻结，
        // 不 await 的「发了就不管」有较大概率随容器一起被掐掉 —— 那正是 P0 要修的病，
        // 不能为了省几百毫秒把它换成 `.catch(()=>{})` 的 fire-and-forget。
        await notifyOwner(finalItems, orderRes._id, user.nickname || '朋友')
        return { code: 0, data: { _id: orderRes._id } }
      }
      case 'order.listMine': {
        const data = await listOrders({ openid: OPENID }, event)
        return { code: 0, data }
      }
      case 'order.listAll': {
        if (!isOwner) return { code: 403, msg: '无权限' }
        const data = await listOrders({}, event)
        // 未推送条数单独统计（不受分页与筛选影响）：
        // 它是「该补一次订阅授权了」的信号，前端顶部提醒卡据此切警示态。
        const unnotified = await db.collection('orders').where({ notified: false }).count()
        data.unnotified = unnotified.total
        return { code: 0, data }
      }
      case 'order.updateStatus': {
        if (!isOwner) return { code: 403, msg: '无权限' }
        const id = clip(event.id, MAX_ID_LEN)
        if (!id) return { code: 400, msg: '缺少订单 id' }
        // 白名单校验，避免写入任意字符串把订单变成筛选项都匹配不到的状态
        if (!ORDER_STATUS.includes(event.status)) return { code: 400, msg: '非法的订单状态' }
        await db.collection('orders').doc(id).update({ data: { status: event.status } })
        return { code: 0 }
      }
      case 'order.update': {
        // 店主改单：整单菜品（加/减/改份数）+ 备注。改的是内容，不动状态。
        if (!isOwner) return { code: 403, msg: '无权限' }
        const id = clip(event.id, MAX_ID_LEN)
        if (!id) return { code: 400, msg: '缺少订单 id' }

        // 先读旧单：一是确认订单真的还在（删过的单不该还能改），
        // 二是拿到旧 items 才能算出菜品计数的差值。
        const old = await getOrderById(id)
        if (!old) return { code: 404, msg: '订单不存在或已被删除' }

        // 与 order.create 共用同一套归一化 + 上限校验，
        // 否则「店主改单」就是一个绕过 MAX_ITEM_QTY 的后门。
        const norm = await normalizeOrderItems(event.items)
        if (norm.error) {
          // 「菜已从菜单删除」在下单链路里的提示是写给顾客的（让他重下一单），
          // 改单链路里店主需要的是「把这行减掉」，所以这里换成可执行的措辞。
          if (norm.missing && norm.missing.length > 0) {
            return {
              code: 400,
              msg: `「${norm.missing.join('、')}」已从菜单删除，请先把它从这单里减掉`
            }
          }
          return { code: 400, msg: norm.error }
        }
        const items = norm.items
        // 备注允许清空（缺省 = 空串，与 order.create 一致）
        const remark = clip(event.remark, MAX_REMARK_LEN)

        await db.collection('orders').doc(id).update({
          data: { items, remark, editedAt: db.serverDate() }
        })
        // 订单写成功之后再调计数：万一这一步出错，至少订单内容是对的。
        // 反过来先调计数、订单再写失败的话，计数就白白跑偏了 —— 而订单才是主数据。
        await applyOrderCountDelta(old.items, items)
        return { code: 0, data: { items, remark } }
      }
      case 'order.delete': {
        // 店主删单：真删（remove），并把这一单贡献的份数从菜品计数里退回。
        if (!isOwner) return { code: 403, msg: '无权限' }
        const id = clip(event.id, MAX_ID_LEN)
        if (!id) return { code: 400, msg: '缺少订单 id' }

        const old = await getOrderById(id)
        if (!old) return { code: 404, msg: '订单不存在或已被删除' }

        await db.collection('orders').doc(id).remove()
        // 新 items 传空数组 = 把这一单的份数全额退回（计数夹在 0 以上，见该函数注释）
        await applyOrderCountDelta(old.items, [])
        return { code: 0 }
      }

      // ==================== 统计 ====================
      case 'stats.heatmap': {
        if (!isOwner) return { code: 403, msg: '无权限' }
        const days = Math.min(365, Math.max(30, event.days || 180))
        const since = new Date(Date.now() - days * 86400000)

        // 分页取全量：原来这里没写 .limit()，于是「180 天」实际只统计到最近 100 单 ——
        // 订单过百之后热力图会静默失真，不报错，只是历史格子慢慢变空。
        const orders = await fetchAll('orders', { where: { createdAt: _.gte(since) } })

        const counts = {}
        orders.forEach(o => {
          const key = dayKey(o.createdAt)
          counts[key] = (counts[key] || 0) + 1
        })
        return { code: 0, data: { counts } }
      }
      case 'stats.get': {
        if (!isOwner) return { code: 403, msg: '无权限' }
        // 同样分页取全量：菜品超过 100 道时，原来这里会让统计排行的总数偏小
        const dishes = await fetchAll('dishes', { orderBy: { field: 'orderCount', order: 'desc' } })
        const orderCnt = await db.collection('orders').count()
        const friendCnt = await db.collection('users').where({ role: 'friend' }).count()
        return {
          code: 0,
          data: {
            dishes,
            totalOrders: orderCnt.total,
            totalCount: dishes.reduce((s, d) => s + (d.orderCount || 0), 0),
            totalFriends: friendCnt.total
          }
        }
      }

      default:
        return { code: 404, msg: '未知操作' }
    }
  } catch (e) {
    console.error('api error:', e)
    return { code: 500, msg: e.message || '服务器错误' }
  }
}
