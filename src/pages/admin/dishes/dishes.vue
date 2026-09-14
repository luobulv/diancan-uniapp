<script setup lang="ts">
/**
 * 菜品管理（店主端）—— 原 pages/admin/dishes 迁移（最大的一页）
 *
 * 与原实现的差异：
 *  1. rating.wxs → src/utils/rating.ts。WXS 在小程序里是独立执行环境，
 *     模板内调用无成本；Vue 模板里调用函数则每次重渲染都会执行，
 *     所以改成 computed 预计算 stars 数组。
 *  2. categoryName 从「手工维护的 data 字段」（openAdd / openEdit / selectCategory
 *     三处都要同步更新）改为 computed，从 form.categoryId 直接推导。
 *  3. 分类与菜品改由 catalog store 提供，写操作后 load(true) 强制刷新，
 *     点餐页下次进入能看到最新菜单。
 *  4. 图片上传改用 utils/cloud.ts 的 uploadFile 封装（内部仍是 wx.cloud.uploadFile）。
 *
 * 保留的关键细节：键盘高度监听（onKeyboardHeightChange）上移表单 + 压缩滚动区高度，
 * 以及「scroll-view 不参与全局 border-box，内边距必须放在内层 .form-inner 上」的约定。
 */
import { computed, onUnmounted, reactive, ref } from 'vue'
import { onLoad, onShow, onUnload } from '@dcloudio/uni-app'
import { callApi, uploadFile } from '@/utils/cloud'
import { makeCloudImagePath } from '@/utils/image'
import { starList } from '@/utils/rating'
import { useUserStore } from '@/stores/user'
import { useCatalogStore } from '@/stores/catalog'
import type { Dish } from '@/types/api'

const userStore = useUserStore()
const catalog = useCatalogStore()

const loading = ref(true)
const showForm = ref(false)
const editingId = ref<string | null>(null)
const showCategorySheet = ref(false)
const showNamePopup = ref(false)
const renamingId = ref<string | null>(null)
const renamingName = ref('')

const keyboardHeight = ref(0)
const bodyMaxHeight = ref('60vh')

const form = reactive({
  name: '',
  categoryId: '',
  imageUrl: '',
  rating: 0
})

let saving = false
let deleting = false
let renaming = false
/** 窗口高度（px），用于算键盘弹起后表单还能占多高 */
let winH = 667

/* ==================== 派生数据 ==================== */

const viewDishes = computed(() =>
  catalog.dishes.map((d) => ({
    ...d,
    rating: d.rating || 0,
    categoryName: catalog.categories.find((c) => c._id === d.categoryId)?.name || '未分类',
    stars: starList(d.rating || 0)
  }))
)

/** 表单里展示的分类名：由 form.categoryId 推导，不再手工同步 */
const categoryName = computed(
  () => catalog.categories.find((c) => c._id === form.categoryId)?.name || ''
)

const formStars = computed(() => starList(form.rating))

/* ==================== 键盘高度 ==================== */

function handleKeyboard(res: { height?: number }) {
  const kb = res.height || 0
  keyboardHeight.value = kb
  if (kb > 0) {
    const h = winH - kb - 180
    bodyMaxHeight.value = Math.max(h, 200) + 'px'
  } else {
    bodyMaxHeight.value = '60vh'
  }
}

onLoad(() => {
  try {
    const info: any = uni.getWindowInfo ? uni.getWindowInfo() : uni.getSystemInfoSync()
    winH = info.windowHeight || 667
  } catch (e) {
    winH = 667
  }
  uni.onKeyboardHeightChange(handleKeyboard)
})

onUnload(() => {
  uni.offKeyboardHeightChange(handleKeyboard)
})

// 页面被 keep-alive 之类的场景兜底（小程序端 onUnload 已足够）
onUnmounted(() => {
  uni.offKeyboardHeightChange(handleKeyboard)
})

/* ==================== 加载 ==================== */

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

/** 本页改过菜品数据，强制重拉并清掉缓存标记 */
async function refreshCatalog() {
  catalog.invalidate()
  await catalog.load(true)
}

/* ==================== 表单 ==================== */

function openAdd() {
  const first = catalog.categories[0]
  showForm.value = true
  editingId.value = null
  form.name = ''
  form.categoryId = first ? first._id : ''
  form.imageUrl = ''
  form.rating = 0
}

function openEdit(d: Dish) {
  showForm.value = true
  editingId.value = d._id
  form.name = d.name
  form.categoryId = d.categoryId
  form.imageUrl = d.imageUrl || ''
  form.rating = d.rating || 0
}

function closeForm() {
  showForm.value = false
  showCategorySheet.value = false
}

/** 遮罩用的空函数：配合 @tap.stop 吃掉冒泡 */
function noop() {}

function onNameInput(e: { detail: { value: string } }) {
  form.name = e.detail.value
}

/* ==================== 分类选择 ==================== */

function openCategorySheet() {
  showCategorySheet.value = true
}

function closeCategorySheet() {
  showCategorySheet.value = false
}

function selectCategory(id: string) {
  form.categoryId = id
  showCategorySheet.value = false
}

/* ==================== 推荐指数 ==================== */

/** 点击左半星 / 右半星精确到 0.5 星，再点一次当前值清零 */
function setRating(v: number) {
  form.rating = form.rating === v ? 0 : v
}

/* ==================== 图片 ==================== */

function chooseImage() {
  uni.chooseMedia({
    count: 1,
    mediaType: ['image'],
    success: (res: any) => {
      const file = res?.tempFiles?.[0]
      if (file?.tempFilePath) uploadImage(file.tempFilePath)
    }
  })
}

async function uploadImage(filePath: string) {
  uni.showLoading({ title: '上传中...', mask: true })
  try {
    // 云存储路径由 utils/image.ts 生成：它按白名单取扩展名。
    // 原来写的是 `filePath.split('.').pop()` —— 真机 chooseMedia 回来的
    // `wxfile://tmp_xxx` 未必带扩展名，那样会把整条路径当成扩展名拼进云存储路径。
    const r = await uploadFile(makeCloudImagePath('dishes', filePath), filePath)
    form.imageUrl = r.fileID
  } catch (e) {
    uni.showToast({ title: '上传失败', icon: 'none' })
  }
  uni.hideLoading()
}

function removeImage() {
  form.imageUrl = ''
}

/* ==================== 快速改名称 ==================== */

function openNameEditor(d: Dish) {
  if (!d) return
  showNamePopup.value = true
  renamingId.value = d._id
  renamingName.value = d.name
}

function closeNamePopup() {
  showNamePopup.value = false
  renamingId.value = null
  renamingName.value = ''
}

function onRenamingNameInput(e: { detail: { value: string } }) {
  renamingName.value = e.detail.value
}

async function confirmRename() {
  const name = renamingName.value.trim()
  if (!name) {
    uni.showToast({ title: '请输入名称', icon: 'none' })
    return
  }
  if (renaming) return

  renaming = true
  uni.showLoading({ title: '保存中...', mask: true })
  try {
    const res = await callApi('dish.update', { id: renamingId.value, name })
    uni.hideLoading()
    if (res.code === 0) {
      uni.showToast({ title: '已保存', icon: 'success' })
      closeNamePopup()
      await refreshCatalog()
    } else {
      uni.showToast({ title: res.msg || '保存失败', icon: 'none' })
    }
  } catch (e) {
    uni.hideLoading()
    uni.showToast({ title: '保存失败', icon: 'none' })
  }
  renaming = false
}

/* ==================== 新增 / 编辑保存 ==================== */

async function save() {
  if (saving) return
  if (!form.name.trim()) {
    uni.showToast({ title: '请输入菜品名', icon: 'none' })
    return
  }
  if (!form.categoryId) {
    uni.showToast({ title: '请选择分类', icon: 'none' })
    return
  }

  const payload = {
    name: form.name.trim(),
    categoryId: form.categoryId,
    imageUrl: form.imageUrl,
    rating: form.rating
  }

  saving = true
  uni.showLoading({ title: '保存中...', mask: true })
  try {
    const res = editingId.value
      ? await callApi('dish.update', { id: editingId.value, ...payload })
      : await callApi('dish.add', payload)
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

/* ==================== 删除 ==================== */

function remove(d: Dish) {
  uni.showModal({
    title: '删除菜品',
    content: '确定删除该菜品吗？',
    success: (r) => {
      if (r.confirm) doRemove(d._id)
    }
  })
}

async function doRemove(id: string) {
  if (deleting) return
  deleting = true
  uni.showLoading({ title: '删除中...', mask: true })
  try {
    const res = await callApi('dish.delete', { id })
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
</script>

<template>
  <view class="page">
    <!-- 菜品列表 -->
    <view v-for="d in viewDishes" :key="d._id" class="dish-card">
      <image class="dish-img" :src="d.imageUrl || '/static/images/placeholder.png'" mode="aspectFill" />
      <view class="dish-info">
        <view class="dish-top">
          <text class="dish-name" @tap="openNameEditor(d)">{{ d.name }}</text>
          <text class="dish-name-edit" @tap="openNameEditor(d)">✎</text>
        </view>
        <view class="dish-meta-row">
          <text class="dish-meta">{{ d.categoryName }} · 已点 {{ d.orderCount }} 次</text>
          <view class="stars">
            <view v-for="s in d.stars" :key="s.star" class="star-wrap">
              <text class="star-base">★</text>
              <view class="star-fill" :style="{ width: s.fill }">
                <text class="star-on">★</text>
              </view>
            </view>
          </view>
        </view>
        <view class="dish-bottom">
          <view class="ops">
            <text class="op" hover-class="text-press" hover-stay-time="80" @tap="openEdit(d)">编辑</text>
            <text class="op danger" hover-class="text-press" hover-stay-time="80" @tap="remove(d)">删除</text>
          </view>
        </view>
      </view>
    </view>

    <view v-if="loading" class="loading-box">
      <view class="loading-icon"></view>
      <text>加载中...</text>
    </view>

    <view v-if="viewDishes.length === 0 && !loading" class="empty">
      <text class="icon">🍲</text>
      还没有菜品，点击下方按钮添加
    </view>

    <!-- 添加按钮 -->
    <view class="fab" hover-class="cta-press" hover-stay-time="80" @tap="openAdd">＋ 添加菜品</view>

    <!-- 表单弹窗 -->
    <view v-if="showForm" class="mask" :style="{ paddingBottom: keyboardHeight + 'px' }" @tap="closeForm">
      <view class="form-panel" @tap.stop="noop">
        <view class="form-header">
          <text class="form-title">{{ editingId ? '编辑菜品' : '添加菜品' }}</text>
          <text class="form-close" @tap="closeForm">✕</text>
        </view>

        <scroll-view scroll-y class="form-body" :style="{ maxHeight: bodyMaxHeight }">
          <!-- 内层容器负责内边距：scroll-view 不参与全局 border-box 规则，横向内边距会失效导致内容溢出 -->
          <view class="form-inner">
            <!-- 图片 -->
            <view class="field">
              <text class="label">图片</text>
              <view class="image-uploader">
                <template v-if="form.imageUrl">
                  <image class="upload-preview" :src="form.imageUrl" mode="aspectFill" />
                  <text class="remove-img" @tap="removeImage">✕</text>
                </template>
                <view v-else class="upload-btn" @tap="chooseImage">＋ 上传图片</view>
              </view>
            </view>

            <view class="field">
              <text class="label">菜品名</text>
              <input
                class="input"
                placeholder="如：红烧肉"
                :value="form.name"
                :adjust-position="false"
                :cursor-spacing="20"
                @input="onNameInput"
              />
            </view>

            <view class="field">
              <text class="label">分类</text>
              <view class="input select-value" @tap="openCategorySheet">
                <text :class="form.categoryId ? 'value-text' : 'placeholder-text'">{{ categoryName || '请选择分类' }}</text>
                <view class="chevron"></view>
              </view>
            </view>

            <view class="field">
              <text class="label">推荐指数</text>
              <view class="star-selector">
                <view v-for="s in formStars" :key="s.star" class="star-wrap big">
                  <text class="star-base">★</text>
                  <view class="star-fill" :style="{ width: s.fill }">
                    <text class="star-on">★</text>
                  </view>
                  <view class="tap-left" @tap="setRating(s.star - 0.5)"></view>
                  <view class="tap-right" @tap="setRating(s.star)"></view>
                </view>
                <text class="star-hint">{{ form.rating > 0 ? form.rating + ' 星' : '未评分' }} · 支持半星，再点一次清零</text>
              </view>
            </view>
          </view>
        </scroll-view>

        <view class="form-footer">
          <view class="btn-cancel" hover-class="btn-press" hover-stay-time="80" @tap="closeForm">取消</view>
          <view class="btn-save" hover-class="cta-press" hover-stay-time="80" @tap="save">保存</view>
        </view>
      </view>
    </view>

    <!-- 分类选择弹窗 -->
    <view v-if="showCategorySheet" class="mask sheet-mask" @tap="closeCategorySheet">
      <view class="sheet-panel" @tap.stop="noop">
        <view class="sheet-header">
          <text class="sheet-title">选择分类</text>
          <text class="sheet-close" @tap="closeCategorySheet">✕</text>
        </view>
        <scroll-view scroll-y class="sheet-body">
          <view
            v-for="c in catalog.categories"
            :key="c._id"
            class="sheet-item"
            :class="{ active: form.categoryId === c._id }"
            hover-class="chip-press"
            hover-stay-time="80"
            @tap="selectCategory(c._id)"
          >
            <text class="sheet-item-name">{{ c.name }}</text>
            <text v-if="form.categoryId === c._id" class="sheet-check">✓</text>
          </view>
          <view v-if="catalog.categories.length === 0" class="sheet-empty">
            暂无分类，请先到「分类管理」添加
          </view>
        </scroll-view>
      </view>
    </view>

    <!-- 快速改名称弹窗 -->
    <view v-if="showNamePopup" class="name-mask" @tap="closeNamePopup">
      <view class="name-dialog" @tap.stop="noop">
        <view class="name-title">修改名称</view>
        <input
          class="name-input"
          :value="renamingName"
          placeholder="请输入菜品名"
          :focus="showNamePopup"
          :adjust-position="false"
          :cursor-spacing="20"
          confirm-type="done"
          @input="onRenamingNameInput"
          @confirm="confirmRename"
        />
        <view class="name-actions">
          <view class="name-btn cancel" hover-class="btn-press" hover-stay-time="80" @tap="closeNamePopup">取消</view>
          <view class="name-btn ok" hover-class="cta-press" hover-stay-time="80" @tap="confirmRename">确认</view>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page {
  padding: 20rpx 20rpx 140rpx;
}

.dish-card {
  display: flex;
  background: var(--paper);
  border-radius: 20rpx;
  padding: 20rpx;
  margin-bottom: 20rpx;
  box-shadow: var(--shadow-sm);
}
.dish-img {
  width: 160rpx;
  height: 160rpx;
  border-radius: 16rpx;
  background: var(--yellow-mist);
  flex-shrink: 0;
}
.dish-info {
  flex: 1;
  margin-left: 20rpx;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  overflow: hidden;
}
.dish-top {
  display: flex;
  align-items: center;
}
.dish-name {
  font-size: 32rpx;
  font-weight: 700;
  color: var(--ink);
  flex: 1;
}
.dish-name-edit {
  font-size: 26rpx;
  color: var(--caramel);
  margin-left: 10rpx;
  padding: 4rpx 10rpx;
}
.dish-meta-row {
  display: flex;
  align-items: center;
  margin-top: 6rpx;
}
.dish-meta {
  font-size: 24rpx;
  color: var(--tan);
  margin-right: 16rpx;
}
.dish-bottom {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-top: 10rpx;
}

/* ---- 推荐指数（半星） ---- */
.stars {
  display: flex;
  align-items: center;
}
.star-wrap {
  position: relative;
  width: 30rpx;
  height: 30rpx;
  margin-right: 2rpx;
  flex-shrink: 0;
}
.star-wrap.big {
  width: 64rpx;
  height: 64rpx;
  margin-right: 8rpx;
}
.star-base,
.star-on {
  position: absolute;
  top: 0;
  left: 0;
  width: 30rpx;
  height: 30rpx;
  line-height: 30rpx;
  text-align: center;
  font-size: 30rpx;
  color: var(--line);
}
.star-wrap.big .star-base,
.star-wrap.big .star-on {
  width: 64rpx;
  height: 64rpx;
  line-height: 64rpx;
  font-size: 60rpx;
}
.star-on {
  color: var(--amber);
}
.star-fill {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  width: 0;
  overflow: hidden;
}
.tap-left,
.tap-right {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 50%;
  z-index: 3;
}
.tap-left { left: 0; }
.tap-right { right: 0; }

.star-selector {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
}
.star-hint {
  font-size: 22rpx;
  color: var(--tan);
  margin-left: 8rpx;
}

.ops {
  display: flex;
  align-items: center;
}
.op {
  font-size: 24rpx;
  color: var(--caramel);
  padding: 8rpx 20rpx;
  background: var(--yellow-soft);
  border-radius: 24rpx;
  margin-left: 14rpx;
}
.op.danger {
  color: #e64340;
  background: #fdecec;
}

/* 悬浮添加按钮 */
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

/* 表单弹窗 */
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
  display: flex;
  flex-direction: column;
  max-height: 85vh;
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
/* 注意：scroll-view 不在 app.wxss 的 border-box 名单里，横向 padding 会被内层滚动区吞掉，
   导致字段溢出到面板右侧 → 内边距必须放在内层 view 上 */
.form-body {
  padding: 0;
  box-sizing: border-box;
}
.form-inner {
  padding: 10rpx 30rpx;
}
.field {
  margin: 26rpx 0;
}
.field.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.label {
  display: block;
  font-size: 26rpx;
  color: var(--tan);
  margin-bottom: 14rpx;
}
.input {
  height: 84rpx;
  background: var(--yellow-soft);
  border-radius: 16rpx;
  padding: 0 24rpx;
  font-size: 28rpx;
  color: var(--ink);
}
.select-value {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.value-text {
  color: var(--ink);
  font-size: 28rpx;
}
.placeholder-text {
  color: var(--sand);
  font-size: 28rpx;
}
.chevron {
  width: 16rpx;
  height: 16rpx;
  border-right: 4rpx solid var(--sand);
  border-bottom: 4rpx solid var(--sand);
  transform: rotate(45deg);
  margin-left: 12rpx;
  flex-shrink: 0;
}
.image-uploader {
  position: relative;
}
.upload-btn {
  height: 160rpx;
  background: var(--yellow-soft);
  border: 2rpx dashed var(--line);
  border-radius: 16rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--tan);
  font-size: 28rpx;
}
.upload-preview {
  width: 200rpx;
  height: 200rpx;
  border-radius: 16rpx;
}
.remove-img {
  position: absolute;
  top: -12rpx;
  left: 186rpx;
  width: 40rpx;
  height: 40rpx;
  background: rgba(74, 47, 24, 0.65);
  color: #fff;
  border-radius: 50%;
  text-align: center;
  line-height: 40rpx;
  font-size: 24rpx;
}
.form-footer {
  display: flex;
  padding: 20rpx 30rpx calc(20rpx + env(safe-area-inset-bottom));
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

/* 分类选择弹窗 */
.sheet-mask {
  z-index: 40;
}
.sheet-panel {
  background: var(--paper);
  border-radius: 24rpx 24rpx 0 0;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  padding-bottom: env(safe-area-inset-bottom);
}
.sheet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 30rpx;
  border-bottom: 2rpx dashed var(--line);
}
.sheet-title {
  font-size: 32rpx;
  font-weight: 700;
  color: var(--ink);
}
.sheet-close {
  font-size: 32rpx;
  color: var(--tan);
}
.sheet-body {
  max-height: 56vh;
  padding: 8rpx 0;
}
.sheet-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 30rpx;
  font-size: 30rpx;
  color: var(--ink);
  border-bottom: 2rpx dashed var(--line);
}
.sheet-item:last-child {
  border-bottom: none;
}
.sheet-item.active {
  color: var(--caramel);
  font-weight: 700;
}
.sheet-check {
  color: var(--caramel);
  font-size: 34rpx;
  font-weight: 700;
}
.sheet-empty {
  padding: 60rpx 30rpx;
  text-align: center;
  color: var(--tan);
  font-size: 26rpx;
}

/* ========== 快速改名称弹窗（居中对话框） ========== */
.name-mask {
  position: fixed;
  inset: 0;
  background: rgba(74, 47, 24, 0.5);
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
}
.name-dialog {
  width: 620rpx;
  background: var(--paper);
  border-radius: 28rpx;
  padding: 36rpx 40rpx 32rpx;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-md);
}
.name-title {
  font-size: 32rpx;
  font-weight: 700;
  color: var(--ink);
  text-align: center;
  margin-bottom: 28rpx;
  letter-spacing: 1rpx;
}
.name-input {
  height: 84rpx;
  line-height: 84rpx;
  background: var(--yellow-soft);
  border-radius: 16rpx;
  padding: 0 24rpx;
  font-size: 30rpx;
  color: var(--ink);
  margin-bottom: 32rpx;
}
.name-actions {
  display: flex;
}
.name-btn {
  flex: 1;
  height: 80rpx;
  line-height: 80rpx;
  text-align: center;
  border-radius: 40rpx;
  font-size: 30rpx;
  font-weight: 700;
}
.name-btn.cancel {
  background: var(--cream-deep);
  color: var(--tan);
  margin-right: 20rpx;
}
.name-btn.ok {
  background: linear-gradient(135deg, var(--yellow), var(--amber));
  color: var(--ink);
  box-shadow: var(--shadow-pop);
}
</style>
