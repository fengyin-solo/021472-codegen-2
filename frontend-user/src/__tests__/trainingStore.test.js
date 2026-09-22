/**
 * 训练计划与打卡存储单元测试
 *
 * 覆盖：
 * - 创建计划：参数校验、日期区间、目标冲突
 * - 打卡：重复打卡、未来日期、周期外、非法练习量
 * - 状态流转：未开始 / 进行中 / 已完成 / 已过期，跨天重新打开
 * - 数据安全：历史记录与既有数据不被覆盖、计划不可变更新
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  trainingStore,
  TrainingError,
  TrainingErrorCode,
  isRetryableCode,
  toDateKey
} from '../utils/trainingStore'

// 固定一个“今天”基准，所有用例相对它构造日期，保证测试不随运行日期变化
const NOW = new Date(2026, 8, 10, 12, 0, 0) // 2026-09-10 本地时间
const dayOffset = (days, base = NOW) => toDateKey(new Date(base.getTime() + days * 86400000))

function validPlan(overrides = {}) {
  return {
    title: '测试训练计划',
    goalType: 'count',
    targetValue: 3,
    startDate: dayOffset(0),
    endDate: dayOffset(6),
    ...overrides
  }
}

describe('Training Store', () => {
  beforeEach(() => {
    trainingStore.__resetForTests([], [])
  })

  // ---------- 创建计划 ----------

  describe('createPlan', () => {
    it('应成功创建一个进行周期内的计划，并派生为进行中', () => {
      const plan = trainingStore.createPlan(validPlan(), NOW)
      expect(plan.id).toBeTruthy()
      expect(plan.status).toBe('ongoing')
      expect(plan.progress).toBe(0)
      expect(plan.totalValue).toBe(0)
      expect(plan.canCheckin).toBe(true)
    })

    it('开始日期在未来时状态应为未开始', () => {
      const plan = trainingStore.createPlan(validPlan({ startDate: dayOffset(2), endDate: dayOffset(8) }), NOW)
      expect(plan.status).toBe('upcoming')
      expect(plan.canCheckin).toBe(false)
    })

    it('缺少名称时应抛出校验错误', () => {
      expect(() => trainingStore.createPlan(validPlan({ title: '' }), NOW)).toThrowError(
        /计划名称/
      )
    })

    it('目标量非正数时应抛出校验错误', () => {
      expect(() => trainingStore.createPlan(validPlan({ targetValue: 0 }), NOW)).toThrow()
      expect(() => trainingStore.createPlan(validPlan({ targetValue: -2 }), NOW)).toThrow()
      expect(() => trainingStore.createPlan(validPlan({ targetValue: NaN }), NOW)).toThrow()
    })

    it('结束日期早于开始日期时应抛出校验错误', () => {
      expect(() =>
        trainingStore.createPlan(validPlan({ startDate: dayOffset(5), endDate: dayOffset(1) }), NOW)
      ).toThrowError(/结束日期/)
    })

    it('相同目标类型且周期重叠应判定为目标冲突，且不写入计划', () => {
      trainingStore.createPlan(validPlan({ startDate: dayOffset(0), endDate: dayOffset(6) }), NOW)
      let conflictError
      try {
        trainingStore.createPlan(validPlan({ startDate: dayOffset(3), endDate: dayOffset(10) }), NOW)
      } catch (e) {
        conflictError = e
      }
      expect(conflictError).toBeInstanceOf(TrainingError)
      expect(conflictError.code).toBe(TrainingErrorCode.GOAL_CONFLICT)
      expect(trainingStore.getPlans(NOW)).toHaveLength(1) // 冲突计划未被写入
    })

    it('相邻但不重叠（首尾相接）的同类型周期不应判定为冲突', () => {
      trainingStore.createPlan(validPlan({ startDate: dayOffset(0), endDate: dayOffset(6) }), NOW)
      expect(() =>
        trainingStore.createPlan(validPlan({ startDate: dayOffset(7), endDate: dayOffset(13) }), NOW)
      ).not.toThrow()
      expect(trainingStore.getPlans(NOW)).toHaveLength(2)
    })

    it('不同目标类型即便周期重叠也不应判定为冲突', () => {
      trainingStore.createPlan(validPlan({ goalType: 'count' }), NOW)
      expect(() =>
        trainingStore.createPlan(validPlan({ goalType: 'duration', title: '时长计划' }), NOW)
      ).not.toThrow()
    })
  })

  // ---------- 打卡 ----------

  describe('checkin', () => {
    it('应成功追加一条打卡并更新进度，且同一天标记为已打卡', () => {
      const plan = trainingStore.createPlan(validPlan({ targetValue: 4 }), NOW)
      const result = trainingStore.checkin(
        { planId: plan.id, date: dayOffset(0), value: 2, note: '出杆练习' },
        NOW
      )
      expect(result.record.id).toBeTruthy()
      expect(result.plan.totalValue).toBe(2)
      expect(result.plan.progress).toBe(50)
      expect(result.plan.checkedInToday).toBe(true)

      const again = trainingStore.getPlan(plan.id, NOW)
      expect(again.checkedInToday).toBe(true)
      expect(again.canCheckin).toBe(true) // 目标未达成，仍可其它天打卡
    })

    it('同一计划同一天重复打卡应被拒绝（DUPLICATE_CHECKIN）', () => {
      const plan = trainingStore.createPlan(validPlan(), NOW)
      trainingStore.checkin({ planId: plan.id, date: dayOffset(0), value: 1 }, NOW)
      let error
      try {
        trainingStore.checkin({ planId: plan.id, date: dayOffset(0), value: 1 }, NOW)
      } catch (e) {
        error = e
      }
      expect(error.code).toBe(TrainingErrorCode.DUPLICATE_CHECKIN)
      // 重复打卡没有产生第二条记录
      expect(trainingStore.getHistory(plan.id, NOW)).toHaveLength(1)
    })

    it('未来日期打卡应被拒绝（FUTURE_DATE）', () => {
      const plan = trainingStore.createPlan(validPlan({ endDate: dayOffset(10) }), NOW)
      let error
      try {
        trainingStore.checkin({ planId: plan.id, date: dayOffset(1), value: 1 }, NOW)
      } catch (e) {
        error = e
      }
      expect(error.code).toBe(TrainingErrorCode.FUTURE_DATE)
      expect(trainingStore.getHistory(plan.id, NOW)).toHaveLength(0)
    })

    it('计划周期之外的日期打卡应被拒绝（PLAN_NOT_ACTIVE）', () => {
      const plan = trainingStore.createPlan(
        validPlan({ startDate: dayOffset(1), endDate: dayOffset(6) }),
        NOW
      )
      expect(() =>
        trainingStore.checkin({ planId: plan.id, date: dayOffset(0), value: 1 }, NOW)
      ).toThrowError(TrainingError)
    })

    it('练习量非正数或日期格式非法应抛出校验错误', () => {
      const plan = trainingStore.createPlan(validPlan(), NOW)
      expect(() =>
        trainingStore.checkin({ planId: plan.id, date: dayOffset(0), value: 0 }, NOW)
      ).toThrow()
      expect(() =>
        trainingStore.checkin({ planId: plan.id, date: 'not-a-date', value: 1 }, NOW)
      ).toThrow()
    })

    it('为不存在的计划打卡应抛出 PLAN_NOT_FOUND', () => {
      expect(() =>
        trainingStore.checkin({ planId: 'NOPE', date: dayOffset(0), value: 1 }, NOW)
      ).toThrowError(TrainingError)
    })

    it('补打过去日期的卡应允许，且不影响今日打卡', () => {
      const plan = trainingStore.createPlan(
        validPlan({ startDate: dayOffset(-3), endDate: dayOffset(3) }),
        NOW
      )
      trainingStore.checkin({ planId: plan.id, date: dayOffset(-2), value: 1 }, NOW)
      trainingStore.checkin({ planId: plan.id, date: dayOffset(-1), value: 1 }, NOW)
      const enriched = trainingStore.getPlan(plan.id, NOW)
      expect(enriched.doneDays).toBe(2)
      expect(enriched.streak).toBe(2)
      expect(enriched.checkedInToday).toBe(false)
      // 今天仍可打卡
      expect(() =>
        trainingStore.checkin({ planId: plan.id, date: dayOffset(0), value: 1 }, NOW)
      ).not.toThrow()
    })
  })

  // ---------- 状态流转 / 跨天重新打开 ----------

  describe('跨天状态流转', () => {
    it('达标后在周期内状态变为已完成，且不再允许打卡', () => {
      const plan = trainingStore.createPlan(
        validPlan({ targetValue: 2, startDate: dayOffset(-1), endDate: dayOffset(2) }),
        NOW
      )
      trainingStore.checkin({ planId: plan.id, date: dayOffset(-1), value: 1 }, NOW)
      trainingStore.checkin({ planId: plan.id, date: dayOffset(0), value: 1 }, NOW)
      const done = trainingStore.getPlan(plan.id, NOW)
      expect(done.status).toBe('completed')
      expect(done.progress).toBe(100)
      expect(done.canCheckin).toBe(false)
    })

    it('周期结束且达标应为已完成；结束未达标应为已过期', () => {
      const reached = trainingStore.createPlan(
        validPlan({ title: '达标', targetValue: 1, startDate: dayOffset(-5), endDate: dayOffset(-1) }),
        NOW
      )
      trainingStore.checkin({ planId: reached.id, date: dayOffset(-3), value: 1 }, NOW)
      expect(trainingStore.getPlan(reached.id, NOW).status).toBe('completed')

      const missed = trainingStore.createPlan(
        validPlan({ title: '未达标', goalType: 'duration', targetValue: 5, startDate: dayOffset(-5), endDate: dayOffset(-1) }),
        NOW
      )
      trainingStore.checkin({ planId: missed.id, date: dayOffset(-3), value: 1 }, NOW)
      expect(trainingStore.getPlan(missed.id, NOW).status).toBe('expired')
    })

    it('同一份数据在不同“今天”重新读取时状态应自动流转（未开始→进行中→已完成/已过期）', () => {
      const plan = trainingStore.createPlan(
        validPlan({ targetValue: 2, startDate: dayOffset(1), endDate: dayOffset(3) }),
        NOW
      )

      // 开始前一天：未开始
      expect(trainingStore.getPlan(plan.id, new Date(2026, 8, 9)).status).toBe('upcoming')
      // 开始当天：进行中
      expect(trainingStore.getPlan(plan.id, new Date(2026, 8, 11)).status).toBe('ongoing')

      // 在周期内打卡达标
      trainingStore.checkin({ planId: plan.id, date: dayOffset(1), value: 1 }, new Date(2026, 8, 11))
      trainingStore.checkin({ planId: plan.id, date: dayOffset(2), value: 1 }, new Date(2026, 8, 12))

      // 结束之后重新打开：因为达标，状态为已完成
      expect(trainingStore.getPlan(plan.id, new Date(2026, 8, 20)).status).toBe('completed')

      // 未达标计划结束后应为已过期
      const other = trainingStore.createPlan(
        validPlan({ title: '另一计划', goalType: 'duration', targetValue: 10, startDate: dayOffset(1), endDate: dayOffset(2) }),
        NOW
      )
      expect(trainingStore.getPlan(other.id, new Date(2026, 8, 20)).status).toBe('expired')
    })

    it('缺卡天数与剩余天数计算应正确', () => {
      const plan = trainingStore.createPlan(
        validPlan({ targetValue: 5, startDate: dayOffset(-2), endDate: dayOffset(2) }),
        NOW
      )
      // -2、-1 两天已过，只打了 -1
      trainingStore.checkin({ planId: plan.id, date: dayOffset(-1), value: 1 }, NOW)
      const info = trainingStore.getPlan(plan.id, NOW)
      expect(info.elapsedDays).toBe(3) // -2,-1,0
      expect(info.remainingDays).toBe(2) // 1,2
      expect(info.missedDays).toBe(2) // -2 和 今天 0 未打卡
    })
  })

  // ---------- 数据安全：历史不被覆盖 ----------

  describe('历史记录与既有数据保护', () => {
    it('多次打卡与查询后历史记录只追加、内容不变，顺序按日期倒序', () => {
      const plan = trainingStore.createPlan(
        validPlan({ startDate: dayOffset(-3), endDate: dayOffset(3) }),
        NOW
      )
      trainingStore.checkin({ planId: plan.id, date: dayOffset(-3), value: 1, note: '第一天' }, NOW)
      trainingStore.checkin({ planId: plan.id, date: dayOffset(-2), value: 2, note: '第二天' }, NOW)

      const history = trainingStore.getHistory(plan.id, NOW)
      expect(history.map((h) => h.date)).toEqual([dayOffset(-2), dayOffset(-3)])
      expect(history[1].note).toBe('第一天')
      expect(history[1].value).toBe(1)

      // 再打一条，前两条记录的 id 与内容必须保持不变
      const firstIds = history.map((h) => h.id)
      trainingStore.checkin({ planId: plan.id, date: dayOffset(0), value: 1 }, NOW)
      const after = trainingStore.getHistory(plan.id, NOW)
      const older = after.filter((h) => firstIds.includes(h.id))
      expect(older).toHaveLength(2)
      expect(older.find((h) => h.note === '第一天').value).toBe(1)
    })

    it('失败的重复/未来日期打卡不得写入或改动任何历史记录', () => {
      const plan = trainingStore.createPlan(validPlan(), NOW)
      trainingStore.checkin({ planId: plan.id, date: dayOffset(0), value: 1 }, NOW)
      const snapshot = JSON.stringify(trainingStore.getHistory(plan.id, NOW))

      expect(() =>
        trainingStore.checkin({ planId: plan.id, date: dayOffset(0), value: 5 }, NOW)
      ).toThrow()
      expect(() =>
        trainingStore.checkin({ planId: plan.id, date: dayOffset(2), value: 5 }, NOW)
      ).toThrow()

      expect(JSON.stringify(trainingStore.getHistory(plan.id, NOW))).toBe(snapshot)
    })

    it('重置/创建不应影响任务中心等其它存储键', () => {
      const unrelated = 'billiard_user_tasks'
      const marker = [{ id: 'KEEP', status: 'pending_payment' }]
      localStorage.setItem(unrelated, JSON.stringify(marker))

      const plan = trainingStore.createPlan(validPlan(), NOW)
      trainingStore.checkin({ planId: plan.id, date: dayOffset(0), value: 1 }, NOW)
      trainingStore.__resetForTests([], [])

      expect(JSON.parse(localStorage.getItem(unrelated))).toEqual(marker)
    })
  })

  // ---------- 历史与统计 ----------

  describe('getHistory / getStats', () => {
    it('删除计划后其历史记录仍保留（不覆盖、不级联删除）', () => {
      const plan = trainingStore.createPlan(validPlan({ startDate: dayOffset(-2), endDate: dayOffset(2) }), NOW)
      trainingStore.checkin({ planId: plan.id, date: dayOffset(-1), value: 1, note: '保留记录' }, NOW)

      // 模拟底层计划被移除（直接重置存储，仅保留打卡）
      const checkins = JSON.parse(localStorage.getItem('billiard_training_checkins'))
      trainingStore.__resetForTests([], checkins)

      const history = trainingStore.getHistory()
      expect(history).toHaveLength(1)
      expect(history[0].planTitle).toBe('已删除的计划')
      expect(history[0].note).toBe('保留记录')
    })

    it('统计应汇总进行中/已完成/打卡数与最长连续天数', () => {
      const a = trainingStore.createPlan(
        validPlan({ title: 'A', targetValue: 3, startDate: dayOffset(-2), endDate: dayOffset(2) }),
        NOW
      )
      trainingStore.checkin({ planId: a.id, date: dayOffset(-1), value: 1 }, NOW)
      trainingStore.checkin({ planId: a.id, date: dayOffset(0), value: 1 }, NOW)

      const b = trainingStore.createPlan(
        validPlan({ title: 'B', goalType: 'duration', targetValue: 1, startDate: dayOffset(-4), endDate: dayOffset(-1) }),
        NOW
      )
      trainingStore.checkin({ planId: b.id, date: dayOffset(-3), value: 1 }, NOW)

      const stats = trainingStore.getStats(NOW)
      expect(stats.activeCount).toBe(1)
      expect(stats.completedCount).toBe(1)
      expect(stats.checkinCount).toBe(3)
      expect(stats.longestStreak).toBeGreaterThanOrEqual(2)
    })
  })

  // ---------- 错误码可重试语义 ----------

  describe('isRetryableCode', () => {
    it('校验类错误码不可重试，未知/网络类错误可重试', () => {
      expect(isRetryableCode(TrainingErrorCode.DUPLICATE_CHECKIN)).toBe(false)
      expect(isRetryableCode(TrainingErrorCode.FUTURE_DATE)).toBe(false)
      expect(isRetryableCode(TrainingErrorCode.GOAL_CONFLICT)).toBe(false)
      expect(isRetryableCode(TrainingErrorCode.PLAN_NOT_FOUND)).toBe(false)
      expect(isRetryableCode(undefined)).toBe(true)
    })
  })
})
