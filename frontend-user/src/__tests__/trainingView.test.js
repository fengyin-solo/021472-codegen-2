/**
 * Training.vue 组件测试
 *
 * 覆盖页面交互：
 * - 未登录展示登录引导
 * - 已登录加载计划、打开打卡弹窗
 * - 重复打卡业务错误即时提示（不弹重试）
 * - 网络失败时展示重试弹窗，点击重试成功
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import Training from '../views/Training.vue'
import { api } from '../utils/api'
import { trainingStore, toDateKey } from '../utils/trainingStore'
import { authState } from '../utils/auth'

const NOW = new Date()
const dayOffset = (d) => toDateKey(new Date(NOW.getTime() + d * 86400000))

vi.spyOn(api, 'getTrainingStats').mockResolvedValue({
  success: true,
  data: { activeCount: 1, completedCount: 0, checkinCount: 0, longestStreak: 0 }
})
vi.spyOn(api, 'getCheckins').mockResolvedValue({ success: true, data: [] })

function seedPlan() {
  trainingStore.__resetForTests([], [])
  const plan = trainingStore.createPlan(
    {
      title: '组件测试计划',
      goalType: 'count',
      targetValue: 3,
      startDate: dayOffset(-1),
      endDate: dayOffset(5)
    },
    NOW
  )
  return plan
}

describe('Training.vue', () => {
  beforeEach(() => {
    authState.isLoggedIn = true
    authState.user = { id: 'U1', name: '张三' }
    vi.restoreAllMocks()
    // restoreAllMocks 会还原全部 spy，需重新挂统计/历史桩
    vi.spyOn(api, 'getTrainingStats').mockResolvedValue({
      success: true,
      data: { activeCount: 1, completedCount: 0, checkinCount: 0, longestStreak: 0 }
    })
    vi.spyOn(api, 'getCheckins').mockResolvedValue({ success: true, data: [] })
  })

  it('未登录时展示登录引导而非计划内容', () => {
    authState.isLoggedIn = false
    const wrapper = mount(Training, { global: { stubs: { teleport: true, transition: false } } })
    expect(wrapper.find('.login-gate').exists()).toBe(true)
    expect(wrapper.find('.plan-card').exists()).toBe(false)
  })

  it('已登录时加载并渲染计划，点击打卡打开弹窗', async () => {
    const plan = seedPlan()
    vi.spyOn(api, 'getTrainingPlans').mockResolvedValue({
      success: true,
      data: [trainingStore.getPlan(plan.id, NOW)]
    })

    const wrapper = mount(Training, { global: { stubs: { teleport: true, transition: false } } })
    await flushPromises()

    expect(wrapper.find('.plan-card').exists()).toBe(true)
    expect(wrapper.text()).toContain('组件测试计划')

    const checkinBtn = wrapper.findAll('button').find((b) => b.text().trim() === '打卡')
    expect(checkinBtn).toBeTruthy()
    await checkinBtn.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('记录训练打卡')
  })

  it('重复打卡返回业务错误时在弹窗内即时提示，不展示重试弹窗', async () => {
    const plan = seedPlan()
    // 预先打一条今天的卡
    trainingStore.checkin({ planId: plan.id, date: dayOffset(0), value: 1 }, NOW)

    vi.spyOn(api, 'getTrainingPlans').mockResolvedValue({
      success: true,
      data: [trainingStore.getPlan(plan.id, NOW)]
    })
    vi.spyOn(api, 'getCheckins').mockResolvedValue({
      success: true,
      data: trainingStore.getHistory(plan.id, NOW)
    })
    // 模拟服务端仍返回重复打卡（非可重试）
    vi.spyOn(api, 'createCheckin').mockResolvedValue({
      success: false,
      retryable: false,
      code: 'DUPLICATE_CHECKIN',
      error: '2026-01-01 的训练已打卡，一天只需记录一次，请勿重复打卡'
    })

    const wrapper = mount(Training, { global: { stubs: { teleport: true, transition: false } } })
    await flushPromises()

    // 已打卡按钮禁用；清空本地历史绕过客户端乐观拦截，验证服务端重复错误仍能正确呈现
    await wrapper.vm.openCheckinModal(trainingStore.getPlan(plan.id, NOW))
    wrapper.setData({ history: [] })
    await wrapper.vm.submitCheckin()
    await flushPromises()

    expect(wrapper.vm.checkinError).toContain('已打卡')
    expect(wrapper.vm.showRetryModal).toBe(false)
    expect(wrapper.vm.showCheckinModal).toBe(true)
  })

  it('网络失败时展示重试弹窗，重试成功后刷新并提示成功', async () => {
    const plan = seedPlan()
    vi.spyOn(api, 'getTrainingPlans').mockResolvedValue({
      success: true,
      data: [trainingStore.getPlan(plan.id, NOW)]
    })

    const createSpy = vi
      .spyOn(api, 'createCheckin')
      .mockResolvedValueOnce({
        success: false,
        retryable: true,
        error: '网络异常，请稍后重试'
      })
      .mockResolvedValueOnce({
        success: true,
        data: { plan: { ...trainingStore.getPlan(plan.id, NOW), status: 'ongoing', totalValue: 1, goalUnit: '次' }, record: {} }
      })

    const wrapper = mount(Training, { global: { stubs: { teleport: true, transition: false } } })
    await flushPromises()

    await wrapper.vm.openCheckinModal(trainingStore.getPlan(plan.id, NOW))
    await wrapper.vm.submitCheckin()
    await flushPromises()

    expect(wrapper.vm.showRetryModal).toBe(true)

    await wrapper.vm.retryLastAction()
    await flushPromises()

    expect(wrapper.vm.showRetryModal).toBe(false)
    expect(createSpy).toHaveBeenCalledTimes(2)
    expect(wrapper.vm.showSuccessModal).toBe(true)
  })
})
