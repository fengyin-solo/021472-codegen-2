/**
 * 训练页面组件测试
 * 验证：页面渲染、新建计划、打卡提交流程、重复打卡提示、跨天重开状态刷新
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import Training from '../views/Training.vue'
import { trainingStore } from '../utils/trainingStore'
import { __setMockNetwork } from '../utils/api'

function offsetDate(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function tick(ms = 50) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function mountPage() {
  const wrapper = mount(Training, {
    global: {
      mocks: { $router: { push: vi.fn() } }
    }
  })
  await tick()
  await flushPromises()
  return wrapper
}

describe('Training 页面', () => {
  beforeEach(() => {
    trainingStore.__reset()
    __setMockNetwork({ delayMs: 0, failures: {} })
  })

  afterEach(() => {
    __setMockNetwork({ delayMs: null, failures: {} })
  })

  it('渲染计划卡片与统计，展示今日打卡入口', async () => {
    trainingStore.createPlan({
      title: '页面测试计划', goalType: 'times', goalTarget: 5,
      startDate: offsetDate(0), endDate: offsetDate(14),
      weeklyTimes: 3, weeklyMinutes: 90
    })
    const wrapper = await mountPage()

    expect(wrapper.text()).toContain('页面测试计划')
    expect(wrapper.text()).toContain('今日打卡')
    expect(wrapper.text()).toContain('进行中')
  })

  it('通过弹窗新建目标冲突的计划时显示错误提示且不新增', async () => {
    trainingStore.createPlan({
      title: '已有计划', goalType: 'times', goalTarget: 5,
      startDate: offsetDate(0), endDate: offsetDate(14),
      weeklyTimes: 3, weeklyMinutes: 90
    })
    const wrapper = await mountPage()
    const before = wrapper.findAll('.plan-card').length

    await wrapper.find('.btn-create').trigger('click')
    await tick()
    await flushPromises()
    wrapper.vm.planForm.title = '冲突计划'
    wrapper.vm.planForm.startDate = offsetDate(2)
    wrapper.vm.planForm.endDate = offsetDate(8)
    await wrapper.findComponent({ name: 'Modal' }).vm.$emit('confirm')
    await flushPromises()

    expect(wrapper.vm.showToast).toBe(true)
    expect(wrapper.vm.toastType).toBe('error')
    expect(wrapper.vm.toastMessage).toContain('冲突')
    expect(wrapper.findAll('.plan-card').length).toBe(before)
  })

  it('打卡成功后计划显示“今日已打卡”，再次重复打卡给出错误提示', async () => {
    const plan = trainingStore.createPlan({
      title: '打卡流程计划', goalType: 'times', goalTarget: 5,
      startDate: offsetDate(0), endDate: offsetDate(14),
      weeklyTimes: 3, weeklyMinutes: 90
    })
    const wrapper = await mountPage()

    // 打开打卡弹窗并提交
    await wrapper.find('.action-btn.primary').trigger('click')
    await tick()
    await flushPromises()
    wrapper.vm.checkinForm.duration = 45
    wrapper.vm.checkinForm.content = '瞄准练习'
    const modals = wrapper.findAllComponents({ name: 'Modal' })
    // 第二个 Modal 为打卡弹窗
    const checkinModal = modals[1]
    await checkinModal.vm.$emit('confirm')
    await tick()
    await flushPromises()

    expect(wrapper.vm.showCheckinModal).toBe(false)
    expect(wrapper.text()).toContain('今日已打卡')
    expect(trainingStore.getPlanById(plan.id).progress.checkinCount).toBe(1)

    // 存储层重复打卡仍被拒绝，记录只有一条
    expect(() => trainingStore.addCheckin({
      planId: plan.id, date: offsetDate(0), duration: 90, content: '开球练习'
    })).toThrow(/一天只能打卡一次/)
    expect(trainingStore.getPlanById(plan.id).progress.checkinCount).toBe(1)
  })

  it('未开始的计划不展示打卡按钮，跨天后状态变为进行中', async () => {
    trainingStore.createPlan({
      title: '未来计划', goalType: 'times', goalTarget: 3,
      startDate: offsetDate(1), endDate: offsetDate(10),
      weeklyTimes: 2, weeklyMinutes: 60
    })
    const wrapper = await mountPage()
    expect(wrapper.find('.plan-status').text()).toBe('未开始')
    expect(wrapper.find('.action-btn.primary').exists()).toBe(false)

    // 模拟跨天重新打开页面：系统时间推进到计划开始日
    vi.useFakeTimers()
    vi.setSystemTime(new Date(offsetDate(1) + 'T12:00:00'))
    wrapper.vm.handleDayBoundary()
    await vi.advanceTimersByTimeAsync(50)
    await flushPromises()
    vi.useRealTimers()

    expect(wrapper.find('.plan-status').text()).toBe('进行中')
    expect(wrapper.find('.action-btn.primary').exists()).toBe(true)
  })
})
