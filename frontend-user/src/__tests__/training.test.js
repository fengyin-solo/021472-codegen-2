/**
 * 训练计划与打卡模块单元测试
 *
 * 覆盖场景：
 * - 计划 CRUD 与字段校验
 * - 目标冲突（同目标、周期重叠）
 * - 打卡：重复打卡拒绝、未来日期拒绝、计划周期外拒绝
 * - 进度与状态推导：未开始 -> 进行中 -> 已完成
 * - 跨天重新打开：状态随当天日期自动流转，历史数据不丢失/不被覆盖
 * - 既有任务数据（billiard_user_tasks）不受影响
 * - API 层失败重试与幂等：网络失败自动重试；响应丢失后重试不产生重复打卡
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  trainingStore,
  deriveStatus,
  getPlanProgress,
  formatDate,
  ErrorCode
} from '../utils/trainingStore'
import { api, withRetry, __setMockNetwork } from '../utils/api'

// ==================== 测试辅助 ====================

function offsetDate(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return formatDate(d)
}

const TASK_STORAGE_KEY = 'billiard_user_tasks'

function validPlanInput(overrides = {}) {
  return {
    title: '出杆训练计划',
    goalType: 'times',
    goalTarget: 4,
    startDate: offsetDate(0),
    endDate: offsetDate(14),
    weeklyTimes: 3,
    weeklyMinutes: 120,
    ...overrides
  }
}

function seedPlan(input = {}) {
  return trainingStore.createPlan(validPlanInput(input))
}

// ==================== 存储层测试 ====================

describe('trainingStore - 计划管理', () => {
  beforeEach(() => {
    trainingStore.__reset()
  })

  it('首次读取播种演示数据，之后不再重复播种', () => {
    localStorage.removeItem('billiard_user_training')
    const first = trainingStore.getAllPlans()
    expect(first.length).toBeGreaterThan(0)

    // 删除全部后重新读取，不应再次播种
    trainingStore.__getState().plans.forEach(p => trainingStore.removePlan(p.id))
    expect(trainingStore.getAllPlans().length).toBe(0)
  })

  it('可以创建计划并读取到派生信息', () => {
    trainingStore.__reset()
    const plan = seedPlan()
    expect(plan.id).toMatch(/^PLAN-/)
    expect(plan.status).toBe('ongoing')
    expect(plan.statusText).toBe('进行中')
    expect(plan.progress.percent).toBe(0)
    expect(plan.canCheckin).toBe(true)
  })

  it('开始日期在未来的计划状态为未开始', () => {
    trainingStore.__reset()
    const plan = seedPlan({ startDate: offsetDate(3), endDate: offsetDate(10) })
    expect(plan.status).toBe('upcoming')
    expect(plan.canCheckin).toBe(false)
  })

  it('校验非法字段：名称/目标值/日期/周期', () => {
    trainingStore.__reset()
    expect(() => seedPlan({ title: '' })).toThrow(/计划名称/)
    expect(() => seedPlan({ goalTarget: 0 })).toThrow(/目标值/)
    expect(() => seedPlan({ startDate: '2026-13-40' })).toThrow(/日期/)
    expect(() => seedPlan({ startDate: offsetDate(5), endDate: offsetDate(1) })).toThrow(/结束日期/)
    expect(() => seedPlan({ weeklyTimes: 0 })).toThrow(/每周训练次数/)
  })

  it('目标冲突：同目标类型且周期重叠的计划不能创建', () => {
    trainingStore.__reset()
    seedPlan({ title: '计划A', startDate: offsetDate(0), endDate: offsetDate(10) })
    let error
    try {
      seedPlan({ title: '计划B', startDate: offsetDate(5), endDate: offsetDate(15) })
    } catch (e) {
      error = e
    }
    expect(error.code).toBe(ErrorCode.GOAL_CONFLICT)
    expect(error.message).toContain('计划A')
    // 冲突的计划没有被写入
    expect(trainingStore.getAllPlans().map(p => p.title)).toEqual(['计划A'])
  })

  it('不同目标类型或周期不重叠的计划可以创建', () => {
    trainingStore.__reset()
    seedPlan({ title: '计划A', goalType: 'times', startDate: offsetDate(0), endDate: offsetDate(10) })
    // 不同目标类型
    expect(() => seedPlan({
      title: '计划B', goalType: 'minutes',
      startDate: offsetDate(0), endDate: offsetDate(10)
    })).not.toThrow()
    // 同类型但周期不重叠
    expect(() => seedPlan({
      title: '计划C', goalType: 'times',
      startDate: offsetDate(11), endDate: offsetDate(20)
    })).not.toThrow()
  })

  it('编辑计划时排除自身再做冲突检测', () => {
    trainingStore.__reset()
    const plan = seedPlan({ title: '计划A' })
    expect(() => trainingStore.updatePlan(plan.id, validPlanInput({ title: '计划A改' }))).not.toThrow()
    expect(trainingStore.getPlanById(plan.id).title).toBe('计划A改')
  })

  it('已达目标（已完成）的计划不再阻止新建周期重叠的计划', () => {
    trainingStore.__reset()
    const done = seedPlan({
      title: '已完成计划', goalType: 'times', goalTarget: 2,
      startDate: offsetDate(-10), endDate: offsetDate(20)
    })
    trainingStore.addCheckin({ planId: done.id, date: offsetDate(-9), duration: 30, content: '瞄准练习' })
    trainingStore.addCheckin({ planId: done.id, date: offsetDate(-8), duration: 30, content: '开球练习' })
    expect(trainingStore.getPlanById(done.id).status).toBe('completed')
    expect(() => seedPlan({
      title: '新一轮计划',
      startDate: offsetDate(0), endDate: offsetDate(10)
    })).not.toThrow()
  })

  it('周期已结束的计划不阻止新建重叠周期的计划', () => {
    trainingStore.__reset()
    seedPlan({
      title: '过期计划', goalType: 'times', goalTarget: 100,
      startDate: offsetDate(-30), endDate: offsetDate(-20)
    })
    expect(() => seedPlan({
      title: '新周期计划',
      startDate: offsetDate(0), endDate: offsetDate(10)
    })).not.toThrow()
  })

  it('删除计划只影响该计划及其打卡，其他计划数据保留', () => {
    trainingStore.__reset()
    const a = seedPlan({ title: '计划A' })
    const b = seedPlan({ title: '计划B', goalType: 'minutes' })
    trainingStore.addCheckin({ planId: a.id, date: offsetDate(0), duration: 30, content: '瞄准练习' })
    trainingStore.addCheckin({ planId: b.id, date: offsetDate(0), duration: 40, content: '开球练习' })

    expect(trainingStore.removePlan(a.id)).toBe(true)
    const state = trainingStore.__getState()
    expect(state.plans.map(p => p.id)).toEqual([b.id])
    expect(state.checkins.map(c => c.planId)).toEqual([b.id])
  })
})

// ==================== 打卡校验测试 ====================

describe('trainingStore - 打卡校验', () => {
  let plan

  beforeEach(() => {
    trainingStore.__reset()
    plan = seedPlan({ startDate: offsetDate(-2), endDate: offsetDate(10) })
  })

  it('正常打卡成功并更新进度', () => {
    const checkin = trainingStore.addCheckin({
      planId: plan.id, date: offsetDate(0), duration: 60, content: '瞄准练习', note: '状态不错'
    })
    expect(checkin.id).toMatch(/^CHK-/)
    const refreshed = trainingStore.getPlanById(plan.id)
    expect(refreshed.progress.checkinCount).toBe(1)
    expect(refreshed.progress.totalMinutes).toBe(60)
    expect(refreshed.checkedToday).toBe(true)
    expect(refreshed.canCheckin).toBe(false)
  })

  it('重复打卡（同计划同日期）被拒绝且不写入第二条', () => {
    trainingStore.addCheckin({ planId: plan.id, date: offsetDate(0), duration: 60, content: '瞄准练习' })
    const beforeCount = trainingStore.__getState().checkins.length

    let error
    try {
      trainingStore.addCheckin({ planId: plan.id, date: offsetDate(0), duration: 90, content: '开球练习' })
    } catch (e) {
      error = e
    }
    expect(error.code).toBe(ErrorCode.DUPLICATE_CHECKIN)
    expect(error.message).toContain('一天只能打卡一次')
    expect(trainingStore.__getState().checkins.length).toBe(beforeCount)

    // 原有打卡内容保持不变，没有被第二次提交覆盖
    const kept = trainingStore.__getState().checkins[0]
    expect(kept.duration).toBe(60)
    expect(kept.content).toBe('瞄准练习')
  })

  it('未来日期打卡被拒绝', () => {
    let error
    try {
      trainingStore.addCheckin({ planId: plan.id, date: offsetDate(1), duration: 60, content: '瞄准练习' })
    } catch (e) {
      error = e
    }
    expect(error.code).toBe(ErrorCode.FUTURE_DATE)
    expect(trainingStore.__getState().checkins.length).toBe(0)
  })

  it('计划周期之外的日期打卡被拒绝', () => {
    expect(() => trainingStore.addCheckin({
      planId: plan.id, date: offsetDate(-5), duration: 60, content: '瞄准练习'
    })).toThrow(/计划周期/)
    expect(() => trainingStore.addCheckin({
      planId: plan.id, date: offsetDate(11), duration: 60, content: '瞄准练习'
    })).toThrow()
  })

  it('不存在的计划/非法时长/缺少内容被拒绝', () => {
    expect(() => trainingStore.addCheckin({
      planId: 'NOPE', date: offsetDate(0), duration: 60, content: 'x'
    })).toThrow()
    expect(() => trainingStore.addCheckin({
      planId: plan.id, date: offsetDate(0), duration: 0, content: 'x'
    })).toThrow(/时长/)
    expect(() => trainingStore.addCheckin({
      planId: plan.id, date: offsetDate(0), duration: 60, content: ''
    })).toThrow(/训练内容/)
  })

  it('使用相同 clientRequestId 的重复写入仍只有一条记录（幂等键）', () => {
    trainingStore.addCheckin(
      { planId: plan.id, date: offsetDate(-1), duration: 30, content: '站姿与握杆' },
      { clientRequestId: 'REQ-1' }
    )
    // 直接再次以同请求 ID 提交同一天 -> 按重复打卡拒绝
    expect(() => trainingStore.addCheckin(
      { planId: plan.id, date: offsetDate(-1), duration: 30, content: '站姿与握杆' },
      { clientRequestId: 'REQ-1' }
    )).toThrow()
    expect(trainingStore.__getState().checkins.filter(c => c.date === offsetDate(-1)).length).toBe(1)
  })

  it('撤销打卡后可重新打卡，历史其他日期记录保留', () => {
    trainingStore.addCheckin({ planId: plan.id, date: offsetDate(-1), duration: 30, content: '站姿与握杆' })
    trainingStore.addCheckin({ planId: plan.id, date: offsetDate(0), duration: 45, content: '瞄准练习' })
    expect(trainingStore.undoCheckin(plan.id, offsetDate(0))).toBe(true)
    expect(trainingStore.getPlanById(plan.id).progress.checkinCount).toBe(1)
    expect(() => trainingStore.addCheckin({
      planId: plan.id, date: offsetDate(0), duration: 50, content: '清台训练'
    })).not.toThrow()
  })
})

// ==================== 状态流转与跨天测试 ====================

describe('训练状态推导与跨天流转', () => {
  beforeEach(() => {
    trainingStore.__reset()
  })

  it('状态随"当天日期"自动流转：未开始 -> 进行中 -> 已完成（周期结束）', () => {
    const plan = {
      id: 'P1', goalType: 'times', goalTarget: 10,
      startDate: '2026-03-01', endDate: '2026-03-14'
    }
    expect(deriveStatus(plan, [], '2026-02-28')).toBe('upcoming')
    expect(deriveStatus(plan, [], '2026-03-01')).toBe('ongoing')
    expect(deriveStatus(plan, [], '2026-03-14')).toBe('ongoing')
    expect(deriveStatus(plan, [], '2026-03-15')).toBe('completed')
  })

  it('达成目标立即完成，即使仍在周期内；跨天后保持完成态', () => {
    const plan = {
      id: 'P1', goalType: 'times', goalTarget: 2,
      startDate: '2026-03-01', endDate: '2026-03-14'
    }
    const checkins = [
      { planId: 'P1', date: '2026-03-02', duration: 30, content: 'a' },
      { planId: 'P1', date: '2026-03-03', duration: 30, content: 'b' }
    ]
    expect(deriveStatus(plan, checkins, '2026-03-03')).toBe('completed')
    expect(deriveStatus(plan, checkins, '2026-03-20')).toBe('completed')
  })

  it('minutes 目标按时长合计、skill 目标按训练内容去重', () => {
    const minutesPlan = { id: 'M', goalType: 'minutes', goalTarget: 100 }
    const progress = getPlanProgress(minutesPlan, [
      { planId: 'M', duration: 40, content: 'a', date: '2026-03-01' },
      { planId: 'M', duration: 45, content: 'b', date: '2026-03-02' },
      { planId: 'OTHER', duration: 999, content: 'x', date: '2026-03-02' }
    ])
    expect(progress.current).toBe(85)

    const skillPlan = { id: 'S', goalType: 'skill', goalTarget: 3 }
    const skillProgress = getPlanProgress(skillPlan, [
      { planId: 'S', content: '瞄准练习', date: '2026-03-01' },
      { planId: 'S', content: '瞄准练习', date: '2026-03-02' },
      { planId: 'S', content: '开球练习', date: '2026-03-03' }
    ])
    expect(skillProgress.current).toBe(2)
  })

  it('模拟跨天重新打开：存储数据不变，getAllPlans 推导的状态随当天变化', () => {
    // 构造一个"昨天视角下明天开始"的计划
    trainingStore.__setState({
      plans: [{
        id: 'P1', title: '跨天计划', goalType: 'times', goalTarget: 3, goalUnit: '次',
        startDate: offsetDate(1), endDate: offsetDate(7),
        weeklyTimes: 2, weeklyMinutes: 60,
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
      }],
      checkins: []
    })
    // 用 deriveStatus 验证：今天=开始日前一天 -> upcoming；开始日当天 -> ongoing
    const rawPlan = trainingStore.__getState().plans[0]
    expect(deriveStatus(rawPlan, [], offsetDate(0))).toBe('upcoming')
    expect(deriveStatus(rawPlan, [], offsetDate(1))).toBe('ongoing')

    // getAllPlans 以真实今天计算：开始日就是明天，因此应为未开始；
    // 快照中的 startDate 字符串保持不变（没有被重写）
    const listed = trainingStore.getAllPlans()[0]
    expect(listed.status).toBe('upcoming')
    expect(trainingStore.__getState().plans[0].startDate).toBe(offsetDate(1))
  })

  it('历史计划和打卡在多次读写后不被覆盖', () => {
    trainingStore.__reset()
    const oldPlan = seedPlan({ title: '历史计划', startDate: offsetDate(-30), endDate: offsetDate(-20) })
    trainingStore.addCheckin({ planId: oldPlan.id, date: offsetDate(-25), duration: 60, content: '历史练习' })
    const snapshot = JSON.stringify(trainingStore.__getState())

    // 新建、编辑、打卡其他计划若干轮
    const newer = seedPlan({ title: '新计划', goalType: 'minutes' })
    trainingStore.addCheckin({ planId: newer.id, date: offsetDate(0), duration: 40, content: '新练习' })
    trainingStore.updatePlan(newer.id, validPlanInput({ title: '新计划改', goalType: 'minutes' }))

    const state = trainingStore.__getState()
    const oldCheckin = state.checkins.find(c => c.planId === oldPlan.id)
    expect(oldCheckin.duration).toBe(60)
    expect(oldCheckin.content).toBe('历史练习')
    // 快照字符串是旧状态的真子集验证：旧计划与旧打卡字段原样保留
    expect(JSON.stringify(state)).toContain(JSON.parse(snapshot).plans[0].title)
  })
})

// ==================== 与既有数据隔离测试 ====================

describe('数据隔离', () => {
  beforeEach(() => {
    trainingStore.__reset()
    localStorage.removeItem(TASK_STORAGE_KEY)
  })

  it('训练数据与任务中心使用独立存储键，互不覆盖', () => {
    localStorage.setItem(TASK_STORAGE_KEY, JSON.stringify([{ id: 'T-EXISTING', type: 'booking' }]))
    seedPlan()

    const tasks = JSON.parse(localStorage.getItem(TASK_STORAGE_KEY))
    expect(tasks).toEqual([{ id: 'T-EXISTING', type: 'booking' }])

    const training = JSON.parse(localStorage.getItem('billiard_user_training'))
    expect(Array.isArray(training.plans)).toBe(true)
    expect(training.plans.length).toBe(1)
  })

  it('损坏的训练数据不会污染原始备份，页面可继续使用', () => {
    localStorage.setItem('billiard_user_training', '{not-json')
    expect(() => trainingStore.getAllPlans()).not.toThrow()
    expect(trainingStore.getAllPlans().length).toBe(0)
    const backupKey = Object.keys(localStorage).find(k => k.startsWith('billiard_user_training_corrupt_backup_'))
    expect(backupKey).toBeTruthy()
    expect(localStorage.getItem(backupKey)).toBe('{not-json')
  })
})

// ==================== API 重试与幂等测试 ====================

describe('API 层 - 失败重试', () => {
  beforeEach(() => {
    trainingStore.__reset()
    __setMockNetwork({ delayMs: 0, failures: {} })
  })

  afterEach(() => {
    __setMockNetwork({ delayMs: null, failures: {} })
  })

  it('网络失败后自动重试，最终成功（只产生一次业务效果）', async () => {
    const plan = seedPlan({ startDate: offsetDate(0), endDate: offsetDate(10) })
    __setMockNetwork({
      delayMs: 0,
      failures: { '/training/checkins': { attempts: 2, afterPersist: false } }
    })

    const result = await api.createCheckin(
      { planId: plan.id, date: offsetDate(0), duration: 40, content: '瞄准练习', clientRequestId: 'R-RETRY-1' },
      { retries: 3, baseDelay: 1 }
    )
    expect(result.success).toBe(true)
    expect(trainingStore.getPlanById(plan.id).progress.checkinCount).toBe(1)
  })

  it('重试次数耗尽后抛出错误且不写入', async () => {
    const plan = seedPlan({ startDate: offsetDate(0), endDate: offsetDate(10) })
    __setMockNetwork({
      delayMs: 0,
      failures: { '/training/checkins': { attempts: 5, afterPersist: false } }
    })

    let error
    try {
      await api.createCheckin(
        { planId: plan.id, date: offsetDate(0), duration: 40, content: '瞄准练习', clientRequestId: 'R-RETRY-2' },
        { retries: 2, baseDelay: 1 }
      )
    } catch (e) {
      error = e
    }
    expect(error).toBeDefined()
    expect(error.message).toContain('网络异常')
    expect(trainingStore.getPlanById(plan.id).progress.checkinCount).toBe(0)
  })

  it('服务端已落库但响应丢失：重试走幂等返回同一条，绝不重复打卡', async () => {
    const plan = seedPlan({ startDate: offsetDate(0), endDate: offsetDate(10) })
    __setMockNetwork({
      delayMs: 0,
      failures: { '/training/checkins': { attempts: 1, afterPersist: true } }
    })

    const result = await api.createCheckin(
      { planId: plan.id, date: offsetDate(0), duration: 55, content: '清台训练', clientRequestId: 'R-IDEM-1' },
      { retries: 3, baseDelay: 1 }
    )
    expect(result.success).toBe(true)
    const checkins = trainingStore.__getState().checkins.filter(c => c.planId === plan.id)
    expect(checkins.length).toBe(1)
    expect(checkins[0].id).toBe('CHK-R-IDEM-1')
    expect(checkins[0].duration).toBe(55)
  })

  it('业务错误（重复打卡/未来日期/目标冲突）不触发重试', async () => {
    const plan = seedPlan({ startDate: offsetDate(0), endDate: offsetDate(10) })
    trainingStore.addCheckin({ planId: plan.id, date: offsetDate(0), duration: 40, content: '瞄准练习' })

    const onRetry = vi.fn()
    let error
    try {
      await api.createCheckin(
        { planId: plan.id, date: offsetDate(0), duration: 40, content: '瞄准练习', clientRequestId: 'R-DUP' },
        { retries: 3, baseDelay: 1, onRetry }
      )
    } catch (e) {
      error = e
    }
    expect(error.errorCode).toBe(ErrorCode.DUPLICATE_CHECKIN)
    expect(onRetry).not.toHaveBeenCalled()
    expect(trainingStore.getPlanById(plan.id).progress.checkinCount).toBe(1)

    // 未来日期同样不重试
    onRetry.mockClear()
    try {
      await api.createCheckin(
        { planId: plan.id, date: offsetDate(2), duration: 40, content: '瞄准练习', clientRequestId: 'R-FUTURE' },
        { retries: 3, baseDelay: 1, onRetry }
      )
    } catch (e) {
      error = e
    }
    expect(error.errorCode).toBe(ErrorCode.FUTURE_DATE)
    expect(onRetry).not.toHaveBeenCalled()
  })

  it('创建计划遇到目标冲突返回业务错误', async () => {
    seedPlan({ title: '原计划', startDate: offsetDate(0), endDate: offsetDate(10) })
    let error
    try {
      await api.createTrainingPlan(validPlanInput({ title: '冲突计划', startDate: offsetDate(1), endDate: offsetDate(5) }))
    } catch (e) {
      error = e
    }
    expect(error.errorCode).toBe(ErrorCode.GOAL_CONFLICT)
    expect(trainingStore.getAllPlans().length).toBe(1)
  })

  it('withRetry 对立即失败的业务结果不重试', async () => {
    const fn = vi.fn()
      .mockResolvedValueOnce({ success: false, error: 'bad', errorCode: 'DUPLICATE_CHECKIN' })
    await expect(withRetry(fn, { retries: 3, baseDelay: 1 })).rejects.toThrow('bad')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('withRetry 对无 errorCode 的网络错误按指数退避重试', async () => {
    const fn = vi.fn()
      .mockResolvedValueOnce({ success: false, error: 'network' })
      .mockResolvedValueOnce({ success: true, data: { ok: 1 } })
    const onRetry = vi.fn()
    const result = await withRetry(fn, { retries: 2, baseDelay: 1, onRetry })
    expect(result.data).toEqual({ ok: 1 })
    expect(fn).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onRetry.mock.calls[0][0].waitMs).toBe(1)
  })
})

// ==================== API 基本读写测试 ====================

describe('API 层 - 训练接口', () => {
  beforeEach(() => {
    trainingStore.__reset()
    __setMockNetwork({ delayMs: 0, failures: {} })
  })

  afterEach(() => {
    __setMockNetwork({ delayMs: null, failures: {} })
  })

  it('可以通过 API 获取计划列表/统计/历史', async () => {
    seedPlan({ title: 'API计划' })
    const [plans, stats, history] = await Promise.all([
      api.getTrainingPlans(),
      api.getTrainingStats(),
      api.getCheckins()
    ])
    expect(plans.success).toBe(true)
    expect(plans.data.some(p => p.title === 'API计划')).toBe(true)
    expect(stats.success).toBe(true)
    expect(stats.data.totalPlans).toBe(1)
    expect(history.success).toBe(true)
    expect(Array.isArray(history.data)).toBe(true)
  })

  it('可以通过 API 更新与删除计划', async () => {
    const plan = seedPlan()
    const upd = await api.updateTrainingPlan(plan.id, validPlanInput({ title: 'API更新' }))
    expect(upd.success).toBe(true)
    expect(upd.data.title).toBe('API更新')

    const del = await api.deleteTrainingPlan(plan.id)
    expect(del.success).toBe(true)
    expect(trainingStore.getPlanById(plan.id)).toBe(null)
  })
})
