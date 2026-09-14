import { defineStore } from 'pinia'
import type { Dish } from '@/types/api'

interface CartEntry {
  dish: Dish
  quantity: number
}

/**
 * 购物车 store —— 消掉原 index.js 的 computeCart / applyCart / 6 处 setData 样板
 *
 * 原项目购物车是页面级状态（onShow 重新 init 时不会保留），
 * 这里也刻意不做持久化，保持行为等价。
 */
export const useCartStore = defineStore('cart', {
  state: () => ({
    items: {} as Record<string, CartEntry>
  }),

  getters: {
    /** 对应原 data.cartCount */
    count: (s) => Object.values(s.items).reduce((n, i) => n + i.quantity, 0),

    /** 对应原 data.cartList（用于弹窗渲染） */
    list: (s) =>
      Object.keys(s.items).map((id) => ({
        dishId: id,
        ...s.items[id].dish,
        quantity: s.items[id].quantity
      })),

    /** 模板里直接 cartStore.quantityOf(dish._id)，替代原 cart[dish._id] 的存在性判断 */
    quantityOf: (s) => (id: string) => s.items[id]?.quantity ?? 0,

    isEmpty: (s) => Object.keys(s.items).length === 0
  },

  actions: {
    add(dish: Dish) {
      const entry = this.items[dish._id]
      if (entry) {
        entry.quantity++
      } else {
        this.items[dish._id] = { dish, quantity: 1 }
      }
    },

    decrease(id: string) {
      const entry = this.items[id]
      if (!entry) return
      if (entry.quantity <= 1) {
        delete this.items[id]
      } else {
        entry.quantity--
      }
    },

    clear() {
      this.items = {}
    }
  }
})
