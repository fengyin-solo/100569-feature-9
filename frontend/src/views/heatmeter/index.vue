<template>
  <section class="page" data-module="heatmeter">
    <header class="page-head">
      <div>
        <h2>热计量抄表管理</h2>
        <p class="page-desc">维护热计量抄表记录，围绕抄表编号、计量表号、用户名称、累计热量做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记热计量抄表记录</button>
        <button class="btn" type="button" @click="exportRows">导出热计量抄表清单</button>
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
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
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
          <td :colspan="columns.length + 2" class="empty-state">暂无热计量抄表数据，可先登记热计量抄表记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条热计量抄表记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <section class="review-list">
      <header class="review-head">
        <h3>巡检问题整改待核对清单</h3>
        <span class="review-desc">来源：站点巡检按整改期限分册出包结果，随包落入抄表侧；待核对 {{ pendingReviews.length }} 条，已核对 {{ checkedReviews.length }} 条。</span>
      </header>
      <table class="data-table">
        <thead>
          <tr>
            <th>核对编号</th>
            <th>来源批次</th>
            <th>巡检编号</th>
            <th>巡检站点</th>
            <th>巡检路线</th>
            <th>问题数</th>
            <th>整改期限</th>
            <th>期限段/区间</th>
            <th>分册</th>
            <th>核对状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in reviewRows" :key="item.id">
            <td>{{ item.reviewNo }}</td>
            <td>{{ item.batchNo }}</td>
            <td>{{ item.patrolNo }}</td>
            <td>{{ item.station }}</td>
            <td>{{ item.route }}</td>
            <td>{{ item.issueCount }}</td>
            <td>{{ item.deadline }}</td>
            <td>{{ item.segmentName }}<br /><span class="range-hint">{{ item.rangeLabel }}</span></td>
            <td>第{{ item.bookletNo }}册</td>
            <td>{{ item.status }}</td>
            <td class="row-actions">
              <button
                v-if="item.status !== '已核对'"
                class="link"
                type="button"
                @click="checkReview(item.id)"
              >
                确认核对
              </button>
              <span v-else class="range-hint">已随 {{ item.batchNo }} 登记</span>
            </td>
          </tr>
          <tr v-if="!reviewRows.length">
            <td colspan="11" class="empty-state">巡检分册尚未出包，暂无待核对条目；重复提交出包不会重复登记</td>
          </tr>
        </tbody>
      </table>
    </section>
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
import { confirmPatrolReview, listPatrolReviews } from '@/api/patrol-pack'
import type { EntryRow, PatrolReviewItem } from '@/data/types'

const meta = moduleMeta('heatmeter')
const columns = ["抄表编号", "计量表号", "用户名称", "累计热量", "抄表方式", "抄表日期", "结算周期", "抄表状态"]
const actions = ["提交抄表", "确认核对", "标记异常"]
const statuses = ["待抄表", "抄表中", "已核对", "抄表异常"]
const stats = [{"label": "待抄表用户", "value": 0}, {"label": "已核对用户", "value": 0}, {"label": "异常表数", "value": 0}]

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

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '热计量抄表记录登记入口尚未接入审批流'
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
    errorMessage.value = error instanceof Error ? error.message : '热计量抄表列表读取失败'
  }
}

// 巡检分册结果落到抄表侧的待核对清单：按入册时间倒序展示。
const reviewRows = ref<PatrolReviewItem[]>([])
const pendingReviews = computed(() => reviewRows.value.filter((item) => item.status !== '已核对'))
const checkedReviews = computed(() => reviewRows.value.filter((item) => item.status === '已核对'))

function reloadReviews() {
  reviewRows.value = listPatrolReviews().sort((a, b) => b.createdAt - a.createdAt || b.id - a.id)
}

function checkReview(id: number) {
  const result = confirmPatrolReview(id)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  errorMessage.value = ''
  reloadReviews()
}

onMounted(() => {
  reload()
  reloadReviews()
})
</script>

<style scoped>
.review-list {
  margin-top: 18px;
}
.review-head {
  margin-bottom: 8px;
}
.review-head h3 {
  font-size: 15px;
  margin: 0 0 4px;
}
.review-desc {
  font-size: 12px;
  color: var(--muted);
}
.range-hint {
  font-size: 12px;
  color: var(--muted);
}
</style>
