<template>
  <div class="training-page">
    <div class="container">
      <!-- 页头 -->
      <div class="page-header">
        <div class="header-content">
          <h1>训练计划与打卡</h1>
          <p class="subtitle">按目标制定计划，记录每次练习，追踪完成进度</p>
        </div>
        <div class="header-actions">
          <button class="btn-create" @click="openCreateModal">
            <span class="plus">＋</span> 新建训练计划
          </button>
        </div>
      </div>

      <!-- 汇总卡片 -->
      <div class="stats-grid">
        <div class="stat-card">
          <span class="stat-icon">📋</span>
          <div class="stat-text">
            <span class="stat-value">{{ stats.totalPlans }}</span>
            <span class="stat-label">全部计划</span>
          </div>
        </div>
        <div class="stat-card ongoing">
          <span class="stat-icon">🔥</span>
          <div class="stat-text">
            <span class="stat-value">{{ stats.ongoing }}</span>
            <span class="stat-label">进行中</span>
          </div>
        </div>
        <div class="stat-card completed">
          <span class="stat-icon">✅</span>
          <div class="stat-text">
            <span class="stat-value">{{ stats.totalCheckins }}</span>
            <span class="stat-label">累计打卡</span>
          </div>
        </div>
        <div class="stat-card streak">
          <span class="stat-icon">⏱️</span>
          <div class="stat-text">
            <span class="stat-value">{{ stats.streak }}</span>
            <span class="stat-label">连续打卡(天)</span>
          </div>
        </div>
      </div>

      <!-- 今日打卡提示 -->
      <div v-if="stats.ongoing > 0" class="today-banner" :class="{ done: stats.checkedToday }">
        <span class="banner-icon">{{ stats.checkedToday ? '🎉' : '📌' }}</span>
        <span class="banner-text">
          {{ stats.checkedToday ? '今天已完成打卡，继续保持！' : '今天还没有打卡，完成练习后记得记录哦' }}
        </span>
      </div>

      <!-- 计划列表 -->
      <div class="section-head">
        <h2>我的训练计划</h2>
      </div>

      <div v-if="plans.length > 0" class="plan-list">
        <div
          v-for="plan in plans"
          :key="plan.id"
          class="plan-card"
          :class="plan.status"
        >
          <div class="plan-top">
            <div class="plan-title-wrap">
              <span class="plan-goal-icon">{{ plan.goalTypeIcon }}</span>
              <div>
                <h3 class="plan-title">{{ plan.title }}</h3>
                <p class="plan-dates">{{ plan.startDate }} ~ {{ plan.endDate }} · 共 {{ plan.totalDays }} 天</p>
              </div>
            </div>
            <span class="plan-status" :class="plan.statusType">{{ plan.statusText }}</span>
          </div>

          <!-- 目标进度 -->
          <div class="progress-block">
            <div class="progress-meta">
              <span class="progress-goal">
                目标：{{ plan.goalTypeName }} {{ plan.goalTarget }} {{ plan.goalUnit }}
              </span>
              <span class="progress-num" :class="{ done: plan.progress.done }">
                {{ plan.progress.current }} / {{ plan.progress.target }} {{ plan.goalUnit }}（{{ plan.progress.percent }}%）
              </span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" :style="{ width: plan.progress.percent + '%' }"></div>
            </div>
            <div class="plan-sub-meta">
              <span>已打卡 {{ plan.progress.checkinCount }} 次</span>
              <span>累计 {{ plan.progress.totalMinutes }} 分钟</span>
              <span>每周 {{ plan.weeklyTimes }} 次<template v-if="plan.weeklyMinutes"> / {{ plan.weeklyMinutes }} 分钟</template></span>
            </div>
          </div>

          <!-- 操作 -->
          <div class="plan-actions">
            <button
              v-if="plan.status === 'ongoing' && !plan.checkedToday"
              class="action-btn primary"
              :disabled="submittingCheckin"
              @click="openCheckinModal(plan)"
            >
              今日打卡
            </button>
            <span v-else-if="plan.status === 'ongoing' && plan.checkedToday" class="checked-tip">
              ✓ 今日已打卡
            </span>
            <span v-else-if="plan.status === 'upcoming'" class="checked-tip muted">计划未开始</span>
            <span v-else class="checked-tip muted">计划已结束</span>

            <div class="action-group">
              <button class="action-btn default" @click="toggleHistory(plan.id)">
                {{ expandedPlan === plan.id ? '收起记录' : '打卡记录' }}
              </button>
              <button class="action-btn default" @click="openEditModal(plan)">编辑</button>
              <button class="action-btn danger" @click="openDeleteModal(plan)">删除</button>
            </div>
          </div>

          <!-- 该计划的打卡记录 -->
          <div v-if="expandedPlan === plan.id" class="plan-history">
            <div v-if="plan.progress.checkins.length === 0" class="mini-empty">暂无打卡记录</div>
            <div v-for="c in plan.progress.checkins" :key="c.id" class="checkin-row">
              <span class="ci-date">{{ c.date }}</span>
              <span class="ci-content">{{ c.content }}</span>
              <span class="ci-duration">{{ c.duration }} 分钟</span>
              <span v-if="c.note" class="ci-note" :title="c.note">{{ c.note }}</span>
              <button
                v-if="c.date === today && plan.status === 'ongoing'"
                class="ci-undo"
                @click="undoCheckin(plan, c)"
              >撤销</button>
            </div>
          </div>
        </div>
      </div>

      <div v-else class="empty-state">
        <div class="empty-icon">🎯</div>
        <h3>还没有训练计划</h3>
        <p>制定一个按目标推进的训练计划，开始记录每次练习吧</p>
        <button class="btn-create lg" @click="openCreateModal">＋ 新建训练计划</button>
      </div>

      <!-- 全部历史 -->
      <div v-if="history.length > 0" class="history-section">
        <div class="section-head">
          <h2>打卡历史</h2>
          <span class="history-count">共 {{ history.length }} 条</span>
        </div>
        <div class="history-list">
          <div v-for="item in history" :key="item.id" class="history-item">
            <div class="hi-date">
              <span class="hi-day">{{ item.date.slice(8) }}</span>
              <span class="hi-ym">{{ item.date.slice(0, 7) }}</span>
            </div>
            <div class="hi-main">
              <span class="hi-plan">{{ item.planTitle }}</span>
              <span class="hi-content">{{ item.content }}<template v-if="item.note"> · {{ item.note }}</template></span>
            </div>
            <span class="hi-duration">{{ item.duration }} 分钟</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 新建/编辑计划 -->
    <Modal
      v-model="showPlanModal"
      :icon="editingPlan ? '✏️' : '🎯'"
      icon-type="info"
      :title="editingPlan ? '编辑训练计划' : '新建训练计划'"
      subtitle="同一目标且周期重叠的计划不能重复创建"
      size="medium"
      confirm-text="保存计划"
      :loading="planSubmitting"
      @confirm="submitPlan"
    >
      <div class="plan-form">
        <div class="form-group">
          <label>计划名称</label>
          <input v-model.trim="planForm.title" maxlength="30" type="text" placeholder="例如：四周出杆稳定性训练" />
        </div>

        <div class="form-group">
          <label>训练目标</label>
          <div class="goal-types">
            <button
              v-for="(cfg, key) in goalTypes"
              :key="key"
              type="button"
              class="goal-chip"
              :class="{ active: planForm.goalType === key }"
              @click="planForm.goalType = key"
            >
              <span>{{ cfg.icon }} {{ cfg.name }}</span>
            </button>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label>目标值（{{ goalUnit }}）</label>
            <input v-model.number="planForm.goalTarget" type="number" min="1" max="9999" placeholder="例如 12" />
          </div>
          <div class="form-group">
            <label>每周训练次数</label>
            <input v-model.number="planForm.weeklyTimes" type="number" min="1" max="14" placeholder="1-14" />
          </div>
          <div class="form-group">
            <label>每周训练(分钟)</label>
            <input v-model.number="planForm.weeklyMinutes" type="number" min="0" max="3000" placeholder="可选" />
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label>开始日期</label>
            <input v-model="planForm.startDate" type="date" />
          </div>
          <div class="form-group">
            <label>结束日期</label>
            <input v-model="planForm.endDate" type="date" :min="planForm.startDate" />
          </div>
        </div>
      </div>
    </Modal>

    <!-- 打卡 -->
    <Modal
      v-model="showCheckinModal"
      icon="🎱"
      icon-type="success"
      title="训练打卡"
      :subtitle="checkinTarget ? checkinTarget.title : ''"
      size="medium"
      confirm-text="提交打卡"
      :loading="submittingCheckin"
      @confirm="submitCheckin"
    >
      <div v-if="checkinTarget" class="checkin-form">
        <div class="form-row">
          <div class="form-group">
            <label>训练日期</label>
            <input v-model="checkinForm.date" type="date" :max="today" :min="checkinTarget.startDate" />
            <p class="field-hint">不可选择未来日期，需在计划周期 {{ checkinTarget.startDate }} ~ {{ checkinTarget.endDate }} 内</p>
          </div>
          <div class="form-group">
            <label>训练时长（分钟）</label>
            <input v-model.number="checkinForm.duration" type="number" min="1" max="1440" placeholder="例如 60" />
          </div>
        </div>

        <div class="form-group">
          <label>训练内容</label>
          <div class="content-chips">
            <button
              v-for="opt in contentOptions"
              :key="opt.key"
              type="button"
              class="content-chip"
              :class="{ active: checkinForm.content === opt.label }"
              @click="checkinForm.content = opt.label"
            >
              {{ opt.icon }} {{ opt.label }}
            </button>
          </div>
        </div>

        <div class="form-group">
          <label>训练备注（可选）</label>
          <textarea v-model.trim="checkinForm.note" maxlength="200" rows="2" placeholder="记录今天的收获或问题"></textarea>
        </div>

        <p v-if="checkinRetrying" class="retry-tip">网络异常，正在自动重试（第 {{ checkinRetryCount }} 次）…</p>
      </div>
    </Modal>

    <!-- 删除确认 -->
    <Modal
      v-model="showDeleteModal"
      icon="warning"
      icon-type="warning"
      title="删除训练计划"
      :subtitle="`删除后「${deleteTarget?.title || ''}」及其打卡记录将一并移除，且不可恢复`"
      size="small"
      confirm-text="确认删除"
      confirm-type="danger"
      :loading="deleteSubmitting"
      @confirm="confirmDelete"
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
import { goalTypeConfig, contentOptions, todayStr } from '../utils/trainingStore'

function emptyPlanForm() {
  return {
    title: '',
    goalType: 'times',
    goalTarget: 12,
    startDate: todayStr(),
    endDate: '',
    weeklyTimes: 3,
    weeklyMinutes: 150
  }
}

function emptyCheckinForm() {
  return { date: todayStr(), duration: 60, content: '', note: '' }
}

export default {
  name: 'Training',
  components: { Modal, Toast },
  data() {
    return {
      goalTypes: goalTypeConfig,
      contentOptions,
      today: todayStr(),
      plans: [],
      history: [],
      stats: { totalPlans: 0, ongoing: 0, completed: 0, totalCheckins: 0, totalMinutes: 0, checkedToday: false, streak: 0 },
      expandedPlan: null,
      loading: false,

      // 计划弹窗
      showPlanModal: false,
      planSubmitting: false,
      editingPlan: null,
      planForm: emptyPlanForm(),

      // 打卡弹窗
      showCheckinModal: false,
      checkinTarget: null,
      checkinForm: emptyCheckinForm(),
      submittingCheckin: false,
      checkinRetrying: false,
      checkinRetryCount: 0,

      // 删除弹窗
      showDeleteModal: false,
      deleteTarget: null,
      deleteSubmitting: false,

      // Toast
      showToast: false,
      toastType: 'success',
      toastTitle: '',
      toastMessage: ''
    }
  },
  computed: {
    goalUnit() {
      return goalTypeConfig[this.planForm.goalType]?.unit || ''
    }
  },
  mounted() {
    this.refresh()
    // 跨天重新打开/切回页面时，按当天日期重新推导状态
    window.addEventListener('focus', this.handleDayBoundary)
    document.addEventListener('visibilitychange', this.handleVisibility)
  },
  beforeUnmount() {
    window.removeEventListener('focus', this.handleDayBoundary)
    document.removeEventListener('visibilitychange', this.handleVisibility)
  },
  activated() {
    this.refresh()
  },
  methods: {
    async refresh() {
      this.loading = true
      try {
        const [plansRes, historyRes, statsRes] = await Promise.all([
          api.getTrainingPlans(),
          api.getCheckins({ limit: 50 }),
          api.getTrainingStats()
        ])
        if (plansRes.success) this.plans = plansRes.data
        if (historyRes.success) this.history = historyRes.data
        if (statsRes.success) this.stats = statsRes.data
        this.today = todayStr()
      } catch (e) {
        logger.error('加载训练数据失败', e)
        this.notify('error', '加载失败', '请检查网络后重试')
      } finally {
        this.loading = false
      }
    },

    handleDayBoundary() {
      if (this.today !== todayStr()) this.refresh()
    },
    handleVisibility() {
      if (document.visibilityState === 'visible') this.handleDayBoundary()
    },

    // ---------- 计划 ----------
    openCreateModal() {
      this.editingPlan = null
      this.planForm = emptyPlanForm()
      this.showPlanModal = true
    },
    openEditModal(plan) {
      this.editingPlan = plan
      this.planForm = {
        title: plan.title,
        goalType: plan.goalType,
        goalTarget: plan.goalTarget,
        startDate: plan.startDate,
        endDate: plan.endDate,
        weeklyTimes: plan.weeklyTimes,
        weeklyMinutes: plan.weeklyMinutes
      }
      this.showPlanModal = true
    },
    async submitPlan() {
      // 前端预校验，错误提示与 store 保持一致
      const f = this.planForm
      if (!f.title) return this.notify('warning', '请填写计划名称', '名称长度为 1-30 字')
      if (!(Number(f.goalTarget) > 0)) return this.notify('warning', '请填写目标值', '需为大于 0 的数字')
      if (!f.startDate || !f.endDate) return this.notify('warning', '请选择计划周期', '开始和结束日期必选')
      if (f.endDate < f.startDate) return this.notify('warning', '日期不合法', '结束日期不能早于开始日期')

      this.planSubmitting = true
      try {
        const res = this.editingPlan
          ? await api.updateTrainingPlan(this.editingPlan.id, { ...f })
          : await api.createTrainingPlan({ ...f })
        if (res && res.success === false) throw new Error(res.error)
        this.showPlanModal = false
        this.notify('success', this.editingPlan ? '计划已更新' : '计划已创建', '开始按目标推进训练吧')
        await this.refresh()
      } catch (e) {
        logger.warn('保存训练计划失败', e)
        this.notify('error', this.editingPlan ? '更新失败' : '创建失败', e.message || '请稍后重试')
      } finally {
        this.planSubmitting = false
      }
    },
    openDeleteModal(plan) {
      this.deleteTarget = plan
      this.showDeleteModal = true
    },
    async confirmDelete() {
      if (!this.deleteTarget) return
      this.deleteSubmitting = true
      try {
        const res = await api.deleteTrainingPlan(this.deleteTarget.id)
        if (res && res.success === false) throw new Error(res.error)
        this.showDeleteModal = false
        if (this.expandedPlan === this.deleteTarget.id) this.expandedPlan = null
        this.notify('success', '计划已删除', '该计划及其打卡记录已移除')
        await this.refresh()
      } catch (e) {
        this.notify('error', '删除失败', e.message || '请稍后重试')
      } finally {
        this.deleteSubmitting = false
      }
    },

    // ---------- 打卡 ----------
    openCheckinModal(plan) {
      this.checkinTarget = plan
      this.checkinForm = emptyCheckinForm()
      this.checkinRetrying = false
      this.checkinRetryCount = 0
      this.showCheckinModal = true
    },
    async submitCheckin() {
      if (this.submittingCheckin) return
      const f = this.checkinForm
      if (!f.date) return this.notify('warning', '请选择训练日期', '不能为未来日期打卡')
      if (f.date > todayStr()) return this.notify('warning', '日期不合法', '不能为未来日期打卡')
      if (!(Number(f.duration) > 0)) return this.notify('warning', '请填写训练时长', '时长需为大于 0 的分钟数')
      if (!f.content) return this.notify('warning', '请选择训练内容', '选择一项今天练习的内容')

      this.submittingCheckin = true
      this.checkinRetrying = false
      this.checkinRetryCount = 0
      // 同一轮提交共用幂等键：无论内部重试多少次，服务端只产生一条记录
      const clientRequestId = 'R' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
      try {
        const res = await api.createCheckin({
          planId: this.checkinTarget.id,
          date: f.date,
          duration: Number(f.duration),
          content: f.content,
          note: f.note,
          clientRequestId
        }, {
          retries: 3,
          baseDelay: 300,
          onRetry: ({ attempt }) => {
            this.checkinRetrying = true
            this.checkinRetryCount = attempt
          }
        })
        if (res && res.success === false) throw new Error(res.error)
        this.showCheckinModal = false
        this.notify('success', '打卡成功', `${f.date} ${f.content} ${f.duration} 分钟`)
        await this.refresh()
      } catch (e) {
        logger.warn('打卡失败', e)
        const title = e.errorCode === 'DUPLICATE_CHECKIN' ? '今日已打卡'
          : e.errorCode === 'FUTURE_DATE' ? '不能为未来日期打卡'
          : e.errorCode === 'GOAL_CONFLICT' ? '目标冲突'
          : '打卡失败'
        this.notify('error', title, e.message || '多次重试仍失败，请稍后再试')
      } finally {
        this.submittingCheckin = false
        this.checkinRetrying = false
      }
    },
    async undoCheckin(plan, checkin) {
      try {
        const res = await api.undoCheckin({ planId: plan.id, date: checkin.date })
        if (res && res.success === false) throw new Error(res.error)
        this.notify('success', '已撤销今日打卡', '可以重新提交')
        await this.refresh()
      } catch (e) {
        this.notify('error', '撤销失败', e.message || '请稍后重试')
      }
    },

    toggleHistory(planId) {
      this.expandedPlan = this.expandedPlan === planId ? null : planId
    },
    notify(type, title, message) {
      this.toastType = type
      this.toastTitle = title
      this.toastMessage = message
      this.showToast = true
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
  max-width: 1000px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin-bottom: 1.5rem;
  gap: 1rem;
  flex-wrap: wrap;
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
  background: var(--gradient-1);
  color: var(--bg-dark);
  border: none;
  border-radius: 12px;
  padding: 0.75rem 1.4rem;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.btn-create:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px var(--primary-glow);
}

.btn-create.lg {
  padding: 0.85rem 1.8rem;
  font-size: 1rem;
  margin-top: 1rem;
}

.btn-create .plus {
  font-size: 1.1rem;
  font-weight: 700;
}

/* 汇总 */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1rem;
  margin-bottom: 1.25rem;
}

.stat-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 1.25rem 1.4rem;
  display: flex;
  align-items: center;
  gap: 0.9rem;
}

.stat-icon {
  font-size: 1.6rem;
}

.stat-text {
  display: flex;
  flex-direction: column;
}

.stat-value {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 1.5rem;
  font-weight: 700;
  line-height: 1.1;
}

.stat-card.ongoing .stat-value {
  color: #ff9f43;
}

.stat-card.completed .stat-value {
  color: var(--primary);
}

.stat-card.streak .stat-value {
  color: #4facfe;
}

.stat-label {
  font-size: 0.8rem;
  color: var(--text-secondary);
  margin-top: 0.2rem;
}

.today-banner {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  background: rgba(255, 159, 67, 0.08);
  border: 1px solid rgba(255, 159, 67, 0.25);
  border-radius: 12px;
  padding: 0.8rem 1.2rem;
  font-size: 0.9rem;
  margin-bottom: 1.75rem;
}

.today-banner.done {
  background: rgba(0, 217, 165, 0.08);
  border-color: rgba(0, 217, 165, 0.25);
}

.banner-icon {
  font-size: 1.15rem;
}

.section-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 0.5rem 0 1rem;
}

.section-head h2 {
  font-size: 1.2rem;
  font-weight: 600;
}

.history-count {
  font-size: 0.85rem;
  color: var(--text-secondary);
}

/* 计划卡片 */
.plan-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.plan-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-left: 4px solid #4facfe;
  border-radius: 18px;
  padding: 1.5rem;
  transition: all 0.3s;
}

.plan-card.ongoing {
  border-left-color: var(--primary);
}

.plan-card.completed {
  border-left-color: #6c757d;
}

.plan-card:hover {
  border-color: rgba(255, 255, 255, 0.15);
}

.plan-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 1.1rem;
}

.plan-title-wrap {
  display: flex;
  align-items: center;
  gap: 0.8rem;
}

.plan-goal-icon {
  font-size: 1.6rem;
}

.plan-title {
  font-size: 1.1rem;
  font-weight: 600;
  margin-bottom: 0.25rem;
}

.plan-dates {
  font-size: 0.82rem;
  color: var(--text-secondary);
}

.plan-status {
  padding: 0.35rem 0.85rem;
  border-radius: 20px;
  font-size: 0.75rem;
  font-weight: 600;
  white-space: nowrap;
}

.plan-status.info {
  background: rgba(79, 172, 254, 0.15);
  color: #4facfe;
}

.plan-status.primary {
  background: rgba(0, 217, 165, 0.15);
  color: var(--primary);
}

.plan-status.success {
  background: rgba(108, 117, 125, 0.15);
  color: #6c757d;
}

.progress-block {
  margin-bottom: 1.1rem;
}

.progress-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.85rem;
  margin-bottom: 0.5rem;
  gap: 1rem;
  flex-wrap: wrap;
}

.progress-goal {
  color: var(--text-secondary);
}

.progress-num {
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 600;
}

.progress-num.done {
  color: var(--primary);
}

.progress-bar {
  height: 8px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 0.6rem;
}

.progress-fill {
  height: 100%;
  background: var(--gradient-1);
  border-radius: 6px;
  transition: width 0.5s ease;
}

.plan-card.completed .progress-fill {
  background: linear-gradient(135deg, #6c757d, #495057);
}

.plan-sub-meta {
  display: flex;
  gap: 1.2rem;
  flex-wrap: wrap;
  font-size: 0.8rem;
  color: var(--text-muted);
}

.plan-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border);
  flex-wrap: wrap;
}

.action-group {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.action-btn {
  padding: 0.55rem 1.15rem;
  border-radius: 10px;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.3s;
  border: 1px solid transparent;
}

.action-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.action-btn.primary {
  background: var(--gradient-1);
  color: var(--bg-dark);
  font-weight: 600;
}

.action-btn.primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px var(--primary-glow);
}

.action-btn.default {
  background: rgba(255, 255, 255, 0.05);
  border-color: var(--border);
  color: var(--text-primary);
}

.action-btn.default:hover {
  background: rgba(255, 255, 255, 0.1);
}

.action-btn.danger {
  background: rgba(255, 107, 107, 0.1);
  border-color: rgba(255, 107, 107, 0.3);
  color: #ff6b6b;
}

.action-btn.danger:hover {
  background: rgba(255, 107, 107, 0.2);
}

.checked-tip {
  font-size: 0.85rem;
  color: var(--primary);
  font-weight: 500;
}

.checked-tip.muted {
  color: var(--text-muted);
}

/* 计划内打卡记录 */
.plan-history {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px dashed var(--border);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.checkin-row {
  display: flex;
  align-items: center;
  gap: 1rem;
  font-size: 0.85rem;
  padding: 0.55rem 0.8rem;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 10px;
  flex-wrap: wrap;
}

.ci-date {
  font-family: 'Space Grotesk', sans-serif;
  color: var(--primary);
  min-width: 92px;
}

.ci-content {
  min-width: 100px;
}

.ci-duration {
  color: var(--text-secondary);
}

.ci-note {
  color: var(--text-muted);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 120px;
}

.ci-undo {
  margin-left: auto;
  background: transparent;
  border: none;
  color: #ff6b6b;
  font-size: 0.8rem;
  cursor: pointer;
}

.mini-empty {
  font-size: 0.85rem;
  color: var(--text-muted);
  padding: 0.4rem 0;
}

/* 历史区 */
.history-section {
  margin-top: 2.5rem;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.history-item {
  display: flex;
  align-items: center;
  gap: 1.2rem;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 0.9rem 1.25rem;
}

.hi-date {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 52px;
}

.hi-day {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 1.4rem;
  font-weight: 700;
  line-height: 1;
  color: var(--primary);
}

.hi-ym {
  font-size: 0.72rem;
  color: var(--text-muted);
}

.hi-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}

.hi-plan {
  font-size: 0.92rem;
  font-weight: 500;
}

.hi-content {
  font-size: 0.8rem;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hi-duration {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 0.9rem;
  color: var(--text-secondary);
}

/* 空态 */
.empty-state {
  text-align: center;
  padding: 3.5rem 2rem;
  background: var(--bg-card);
  border: 1px dashed var(--border);
  border-radius: 20px;
}

.empty-icon {
  font-size: 3.5rem;
  margin-bottom: 1rem;
  opacity: 0.6;
}

.empty-state h3 {
  font-size: 1.2rem;
  margin-bottom: 0.5rem;
}

.empty-state p {
  color: var(--text-secondary);
  font-size: 0.9rem;
}

/* 表单 */
.plan-form,
.checkin-form {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}

.form-row {
  display: flex;
  gap: 1rem;
}

.form-row .form-group {
  flex: 1;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.form-group label {
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.form-group input,
.form-group textarea {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0.7rem 0.9rem;
  color-scheme: dark;
  color: var(--text-primary);
  font-size: 0.9rem;
  font-family: inherit;
  width: 100%;
}

.form-group textarea {
  resize: vertical;
}

.form-group input:focus,
.form-group textarea:focus {
  outline: none;
  border-color: var(--primary);
}

.field-hint {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.goal-types,
.content-chips {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.goal-chip,
.content-chip {
  padding: 0.5rem 0.9rem;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  border-radius: 20px;
  font-size: 0.83rem;
  cursor: pointer;
  transition: all 0.25s;
}

.goal-chip:hover,
.content-chip:hover {
  border-color: var(--primary);
  color: var(--text-primary);
}

.goal-chip.active,
.content-chip.active {
  background: rgba(0, 217, 165, 0.15);
  border-color: rgba(0, 217, 165, 0.4);
  color: var(--primary);
}

.retry-tip {
  font-size: 0.85rem;
  color: #ffc107;
}

@media (max-width: 768px) {
  .training-page {
    padding: 1rem 1.5rem 3rem;
  }

  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .form-row {
    flex-direction: column;
  }

  .plan-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .action-group {
    justify-content: space-between;
  }
}
</style>
