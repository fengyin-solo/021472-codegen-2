<!--
  Training.vue - 训练计划与打卡

  功能说明：
  - 按目标（次数/时长 + 周期）创建训练计划
  - 记录每次练习打卡，查看训练进度与完成状态
  - 查看打卡历史（历史记录只追加，不覆盖）

  边界处理：
  - 重复打卡 / 未来日期 / 目标冲突：业务校验错误，即时提示，不重试
  - 请求失败（网络抖动）：自动重试后仍失败，弹窗提供「重试」
  - 跨天重新打开页面：计划状态按当前日期实时派生，自动流转
-->
<template>
  <div class="training-page">
    <div class="container">
      <!-- 未登录提示 -->
      <div v-if="!isLoggedIn" class="login-gate">
        <div class="gate-icon">🎱</div>
        <h2>登录后开启你的训练计划</h2>
        <p>记录每次练习，追踪目标进度，坚持打卡提升球技</p>
        <button class="btn-primary-large" @click="requestLogin">立即登录</button>
      </div>

      <template v-else>
        <!-- 页头 -->
        <div class="page-header">
          <div class="header-content">
            <h1>训练计划与打卡</h1>
            <p class="subtitle">按目标记录每一次练习，见证自己的进步</p>
          </div>
          <button class="btn-create" :disabled="pageLoading" @click="openCreateModal">
            <span class="plus">＋</span> 新建训练计划
          </button>
        </div>

        <!-- 总览统计 -->
        <div class="stats-grid">
          <div class="stat-card">
            <span class="stat-icon">🏃</span>
            <div>
              <div class="stat-value">{{ stats.activeCount }}</div>
              <div class="stat-label">进行中计划</div>
            </div>
          </div>
          <div class="stat-card">
            <span class="stat-icon">✅</span>
            <div>
              <div class="stat-value">{{ stats.completedCount }}</div>
              <div class="stat-label">已完成目标</div>
            </div>
          </div>
          <div class="stat-card">
            <span class="stat-icon">📝</span>
            <div>
              <div class="stat-value">{{ stats.checkinCount }}</div>
              <div class="stat-label">累计打卡</div>
            </div>
          </div>
          <div class="stat-card">
            <span class="stat-icon">🔥</span>
            <div>
              <div class="stat-value">{{ stats.longestStreak }}</div>
              <div class="stat-label">最长连续天数</div>
            </div>
          </div>
        </div>

        <!-- 加载 / 失败态 -->
        <div v-if="pageLoading" class="state-box">
          <div class="spinner"></div>
          <p>正在加载训练计划…</p>
        </div>
        <div v-else-if="pageError" class="state-box error-box">
          <div class="state-icon">📡</div>
          <h3>训练数据加载失败</h3>
          <p>{{ pageError }}</p>
          <button class="btn-primary-large" @click="loadData">重试</button>
        </div>

        <template v-else>
          <!-- 计划列表 -->
          <div v-if="plans.length > 0" class="plans-list">
            <div
              v-for="plan in plans"
              :key="plan.id"
              class="plan-card"
              :class="plan.status"
            >
              <div class="plan-top">
                <div class="plan-title-wrap">
                  <span class="plan-goal-icon">{{ plan.goalIcon }}</span>
                  <div>
                    <h3 class="plan-title">{{ plan.title }}</h3>
                    <p class="plan-range">{{ plan.startDate }} ~ {{ plan.endDate }}（共 {{ plan.totalDays }} 天）</p>
                  </div>
                </div>
                <span class="plan-status" :class="plan.statusType">{{ plan.statusText }}</span>
              </div>

              <!-- 进度 -->
              <div class="progress-block">
                <div class="progress-meta">
                  <span class="progress-numbers">
                    {{ plan.totalValue }} / {{ plan.targetValue }} {{ plan.goalUnit }}
                  </span>
                  <span class="progress-percent">{{ plan.progress }}%</span>
                </div>
                <div class="progress-bar">
                  <div class="progress-fill" :style="{ width: plan.progress + '%' }"></div>
                </div>
                <div class="plan-sub-meta">
                  <span>已打卡 {{ plan.doneDays }} 天</span>
                  <span v-if="plan.streak > 0">🔥 连续 {{ plan.streak }} 天</span>
                  <span v-if="plan.status === 'ongoing'">剩余 {{ plan.remainingDays }} 天</span>
                  <span v-if="plan.status === 'ongoing' && plan.missedDays > 0" class="missed">
                    已缺卡 {{ plan.missedDays }} 天
                  </span>
                  <span v-if="plan.status === 'expired'" class="missed">目标未达成</span>
                </div>
              </div>

              <!-- 操作 -->
              <div class="plan-actions">
                <button
                  v-if="plan.canCheckin"
                  class="action-btn primary"
                  :disabled="plan.checkedInToday"
                  @click="openCheckinModal(plan)"
                >
                  {{ plan.checkedInToday ? '今日已打卡 ✓' : '打卡' }}
                </button>
                <button class="action-btn default" @click="toggleHistory(plan.id)">
                  {{ expandedHistory === plan.id ? '收起历史' : '查看打卡历史' }}
                </button>
              </div>

              <!-- 该计划打卡历史 -->
              <div v-if="expandedHistory === plan.id" class="history-panel">
                <div v-if="planHistory(plan.id).length === 0" class="history-empty">
                  暂无打卡记录，开始第一次练习吧
                </div>
                <ul v-else class="history-list">
                  <li v-for="item in planHistory(plan.id)" :key="item.id" class="history-item">
                    <div class="history-dot"></div>
                    <div class="history-main">
                      <span class="history-date">{{ item.date }}</span>
                      <span v-if="item.note" class="history-note">{{ item.note }}</span>
                    </div>
                    <span class="history-value">{{ item.value }} {{ plan.goalUnit }}</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <div v-else class="state-box">
            <div class="state-icon">🎯</div>
            <h3>还没有训练计划</h3>
            <p>设定一个可衡量的目标，开始规律训练</p>
            <button class="btn-primary-large" @click="openCreateModal">创建第一个计划</button>
          </div>
        </template>
      </template>
    </div>

    <!-- 新建计划弹窗 -->
    <Modal
      v-model="showCreateModal"
      icon="🎯"
      icon-type="info"
      title="新建训练计划"
      subtitle="设定目标类型、目标量与训练周期"
      size="medium"
      confirm-text="创建计划"
      :loading="createLoading"
      @confirm="submitCreate"
    >
      <div class="form">
        <div class="form-item">
          <label>计划名称</label>
          <input v-model.trim="createForm.title" class="form-input" placeholder="例如：出杆稳定性专项" maxlength="30" />
        </div>
        <div class="form-item">
          <label>目标类型</label>
          <div class="goal-toggle">
            <button
              v-for="opt in goalOptions"
              :key="opt.value"
              type="button"
              class="goal-option"
              :class="{ active: createForm.goalType === opt.value }"
              @click="createForm.goalType = opt.value"
            >
              {{ opt.icon }} {{ opt.label }}
            </button>
          </div>
        </div>
        <div class="form-item">
          <label>{{ currentGoalInputLabel }}</label>
          <input
            v-model.number="createForm.targetValue"
            class="form-input"
            type="number"
            min="1"
            step="1"
            placeholder="请输入大于 0 的目标量"
          />
        </div>
        <div class="form-row">
          <div class="form-item">
            <label>开始日期</label>
            <input v-model="createForm.startDate" class="form-input" type="date" />
          </div>
          <div class="form-item">
            <label>结束日期</label>
            <input v-model="createForm.endDate" class="form-input" type="date" />
          </div>
        </div>
        <p v-if="createError" class="form-error">⚠️ {{ createError }}</p>
        <p class="form-hint">同一目标类型在重叠的周期内只能存在一个计划，避免目标冲突。</p>
      </div>
    </Modal>

    <!-- 打卡弹窗 -->
    <Modal
      v-model="showCheckinModal"
      icon="📝"
      icon-type="success"
      title="记录训练打卡"
      :subtitle="checkinTarget ? checkinTarget.title : ''"
      size="small"
      confirm-text="提交打卡"
      :loading="checkinLoading"
      @confirm="submitCheckin"
    >
      <div v-if="checkinTarget" class="form">
        <div class="checkin-target">
          目标 {{ checkinTarget.targetValue }} {{ checkinTarget.goalUnit }} ·
          已完成 {{ checkinTarget.totalValue }} {{ checkinTarget.goalUnit }}（{{ checkinTarget.progress }}%）
        </div>
        <div class="form-item">
          <label>打卡日期</label>
          <input
            v-model="checkinForm.date"
            class="form-input"
            type="date"
            :max="todayStr"
          />
          <span class="field-error">{{ fieldErrors.date }}</span>
        </div>
        <div class="form-item">
          <label>本次{{ checkinTarget.goalName }}（{{ checkinTarget.goalUnit }}）</label>
          <input
            v-model.number="checkinForm.value"
            class="form-input"
            type="number"
            min="0.5"
            step="0.5"
            placeholder="本次练习量"
          />
          <span class="field-error">{{ fieldErrors.value }}</span>
        </div>
        <div class="form-item">
          <label>训练备注（可选）</label>
          <textarea
            v-model.trim="checkinForm.note"
            class="form-input textarea"
            rows="2"
            placeholder="记录今天的练习内容或感受"
            maxlength="100"
          ></textarea>
        </div>
        <p v-if="checkinError" class="form-error">⚠️ {{ checkinError }}</p>
      </div>
    </Modal>

    <!-- 请求失败重试弹窗 -->
    <Modal
      v-model="showRetryModal"
      icon="📡"
      icon-type="error"
      title="请求失败"
      :subtitle="retryMessage"
      size="small"
      confirm-text="重试"
      :show-cancel="false"
      :loading="retryLoading"
      @confirm="retryLastAction"
    >
      <p class="retry-tip">网络或服务暂时不可用，请检查网络后点击重试。已填写的内容不会丢失。</p>
    </Modal>

    <!-- 成功提示 -->
    <Modal
      v-model="showSuccessModal"
      icon="🎉"
      icon-type="success"
      :title="successTitle"
      :subtitle="successMessage"
      size="small"
      :show-cancel="false"
      confirm-text="我知道了"
      @confirm="showSuccessModal = false"
    />

    <Toast
      v-model="showToast"
      :type="toastType"
      :title="toastTitle"
      :message="toastMessage"
    />
  </div>
</template>

<script>
import Modal from '../components/Modal.vue'
import Toast from '../components/Toast.vue'
import { api, logger } from '../utils/api'
import { authState } from '../utils/auth'
import { eventBus } from '../utils/eventBus'
import { goalTypeConfig } from '../utils/trainingStore'

function toDateKey(date) {
  const pad = (n) => n.toString().padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export default {
  name: 'Training',
  components: { Modal, Toast },
  data() {
    return {
      plans: [],
      history: [],
      stats: {
        activeCount: 0,
        completedCount: 0,
        checkinCount: 0,
        longestStreak: 0
      },
      pageLoading: false,
      pageError: '',
      expandedHistory: null,

      // 新建计划
      showCreateModal: false,
      createLoading: false,
      createError: '',
      createForm: this.emptyCreateForm(),

      // 打卡
      showCheckinModal: false,
      checkinLoading: false,
      checkinError: '',
      checkinTarget: null,
      checkinForm: { date: '', value: 1, note: '' },
      fieldErrors: { date: '', value: '' },

      // 失败重试
      showRetryModal: false,
      retryLoading: false,
      retryMessage: '',
      retryAction: null,

      // 成功 / Toast
      showSuccessModal: false,
      successTitle: '',
      successMessage: '',
      showToast: false,
      toastType: 'info',
      toastTitle: '',
      toastMessage: '',

      // 用于驱动「当前日期」，跨天重新打开 / 标签页切回时重算
      nowTick: Date.now()
    }
  },
  computed: {
    isLoggedIn() {
      return authState.isLoggedIn
    },
    todayStr() {
      return toDateKey(new Date(this.nowTick))
    },
    goalOptions() {
      return [
        { value: 'count', label: goalTypeConfig.count.name, icon: goalTypeConfig.count.icon },
        { value: 'duration', label: goalTypeConfig.duration.name, icon: goalTypeConfig.duration.icon }
      ]
    },
    currentGoalInputLabel() {
      return goalTypeConfig[this.createForm.goalType]?.inputLabel || '目标量'
    }
  },
  mounted() {
    if (this.isLoggedIn) this.loadData()
    // 跨天场景：标签页重新可见 / 窗口重新聚焦时按当天日期重新派生状态
    document.addEventListener('visibilitychange', this.handleVisibility)
    window.addEventListener('focus', this.refreshOnNewDay)
  },
  beforeUnmount() {
    document.removeEventListener('visibilitychange', this.handleVisibility)
    window.removeEventListener('focus', this.refreshOnNewDay)
  },
  activated() {
    if (this.isLoggedIn) this.loadData()
  },
  methods: {
    requestLogin() {
      eventBus.emit('open-login')
    },
    handleVisibility() {
      if (document.visibilityState === 'visible') this.refreshOnNewDay()
    },
    refreshOnNewDay() {
      // 日期真正跨过一天时才重新请求，避免无谓刷新
      const latest = toDateKey(new Date())
      if (latest !== this.todayStr) {
        this.nowTick = Date.now()
        if (this.isLoggedIn && !this.showCheckinModal && !this.showCreateModal) {
          this.loadData()
        }
      }
    },

    emptyCreateForm() {
      const today = toDateKey(new Date())
      const end = toDateKey(new Date(Date.now() + 7 * 86400000))
      return {
        title: '',
        goalType: 'count',
        targetValue: 10,
        startDate: today,
        endDate: end
      }
    },

    async loadData() {
      this.pageLoading = true
      this.pageError = ''
      const [plansRes, historyRes, statsRes] = await Promise.all([
        api.getTrainingPlans(),
        api.getCheckins(),
        api.getTrainingStats()
      ])
      this.pageLoading = false

      if (plansRes.success) {
        this.plans = plansRes.data
        this.history = historyRes.success ? historyRes.data : []
        if (statsRes.success) this.stats = statsRes.data
        logger.info('Training data loaded', { plans: this.plans.length })
      } else {
        this.pageError = plansRes.error || '加载失败'
      }
    },

    planHistory(planId) {
      return this.history.filter((h) => h.planId === planId)
    },
    toggleHistory(planId) {
      this.expandedHistory = this.expandedHistory === planId ? null : planId
      // 展开时补拉一次历史，保证看到最新记录
      if (this.expandedHistory) this.refreshHistory()
    },
    async refreshHistory() {
      const res = await api.getCheckins()
      if (res.success) this.history = res.data
    },

    // ---------- 新建计划 ----------
    openCreateModal() {
      this.createForm = this.emptyCreateForm()
      this.createError = ''
      this.showCreateModal = true
    },
    validateCreate() {
      const f = this.createForm
      if (!f.title) return '请填写计划名称'
      const value = Number(f.targetValue)
      if (!Number.isFinite(value) || value <= 0) return '目标量必须为大于 0 的数字'
      if (!f.startDate || !f.endDate) return '请选择完整的开始与结束日期'
      if (f.endDate < f.startDate) return '结束日期不能早于开始日期'
      return ''
    },
    async submitCreate() {
      const clientError = this.validateCreate()
      if (clientError) {
        this.createError = clientError
        return
      }
      this.createLoading = true
      this.createError = ''
      const payload = { ...this.createForm, targetValue: Number(this.createForm.targetValue) }
      const res = await api.createTrainingPlan(payload)
      this.createLoading = false

      if (res.success) {
        this.showCreateModal = false
        await this.loadData()
        this.showSuccess('计划已创建', '坚持打卡，达成你的训练目标')
      } else if (res.retryable) {
        this.showCreateModal = false
        this.openRetry(res.error, () => this.resubmitCreate(payload))
      } else {
        // 目标冲突等业务校验错误：停留在弹窗内即时提示，不重试
        this.createError = res.error || '创建失败，请检查填写内容'
        logger.warn('Create plan rejected', { code: res.code })
      }
    },
    async resubmitCreate(payload) {
      const res = await api.createTrainingPlan(payload)
      if (res.success) {
        this.showRetryModal = false
        await this.loadData()
        this.showSuccess('计划已创建', '坚持打卡，达成你的训练目标')
      } else if (res.retryable) {
        this.retryMessage = res.error
      } else {
        this.showRetryModal = false
        this.showCreateModal = true
        this.createError = res.error || '创建失败，请检查填写内容'
      }
      return res
    },

    // ---------- 打卡 ----------
    openCheckinModal(plan) {
      this.checkinTarget = plan
      this.checkinForm = { date: this.todayStr, value: 1, note: '' }
      this.fieldErrors = { date: '', value: '' }
      this.checkinError = ''
      this.showCheckinModal = true
    },
    validateCheckin() {
      const errors = { date: '', value: '' }
      if (!this.checkinForm.date) {
        errors.date = '请选择打卡日期'
      } else if (this.checkinForm.date > this.todayStr) {
        errors.date = '不能为未来日期打卡'
      }
      const value = Number(this.checkinForm.value)
      if (!Number.isFinite(value) || value <= 0) {
        errors.value = '练习量必须大于 0'
      }
      this.fieldErrors = errors
      return !errors.date && !errors.value
    },
    async submitCheckin() {
      if (!this.checkinTarget) return
      // 客户端预校验（未来日期 / 非法数量）
      if (!this.validateCheckin()) return

      // 乐观防重复提交：同一计划同一天直接拦截，避免重复写入
      if (this.planHistory(this.checkinTarget.id).some((h) => h.date === this.checkinForm.date)) {
        this.checkinError = `${this.checkinForm.date} 的训练已打卡，一天只需记录一次`
        return
      }

      this.checkinLoading = true
      this.checkinError = ''
      const payload = {
        planId: this.checkinTarget.id,
        date: this.checkinForm.date,
        value: Number(this.checkinForm.value),
        note: this.checkinForm.note
      }
      const res = await api.createCheckin(payload)
      this.checkinLoading = false

      if (res.success) {
        this.showCheckinModal = false
        await this.loadData()
        const plan = res.data.plan
        const done = plan.status === 'completed'
        this.showSuccess(
          done ? '打卡成功，目标已达成 🎉' : '打卡成功',
          done ? '你已完成该训练计划的目标' : `已累计 ${plan.totalValue} ${plan.goalUnit}，继续加油`
        )
      } else if (res.retryable) {
        this.showCheckinModal = false
        this.openRetry(res.error, () => this.resubmitCheckin(payload))
      } else {
        // 重复打卡 / 未来日期 / 周期外等业务错误：即时提示，不重试
        this.checkinError = res.error || '打卡失败，请检查后重试'
        if (res.field === 'date') this.fieldErrors.date = res.error
        logger.warn('Checkin rejected', { code: res.code })
      }
    },
    async resubmitCheckin(payload) {
      const res = await api.createCheckin(payload)
      if (res.success) {
        this.showRetryModal = false
        this.showCheckinModal = false
        await this.loadData()
        const plan = res.data.plan
        this.showSuccess(
          plan.status === 'completed' ? '打卡成功，目标已达成 🎉' : '打卡成功',
          `已累计 ${plan.totalValue} ${plan.goalUnit}`
        )
      } else if (res.retryable) {
        this.retryMessage = res.error
      } else {
        this.showRetryModal = false
        this.showCheckinModal = true
        this.checkinError = res.error || '打卡失败，请检查后重试'
        if (res.field === 'date') this.fieldErrors.date = res.error
      }
      return res
    },

    // ---------- 失败重试 ----------
    openRetry(message, action) {
      this.retryMessage = message || '网络请求失败，请稍后重试'
      this.retryAction = action
      this.showRetryModal = true
    },
    async retryLastAction() {
      if (!this.retryAction) {
        this.showRetryModal = false
        return
      }
      this.retryLoading = true
      try {
        await this.retryAction()
      } finally {
        this.retryLoading = false
      }
    },

    showSuccess(title, message) {
      this.successTitle = title
      this.successMessage = message
      this.showSuccessModal = true
    }
  }
}
</script>

<style scoped>
.training-page {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem 3rem 4rem;
}

.container {
  max-width: 960px;
  margin: 0 auto;
}

/* 未登录 */
.login-gate {
  text-align: center;
  padding: 5rem 2rem;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 24px;
}

.gate-icon {
  font-size: 4rem;
  margin-bottom: 1rem;
}

.login-gate h2 {
  font-size: 1.5rem;
  margin-bottom: 0.5rem;
}

.login-gate p {
  color: var(--text-secondary);
  margin-bottom: 1.5rem;
}

/* 页头 */
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin-bottom: 1.75rem;
  gap: 1rem;
}

.header-content h1 {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 2rem;
  font-weight: 700;
  margin-bottom: 0.5rem;
}

.subtitle {
  color: var(--text-secondary);
  font-size: 0.95rem;
}

.btn-create {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.7rem 1.25rem;
  background: var(--gradient-1);
  color: var(--bg-dark);
  border: none;
  border-radius: 12px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
  white-space: nowrap;
}

.btn-create:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px var(--primary-glow);
}

.btn-create:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-create .plus {
  font-size: 1.1rem;
  font-weight: 700;
}

.btn-primary-large {
  padding: 0.75rem 1.75rem;
  background: var(--gradient-1);
  color: var(--bg-dark);
  border: none;
  border-radius: 12px;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
}

.btn-primary-large:hover {
  box-shadow: 0 6px 18px var(--primary-glow);
}

/* 统计卡片 */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1rem;
  margin-bottom: 2rem;
}

.stat-card {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 1.1rem 1.25rem;
}

.stat-icon {
  font-size: 1.6rem;
}

.stat-value {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 1.4rem;
  font-weight: 700;
  line-height: 1.1;
}

.stat-label {
  font-size: 0.78rem;
  color: var(--text-secondary);
}

/* 状态盒 */
.state-box {
  text-align: center;
  padding: 3.5rem 2rem;
  background: var(--bg-card);
  border: 1px dashed var(--border);
  border-radius: 24px;
}

.state-icon {
  font-size: 3.5rem;
  margin-bottom: 0.75rem;
  opacity: 0.8;
}

.state-box h3 {
  font-size: 1.2rem;
  margin-bottom: 0.4rem;
}

.state-box p {
  color: var(--text-secondary);
  font-size: 0.9rem;
  margin-bottom: 1.25rem;
}

.error-box {
  border-color: rgba(255, 107, 107, 0.35);
}

.spinner {
  width: 36px;
  height: 36px;
  margin: 0 auto 1rem;
  border: 3px solid var(--border);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* 计划卡片 */
.plans-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.plan-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-left: 4px solid var(--primary);
  border-radius: 20px;
  padding: 1.5rem;
  transition: border-color 0.3s, transform 0.3s;
}

.plan-card:hover {
  border-color: rgba(255, 255, 255, 0.15);
}

.plan-card.upcoming {
  border-left-color: #4facfe;
}

.plan-card.completed {
  border-left-color: var(--primary);
}

.plan-card.expired {
  border-left-color: #ffc107;
  opacity: 0.92;
}

.plan-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 1.25rem;
}

.plan-title-wrap {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.plan-goal-icon {
  font-size: 1.6rem;
}

.plan-title {
  font-size: 1.1rem;
  font-weight: 600;
  margin-bottom: 0.2rem;
}

.plan-range {
  font-size: 0.82rem;
  color: var(--text-muted);
}

.plan-status {
  padding: 0.35rem 0.85rem;
  border-radius: 20px;
  font-size: 0.75rem;
  font-weight: 600;
  white-space: nowrap;
}

.plan-status.primary {
  background: rgba(0, 217, 165, 0.15);
  color: var(--primary);
}

.plan-status.info {
  background: rgba(79, 172, 254, 0.15);
  color: #4facfe;
}

.plan-status.success {
  background: rgba(0, 217, 165, 0.15);
  color: var(--primary);
}

.plan-status.warning {
  background: rgba(255, 193, 7, 0.15);
  color: #ffc107;
}

/* 进度 */
.progress-block {
  margin-bottom: 1.25rem;
}

.progress-meta {
  display: flex;
  justify-content: space-between;
  font-size: 0.85rem;
  margin-bottom: 0.5rem;
}

.progress-numbers {
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 600;
}

.progress-percent {
  color: var(--primary);
  font-weight: 600;
}

.progress-bar {
  height: 8px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 0.6rem;
}

.progress-fill {
  height: 100%;
  background: var(--gradient-1);
  border-radius: 4px;
  transition: width 0.5s ease;
}

.plan-sub-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  font-size: 0.78rem;
  color: var(--text-secondary);
}

.plan-sub-meta .missed {
  color: #ffc107;
}

/* 操作 */
.plan-actions {
  display: flex;
  gap: 0.75rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border);
}

.action-btn {
  padding: 0.55rem 1.25rem;
  border-radius: 10px;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: all 0.2s;
}

.action-btn.primary {
  background: var(--gradient-1);
  color: var(--bg-dark);
  font-weight: 600;
}

.action-btn.primary:hover:not(:disabled) {
  box-shadow: 0 4px 12px var(--primary-glow);
}

.action-btn.primary:disabled {
  background: rgba(0, 217, 165, 0.18);
  color: var(--primary);
  cursor: default;
}

.action-btn.default {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border);
  color: var(--text-primary);
}

.action-btn.default:hover {
  background: rgba(255, 255, 255, 0.1);
}

/* 历史面板 */
.history-panel {
  margin-top: 1.25rem;
  padding-top: 1.25rem;
  border-top: 1px dashed var(--border);
}

.history-empty {
  font-size: 0.85rem;
  color: var(--text-muted);
  text-align: center;
  padding: 0.75rem 0;
}

.history-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.history-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.history-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--primary);
  flex-shrink: 0;
}

.history-main {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.history-date {
  font-size: 0.88rem;
  font-weight: 500;
}

.history-note {
  font-size: 0.78rem;
  color: var(--text-muted);
}

.history-value {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--primary);
}

/* 表单 */
.form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-item {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  flex: 1;
}

.form-item label {
  font-size: 0.85rem;
  color: var(--text-secondary);
  font-weight: 500;
}

.form-row {
  display: flex;
  gap: 1rem;
}

.form-input {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0.65rem 0.85rem;
  color: var(--text-primary);
  font-size: 0.9rem;
  font-family: inherit;
  outline: none;
  transition: border-color 0.2s;
}

.form-input:focus {
  border-color: var(--primary);
}

.textarea {
  resize: vertical;
}

.goal-toggle {
  display: flex;
  gap: 0.75rem;
}

.goal-option {
  flex: 1;
  padding: 0.7rem;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--border);
  border-radius: 10px;
  color: var(--text-secondary);
  font-size: 0.88rem;
  cursor: pointer;
  transition: all 0.2s;
}

.goal-option.active {
  background: rgba(0, 217, 165, 0.15);
  border-color: rgba(0, 217, 165, 0.4);
  color: var(--primary);
  font-weight: 600;
}

.form-error {
  color: #ff6b6b;
  font-size: 0.85rem;
}

.field-error {
  color: #ff6b6b;
  font-size: 0.75rem;
  min-height: 0.9rem;
}

.form-hint {
  font-size: 0.78rem;
  color: var(--text-muted);
}

.checkin-target {
  background: rgba(0, 217, 165, 0.08);
  border: 1px solid rgba(0, 217, 165, 0.2);
  border-radius: 10px;
  padding: 0.75rem 1rem;
  font-size: 0.85rem;
  color: var(--primary);
}

.retry-tip {
  font-size: 0.88rem;
  color: var(--text-secondary);
  line-height: 1.6;
}

@media (max-width: 768px) {
  .training-page {
    padding: 1rem 1.25rem 3rem;
  }

  .page-header {
    flex-direction: column;
    align-items: stretch;
  }

  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .form-row {
    flex-direction: column;
  }
}
</style>
