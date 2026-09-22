/**
 * 训练计划/打卡 API 与请求重试测试
 *
 * 覆盖：
 * - 训练计划与打卡接口的成功路径
 * - 重复打卡 / 未来日期 / 目标冲突为不可重试错误（立即返回，不消耗重试次数）
 * - 网络瞬时故障自动重试后成功
 * - 持续失败时重试次数耗尽并返回失败
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  api,
  __setRetryDelay,
  failNextMockRequests
} from '../utils/api'
import { trainingStore, toDateKey } from '../utils/trainingStore'

// API 处理层按真实当前日期派生状态，因此用例日期相对“今天”构造
const NOW = new Date()
const dayOffset = (days) => toDateKey(new Date(NOW.getTime() + days * 86400000))

function makePlan(overrides = {}) {
  return trainingStore.createPlan(
    {
      title: '接口测试计划',
      goalType: 'count',
      targetValue: 3,
      startDate: dayOffset(0),
      endDate: dayOffset(6),
      ...overrides
    },
    NOW
  )
}

describe('Training API', () => {
  beforeEach(() => {
    trainingStore.__resetForTests([], [])
    __setRetryDelay(0)
    failNextMockRequests(0)
  })

  it('getTrainingPlans 应返回计划列表', async () => {
    makePlan()
    const res = await api.getTrainingPlans()
    expect(res.success).toBe(true)
    expect(Array.isArray(res.data)).toBe(true)
    expect(res.data.length).toBe(1)
    expect(res.data[0].status).toBe('ongoing')
  })

  it('createTrainingPlan 应成功创建计划', async () => {
    const res = await api.createTrainingPlan({
      title: '通过API创建',
      goalType: 'duration',
      targetValue: 10,
      startDate: dayOffset(0),
      endDate: dayOffset(5)
    })
    expect(res.success).toBe(true)
    expect(res.data.goalType).toBe('duration')
  })

  it('createCheckin 应成功打卡并返回更新后的计划', async () => {
    const plan = makePlan({ targetValue: 4 })
    const res = await api.createCheckin({
      planId: plan.id,
      date: dayOffset(0),
      value: 2
    })
    expect(res.success).toBe(true)
    expect(res.data.plan.totalValue).toBe(2)
    expect(res.data.record.date).toBe(dayOffset(0))
  })

  it('getCheckins 应返回打卡历史', async () => {
    const plan = makePlan()
    await api.createCheckin({ planId: plan.id, date: dayOffset(0), value: 1 })
    const res = await api.getCheckins()
    expect(res.success).toBe(true)
    expect(res.data.length).toBe(1)
  })

  it('getTrainingStats 应返回统计对象', async () => {
    const res = await api.getTrainingStats()
    expect(res.success).toBe(true)
    expect(res.data).toHaveProperty('checkinCount')
  })

  it('重复打卡应返回不可重试的业务错误，且不触发重试', async () => {
    const plan = makePlan()
    const first = await api.createCheckin({ planId: plan.id, date: dayOffset(0), value: 1 })
    expect(first.success).toBe(true)

    // 统计处理函数实际执行次数：不可重试错误应只执行 1 次（无重试）
    const spy = vi.spyOn(trainingStore, 'checkin')
    const dup = await api.createCheckin({ planId: plan.id, date: dayOffset(0), value: 1 })
    expect(dup.success).toBe(false)
    expect(dup.retryable).toBe(false)
    expect(dup.code).toBe('DUPLICATE_CHECKIN')
    expect(dup.error).toContain('重复')
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('未来日期与目标冲突均为不可重试错误', async () => {
    const plan = makePlan({ endDate: dayOffset(10) })
    const future = await api.createCheckin({
      planId: plan.id,
      date: dayOffset(1),
      value: 1
    })
    expect(future.success).toBe(false)
    expect(future.retryable).toBe(false)
    expect(future.code).toBe('FUTURE_DATE')

    const conflict = await api.createTrainingPlan({
      title: '冲突计划',
      goalType: 'count',
      targetValue: 5,
      startDate: dayOffset(2),
      endDate: dayOffset(8)
    })
    expect(conflict.success).toBe(false)
    expect(conflict.retryable).toBe(false)
    expect(conflict.code).toBe('GOAL_CONFLICT')
  })

  it('前两次网络故障后第三次成功：自动重试应对瞬时失败', async () => {
    failNextMockRequests(2)
    const res = await api.getTrainingPlans()
    expect(res.success).toBe(true)
  })

  it('持续网络故障应在耗尽重试次数后返回可重试错误', async () => {
    failNextMockRequests(10)
    const res = await api.getTrainingPlans()
    expect(res.success).toBe(false)
    expect(res.retryable).toBe(true)
    expect(res.error).toContain('网络')
  }, 10000)

  it('打卡在首次网络失败重试成功后，只写入一条记录', async () => {
    const plan = makePlan()
    failNextMockRequests(1)
    const res = await api.createCheckin({ planId: plan.id, date: dayOffset(0), value: 1 })
    expect(res.success).toBe(true)
    expect(trainingStore.getHistory(plan.id)).toHaveLength(1)
  })
})
