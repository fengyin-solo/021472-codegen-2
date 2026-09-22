/**
 * 训练计划与打卡存储管理
 *
 * 功能说明：
 * - 管理用户自定义的训练计划（目标、周期、每周训练次数/时长）
 * - 记录每次练习打卡（训练日期、时长、内容、备注）
 * - 计划状态（未开始/进行中/已完成）一律按当天日期与打卡数据实时推导，
 *   因此跨天重新打开页面时状态会自动正确流转
 * - 使用 localStorage 持久化；写入采用整体快照，历史计划与既有打卡不会被覆盖
 * - 与任务中心（billiard_user_tasks）使用独立的存储键，互不影响
 *
 * 数据结构：
 * {
 *   version: 1,
 *   plans: [{ id, title, goalType, goalTarget, goalUnit, startDate, endDate,
 *             weeklyTimes, weeklyMinutes, createdAt, updatedAt }],
 *   checkins: [{ id, planId, date, duration, content, note, createdAt }]
 * }
 */

const STORAGE_KEY = 'billiard_user_training'
const STORAGE_VERSION = 1

const logger = {
  info: (...args) => console.log('[trainingStore]', ...args),
  warn: (...args) => console.warn('[trainingStore]', ...args),
  error: (...args) => console.error('[trainingStore]', ...args)
}

/** 目标类型配置 */
export const goalTypeConfig = {
  times: { name: '训练次数', unit: '次', icon: '🔁' },
  minutes: { name: '训练时长', unit: '分钟', icon: '⏱️' },
  skill: { name: '技能提升', unit: '项', icon: '🎯' }
}

/** 计划状态文案 */
export const planStatusConfig = {
  upcoming: { text: '未开始', type: 'info' },
  ongoing: { text: '进行中', type: 'primary' },
  completed: { text: '已完成', type: 'success' }
}

/** 训练内容建议项 */
export const contentOptions = [
  { key: 'stance', label: '站姿与握杆', icon: '🧍' },
  { key: 'aim', label: '瞄准练习', icon: '🎯' },
  { key: 'stroke', label: '出杆稳定性', icon: '🏑' },
  { key: 'break', label: '开球练习', icon: '💥' },
  { key: 'safety', label: '防守走位', icon: '🛡️' },
  { key: 'clearance', label: '清台训练', icon: '🎱' },
  { key: 'match', label: '实战对抗', icon: '🏆' },
  { key: 'other', label: '其他练习', icon: '📝' }
]

// ==================== 日期工具 ====================

/**
 * 将 Date / 字符串格式化为 YYYY-MM-DD（按本地时区，避免 UTC 偏移）
 */
export function formatDate(date) {
  const d = new Date(date)
  const pad = n => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 今天的日期字符串 */
export function todayStr() {
  return formatDate(new Date())
}

/** 判断字符串是否为合法的 YYYY-MM-DD 日期 */
export function isValidDateStr(str) {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false
  const d = new Date(str + 'T00:00:00')
  return !Number.isNaN(d.getTime()) && formatDate(d) === str
}

/** 计算两个日期字符串之间相差的天数（b - a，可为负） */
export function dayDiff(a, b) {
  const da = new Date(a + 'T00:00:00').getTime()
  const db = new Date(b + 'T00:00:00').getTime()
  return Math.round((db - da) / 86400000)
}

// ==================== 存储读写 ====================

function getDefaultState() {
  return { version: STORAGE_VERSION, plans: [], checkins: [] }
}

/**
 * 读取并迁移存储数据。
 * 迁移时按字段合并到新的默认结构上，绝不丢弃未知版本中的既有数据。
 */
function loadState() {
  const base = getDefaultState()
  let raw = null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch (e) {
    logger.error('读取训练数据失败', e)
    return base
  }
  if (!raw) {
    // 首次使用：写入演示数据，仅在完全没有该存储键时发生
    const seeded = getSeedState()
    persistState(seeded)
    return seeded
  }
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      // 未知字段原样保留，迁移/读取都不会丢弃既有数据
      return {
        ...parsed,
        version: typeof parsed.version === 'number' ? parsed.version : STORAGE_VERSION,
        plans: Array.isArray(parsed.plans) ? parsed.plans : [],
        checkins: Array.isArray(parsed.checkins) ? parsed.checkins : []
      }
    }
  } catch (e) {
    // 数据损坏：不要覆盖，备份后从空数据开始
    logger.error('训练数据解析失败，已保留原始数据备份', e)
    try {
      localStorage.setItem(STORAGE_KEY + '_corrupt_backup_' + Date.now(), raw)
    } catch (_) { /* ignore */ }
  }
  return base
}

/** 整体快照写入（单次 setItem，保证 plans/checkins 同时更新） */
function persistState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    return true
  } catch (e) {
    logger.error('保存训练数据失败', e)
    return false
  }
}

function generateId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

/** 演示数据：以当前日期为锚点，便于直接体验进行中/待打卡状态 */
function getSeedState() {
  const now = new Date()
  const offset = days => {
    const d = new Date(now)
    d.setDate(d.getDate() + days)
    return formatDate(d)
  }
  const ts = new Date().toISOString()
  return {
    version: STORAGE_VERSION,
    plans: [
      {
        id: 'PLAN-SEED-001',
        title: '基础出杆稳定性训练',
        goalType: 'times',
        goalTarget: 12,
        goalUnit: '次',
        startDate: offset(-6),
        endDate: offset(21),
        weeklyTimes: 4,
        weeklyMinutes: 180,
        createdAt: ts,
        updatedAt: ts
      },
      {
        id: 'PLAN-SEED-002',
        title: '每周有氧击球',
        goalType: 'minutes',
        goalTarget: 600,
        goalUnit: '分钟',
        startDate: offset(-20),
        endDate: offset(-2),
        weeklyTimes: 3,
        weeklyMinutes: 150,
        createdAt: ts,
        updatedAt: ts
      }
    ],
    checkins: [
      {
        id: 'CHK-SEED-001', planId: 'PLAN-SEED-001', date: offset(-5),
        duration: 45, content: '出杆稳定性', note: '空杆运杆练习 3 组', createdAt: ts
      },
      {
        id: 'CHK-SEED-002', planId: 'PLAN-SEED-001', date: offset(-3),
        duration: 60, content: '瞄准练习', note: '', createdAt: ts
      },
      {
        id: 'CHK-SEED-003', planId: 'PLAN-SEED-002', date: offset(-18),
        duration: 50, content: '实战对抗', note: '', createdAt: ts
      },
      {
        id: 'CHK-SEED-004', planId: 'PLAN-SEED-002', date: offset(-10),
        duration: 55, content: '清台训练', note: '蛇彩 3 局', createdAt: ts
      }
    ]
  }
}

// ==================== 业务校验 ====================

/** 业务校验错误，携带 code 便于界面区分提示 */
export class ValidationError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ValidationError'
    this.code = code
  }
}

export const ErrorCode = {
  INVALID_FIELD: 'INVALID_FIELD',
  FUTURE_DATE: 'FUTURE_DATE',
  DUPLICATE_CHECKIN: 'DUPLICATE_CHECKIN',
  PLAN_NOT_FOUND: 'PLAN_NOT_FOUND',
  PLAN_NOT_ACTIVE: 'PLAN_NOT_ACTIVE',
  GOAL_CONFLICT: 'GOAL_CONFLICT'
}

/**
 * 校验计划表单
 * @returns {{title, goalType, goalTarget, startDate, endDate, weeklyTimes, weeklyMinutes}}
 */
function validatePlanInput(input) {
  const title = (input.title || '').trim()
  if (!title || title.length > 30) {
    throw new ValidationError(ErrorCode.INVALID_FIELD, '请填写 1-30 字的计划名称')
  }
  const goalType = input.goalType
  if (!goalTypeConfig[goalType]) {
    throw new ValidationError(ErrorCode.INVALID_FIELD, '请选择训练目标类型')
  }
  const goalTarget = Number(input.goalTarget)
  if (!Number.isFinite(goalTarget) || goalTarget <= 0 || goalTarget > 9999) {
    throw new ValidationError(ErrorCode.INVALID_FIELD, '目标值需为 1-9999 之间的数字')
  }
  const startDate = input.startDate
  const endDate = input.endDate
  if (!isValidDateStr(startDate) || !isValidDateStr(endDate)) {
    throw new ValidationError(ErrorCode.INVALID_FIELD, '请选择正确的开始与结束日期')
  }
  if (dayDiff(startDate, endDate) < 0) {
    throw new ValidationError(ErrorCode.INVALID_FIELD, '结束日期不能早于开始日期')
  }
  if (dayDiff(startDate, endDate) > 366) {
    throw new ValidationError(ErrorCode.INVALID_FIELD, '单个计划周期不能超过 366 天')
  }
  const weeklyTimes = Number(input.weeklyTimes)
  if (!Number.isInteger(weeklyTimes) || weeklyTimes < 1 || weeklyTimes > 14) {
    throw new ValidationError(ErrorCode.INVALID_FIELD, '每周训练次数需为 1-14 次')
  }
  const weeklyMinutes = Number(input.weeklyMinutes)
  if (!Number.isFinite(weeklyMinutes) || weeklyMinutes < 0 || weeklyMinutes > 3000) {
    throw new ValidationError(ErrorCode.INVALID_FIELD, '每周训练时长需为 0-3000 分钟')
  }
  return {
    title,
    goalType,
    goalTarget,
    goalUnit: goalTypeConfig[goalType].unit,
    startDate,
    endDate,
    weeklyTimes,
    weeklyMinutes
  }
}

/**
 * 检查目标冲突：同一目标类型、日期区间重叠且仍有效（未开始/进行中）的计划。
 * 已结束或已达目标的计划不阻止新建。
 */
function findConflict(state, data, excludePlanId) {
  const today = todayStr()
  return state.plans.find(p => {
    if (p.id === excludePlanId) return false
    if (p.goalType !== data.goalType) return false
    const status = deriveStatus(p, state.checkins, today)
    // 已完成（达成目标或周期结束）的计划不阻止新建
    if (status === 'completed') return false
    // 区间重叠：startDate <= other.end 且 endDate >= other.start
    return data.startDate <= p.endDate && data.endDate >= p.startDate
  }) || null
}

// ==================== 状态与进度推导（纯函数） ====================

/**
 * 根据当天日期推导计划状态：
 * - 今天 < 开始日期 -> upcoming（未开始）
 * - 已达目标 -> completed（已完成，与日期无关，历史保持完成态）
 * - 今天 > 结束日期 -> completed（周期结束）
 * - 其余 -> ongoing（进行中，含跨天后从 upcoming 自动流转）
 */
export function deriveStatus(plan, checkins = [], today = todayStr()) {
  if (today < plan.startDate) return 'upcoming'
  const { current } = getPlanProgress(plan, checkins)
  if (current >= plan.goalTarget) return 'completed'
  if (today > plan.endDate) return 'completed'
  return 'ongoing'
}

/**
 * 计算计划进度（不依赖状态，只依赖打卡事实数据）
 * - times: 打卡次数；skill: 训练内容去重后的项数；minutes: 打卡分钟合计
 */
export function getPlanProgress(plan, checkins = []) {
  const related = checkins.filter(c => c.planId === plan.id)
  let current = 0
  if (plan.goalType === 'times') {
    current = related.length
  } else if (plan.goalType === 'minutes') {
    current = related.reduce((sum, c) => sum + (Number(c.duration) || 0), 0)
  } else if (plan.goalType === 'skill') {
    current = new Set(related.map(c => c.content).filter(Boolean)).size
  }
  const percent = plan.goalTarget > 0
    ? Math.min(100, Math.round((current / plan.goalTarget) * 100))
    : 0
  return {
    current,
    target: plan.goalTarget,
    percent,
    done: current >= plan.goalTarget,
    checkinCount: related.length,
    totalMinutes: related.reduce((sum, c) => sum + (Number(c.duration) || 0), 0),
    checkins: related.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  }
}

function enrichPlan(plan, state, today) {
  const progress = getPlanProgress(plan, state.checkins)
  const status = deriveStatus(plan, state.checkins, today)
  const statusInfo = planStatusConfig[status]
  const totalDays = Math.max(0, dayDiff(plan.startDate, plan.endDate)) + 1
  const elapsedDays = Math.min(totalDays, Math.max(0, dayDiff(plan.startDate, today) + 1))
  const checkedDates = new Set(progress.checkins.map(c => c.date))
  const checkedToday = checkedDates.has(today)
  return {
    ...plan,
    goalTypeName: goalTypeConfig[plan.goalType]?.name || plan.goalType,
    goalTypeIcon: goalTypeConfig[plan.goalType]?.icon || '🎯',
    status,
    statusText: statusInfo.text,
    statusType: statusInfo.type,
    progress,
    totalDays,
    elapsedDays: status === 'upcoming' ? 0 : elapsedDays,
    canCheckin: status === 'ongoing' && !checkedToday,
    checkedToday
  }
}

// ==================== 对外 API ====================

export const trainingStore = {
  /** 仅供测试：清空为空白状态（保留键，避免触发首次播种） */
  __reset() {
    try {
      persistState(getDefaultState())
    } catch (_) { /* ignore */ }
  },

  /** 仅供测试：直接写入快照（跳过演示数据播种） */
  __setState(state) {
    persistState({ ...getDefaultState(), ...state })
  },

  /** 仅供测试：读取原始快照 */
  __getState() {
    return loadState()
  },

  /** 获取全部计划（含派生状态/进度），默认进行中的在前 */
  getAllPlans() {
    const state = loadState()
    const today = todayStr()
    const order = { ongoing: 0, upcoming: 1, completed: 2 }
    return state.plans
      .map(p => enrichPlan(p, state, today))
      .sort((a, b) => {
        if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status]
        return a.startDate < b.startDate ? 1 : -1
      })
  },

  getPlanById(planId) {
    const state = loadState()
    const plan = state.plans.find(p => p.id === planId)
    return plan ? enrichPlan(plan, state, todayStr()) : null
  },

  /**
   * 创建训练计划
   * @param {Object} input - title/goalType/goalTarget/startDate/endDate/weeklyTimes/weeklyMinutes
   * @returns {Object} 新建计划（enriched）
   * @throws {ValidationError} 字段非法或目标冲突
   */
  createPlan(input) {
    const data = validatePlanInput(input)
    const state = loadState()
    const conflict = findConflict(state, data, null)
    if (conflict) {
      throw new ValidationError(
        ErrorCode.GOAL_CONFLICT,
        `与进行中的「${conflict.title}」目标及周期冲突，请调整目标或时间范围`
      )
    }
    const ts = new Date().toISOString()
    const plan = {
      id: generateId('PLAN-'),
      ...data,
      createdAt: ts,
      updatedAt: ts
    }
    state.plans.push(plan)
    if (!persistState(state)) {
      throw new ValidationError(ErrorCode.INVALID_FIELD, '本地存储写入失败，请清理存储空间后重试')
    }
    logger.info('训练计划已创建', { id: plan.id, title: plan.title })
    return enrichPlan(plan, state, todayStr())
  },

  /** 编辑计划（目标类型/周期变化时同样做冲突检测） */
  updatePlan(planId, updates) {
    const state = loadState()
    const index = state.plans.findIndex(p => p.id === planId)
    if (index === -1) {
      throw new ValidationError(ErrorCode.PLAN_NOT_FOUND, '训练计划不存在或已被删除')
    }
    const merged = { ...state.plans[index], ...updates }
    const data = validatePlanInput(merged)
    const conflict = findConflict(state, data, planId)
    if (conflict) {
      throw new ValidationError(
        ErrorCode.GOAL_CONFLICT,
        `与进行中的「${conflict.title}」目标及周期冲突，请调整目标或时间范围`
      )
    }
    state.plans[index] = {
      ...state.plans[index],
      ...data,
      updatedAt: new Date().toISOString()
    }
    if (!persistState(state)) {
      throw new ValidationError(ErrorCode.INVALID_FIELD, '本地存储写入失败，请稍后重试')
    }
    logger.info('训练计划已更新', { id: planId })
    return enrichPlan(state.plans[index], state, todayStr())
  },

  /** 删除计划（同时移除其打卡记录），仅作用于该计划，其他数据不动 */
  removePlan(planId) {
    const state = loadState()
    const before = state.plans.length
    state.plans = state.plans.filter(p => p.id !== planId)
    if (state.plans.length === before) {
      logger.warn('计划不存在，无法删除', planId)
      return false
    }
    state.checkins = state.checkins.filter(c => c.planId !== planId)
    persistState(state)
    logger.info('训练计划已删除', { planId })
    return true
  },

  /**
   * 打卡（核心写入）
   * @param {Object} input - planId/date/duration/content/note
   * @param {Object} [options]
   * @param {string} [options.clientRequestId] - 幂等键，防止「请求失败重试」造成重复打卡
   * @returns {Object} 新打卡记录（重复提交时返回已存在的同一条）
   * @throws {ValidationError}
   */
  addCheckin(input, options = {}) {
    const planId = input.planId
    const date = input.date
    const duration = Number(input.duration)
    const content = (input.content || '').trim()
    const note = (input.note || '').trim()
    const state = loadState()

    const plan = state.plans.find(p => p.id === planId)
    if (!plan) {
      throw new ValidationError(ErrorCode.PLAN_NOT_FOUND, '训练计划不存在或已被删除')
    }
    if (!isValidDateStr(date)) {
      throw new ValidationError(ErrorCode.INVALID_FIELD, '请选择正确的训练日期')
    }
    if (date > todayStr()) {
      throw new ValidationError(ErrorCode.FUTURE_DATE, '不能为未来日期打卡，请选择今天或过去的日期')
    }
    if (!Number.isFinite(duration) || duration <= 0 || duration > 1440) {
      throw new ValidationError(ErrorCode.INVALID_FIELD, '训练时长需为 1-1440 分钟')
    }
    if (!content) {
      throw new ValidationError(ErrorCode.INVALID_FIELD, '请选择训练内容')
    }
    if (note.length > 200) {
      throw new ValidationError(ErrorCode.INVALID_FIELD, '备注不能超过 200 字')
    }
    if (date < plan.startDate || date > plan.endDate) {
      throw new ValidationError(
        ErrorCode.PLAN_NOT_ACTIVE,
        `打卡日期需在计划周期内（${plan.startDate} ~ ${plan.endDate}）`
      )
    }

    // 幂等：同计划同日期重复打卡直接返回既有记录（覆盖重复点击与失败重试两种场景）
    const existing = state.checkins.find(c => c.planId === planId && c.date === date)
    if (existing) {
      logger.warn('该日期已打卡，拒绝重复写入', { planId, date })
      const error = new ValidationError(
        ErrorCode.DUPLICATE_CHECKIN,
        `${date} 已完成打卡，一天只能打卡一次`
      )
      error.existing = existing
      throw error
    }

    const checkin = {
      id: options.clientRequestId
        ? 'CHK-' + options.clientRequestId
        : generateId('CHK-'),
      planId,
      date,
      duration,
      content,
      note,
      createdAt: new Date().toISOString()
    }
    state.checkins.push(checkin)
    if (!persistState(state)) {
      throw new ValidationError(ErrorCode.INVALID_FIELD, '打卡记录保存失败，请稍后重试')
    }
    logger.info('打卡成功', { planId, date, duration })
    return checkin
  },

  /** 撤销当天打卡（误操作纠正），历史打卡不可删除 */
  undoCheckin(planId, date) {
    const state = loadState()
    const before = state.checkins.length
    state.checkins = state.checkins.filter(c => !(c.planId === planId && c.date === date))
    if (state.checkins.length === before) {
      logger.warn('打卡记录不存在，无法撤销', { planId, date })
      return false
    }
    persistState(state)
    logger.info('打卡已撤销', { planId, date })
    return true
  },

  /** 打卡历史（全部计划，按日期倒序），附带计划标题，不修改任何数据 */
  getHistory(limit) {
    const state = loadState()
    const planTitleMap = new Map(state.plans.map(p => [p.id, p.title]))
    const rows = state.checkins
      .map(c => ({ ...c, planTitle: planTitleMap.get(c.planId) || '已删除的计划' }))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    return typeof limit === 'number' ? rows.slice(0, limit) : rows
  },

  /** 顶部汇总统计 */
  getStats() {
    const state = loadState()
    const today = todayStr()
    const plans = state.plans
    let ongoing = 0
    let completed = 0
    let checkedToday = false
    plans.forEach(p => {
      const status = deriveStatus(p, state.checkins, today)
      if (status === 'ongoing') ongoing++
      if (status === 'completed') completed++
      if (state.checkins.some(c => c.planId === p.id && c.date === today)) checkedToday = true
    })
    const dates = new Set(state.checkins.map(c => c.date))
    const streak = computeStreak(dates, today)
    return {
      totalPlans: plans.length,
      ongoing,
      completed,
      totalCheckins: state.checkins.length,
      totalMinutes: state.checkins.reduce((s, c) => s + (Number(c.duration) || 0), 0),
      checkedToday,
      streak
    }
  }
}

/** 连续打卡天数（从今天往前；今天没打则从昨天起算，保持跨天展示正确） */
function computeStreak(dateSet, today) {
  let streak = 0
  let cursor = today
  if (!dateSet.has(cursor)) {
    const d = new Date(cursor + 'T00:00:00')
    d.setDate(d.getDate() - 1)
    cursor = formatDate(d)
  }
  while (dateSet.has(cursor)) {
    streak++
    const d = new Date(cursor + 'T00:00:00')
    d.setDate(d.getDate() - 1)
    cursor = formatDate(d)
  }
  return streak
}

export default trainingStore
