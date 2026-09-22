/**
 * 训练计划与打卡存储管理
 *
 * 功能说明：
 * - 按目标（goalType + targetValue + 周期日期）创建训练计划
 * - 记录每次练习打卡（append-only，历史记录永不覆盖）
 * - 计划状态根据当前日期实时派生：未开始 / 进行中 / 已完成 / 已过期
 *
 * 数据安全：
 * - 使用独立的 localStorage 键，与任务中心（billiard_user_tasks）等既有数据完全隔离
 * - 打卡只做「新增」，从不修改或删除既有打卡记录
 * - 计划更新采用不可变合并，绝不覆盖 extra / createdAt 等既有字段
 * - 首次访问时仅在键不存在时写入演示数据，已有数据不会被重置
 */

const PLAN_STORAGE_KEY = 'billiard_training_plans'
const CHECKIN_STORAGE_KEY = 'billiard_training_checkins'

const logger = {
  info: (...args) => console.log('[trainingStore]', ...args),
  warn: (...args) => console.warn('[trainingStore]', ...args),
  error: (...args) => console.error('[trainingStore]', ...args)
}

/** 目标类型配置 */
export const goalTypeConfig = {
  count: { name: '练习次数', unit: '次', icon: '🎯', inputLabel: '目标次数' },
  duration: { name: '练习时长', unit: '小时', icon: '⏱️', inputLabel: '目标小时数' }
}

/** 计划派生状态配置（status 由日期与打卡实时计算，不持久化，保证跨天重新打开正确流转） */
export const planStatusConfig = {
  upcoming: { text: '未开始', type: 'info' },
  ongoing: { text: '进行中', type: 'primary' },
  completed: { text: '已完成', type: 'success' },
  expired: { text: '已过期', type: 'warning' }
}

/** 业务错误码：用于区分可重试的网络错误与不可重试的校验错误 */
export const TrainingErrorCode = {
  PLAN_NOT_FOUND: 'PLAN_NOT_FOUND',
  INVALID_PLAN: 'INVALID_PLAN',
  GOAL_CONFLICT: 'GOAL_CONFLICT',
  INVALID_CHECKIN: 'INVALID_CHECKIN',
  FUTURE_DATE: 'FUTURE_DATE',
  DUPLICATE_CHECKIN: 'DUPLICATE_CHECKIN',
  PLAN_NOT_ACTIVE: 'PLAN_NOT_ACTIVE',
  STORAGE_ERROR: 'STORAGE_ERROR'
}

/** 不可重试的校验类错误码集合（4xx 语义，重试无意义） */
const NON_RETRYABLE_CODES = new Set([
  TrainingErrorCode.PLAN_NOT_FOUND,
  TrainingErrorCode.INVALID_PLAN,
  TrainingErrorCode.GOAL_CONFLICT,
  TrainingErrorCode.INVALID_CHECKIN,
  TrainingErrorCode.FUTURE_DATE,
  TrainingErrorCode.DUPLICATE_CHECKIN,
  TrainingErrorCode.PLAN_NOT_ACTIVE
])

export function isRetryableCode(code) {
  return !code || !NON_RETRYABLE_CODES.has(code)
}

export class TrainingError extends Error {
  constructor(code, message, field) {
    super(message)
    this.name = 'TrainingError'
    this.code = code
    this.field = field
  }
}

// ==================== 日期工具 ====================

const pad = (n) => n.toString().padStart(2, '0')

/** 将 Date / 字符串格式化为本地日期 YYYY-MM-DD（不使用 toISOString，避免 UTC 时区偏移） */
export function toDateKey(date) {
  const d = date instanceof Date ? date : new Date(date + 'T00:00:00')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function todayKey(now = new Date()) {
  return toDateKey(now)
}

/** 含首尾的天数（YYYY-MM-DD 差值 + 1） */
export function daysInclusive(startKey, endKey) {
  const start = new Date(startKey + 'T00:00:00')
  const end = new Date(endKey + 'T00:00:00')
  return Math.round((end - start) / 86400000) + 1
}

function diffDays(aKey, bKey) {
  const a = new Date(aKey + 'T00:00:00')
  const b = new Date(bKey + 'T00:00:00')
  return Math.round((a - b) / 86400000)
}

function formatDateTime(date) {
  const d = date instanceof Date ? date : new Date(date)
  return `${toDateKey(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ==================== 存储读写 ====================

function readList(key) {
  try {
    const stored = localStorage.getItem(key)
    if (!stored) return null // null 表示「从未初始化」，用于区分空列表
    const parsed = JSON.parse(stored)
    return Array.isArray(parsed) ? parsed : []
  } catch (e) {
    // 数据损坏时返回 null 触发重新种子，绝不用默认数据静默覆盖其它键
    logger.error('读取训练数据失败', key, e)
    return null
  }
}

function writeList(key, list) {
  try {
    localStorage.setItem(key, JSON.stringify(list))
    return true
  } catch (e) {
    logger.error('写入训练数据失败', key, e)
    throw new TrainingError(TrainingErrorCode.STORAGE_ERROR, '本地存储写入失败，请稍后重试')
  }
}

function loadPlans() {
  const plans = readList(PLAN_STORAGE_KEY)
  if (plans === null) {
    const seeded = getSeedPlans()
    writeList(PLAN_STORAGE_KEY, seeded)
    return seeded
  }
  return plans
}

function loadCheckins() {
  const checkins = readList(CHECKIN_STORAGE_KEY)
  if (checkins === null) {
    const seeded = getSeedCheckins()
    writeList(CHECKIN_STORAGE_KEY, seeded)
    return seeded
  }
  return checkins
}

function savePlans(plans) {
  writeList(PLAN_STORAGE_KEY, plans)
}

function saveCheckins(checkins) {
  writeList(CHECKIN_STORAGE_KEY, checkins)
}

// ==================== 演示数据（仅首次初始化） ====================

function seedDateOffset(days) {
  return toDateKey(new Date(Date.now() + days * 86400000))
}

function getSeedPlans() {
  // 一条进行中的计划：3 天前开始、4 天后结束，目标练习 5 次
  return [
    {
      id: 'P-SEED-0001',
      title: '出杆稳定性专项',
      goalType: 'count',
      targetValue: 5,
      startDate: seedDateOffset(-3),
      endDate: seedDateOffset(4),
      createdAt: formatDateTime(new Date(Date.now() - 3 * 86400000)),
      extra: { seed: true }
    }
  ]
}

function getSeedCheckins() {
  // 一条昨天的打卡：历史数据，任何后续操作都不得修改它
  return [
    {
      id: 'C-SEED-0001',
      planId: 'P-SEED-0001',
      date: seedDateOffset(-1),
      value: 1,
      note: '演示数据：定点出杆 30 分钟',
      createdAt: formatDateTime(new Date(Date.now() - 86400000)),
      extra: { seed: true }
    }
  ]
}

// ==================== 校验与计算 ====================

function validatePlanInput(input) {
  const title = (input.title || '').trim()
  const goalType = input.goalType
  const targetValue = Number(input.targetValue)
  const startDate = input.startDate
  const endDate = input.endDate

  if (!title) {
    throw new TrainingError(TrainingErrorCode.INVALID_PLAN, '请填写计划名称', 'title')
  }
  if (!goalTypeConfig[goalType]) {
    throw new TrainingError(TrainingErrorCode.INVALID_PLAN, '目标类型无效', 'goalType')
  }
  if (!Number.isFinite(targetValue) || targetValue <= 0) {
    throw new TrainingError(
      TrainingErrorCode.INVALID_PLAN,
      '目标量必须为大于 0 的数字',
      'targetValue'
    )
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate || '')) {
    throw new TrainingError(TrainingErrorCode.INVALID_PLAN, '请选择开始日期', 'startDate')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate || '')) {
    throw new TrainingError(TrainingErrorCode.INVALID_PLAN, '请选择结束日期', 'endDate')
  }
  if (endDate < startDate) {
    throw new TrainingError(
      TrainingErrorCode.INVALID_PLAN,
      '结束日期不能早于开始日期',
      'endDate'
    )
  }
  return { title, goalType, targetValue, startDate, endDate }
}

/** 目标冲突：相同目标类型且日期区间重叠的计划视为目标冲突（创建时检测，不依赖传入状态） */
function assertNoGoalConflict(plans, goalType, startDate, endDate, excludeId) {
  const conflict = plans.find(
    (p) =>
      p.id !== excludeId &&
      p.goalType === goalType &&
      p.startDate <= endDate &&
      p.endDate >= startDate
  )
  if (conflict) {
    throw new TrainingError(
      TrainingErrorCode.GOAL_CONFLICT,
      `目标冲突：与「${conflict.title}」的训练周期（${conflict.startDate} ~ ${conflict.endDate}）重叠`,
      'startDate'
    )
  }
}

function generateId(prefix) {
  return (
    prefix +
    Date.now().toString(36).toUpperCase() +
    Math.floor(Math.random() * 36 ** 4)
      .toString(36)
      .toUpperCase()
      .padStart(4, '0')
  )
}

/** 汇总某计划的打卡（只读取历史，不修改） */
function summarizeCheckins(checkins, planId) {
  const list = checkins.filter((c) => c.planId === planId)
  const totalValue = list.reduce((sum, c) => sum + (Number(c.value) || 0), 0)
  const doneDays = new Set(list.map((c) => c.date)).size
  const sortedDates = [...new Set(list.map((c) => c.date))].sort()
  return { list, totalValue, doneDays, sortedDates }
}

/**
 * 计算连续达标天数（consecutive streak）。
 * 从周期内「有打卡的最后一天」向前数：有打卡即 +1，中间出现空档则中断。
 */
function calcStreak(sortedDates) {
  if (sortedDates.length === 0) return 0
  let streak = 1
  for (let i = sortedDates.length - 1; i > 0; i--) {
    if (diffDays(sortedDates[i], sortedDates[i - 1]) === 1) {
      streak++
    } else {
      break
    }
  }
  return streak
}

/** 为计划附加派生字段（纯函数，不改写原对象，保证跨天重开时状态重新计算） */
function enrichPlan(plan, checkins, now = new Date()) {
  const today = toDateKey(now)
  const { totalValue, doneDays, sortedDates } = summarizeCheckins(checkins, plan.id)
  const goalInfo = goalTypeConfig[plan.goalType] || goalTypeConfig.count

  const targetReached = totalValue >= Number(plan.targetValue)
  let status
  if (today < plan.startDate) {
    status = 'upcoming'
  } else if (today > plan.endDate) {
    status = targetReached ? 'completed' : 'expired'
  } else {
    status = targetReached ? 'completed' : 'ongoing'
  }

  const totalDays = daysInclusive(plan.startDate, plan.endDate)
  const elapsedDays = Math.min(Math.max(diffDays(today, plan.startDate) + 1, 0), totalDays)
  const remainingDays = Math.max(diffDays(plan.endDate, today), 0)
  const progress = Math.min(100, Math.round((totalValue / Number(plan.targetValue)) * 100))

  // 周期内已过去但没有打卡的天数（未开始前不计）
  const missedDays = (() => {
    if (status === 'upcoming') return 0
    const lastElapsed = status === 'completed' || status === 'expired' ? plan.endDate : today
    const elapsed = daysInclusive(plan.startDate, lastElapsed)
    const practicedInRange = sortedDates.filter((d) => d >= plan.startDate && d <= lastElapsed).length
    return Math.max(elapsed - practicedInRange, 0)
  })()

  const statusInfo = planStatusConfig[status]

  return {
    ...plan,
    goalName: goalInfo.name,
    goalUnit: goalInfo.unit,
    goalIcon: goalInfo.icon,
    totalValue,
    doneDays,
    totalDays,
    elapsedDays,
    remainingDays,
    missedDays,
    streak: calcStreak(sortedDates),
    progress,
    targetReached,
    status,
    statusText: statusInfo.text,
    statusType: statusInfo.type,
    checkinDates: sortedDates,
    checkedInToday: sortedDates.includes(today),
    canCheckin: status === 'ongoing'
  }
}

// ==================== 对外 API ====================

export const trainingStore = {
  /** 获取计划列表（附加实时派生状态），默认进行中在前、再按创建时间倒序 */
  getPlans(now = new Date()) {
    const plans = loadPlans()
    const checkins = loadCheckins()
    return plans
      .map((p) => enrichPlan(p, checkins, now))
      .sort((a, b) => {
        const order = { ongoing: 0, upcoming: 1, completed: 2, expired: 3 }
        if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status]
        return (b.createdAt || '').localeCompare(a.createdAt || '')
      })
  },

  getPlan(planId, now = new Date()) {
    const plan = loadPlans().find((p) => p.id === planId)
    if (!plan) return null
    return enrichPlan(plan, loadCheckins(), now)
  },

  /** 创建训练计划（校验日期、目标量与目标冲突；冲突时不写入任何数据） */
  createPlan(input, now = new Date()) {
    const data = validatePlanInput(input)
    const plans = loadPlans()
    assertNoGoalConflict(plans, data.goalType, data.startDate, data.endDate)

    const newPlan = {
      id: generateId('P-'),
      title: data.title,
      goalType: data.goalType,
      targetValue: data.targetValue,
      startDate: data.startDate,
      endDate: data.endDate,
      createdAt: formatDateTime(now),
      extra: {}
    }
    const next = [newPlan, ...plans]
    savePlans(next)
    logger.info('训练计划已创建', { id: newPlan.id })
    return enrichPlan(newPlan, loadCheckins(), now)
  },

  /**
   * 打卡（记录一次练习）。
   * - 拒绝未来日期
   * - 同一计划同一天重复打卡被拒绝（历史记录不重复写入）
   * - 校验目标冲突（计划仍存在且周期覆盖该日期）
   * - 仅向打卡数组追加新记录，绝不修改既有打卡与计划字段
   */
  checkin(input, now = new Date()) {
    const planId = input.planId
    const date = input.date
    const value = Number(input.value)
    const note = (input.note || '').trim()

    const plans = loadPlans()
    const plan = plans.find((p) => p.id === planId)
    if (!plan) {
      throw new TrainingError(TrainingErrorCode.PLAN_NOT_FOUND, '训练计划不存在或已被删除')
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
      throw new TrainingError(TrainingErrorCode.INVALID_CHECKIN, '请选择打卡日期', 'date')
    }
    if (date > toDateKey(now)) {
      throw new TrainingError(
        TrainingErrorCode.FUTURE_DATE,
        '不能为未来日期打卡，请选择今天或过去的日期',
        'date'
      )
    }
    if (!Number.isFinite(value) || value <= 0) {
      throw new TrainingError(
        TrainingErrorCode.INVALID_CHECKIN,
        '练习量必须为大于 0 的数字',
        'value'
      )
    }
    if (date < plan.startDate || date > plan.endDate) {
      throw new TrainingError(
        TrainingErrorCode.PLAN_NOT_ACTIVE,
        `打卡日期需在计划周期内（${plan.startDate} ~ ${plan.endDate}）`,
        'date'
      )
    }

    const checkins = loadCheckins()
    const duplicated = checkins.some((c) => c.planId === planId && c.date === date)
    if (duplicated) {
      throw new TrainingError(
        TrainingErrorCode.DUPLICATE_CHECKIN,
        `${date} 的训练已打卡，一天只需记录一次，请勿重复打卡`,
        'date'
      )
    }

    const record = {
      id: generateId('C-'),
      planId,
      date,
      value,
      note,
      createdAt: formatDateTime(now),
      extra: {}
    }
    // append-only：新记录并入既有记录后整体写回，原有记录对象保持不变
    const next = [...checkins, record]
    saveCheckins(next)
    logger.info('打卡成功', { planId, date, value })

    return { record, plan: enrichPlan(plan, next, now) }
  },

  /** 打卡历史（默认按日期倒序），可按计划筛选；历史为纯记录，不依赖当天日期 */
  getHistory(planId) {
    const checkins = loadCheckins()
    const plans = loadPlans()
    const planMap = new Map(plans.map((p) => [p.id, p]))
    return checkins
      .filter((c) => !planId || c.planId === planId)
      .map((c) => ({
        ...c,
        planTitle: planMap.get(c.planId)?.title || '已删除的计划',
        goalType: planMap.get(c.planId)?.goalType || null,
        goalUnit: goalTypeConfig[planMap.get(c.planId)?.goalType]?.unit || ''
      }))
      .sort((a, b) =>
        a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || '').localeCompare(a.createdAt || '')
      )
  },

  /** 整体训练统计（用于进度总览） */
  getStats(now = new Date()) {
    const plans = this.getPlans(now)
    const checkins = loadCheckins()
    const active = plans.filter((p) => p.status === 'ongoing')
    const completed = plans.filter((p) => p.status === 'completed')
    const expired = plans.filter((p) => p.status === 'expired')
    const totalPractice = checkins.reduce((sum, c) => sum + (Number(c.value) || 0), 0)
    const longestStreak = plans.reduce((max, p) => Math.max(max, p.streak), 0)
    return {
      planCount: plans.length,
      activeCount: active.length,
      completedCount: completed.length,
      expiredCount: expired.length,
      checkinCount: checkins.length,
      totalPractice,
      longestStreak
    }
  },

  /** 仅供测试：重置全部训练数据 */
  __resetForTests(plans = [], checkins = []) {
    writeList(PLAN_STORAGE_KEY, plans)
    writeList(CHECKIN_STORAGE_KEY, checkins)
  }
}

export default trainingStore
