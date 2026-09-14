import { defineStore } from 'pinia'
import { callApi } from '@/utils/cloud'
import type { Category, Dish, DishGroup } from '@/types/api'

/** 未分类分组的固定 id（与原 index.js 一致） */
export const UNCAT_ID = '__uncat__'

/**
 * 菜品目录 store —— 分类 + 菜品 + 分组
 *
 * 原 index.js 里 groupList 是 data 字段，每次 categories/dishes 变化都要手动
 * 跑一遍 init() 重建；这里改成 getter，由 Vue 响应式自动重算。
 *
 * ⚠️ 该 store 被 index 与 admin/dishes 共用。admin 侧写操作完成后
 * 必须调用 load(true) 刷新，否则点餐页会显示旧数据。
 */
export const useCatalogStore = defineStore('catalog', {
  state: () => ({
    categories: [] as Category[],
    dishes: [] as Dish[],
    loading: true,
    loaded: false
  }),

  getters: {
    /** 按分类分组的菜品（对应原 data.groupList） */
    groupList(state): DishGroup[] {
      const grouped: DishGroup[] = []

      if (state.categories.length > 0) {
        state.categories.forEach((c) => {
          const list = state.dishes.filter((d) => d.categoryId === c._id)
          if (list.length > 0) {
            grouped.push({ _id: c._id, name: c.name, dishes: list })
          }
        })
        const uncat = state.dishes.filter(
          (d) => !state.categories.some((c) => c._id === d.categoryId)
        )
        if (uncat.length > 0) {
          grouped.push({ _id: UNCAT_ID, name: '未分类', dishes: uncat })
        }
      } else {
        grouped.push({ _id: 'all', name: '全部', dishes: state.dishes })
      }

      return grouped
    },

    /** 是否存在「未分类」分组（原 WXML 里 groupList[length-1]._id === '__uncat__' 的判断） */
    hasUncatGroup(): boolean {
      return this.groupList.some((g) => g._id === UNCAT_ID)
    }
  },

  actions: {
    async load(force = false) {
      if (this.loaded && !force) return

      this.loading = true
      try {
        const [catRes, dishRes] = await Promise.all([
          callApi<Category[]>('category.list'),
          callApi<Dish[]>('dish.list')
        ])
        this.categories = catRes.data || []
        this.dishes = (dishRes.data || []).map((d) => ({ ...d, rating: d.rating || 0 }))
        this.loaded = true
      } finally {
        this.loading = false
      }
    },

    /** 清空缓存，下次进入强制重新拉取 */
    invalidate() {
      this.loaded = false
    }
  }
})
