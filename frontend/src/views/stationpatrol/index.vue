<template>
  <section class="page" data-module="stationpatrol">
    <header class="page-head">
      <div>
        <h2>站点巡检管理</h2>
        <p class="page-desc">巡检按巡检路线分片；问题上报后按整改期限分册打包下发各班组，整改期限由片区负责人核定，越级操作一律挡回。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openPack">按整改期限分册打包</button>
        <button class="btn" type="button" @click="exportRows">导出巡检整表</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item role-tag">当前岗位：
        <select v-model="store.role" class="role-select">
          <option v-for="role in ROLES" :key="role" :value="role">{{ role }}</option>
        </select>
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column" :class="{ 'cell-warn': column === '整改期限' && !deadlineText(row) }">
            {{ column === '整改期限' ? (deadlineText(row) || '待片区负责人核定') : (row[column] ?? '—') }}
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in rowActions(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无站点巡检数据，可先登记巡检记录</td>
        </tr>
      </tbody>
    </table>

    <section v-if="batches.length" class="batch-list">
      <h3>已出包批次（重复提交只记一次，可重新下载原分册）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>批次号</th>
            <th>打包基准日</th>
            <th>分册数</th>
            <th>下发记录数</th>
            <th>问题总数</th>
            <th>打包人</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="batch in batches" :key="batch.id">
            <td>{{ batch.batchNo }}</td>
            <td>{{ batch.packDate }}</td>
            <td>{{ batch.bookletCount }}</td>
            <td>{{ batch.recordCount }}</td>
            <td>{{ batch.reviewCount }}</td>
            <td>{{ batch.operator }}</td>
            <td><button class="link" type="button" @click="redownload(batch.id)">重新下载分册</button></td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条站点巡检记录</span>
      <span v-if="message" :class="messageError ? 'error-text' : 'ok-text'">{{ message }}</span>
    </footer>

    <!-- 片区负责人核定整改期限 -->
    <div v-if="approveTarget" class="modal-mask" @click.self="closeApprove">
      <div class="modal-card">
        <h3>核定整改期限（片区负责人）</h3>
        <p class="modal-desc">
          巡检编号 {{ approveTarget['巡检编号'] }} · 站点 {{ approveTarget['巡检站点'] }} · 路线
          {{ approveTarget['巡检路线'] }}
        </p>
        <div class="form-grid">
          <label class="filter-item">
            <span>发现问题数</span>
            <input v-model.number="approveForm.issueCount" type="number" min="1" step="1" />
          </label>
          <label class="filter-item">
            <span>整改期限（yyyy-MM-dd）</span>
            <input v-model="approveForm.deadline" type="date" />
          </label>
        </div>
        <p v-if="approveError" class="error-text">{{ approveError }}</p>
        <div class="modal-actions">
          <button class="btn" type="button" @click="closeApprove">取消</button>
          <button class="btn primary" type="button" @click="submitApprove">核定并上报</button>
        </div>
      </div>
    </div>

    <!-- 分册打包预览 / 出包 -->
    <div v-if="packOpen" class="modal-mask" @click.self="closePack">
      <div class="modal-card modal-wide">
        <h3>按整改期限分册打包</h3>
        <div class="form-inline">
          <label class="filter-item">
            <span>打包基准日</span>
            <input v-model="packDate" type="date" />
          </label>
          <button class="btn" type="button" @click="refreshPreview">生成预览</button>
          <span class="modal-tip">期限区间按基准日换算，空段不生成空文件，只在分册说明里附注。</span>
        </div>

        <div v-if="preview" class="preview-body">
          <h4>分册一览（共 {{ preview.booklets.length }} 册，{{ preview.eligible.length }} 条记录）</h4>
          <table class="data-table">
            <thead>
              <tr>
                <th>册号</th>
                <th>期限段</th>
                <th>整改期限区间</th>
                <th>路线数</th>
                <th>记录数</th>
                <th>发现问题数</th>
                <th>册文件名</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="booklet in preview.booklets" :key="booklet.no">
                <td>第{{ booklet.no }}册</td>
                <td>{{ booklet.segmentName }}</td>
                <td>{{ booklet.rangeLabel }}</td>
                <td>{{ booklet.routeCount }}</td>
                <td>{{ booklet.rows.length }}</td>
                <td>{{ booklet.issueCount }}</td>
                <td class="file-name">{{ booklet.fileName }}</td>
              </tr>
              <tr v-for="segment in preview.emptySegments" :key="segment.key" class="empty-segment-row">
                <td>—</td>
                <td>{{ segment.name }}</td>
                <td>{{ rangeOf(segment) }}</td>
                <td>0</td>
                <td>0</td>
                <td>0</td>
                <td class="empty-note">当期无内容，不生成空册，分册说明中附注</td>
              </tr>
            </tbody>
          </table>

          <div v-if="preview.blocked.length" class="blocked-box">
            <h4>以下 {{ preview.blocked.length }} 条已先挡下，处理完才能出包</h4>
            <table class="data-table">
              <thead>
                <tr>
                  <th>巡检编号</th>
                  <th>巡检站点</th>
                  <th>巡检路线</th>
                  <th>挡回原因</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in preview.blocked" :key="item.id">
                  <td>{{ item.patrolNo }}</td>
                  <td>{{ item.station }}</td>
                  <td>{{ item.route }}</td>
                  <td class="error-text">{{ item.reason }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <p v-if="packMessage" :class="packError ? 'error-text' : 'ok-text'">{{ packMessage }}</p>
        <div class="modal-actions">
          <button class="btn" type="button" @click="closePack">关闭</button>
          <button class="btn primary" type="button" :disabled="!canSubmit" @click="submit">
            确认出包并下载下发
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { downloadEntries, listEntries } from '@/api/local-service'
import {
  approvePatrolDeadline,
  buildPackPreview,
  downloadFiles,
  listPackBatches,
  patrolDeadline,
  redownloadBatch,
  runPatrolAction,
  segmentRangeLabel as segmentRangeLabelOf,
  submitPack,
  todayText,
} from '@/api/patrol-pack'
import { listRows } from '@/data/local-store'
import type { DeadlineSegment, EntryRow, PackBatch, PackPreview } from '@/data/types'
import { ROLES, useSessionStore } from '@/stores/session'

const store = useSessionStore()

const columns = ['巡检编号', '巡检站点', '巡检路线', '巡检人', '巡检日期', '发现问题数', '整改期限']
const statuses = ['待巡检', '巡检中', '已上报', '已整改']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const message = ref('')
const messageError = ref(false)
const filters = ref<Record<string, string>>({})
const filterFields = ['巡检编号', '巡检站点', '巡检路线']

const batches = ref<PackBatch[]>([])

const stats = computed(() => {
  const all = listRows('stationpatrol')
  const pendingIssues = all
    .filter((row) => ['巡检中', '已上报'].includes(String(row.status)))
    .reduce((sum, row) => sum + Number(row['发现问题数'] || 0), 0)
  const month = new Date().getMonth()
  const monthCount = all.filter((row) => {
    const value = String(row['巡检日期'] ?? '')
    const date = new Date(value)
    return !Number.isNaN(date.getTime()) && date.getMonth() === month
  }).length
  return [
    { label: '待巡检站点', value: all.filter((row) => String(row.status) === '待巡检').length },
    { label: '待整改问题', value: pendingIssues },
    { label: '本月巡检次数', value: monthCount },
  ]
})

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function deadlineText(row: EntryRow): string {
  return patrolDeadline(row)
}

// 兼容既有做法：允许在列表里补报；正常路径是负责人核定即上报。
function rowActions(row: EntryRow): string[] {
  switch (String(row.status)) {
    case '待巡检':
      return ['提交巡检']
    case '巡检中':
      return ['核定期限并上报', '上报问题']
    case '已上报':
      return ['确认整改']
    default:
      return []
  }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries('stationpatrol')
}

function flash(text: string, error = false) {
  message.value = text
  messageError.value = error
}

function runAction(action: string, row: EntryRow) {
  message.value = ''
  if (action === '核定期限并上报') {
    openApprove(row)
    return
  }
  if (action === '上报问题' && !store.canApproveDeadline) {
    flash('整改期限须由片区负责人核定，巡检员无权上报，越级操作已挡回', true)
    return
  }
  const result = runPatrolAction(Number(row.id), action)
  if (!result.ok) {
    flash(result.message, true)
    return
  }
  flash(result.message)
  reload()
}

function reload() {
  message.value = ''
  try {
    const payload = listEntries('stationpatrol', filters.value)
    rows.value = payload.items
    total.value = payload.total
    batches.value = listPackBatches()
  } catch (error) {
    flash(error instanceof Error ? error.message : '站点巡检列表读取失败', true)
  }
}

// ---- 负责人核定弹层 ----
const approveTarget = ref<EntryRow | null>(null)
const approveError = ref('')
const approveForm = reactive({ issueCount: 1, deadline: '' })

function openApprove(row: EntryRow) {
  if (!store.canApproveDeadline) {
    flash(`整改期限由片区负责人核定，当前岗位「${store.role}」无权办理，越级操作已挡回`, true)
    return
  }
  approveTarget.value = row
  approveForm.issueCount = Number(row['发现问题数']) > 0 ? Number(row['发现问题数']) : 1
  approveForm.deadline = patrolDeadline(row) || ''
  approveError.value = ''
}

function closeApprove() {
  approveTarget.value = null
  approveError.value = ''
}

function submitApprove() {
  if (!approveTarget.value) {
    return
  }
  const result = approvePatrolDeadline({
    id: Number(approveTarget.value.id),
    deadline: approveForm.deadline,
    issueCount: approveForm.issueCount,
    operator: store.operator,
    role: store.role,
  })
  if (!result.ok) {
    approveError.value = result.message
    return
  }
  closeApprove()
  flash(result.message)
  reload()
}

// ---- 分册打包弹层 ----
const packOpen = ref(false)
const packDate = ref(todayText())
const preview = ref<PackPreview | null>(null)
const packMessage = ref('')
const packError = ref(false)

const canSubmit = computed(() => !!preview.value && preview.value.blocked.length === 0 && preview.value.eligible.length > 0)

function openPack() {
  packOpen.value = true
  packDate.value = todayText()
  packMessage.value = ''
  packError.value = false
  refreshPreview()
}

function closePack() {
  packOpen.value = false
}

function refreshPreview() {
  packMessage.value = ''
  packError.value = false
  try {
    preview.value = buildPackPreview(packDate.value || todayText())
    if (preview.value.blocked.length > 0) {
      packMessage.value = `有 ${preview.value.blocked.length} 条记录被挡下，当前无法出包`
      packError.value = true
    }
  } catch (error) {
    packMessage.value = error instanceof Error ? error.message : '分册预览生成失败'
    packError.value = true
    preview.value = null
  }
}

function rangeOf(segment: DeadlineSegment): string {
  if (!preview.value) {
    return segment.rangeLabel
  }
  return segmentRangeLabelOf(segment, preview.value.packDate)
}

function submit() {
  const result = submitPack(packDate.value || todayText(), `${store.role}·${store.operator}`)
  if (!result.ok) {
    packMessage.value = result.message
    packError.value = true
    preview.value = result.preview
    return
  }
  downloadFiles(result.files)
  packMessage.value = result.duplicated
    ? `该批内容已出过包（批次 ${result.batch.batchNo}），重复提交只记一次，已重新下载原分册，不重复进入抄表待核对清单`
    : `出包成功：批次 ${result.batch.batchNo}，共 ${result.batch.bookletCount} 册，已逐册下载；分册结果已落入抄表侧待核对清单`
  packError.value = false
  reload()
  preview.value = buildPackPreview(packDate.value || todayText())
}

function redownload(batchId: string) {
  const result = redownloadBatch(batchId)
  flash(result.message, !result.ok)
}

onMounted(reload)
</script>

<style scoped>
.role-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.role-select {
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 2px 4px;
  font-size: 12px;
}
.cell-warn {
  color: #b45309;
}
.ok-text {
  color: #15803d;
}
.batch-list {
  margin-top: 16px;
}
.batch-list h3 {
  font-size: 14px;
  margin: 8px 0;
}
.file-name {
  font-size: 12px;
  color: var(--muted);
}
.empty-note {
  color: var(--muted);
  font-size: 12px;
}
.empty-segment-row td {
  background: #fafbfc;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.modal-card {
  background: #fff;
  border-radius: 10px;
  padding: 18px 20px;
  width: 460px;
  max-height: 86vh;
  overflow: auto;
}
.modal-wide {
  width: 880px;
}
.modal-card h3 {
  margin: 0 0 8px;
  font-size: 16px;
}
.modal-desc {
  color: var(--muted);
  font-size: 13px;
  margin: 0 0 12px;
}
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.form-inline {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.modal-tip {
  font-size: 12px;
  color: var(--muted);
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}
.preview-body h4 {
  font-size: 13px;
  margin: 12px 0 6px;
}
.blocked-box {
  margin-top: 12px;
  border-top: 1px dashed var(--border);
  padding-top: 8px;
}
</style>
