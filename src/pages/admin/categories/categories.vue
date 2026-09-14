<script setup lang="ts">
/**
 * 分类管理 —— 原 pages/admin/categories 迁移
 *
 * 与原实现的差异：
 *  - 分类列表改由 catalog store 提供（index 页共用同一份数据），
 *    保存/删除成功后调 catalog.load(true) 强制刷新，点餐页下次进入即可看到新分类。
 *  - 「N 个菜品」的计数不再需要单独拉一次 dish.list 再手工 map，
 *    直接用 store 里的 dishes 统计（数据本来就一起回来了）。
 */
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { callApi } from '@/utils/cloud'
import { useUserStore } from '@/stores/user'
import { useCatalogStore } from '@/stores/catalog'
import type { Category } from '@/types/api'

const userStore = useUserStore()
const catalog = useCatalogStore()

const showForm = ref(false)
const editingId = ref<string | null>(null)
const name = ref('')
const loading = ref(true)

let saving = false
let deleting = false

/** 分类 + 该分类下的菜品数（对应原 data.categories[].count） */
const categories = computed(() =>
  catalog.categories.map((c) => ({
    ...c,
    count: catalog.dishes.filter((d) => d.categoryId === c._id).length
  }))
)

onShow(() => {
  load()
})

async function load() {
  try {
    await userStore.login()
    await catalog.load(true)
  } catch (e) {
    console.error(e)
  }
  loading.value = false
}

function openAdd() {
  showForm.value = true
  editingId.value = null
  name.value = ''
}

function openEdit(c: Category) {
  showForm.value = true
  editingId.value = c._id
  name.value = c.name
}

function closeForm() {
  showForm.value = false
}

/** 遮罩用的空函数：配合 @tap.stop 吃掉冒泡 */
function noop() {}

function onNameInput(e: { detail: { value: string } }) {
  name.value = e.detail.value
}

async function save() {
  if (saving) return
  const n = name.value.trim()
  if (!n) {
    uni.showToast({ title: '请输入分类名', icon: 'none' })
    return
  }

  saving = true
  uni.showLoading({ title: '保存中...', mask: true })
  try {
    const res = editingId.value
      ? await callApi('category.update', { id: editingId.value, name: n })
      : await callApi('category.add', { name: n })
    uni.hideLoading()
    if (res.code === 0) {
      uni.showToast({ title: '已保存', icon: 'success' })
      showForm.value = false
      await refreshCatalog()
    } else {
      uni.showToast({ title: res.msg || '保存失败', icon: 'none' })
    }
  } catch (e) {
    uni.hideLoading()
    uni.showToast({ title: '保存失败', icon: 'none' })
  }
  saving = false
}

function remove(c: Category) {
  uni.showModal({
    title: '删除分类',
    content: `确定删除「${c.name}」吗？`,
    success: (r) => {
      if (r.confirm) doRemove(c._id)
    }
  })
}

async function doRemove(id: string) {
  if (deleting) return
  deleting = true
  uni.showLoading({ title: '删除中...', mask: true })
  try {
    const res = await callApi('category.delete', { id })
    uni.hideLoading()
    if (res.code === 0) {
      uni.showToast({ title: '已删除', icon: 'success' })
      await refreshCatalog()
    } else {
      uni.showToast({ title: res.msg || '删除失败', icon: 'none' })
    }
  } catch (e) {
    uni.hideLoading()
    uni.showToast({ title: '删除失败', icon: 'none' })
  }
  deleting = false
}

/** 目录数据被本页改过，强制重拉 + 清空缓存标记，保证别处拿到的是新数据 */
async function refreshCatalog() {
  catalog.invalidate()
  await catalog.load(true)
}
</script>

<template>
  <view class="page">
    <view v-for="c in categories" :key="c._id" class="cate-card">
      <view class="cate-info">
        <text class="cate-name">{{ c.name }}</text>
        <text class="cate-count">{{ c.count }} 个菜品</text>
      </view>
      <view class="cate-ops">
        <text class="op" hover-class="text-press" hover-stay-time="80" @tap="openEdit(c)">编辑</text>
        <text class="op danger" hover-class="text-press" hover-stay-time="80" @tap="remove(c)">删除</text>
      </view>
    </view>

    <view v-if="loading" class="loading-box">
      <view class="loading-icon"></view>
      <text>加载中...</text>
    </view>

    <view v-if="categories.length === 0 && !loading" class="empty">
      <text class="icon">🗂️</text>
      还没有分类
    </view>

    <view class="fab" hover-class="cta-press" hover-stay-time="80" @tap="openAdd">＋ 添加分类</view>

    <!-- 表单弹窗 -->
    <view v-if="showForm" class="mask" @tap="closeForm">
      <view class="form-panel" @tap.stop="noop">
        <view class="form-header">
          <text class="form-title">{{ editingId ? '编辑分类' : '添加分类' }}</text>
          <text class="form-close" @tap="closeForm">✕</text>
        </view>
        <view class="form-body">
          <input
            class="input"
            placeholder="分类名，如：热菜、凉菜、主食"
            :value="name"
            focus
            @input="onNameInput"
          />
        </view>
        <view class="form-footer">
          <view class="btn-cancel" hover-class="btn-press" hover-stay-time="80" @tap="closeForm">取消</view>
          <view class="btn-save" hover-class="cta-press" hover-stay-time="80" @tap="save">保存</view>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page {
  padding: 20rpx 20rpx 140rpx;
}
.cate-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--paper);
  border-radius: 20rpx;
  padding: 28rpx;
  margin-bottom: 20rpx;
  box-shadow: var(--shadow-sm);
}
.cate-info {
  display: flex;
  flex-direction: column;
}
.cate-name {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--ink);
}
.cate-count {
  font-size: 24rpx;
  color: var(--tan);
  margin-top: 6rpx;
}
.cate-ops {
  display: flex;
}
.op {
  font-size: 24rpx;
  color: var(--caramel);
  padding: 8rpx 22rpx;
  background: var(--yellow-soft);
  border-radius: 24rpx;
  margin-left: 14rpx;
}
.op.danger {
  color: #e64340;
  background: #fdecec;
}
.fab {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  bottom: 40rpx;
  background: linear-gradient(135deg, var(--yellow), var(--amber));
  color: var(--ink);
  padding: 22rpx 60rpx;
  border-radius: 48rpx;
  font-size: 30rpx;
  font-weight: 700;
  letter-spacing: 1rpx;
  box-shadow: var(--shadow-pop);
  z-index: 10;
}

.mask {
  position: fixed;
  inset: 0;
  background: rgba(74, 47, 24, 0.5);
  z-index: 30;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}
.form-panel {
  background: var(--paper);
  border-radius: 24rpx 24rpx 0 0;
  padding-bottom: env(safe-area-inset-bottom);
}
.form-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 30rpx;
  border-bottom: 2rpx dashed var(--line);
}
.form-title {
  font-size: 32rpx;
  font-weight: 700;
  color: var(--ink);
}
.form-close {
  font-size: 32rpx;
  color: var(--tan);
}
.form-body {
  padding: 30rpx;
}
.input {
  height: 84rpx;
  background: var(--yellow-soft);
  border-radius: 16rpx;
  padding: 0 24rpx;
  font-size: 28rpx;
  color: var(--ink);
}
.form-footer {
  display: flex;
  padding: 20rpx 30rpx;
  border-top: 2rpx dashed var(--line);
}
.btn-cancel {
  flex: 1;
  height: 84rpx;
  line-height: 84rpx;
  text-align: center;
  background: var(--cream-deep);
  color: var(--tan);
  border-radius: 16rpx;
  margin-right: 20rpx;
  font-size: 30rpx;
}
.btn-save {
  flex: 2;
  height: 84rpx;
  line-height: 84rpx;
  text-align: center;
  background: linear-gradient(135deg, var(--yellow), var(--amber));
  color: var(--ink);
  border-radius: 16rpx;
  font-size: 30rpx;
  font-weight: 700;
  letter-spacing: 1rpx;
  box-shadow: var(--shadow-pop);
}
</style>
