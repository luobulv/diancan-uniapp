import { SUBSCRIBE_TEMPLATE_ID } from '@/config'

interface SubscribeText {
  /** 用户点「允许」后的提示语 */
  acceptText?: string
  /** 用户点「拒绝」后的提示语 */
  rejectText?: string
}

const DEFAULT_TEXT: Required<SubscribeText> = {
  acceptText: '已补一次推送额度',
  rejectText: '你拒绝了订阅，订单仍无法推送到微信'
}

/**
 * 请求「新订单提醒」订阅授权。
 *
 * 故意保留原生 wx.requestSubscribeMessage 而不是换 uni 的封装：
 * uni 在某些版本上会加工返回值结构，导致 res[tmplId] === 'accept' 判断失效。
 * 用条件编译把原生调用隔离在 mp-weixin 分支里最稳。
 *
 * ⚠️ wx.requestSubscribeMessage 只能由用户点击触发，调用方不要把它放到
 * `await` 之后（会丢掉用户手势而报 can only be invoked by user TAP gesture）。
 */
export function requestOrderSubscribe(text: SubscribeText = {}): Promise<void> {
  const { acceptText, rejectText } = { ...DEFAULT_TEXT, ...text }
  return new Promise((resolve) => {
    // #ifdef MP-WEIXIN
    wx.requestSubscribeMessage({
      tmplIds: [SUBSCRIBE_TEMPLATE_ID],
      success: (res: Record<string, string>) => {
        const r = res[SUBSCRIBE_TEMPLATE_ID]
        if (r === 'accept') {
          uni.showToast({ title: acceptText, icon: 'success' })
        } else if (r === 'reject') {
          uni.showToast({ title: rejectText, icon: 'none' })
        }
        resolve()
      },
      fail: () => {
        uni.showToast({ title: '订阅失败', icon: 'none' })
        resolve()
      }
    })
    // #endif

    // #ifndef MP-WEIXIN
    resolve()
    // #endif
  })
}
