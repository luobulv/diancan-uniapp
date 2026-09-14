/// <reference types="@dcloudio/types" />

/**
 * 让 tsc 认识 .vue 单文件组件（main.ts 里 import App from './App.vue'）。
 * 只用于编辑器/类型检查，不参与构建产物。
 */
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}
