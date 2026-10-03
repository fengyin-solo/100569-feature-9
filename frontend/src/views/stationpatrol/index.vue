<template>
  <section class="page" data-module="stationpatrol">
    <header class="page-head">
      <div>
        <h2>站点巡检管理</h2>
        <p class="page-desc">维护巡检记录，围绕巡检编号、巡检站点、巡检路线、巡检人做登记、筛选与状态流转；巡检问题按整改期限分册打包下发班组。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记巡检记录</button>
        <button class="btn" type="button" @click="exportRows">导出站点巡检清单</button>
      </div>
    </header>

    <div class="identity-bar panel">
      <div class="identity-main">
        <span class="panel-title">当前操作身份</span>
        <select v-model="operatorId" class="identity-select" @change="onIdentityChange">
          <option v-for="item in store.operators" :key="item.id" :value="item.id">
            {{ item.name }}（{{ item.role }}<template v-if="item.role !== '值班员'">·{{ item.area }}</template>）
          </option>
        </select>
        <span class="identity-hint">
          巡检按巡检路线分片，整改期限由片区负责人核定；非本片区负责人或跨片核定都会被挡回。
        </span>
      </div>
      <span v-if="store.current.role === '片区负责人'" class="tag tag-ok">
        {{ store.current.area }}负责人，可核定并出包
      </span>
      <span v-else class="tag tag-warn">当前身份无出包权限</span>
    </div>

    <div class="panel package-panel">
      <div class="panel-head">
        <span class="panel-title">按整改期限分册打包（下发班组）</span>
        <span class="panel-hint">
          期限区间按周连续排开，区间参数或记录整改期限缺失会先挡下；某个期限段当期没内容只在清单里说明，不出空文件。
        </span>
      </div>
      <form class="package-form" @submit.prevent="submitPackage">
        <label class="filter-item">
          <span>期限区间起始周一</span>
          <input v-model="anchorDate" type="date" />
        </label>
        <label class="filter-item">
          <span>分册周数（册数）</span>
          <input v-model.number="weeks" type="number" min="1" step="1" />
        </label>
        <button class="btn primary" type="submit">核定期限并分册打包下载</button>
      </form>
      <p v-if="hasFilters" class="panel-note">
        当前带着列表筛选条件出包，只入册筛选命中且属于{{ store.current.area }}的路线；筛到外片区路线会被越级挡回。
      </p>
      <ul v-if="previewSegments.length" class="segment-preview">
        <li v-for="(segment, index) in previewSegments" :key="segment.start">
          第{{ index + 1 }}册：{{ segment.start }} 至 {{ segment.end }}
        </li>
      </ul>
      <span v-if="packageMessage" :class="packageOk ? 'ok-text' : 'error-text'" class="package-message">
        {{ packageMessage }}
      </span>

      <table v-if="packages.length" class="data-table package-history">
        <thead>
          <tr>
            <th>分册包编号</th>
            <th>片区/班组</th>
            <th>期限区间</th>
            <th>册数</th>
            <th>待整改问题</th>
            <th>出包时间</th>
            <th>核对状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="pkg in packages" :key="pkg.id">
            <td>{{ pkg.packageNo }}</td>
            <td>{{ pkg.area }} / {{ pkg.crew }}</td>
            <td>{{ pkg.rangeStart }} 至 {{ pkg.rangeEnd }}</td>
            <td>{{ pkg.files.length }}<span class="muted-text">（共{{ pkg.weeks }}段）</span></td>
            <td>{{ pkg.issueCount }}</td>
            <td>{{ pkg.createdAt }}</td>
            <td>
              <span :class="pkg.checked ? 'tag tag-muted' : 'tag tag-warn'">
                {{ pkg.checked ? '抄表已核对' : '抄表待核对' }}
              </span>
            </td>
            <td class="row-actions">
              <button class="link" type="button" @click="downloadAgain(pkg.id)">重新下载</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

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
          <td v-for="column in columns" :key="column">
            <template v-if="column === '巡检路线'">
              {{ row[column] ?? '—' }}
              <span v-if="sliceOf(row)" class="badge">{{ sliceOf(row)?.area }}</span>
              <span v-else class="badge badge-muted">未分片</span>
            </template>
            <template v-else>{{ row[column] ?? '—' }}</template>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
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

    <footer class="page-foot">
      <span>共 {{ total }} 条站点巡检记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  downloadPackage,
  listPatrolPackages,
  submitPatrolPackage,
} from '@/api/patrol-package'
import { ROUTE_BY_NAME } from '@/data/routes'
import type { EntryRow, PatrolPackageRecord } from '@/data/types'
import { useSessionStore } from '@/stores/session'
import { addDays, buildWeekSegments, isValidIsoDate, todayLocalIso, toIsoDate } from '@/utils/date'

const store = useSessionStore()

const meta = moduleMeta('stationpatrol')
const columns = ["巡检编号", "巡检站点", "巡检路线", "巡检人", "巡检日期", "发现问题数", "整改期限", "巡检状态"]
const actions = ["提交巡检", "确认整改", "上报问题"]
const statuses = ["待巡检", "巡检中", "已整改", "已上报"]
const stats = [{"label": "待巡检站点", "value": 0}, {"label": "待整改问题", "value": 0}, {"label": "本月巡检次数", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function sliceOf(row: EntryRow) {
  return ROUTE_BY_NAME.get(String(row['巡检路线'] ?? ''))
}

// 分册打包
const operatorId = ref(store.current.id)
const weeks = ref(4)
const todayIso = todayLocalIso()
const anchorDate = ref((() => {
  const now = new Date()
  const mondayOffset = -((now.getDay() + 6) % 7)
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset)
  let candidate = toIsoDate(new Date(Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate())))
  if (candidate < todayIso) {
    candidate = addDays(candidate, 7)
  }
  return candidate
})())
const packages = ref<PatrolPackageRecord[]>([])
const packageMessage = ref('')
const packageOk = ref(false)

const hasFilters = computed(() =>
  Object.values(filters.value).some((value) => value.trim() !== ''),
)

const previewSegments = computed(() => {
  if (!isValidIsoDate(anchorDate.value) || !Number.isInteger(weeks.value) || weeks.value < 1) {
    return []
  }
  try {
    return buildWeekSegments(weeks.value, anchorDate.value, todayIso)
  } catch {
    return []
  }
})

function onIdentityChange() {
  store.selectOperator(operatorId.value)
  packageMessage.value = ''
}

function submitPackage() {
  packageMessage.value = ''
  const result = submitPatrolPackage({
    weeks: weeks.value,
    anchorDate: anchorDate.value,
    operator: store.current,
    filters: { ...filters.value },
  })
  packageOk.value = result.ok
  packageMessage.value = result.message
  packages.value = listPatrolPackages()
}

function downloadAgain(id: number) {
  downloadPackage(id)
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '巡检记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '站点巡检列表读取失败'
  }
}

function refreshPackages() {
  packages.value = listPatrolPackages()
}

onMounted(() => {
  reload()
  refreshPackages()
})
</script>
