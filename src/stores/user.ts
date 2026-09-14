import { defineStore } from 'pinia'
import { callApi, callLogin } from '@/utils/cloud'
import type { Role, User } from '@/types/api'

const ROLE_TEXT: Record<Role, string> = {
  owner: '店主',
  friend: '点餐成员',
  guest: '访客（未接受邀请）'
}

/** 本地缓存的 key：冷启动首帧据此渲染，避免「先顾客后店主」的闪烁 */
const CACHE_KEY = 'hl_user'

function readCache(): User | null {
  try {
    const v = uni.getStorageSync(CACHE_KEY)
    return v && typeof v === 'object' && v.role ? (v as User) : null
  } catch {
    return null
  }
}

function writeCache(user: User | null) {
  try {
    if (user) uni.setStorageSync(CACHE_KEY, user)
    else uni.removeStorageSync(CACHE_KEY)
  } catch {
    /* 缓存失败不影响主流程 */
  }
}

/**
 * 用户身份 store —— 替代原项目 app.globalData.user
 *
 * ⚠️ 原 index / mine 页的 onShow 都会调 app.refreshUser() 强制刷新角色：
 * 那是「登录自愈 / 后台改角色」的依赖，迁移后必须继续调 login(true)，不要优化掉。
 *
 * ⚠️⚠️ 但 `login(true)` **绝对不能**在请求前先把 user 置空！
 * 原生项目里 refreshUser() 也置空了 globalData.user，可当时页面模板读的是
 * data.user（setData 后才变），所以只有首次加载才会闪。
 * 迁到 Pinia 后模板直接绑 store，置空会让 isOwner 立刻变 false，
 * 于是「进入点餐/订单/我的」每次都先渲染一遍顾客视图再跳回店主视图。
 * 正确做法：保留旧值直到新值到位（stale-while-revalidate），并用本地缓存兜住冷启动首帧。
 */
export const useUserStore = defineStore('user', {
  state: () => {
    const cached = readCache()
    return {
      user: cached as User | null,
      /** 已经拿到过一次确定的角色（来自缓存或云端）；模板据此再决定渲染店主/顾客分支 */
      roleReady: !!cached,
      /** 正在登录（用于首屏 loading） */
      loggingIn: false
    }
  },

  getters: {
    isOwner: (s) => s.user?.role === 'owner',
    isFriend: (s) => s.user?.role === 'friend',
    isGuest: (s) => s.user?.role === 'guest',
    roleText: (s): string => (s.user ? ROLE_TEXT[s.user.role] : '')
  },

  actions: {
    /** 登录并缓存用户；force = true 时强制从云端重新拉取（对应原 refreshUser） */
    async login(force = false): Promise<User> {
      if (this.user && !force) return this.user

      // ⚠️ 不要在这里 `this.user = null`！保留旧值直到请求返回，否则角色会闪一下。
      this.loggingIn = true
      try {
        const res = await callLogin<User>()
        if (res.code !== 0 || !res.data) throw new Error(res.msg || '登录失败')
        this.user = res.data
        this.roleReady = true
        writeCache(res.data)
        return res.data
      } catch (e) {
        // 失败时若已有缓存值就继续用旧的，不要把界面打回访客态
        if (!this.user && this.roleReady) this.roleReady = false
        throw e
      } finally {
        this.loggingIn = false
      }
    },

    /** 保存昵称 / 头像（原 app.updateProfile） */
    async updateProfile(profile: Partial<Pick<User, 'nickname' | 'avatarUrl'>>) {
      const res = await callApi<User>('user.updateProfile', profile)
      if (res.code === 0 && res.data) {
        this.user = res.data
        writeCache(res.data)
      }
      return res
    },

    /** 仅本地修改（编辑中未保存），对应原 setData({'user.xxx': v}) */
    patchLocal(patch: Partial<User>) {
      if (this.user) {
        Object.assign(this.user, patch)
        writeCache(this.user)
      }
    },

    /** 退出登录 / 切换身份时清空（清缓存，避免下次冷启动又用旧身份） */
    clear() {
      this.user = null
      this.roleReady = false
      writeCache(null)
    }
  }
})
