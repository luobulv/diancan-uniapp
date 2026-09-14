const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 店主 openid 白名单（可选的加固开关）。
 *
 * 留空时行为与旧版完全一致：首位登录者会是店主，系统里没有店主时也会自动晋升。
 * 想彻底锁死店主身份，就在云函数配置里加环境变量 OWNER_OPENID=<你自己的 openid>：
 * 之后只有这个 openid 能成为店主，「店主记录被误删 → 下一个打开的访客被静默提拔为店主」
 * 这条路就被堵上了。
 *
 * ⚠️ 配置前务必确认 openid 填对了，否则会把自己也挡在门外（届时无人是店主，管理页进不去）。
 */
const OWNER_OPENID = process.env.OWNER_OPENID || ''

/** 是否允许该 openid 成为店主 */
function canBeOwner(openid) {
  if (!OWNER_OPENID) return true // 未加固：维持旧行为
  return openid === OWNER_OPENID
}

// 登录：获取 openid，首次登录者自动成为「店主」，并初始化一个默认分类
exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const users = db.collection('users')

  const res = await users.where({ openid: OPENID }).get()
  if (res.data.length > 0) {
    let user = res.data[0]
    // 自愈：若当前用户是「访客」，但系统里已无店主，则自动晋升为店主
    // （例如误删店主记录、或换账号后想重新成为店主时，登录即可自动恢复）
    // ⚠️ 这条自愈同时意味着「店主记录被误删 → 下一个打开小程序的访客会静默变成店主」。
    // 配上 OWNER_OPENID 后，只有白名单里的 openid 才走得通这条路。
    if (user.role === 'guest' && canBeOwner(OPENID)) {
      const ownerRes = await users.where({ role: 'owner' }).get()
      if (ownerRes.data.length === 0) {
        await users.doc(user._id).update({ data: { role: 'owner' } })
        console.warn(`[login] 系统内无店主，已将 openid=${OPENID} 自动晋升为 owner（自愈逻辑）`)
        user = Object.assign({}, user, { role: 'owner' })
      }
    }
    return { code: 0, data: user }
  }

  // 新用户：判断是否已有店主，没有则当前用户成为店主（同时受 OWNER_OPENID 约束）
  const ownerRes = await users.where({ role: 'owner' }).get()
  const role = ownerRes.data.length === 0 && canBeOwner(OPENID) ? 'owner' : 'guest'

  const newUser = {
    openid: OPENID,
    nickname: role === 'owner' ? '店主' : '朋友',
    avatarUrl: '',
    role,
    invitedBy: '',
    createdAt: db.serverDate()
  }
  const addRes = await users.add({ data: newUser })

  // 店主首次登录，自动创建一个默认分类
  if (role === 'owner') {
    await db.collection('categories').add({
      data: { name: '推荐菜', sort: 0, createdAt: db.serverDate() }
    }).catch(() => {})
  }

  return { code: 0, data: { _id: addRes._id, ...newUser } }
}
