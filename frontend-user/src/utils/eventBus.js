/**
 * 轻量全局事件总线
 * 用于跨组件通信（例如任意页面请求打开全局登录弹窗）
 */
import { reactive } from 'vue'

const listeners = {}

export const eventBus = {
  on(event, handler) {
    if (!listeners[event]) listeners[event] = new Set()
    listeners[event].add(handler)
    return () => this.off(event, handler)
  },
  off(event, handler) {
    listeners[event]?.delete(handler)
  },
  emit(event, payload) {
    listeners[event]?.forEach((handler) => handler(payload))
  }
}

/** 全局通知计数（预留，供需要响应事件的响应式场景使用） */
export const busState = reactive({ last: '' })

export default eventBus
