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

// ==================== 服务端业务上限 ====================
// 下面这些量客户端全都可以伪造（云函数是唯一可信边界），所以必须在这里收口，
// 不能指望前端表单校验。
const MAX_ORDER_ITEMS = 50   // 单笔订单最多几个菜品行
const MAX_ITEM_QTY = 99      // 单个菜品最多几份
const MAX_NAME_LEN = 20      // 菜品名 / 昵称长度上限
const MAX_REMARK_LEN = 200   // 备注长度上限
const INVITE_TTL_DAYS = 7    // 邀请码有效期（天）

// 允许的订单状态。与 pages/admin/orders/orders.vue 的筛选项一致，
// 注意是英式拼写 cancelled（两个 l），别写成 canceled。
const ORDER_STATUS = ['pending', 'completed', 'cancelled']

async function getUser(openid) {
  const res = await db.collection('users').where({ openid }).get()
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

const pad = n => (n < 10 ? '0' + n : '' + n)

function formatTime(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
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

// 新订单通知店主。推送成功后会回写订单 notified: true，
// 前端据此展示「未通知」横幅，引导店主补一次授权。
async function notifyOwner(items, orderId, orderer) {
  if (!SUBSCRIBE_TEMPLATE_ID || SUBSCRIBE_TEMPLATE_ID === TEMPLATE_PLACEHOLDER) return
  try {
    const ownerRes = await db.collection('users').where({ role: 'owner' }).get()
    if (ownerRes.data.length === 0) return
    const owner = ownerRes.data[0]

    const names = items.map(it => `${it.name}x${it.quantity}`).join('、')
    const detail = names.length > 20 ? names.slice(0, 20) + '…' : names
    // thing 类字段最长 20 字，昵称过长会被微信拒绝，这里做个保护
    const clippedOrderer = orderer && orderer.length > 20 ? orderer.slice(0, 20) + '…' : orderer

    await cloud.openapi.subscribeMessage.send({
      touser: owner.openid,
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
          data.nickname = String(event.nickname).trim().slice(0, MAX_NAME_LEN)
        }
        // 头像只接受可跨设备访问的地址（云存储 fileID / https 外链）。
        // 非法协议**丢弃而不是报错**：老库里残留的 wxfile:// 头像不该把
        // 「顺手改个昵称」也一起挡掉（客户端每次保存是昵称+头像一起提交的）。
        if (event.avatarUrl !== undefined) {
          const avatar = String(event.avatarUrl).trim().slice(0, 512)
          if (isStorableImage(avatar)) data.avatarUrl = avatar
        }
        if (Object.keys(data).length === 0) return { code: 400, msg: '没有需要更新的内容' }
        await db.collection('users').doc(user._id).update({ data })
        const fresh = await getUser(OPENID)
        return { code: 0, data: fresh }
      }

      // ==================== 分类 ====================
      case 'category.list': {
        const res = await db.collection('categories').orderBy('sort', 'asc').get()
        return { code: 0, data: res.data }
      }
      case 'category.add': {
        if (!isOwner) return { code: 403, msg: '无权限' }
        const name = (event.name || '').trim()
        if (!name) return { code: 400, msg: '分类名不能为空' }
        const cnt = await db.collection('categories').count()
        const addRes = await db.collection('categories').add({
          data: { name, sort: cnt.total, createdAt: db.serverDate() }
        })
        return { code: 0, data: { _id: addRes._id } }
      }
      case 'category.update': {
        if (!isOwner) return { code: 403, msg: '无权限' }
        const name = (event.name || '').trim()
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
        const res = await db.collection('dishes').orderBy('createdAt', 'desc').get()
        return { code: 0, data: res.data }
      }
      case 'dish.add': {
        if (!isOwner) return { code: 403, msg: '无权限' }
        const { name, categoryId, imageUrl, rating } = event
        if (!name || !categoryId) return { code: 400, msg: '菜品名和分类必填' }
        const addRes = await db.collection('dishes').add({
          data: {
            name,
            categoryId,
            imageUrl: imageUrl || '',
            rating: clampRating(rating),
            orderCount: 0,
            createdAt: db.serverDate()
          }
        })
        return { code: 0, data: { _id: addRes._id } }
      }
      case 'dish.update': {
        if (!isOwner) return { code: 403, msg: '无权限' }
        const { id, name, categoryId, imageUrl, rating } = event
        const data = {}
        if (name !== undefined) data.name = name
        if (categoryId !== undefined) data.categoryId = categoryId
        if (imageUrl !== undefined) data.imageUrl = imageUrl
        if (rating !== undefined) data.rating = clampRating(rating)
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
        const res = await db.collection('invitations').orderBy('createdAt', 'desc').limit(100).get()
        return { code: 0, data: res.data }
      }
      case 'invite.accept': {
        const code = (event.code || '').trim().toUpperCase()
        if (!code) return { code: 400, msg: '请输入邀请码' }
        if (user.role !== 'guest') return { code: 400, msg: '你已是点餐成员，无需重复接受邀请' }

        // 先读一次：只用来判断「是否存在 / 是否过期 / 邀请人是谁」，**不承担并发保护**。
        // 修复前创建的老邀请码没有 expiresAt 字段 —— 视为不过期，否则存量码会集体失效。
        const inv = await db.collection('invitations').where({ code }).get()
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
        const rawItems = Array.isArray(event.items) ? event.items : []
        if (rawItems.length === 0) return { code: 400, msg: '订单为空' }
        if (rawItems.length > MAX_ORDER_ITEMS) {
          return { code: 400, msg: `一次最多点 ${MAX_ORDER_ITEMS} 道菜` }
        }

        // 逐项归一化。原来 quantity 完全不校验 —— 客户端可以传 999999 把
        // dishes.orderCount 刷爆，也可以提交超长数组让下面那个循环连打几千次库。
        const merged = new Map()
        for (const it of rawItems) {
          const dishId = String((it && it.dishId) || '').trim()
          const name = String((it && it.name) || '').trim().slice(0, MAX_NAME_LEN)
          const quantity = Number(it && it.quantity)
          if (!dishId || !name) return { code: 400, msg: '订单数据不完整' }
          if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_ITEM_QTY) {
            return { code: 400, msg: `每道菜数量需为 1~${MAX_ITEM_QTY} 的整数` }
          }
          // 同一道菜出现多次就合并，避免拆成多行绕过上面的数量上限
          const prev = merged.get(dishId)
          const total = (prev ? prev.quantity : 0) + quantity
          if (total > MAX_ITEM_QTY) {
            return { code: 400, msg: `每道菜最多 ${MAX_ITEM_QTY} 份` }
          }
          merged.set(dishId, { dishId, name, quantity: total })
        }
        const normItems = Array.from(merged.values())

        const orderRes = await db.collection('orders').add({
          data: {
            openid: OPENID,
            nickname: user.nickname || '朋友',
            avatarUrl: user.avatarUrl || '',
            items: normItems,
            remark: String(remark || '').slice(0, MAX_REMARK_LEN),
            status: 'pending',
            notified: false,  // 推送成功后会由 notifyOwner 置为 true
            createdAt: db.serverDate()
          }
        })
        // 累加每个菜品的点餐次数
        for (const it of normItems) {
          await db.collection('dishes').doc(it.dishId).update({
            data: { orderCount: _.inc(it.quantity) }
          }).catch(() => {})
        }
        // 通知店主（推送成功会把订单 notified 置为 true）。
        // 这里是**刻意 await** 的：云函数 return 之后执行环境会被冻结，
        // 不 await 的「发了就不管」有较大概率随容器一起被掐掉 —— 那正是 P0 要修的病，
        // 不能为了省几百毫秒把它换成 `.catch(()=>{})` 的 fire-and-forget。
        await notifyOwner(normItems, orderRes._id, user.nickname || '朋友')
        return { code: 0, data: { _id: orderRes._id } }
      }
      case 'order.listMine': {
        const res = await db.collection('orders')
          .where({ openid: OPENID })
          .orderBy('createdAt', 'desc')
          .limit(100)
          .get()
        return { code: 0, data: res.data }
      }
      case 'order.listAll': {
        if (!isOwner) return { code: 403, msg: '无权限' }
        const res = await db.collection('orders').orderBy('createdAt', 'desc').limit(100).get()
        return { code: 0, data: res.data }
      }
      case 'order.updateStatus': {
        if (!isOwner) return { code: 403, msg: '无权限' }
        // 白名单校验，避免写入任意字符串把订单变成筛选项都匹配不到的状态
        if (!ORDER_STATUS.includes(event.status)) return { code: 400, msg: '非法的订单状态' }
        await db.collection('orders').doc(event.id).update({ data: { status: event.status } })
        return { code: 0 }
      }

      // ==================== 统计 ====================
      case 'stats.heatmap': {
        if (!isOwner) return { code: 403, msg: '无权限' }
        const days = Math.min(365, Math.max(30, event.days || 180))
        const since = new Date(Date.now() - days * 86400000)

        // ⚠️ 必须分页。云函数端单次 get() 默认且最多返回 100 条（官方文档明示），
        // 原来这里没写 .limit()，于是「180 天」实际上只统计到了最近 100 单 ——
        // 订单过百之后热力图会静默失真，不报错，只是历史格子慢慢变空。
        const PAGE = 100
        const cond = { createdAt: _.gte(since) }
        const totalRes = await db.collection('orders').where(cond).count()
        const pages = Math.ceil(totalRes.total / PAGE)
        const tasks = []
        for (let i = 0; i < pages; i++) {
          // 每次都重新构造查询，不复用同一个 Query 对象
          tasks.push(
            db.collection('orders').where(cond).skip(i * PAGE).limit(PAGE).get()
          )
        }
        const results = await Promise.all(tasks)

        const counts = {}
        results.forEach(res => {
          res.data.forEach(o => {
            const d = o.createdAt instanceof Date ? o.createdAt : new Date(o.createdAt || Date.now())
            const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
            counts[key] = (counts[key] || 0) + 1
          })
        })
        return { code: 0, data: { counts } }
      }
      case 'stats.get': {
        if (!isOwner) return { code: 403, msg: '无权限' }
        const dishes = await db.collection('dishes').orderBy('orderCount', 'desc').get()
        const orderCnt = await db.collection('orders').count()
        const friendCnt = await db.collection('users').where({ role: 'friend' }).count()
        return {
          code: 0,
          data: {
            dishes: dishes.data,
            totalOrders: orderCnt.total,
            totalCount: dishes.data.reduce((s, d) => s + (d.orderCount || 0), 0),
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
