import { listRows, saveRows } from '@/data/local-store'
import {
  addPack,
  findBatchByFingerprint,
  listBatches,
  listReviews,
  markReviewChecked,
} from '@/data/patrol-store'
import type {
  DeadlineSegment,
  EntryRow,
  PackBatch,
  PackPreview,
  PatrolBlockedRow,
  PatrolBooklet,
  PatrolReviewItem,
} from '@/data/types'

// 巡检问题整改分册：纯前端实现，出包结果以多册 CSV 下载，并落入抄表侧待核对清单。

export const PATROL_KEY = 'stationpatrol'
const DEADLINE_FIELD = '整改期限'
const ISSUE_FIELD = '发现问题数'
const STATUS_REPORTED = '已上报'
const STATUS_INSPECTING = '巡检中'
const STATUS_PENDING = '待巡检'
// 巡检状态只许逐级往前走：待巡检 → 巡检中 → 已上报 → 已整改。
const STATUS_ORDER = ['待巡检', '巡检中', '已上报', '已整改']

// 片区负责人才核定得整改期限：身份不在名单里的（如巡检员）一律按越级挡回。
const APPROVER_ROLES = ['值班管理员', '片区负责人']

// 固定期限段：按打包基准日换算区间，顺序即册号顺序。
export const DEADLINE_SEGMENTS: DeadlineSegment[] = [
  { key: 'current', name: '当期到期', minDays: -Infinity, maxDays: 0, rangeLabel: '截至{base}（含当日，已到期）' },
  { key: 'within7', name: '7日内到期', minDays: 1, maxDays: 7, rangeLabel: '{d1} 至 {d7}' },
  { key: 'within15', name: '8至15日到期', minDays: 8, maxDays: 15, rangeLabel: '{d8} 至 {d15}' },
  { key: 'within30', name: '16至30日到期', minDays: 16, maxDays: 30, rangeLabel: '{d16} 至 {d30}' },
  { key: 'over30', name: '30日以上', minDays: 31, maxDays: Infinity, rangeLabel: '{d31} 起' },
]

// 列表与导出册子共用同一个取值口径，保证多处看到的整改期限对得上。
export function patrolDeadline(row: EntryRow): string {
  return String(row[DEADLINE_FIELD] ?? '').trim()
}

export function patrolIssueCount(row: EntryRow): number {
  const raw = Number(row[ISSUE_FIELD])
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0
}

export function todayText(): string {
  return formatDate(new Date())
}

export function formatDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// 严格校验 yyyy-MM-dd，且必须是日历上真实存在的日期。
export function parseDeadline(value: string): Date | null {
  const text = value.trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!match) {
    return null
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null
  }
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }
  return date
}

function addDays(base: Date, days: number): Date {
  const date = new Date(base.getFullYear(), base.getMonth(), base.getDate())
  date.setDate(date.getDate() + days)
  return date
}

function daysBetween(base: Date, target: Date): number {
  const a = new Date(base.getFullYear(), base.getMonth(), base.getDate())
  const b = new Date(target.getFullYear(), target.getMonth(), target.getDate())
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

export function segmentRangeLabel(segment: DeadlineSegment, baseText: string): string {
  const base = parseDeadline(baseText)
  if (!base) {
    return segment.rangeLabel
  }
  const map: Record<string, string> = {
    '{base}': baseText,
    '{d1}': formatDate(addDays(base, 1)),
    '{d7}': formatDate(addDays(base, 7)),
    '{d8}': formatDate(addDays(base, 8)),
    '{d15}': formatDate(addDays(base, 15)),
    '{d16}': formatDate(addDays(base, 16)),
    '{d30}': formatDate(addDays(base, 30)),
    '{d31}': formatDate(addDays(base, 31)),
  }
  return segment.rangeLabel.replace(/\{[^}]+\}/g, (token) => map[token] ?? token)
}

function segmentOf(deadline: Date, base: Date): DeadlineSegment {
  const days = daysBetween(base, deadline)
  return DEADLINE_SEGMENTS.find((segment) => days >= segment.minDays && days <= segment.maxDays) ?? DEADLINE_SEGMENTS[0]
}

function text(row: EntryRow, field: string): string {
  return String(row[field] ?? '').trim()
}

export type GuardResult = { ok: boolean; message: string }

// 巡检动作越级守卫：只允许在状态机上往前挪一格，回退、跳级、重复都挡回。
export function runPatrolAction(id: number, action: string): GuardResult {
  const target = ACTION_TARGETS[action]
  if (!target) {
    return { ok: false, message: `巡检记录没有登记「${action}」这个动作` }
  }
  const rows = listRows(PATROL_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的巡检记录` }
  }
  const current = String(rows[index].status)
  const currentIndex = STATUS_ORDER.indexOf(current)
  const targetIndex = STATUS_ORDER.indexOf(target)
  if (currentIndex < 0) {
    return { ok: false, message: `巡检记录当前状态「${current}」无法识别，请先核对数据` }
  }
  if (currentIndex === targetIndex) {
    return { ok: false, message: `巡检记录已经是「${target}」，不用重复操作` }
  }
  if (targetIndex !== currentIndex + 1) {
    const expected = STATUS_ORDER[currentIndex + 1]
    return {
      ok: false,
      message: `越级操作已挡回：当前「${current}」只能先办理「${expected}」，不能直接${action}到「${target}」`,
    }
  }
  if (action === '确认整改' && patrolIssueCount(rows[index]) > 0 && !patrolDeadline(rows[index])) {
    return { ok: false, message: '该记录的整改期限缺失，须先由片区负责人核定期限后再流转' }
  }
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== STATUS_ORDER[STATUS_ORDER.length - 1],
    abnormal: false,
    巡检状态: target,
  }
  const next = [...rows]
  next[index] = updated
  saveRows(PATROL_KEY, next)
  return { ok: true, message: `巡检记录已${action}，当前状态「${target}」` }
}

const ACTION_TARGETS: Record<string, string> = {
  提交巡检: '巡检中',
  上报问题: '已上报',
  确认整改: '已整改',
}

export type ApproveInput = {
  id: number
  deadline: string
  issueCount: number
  operator: string
  role: string
  remark?: string
}

// 整改期限由片区负责人核定：巡检员越级办理挡回；核定同时把问题数落实并上报。
export function approvePatrolDeadline(input: ApproveInput): GuardResult {
  if (!APPROVER_ROLES.includes(input.role)) {
    return { ok: false, message: `整改期限由片区负责人核定，「${input.role}」无权办理，越级操作已挡回` }
  }
  const rows = listRows(PATROL_KEY)
  const index = rows.findIndex((row) => Number(row.id) === input.id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${input.id} 的巡检记录` }
  }
  const row = rows[index]
  const current = String(row.status)
  if (current === STATUS_PENDING) {
    return { ok: false, message: '该记录还在「待巡检」，请先提交巡检后再核定整改期限' }
  }
  if (current !== STATUS_INSPECTING) {
    return { ok: false, message: `该记录当前为「${current}」，整改期限已核定过，不能重复核定` }
  }
  const deadline = input.deadline.trim()
  const parsed = parseDeadline(deadline)
  if (!parsed) {
    return { ok: false, message: '整改期限缺失或不是有效日期（格式须为 yyyy-MM-dd），已挡下，请重新核定' }
  }
  const patrolDate = parseDeadline(text(row, '巡检日期'))
  if (patrolDate && daysBetween(patrolDate, parsed) < 0) {
    return { ok: false, message: `整改期限（${deadline}）不能早于巡检日期（${text(row, '巡检日期')}）` }
  }
  const issueCount = Math.floor(Number(input.issueCount))
  if (!Number.isFinite(issueCount) || issueCount <= 0) {
    return { ok: false, message: '发现问题数须为大于 0 的整数；确无问题的记录无需上报分册' }
  }
  const updated: EntryRow = {
    ...row,
    status: STATUS_REPORTED,
    pending: true,
    abnormal: false,
    [ISSUE_FIELD]: issueCount,
    [DEADLINE_FIELD]: deadline,
    巡检状态: STATUS_REPORTED,
    期限核定人: input.operator,
    核定时间: todayText(),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(PATROL_KEY, next)
  return { ok: true, message: `整改期限已由${input.role}核定：${deadline}，问题 ${issueCount} 项，记录已上报` }
}

// 分册前的预校验：有问题的记录必须已上报且期限齐全有效，否则先挡下。
export function buildPackPreview(packDate: string): PackPreview {
  const base = parseDeadline(packDate) ?? new Date()
  const rows = listRows(PATROL_KEY)

  const eligible: EntryRow[] = []
  const blocked: PatrolBlockedRow[] = []

  for (const row of rows) {
    // 没有发现问题的记录不进入分册下发范围，直接跳过。
    if (patrolIssueCount(row) === 0) {
      continue
    }
    const status = String(row.status)
    if (status !== STATUS_REPORTED) {
      blocked.push({
        id: Number(row.id),
        patrolNo: text(row, '巡检编号'),
        station: text(row, '巡检站点'),
        route: text(row, '巡检路线'),
        reason:
          status === STATUS_INSPECTING
            ? '巡检中尚未上报，整改期限未由片区负责人核定'
            : `当前状态「${status}」，不在已上报待下发范围`,
      })
      continue
    }
    const deadlineText = patrolDeadline(row)
    if (!deadlineText) {
      blocked.push({
        id: Number(row.id),
        patrolNo: text(row, '巡检编号'),
        station: text(row, '巡检站点'),
        route: text(row, '巡检路线'),
        reason: '整改期限缺失，须先由片区负责人核定后才能分册',
      })
      continue
    }
    const deadline = parseDeadline(deadlineText)
    if (!deadline) {
      blocked.push({
        id: Number(row.id),
        patrolNo: text(row, '巡检编号'),
        station: text(row, '巡检站点'),
        route: text(row, '巡检路线'),
        reason: `整改期限「${deadlineText}」不是有效日期，无法归入期限区间`,
      })
      continue
    }
    eligible.push(row)
  }

  // 巡检按巡检路线分片：同一段内先按路线归并，再按巡检编号排序。
  const sorted = [...eligible].sort((a, b) => {
    const route = text(a, '巡检路线').localeCompare(text(b, '巡检路线'), 'zh-Hans-CN')
    return route !== 0 ? route : text(a, '巡检编号').localeCompare(text(b, '巡检编号'), 'zh-Hans-CN')
  })

  const grouped = new Map<string, EntryRow[]>()
  for (const row of sorted) {
    const key = segmentOf(parseDeadline(patrolDeadline(row)) as Date, base).key
    grouped.set(key, [...(grouped.get(key) ?? []), row])
  }

  const booklets: PatrolBooklet[] = []
  const emptySegments: DeadlineSegment[] = []
  let no = 0
  for (const segment of DEADLINE_SEGMENTS) {
    const segmentRows = grouped.get(segment.key) ?? []
    if (segmentRows.length === 0) {
      emptySegments.push(segment)
      continue
    }
    no += 1
    const rangeLabel = segmentRangeLabel(segment, formatDate(base))
    booklets.push({
      no,
      segmentKey: segment.key,
      segmentName: segment.name,
      rangeLabel,
      fileName: bookletFileName(no, segment, formatDate(base)),
      routeCount: new Set(segmentRows.map((row) => text(row, '巡检路线'))).size,
      issueCount: segmentRows.reduce((sum, row) => sum + patrolIssueCount(row), 0),
      rows: segmentRows,
    })
  }

  return { packDate: formatDate(base), eligible: sorted, blocked, booklets, emptySegments }
}

function bookletFileName(no: number, segment: DeadlineSegment, baseText: string): string {
  const base = parseDeadline(baseText) as Date
  const pad = String(no).padStart(2, '0')
  if (segment.key === 'current') {
    return `巡检问题整改分册-第${pad}册-${segment.name}-截至${baseText}.csv`
  }
  const start = addDays(base, segment.minDays)
  const end = Number.isFinite(segment.maxDays) ? addDays(base, segment.maxDays as number) : null
  const span = end ? `${formatDate(start)}-${formatDate(end)}` : `${formatDate(start)}起`
  return `巡检问题整改分册-第${pad}册-${segment.name}-${span}.csv`
}

function csvCell(value: string | number): string {
  const textValue = String(value ?? '')
  return /[",\n]/.test(textValue) ? `"${textValue.replace(/"/g, '""')}"` : textValue
}

function buildBookletCsv(booklet: PatrolBooklet, preview: PackPreview, batchNo: string): string {
  const lines: string[] = []
  lines.push(['巡检问题整改分册', `第${booklet.no}册（共${preview.booklets.length}册）`].map(csvCell).join(','))
  lines.push(['期限段', booklet.segmentName].map(csvCell).join(','))
  lines.push(['整改期限区间', booklet.rangeLabel].map(csvCell).join(','))
  lines.push(['打包基准日', preview.packDate].map(csvCell).join(','))
  lines.push(['打包批次', batchNo].map(csvCell).join(','))
  lines.push(['本册路线数', booklet.routeCount].map(csvCell).join(','))
  lines.push(['本册发现问题总数', booklet.issueCount].map(csvCell).join(','))
  lines.push('')
  lines.push(['巡检路线', '巡检编号', '巡检站点', '发现问题数', '整改期限'].map(csvCell).join(','))

  let route = ''
  for (const row of booklet.rows) {
    const rowRoute = text(row, '巡检路线')
    if (rowRoute !== route) {
      route = rowRoute
      lines.push([`【分片】${route}`].map(csvCell).join(','))
    }
    lines.push(
      [
        route,
        text(row, '巡检编号'),
        text(row, '巡检站点'),
        patrolIssueCount(row),
        patrolDeadline(row),
      ]
        .map(csvCell)
        .join(','),
    )
  }
  return `\uFEFF${lines.join('\r\n')}`
}

function buildReadmeCsv(preview: PackPreview, batch: PackBatch): string {
  const lines: string[] = []
  lines.push(['巡检问题整改分册说明'].map(csvCell).join(','))
  lines.push(['打包批次', batch.batchNo].map(csvCell).join(','))
  lines.push(['打包基准日', preview.packDate].map(csvCell).join(','))
  lines.push(['打包时间', new Date(batch.createdAt).toLocaleString('zh-CN')].map(csvCell).join(','))
  lines.push(['打包人', batch.operator].map(csvCell).join(','))
  lines.push(['分册数量', batch.bookletCount].map(csvCell).join(','))
  lines.push(['下发记录数', batch.recordCount].map(csvCell).join(','))
  lines.push(['问题总数', batch.reviewCount].map(csvCell).join(','))
  lines.push('')
  lines.push(['册号', '期限段', '整改期限区间', '路线数', '记录数', '发现问题数', '文件名'].map(csvCell).join(','))
  for (const booklet of batch.booklets) {
    lines.push(
      [
        `第${booklet.no}册`,
        booklet.segmentName,
        booklet.rangeLabel,
        booklet.routeCount,
        booklet.rows.length,
        booklet.issueCount,
        booklet.fileName,
      ]
        .map(csvCell)
        .join(','),
    )
  }
  for (const segment of batch.emptySegments) {
    const rangeLabel = segmentRangeLabel(segment, preview.packDate)
    lines.push(
      ['—', segment.name, rangeLabel, 0, 0, 0, `本期限段当期没有巡检问题需要下发，不生成空册，仅在此说明`]
        .map(csvCell)
        .join(','),
    )
  }
  lines.push('')
  lines.push(['说明', '巡检按巡检路线分片，整改期限由片区负责人核定；各册整改期限与巡检列表口径一致。'].map(csvCell).join(','))
  return `\uFEFF${lines.join('\r\n')}`
}

function readmeFileName(preview: PackPreview): string {
  return `巡检问题整改分册-分册说明-打包日${preview.packDate.replace(/-/g, '')}.csv`
}

export type PackFile = { filename: string; content: string }

// 出包：组装各册与分册说明；存在被挡下的记录时整批挡回，不产出任何册。
export function submitPack(packDate: string, operator: string):
  | { ok: true; batch: PackBatch; files: PackFile[]; duplicated: boolean }
  | { ok: false; message: string; preview: PackPreview } {
  const preview = buildPackPreview(packDate)
  if (preview.blocked.length > 0) {
    return {
      ok: false,
      message: `有 ${preview.blocked.length} 条发现问题的记录被挡下（期限缺失/未上报/期限非法），处理完再出包`,
      preview,
    }
  }
  if (preview.eligible.length === 0) {
    return { ok: false, message: '当期没有已上报且带整改期限的巡检问题可下发，无需出包', preview }
  }

  const fingerprint = preview.eligible
    .map((row) => `${row.id}:${patrolDeadline(row)}:${patrolIssueCount(row)}`)
    .sort()
    .join('|')
  const existed = findBatchByFingerprint(fingerprint)
  if (existed) {
    // 重复提交出包只记一次：原批次重发下载，不再落批次、不再进抄表待核对清单。
    return { ok: true, batch: existed, files: batchFiles(existed), duplicated: true }
  }

  const baseText = preview.packDate
  const dayCount = listBatches().filter((batch) => batch.packDate === baseText).length + 1
  const batchNo = `FXC-${baseText.replace(/-/g, '')}-${String(dayCount).padStart(2, '0')}`
  const batch: PackBatch = {
    id: `pack-${Date.now()}`,
    batchNo,
    fingerprint,
    packDate: baseText,
    operator,
    createdAt: Date.now(),
    bookletCount: preview.booklets.length,
    recordCount: preview.eligible.length,
    reviewCount: preview.booklets.reduce((sum, booklet) => sum + booklet.issueCount, 0),
    booklets: preview.booklets.map((booklet) => ({ ...booklet })),
    emptySegments: preview.emptySegments.map((segment) => ({ ...segment })),
  }
  const reviews = buildReviews(batch)
  addPack(batch, reviews)
  return { ok: true, batch, files: batchFiles(batch), duplicated: false }
}

function batchFiles(batch: PackBatch): PackFile[] {
  const preview: PackPreview = {
    packDate: batch.packDate,
    eligible: batch.booklets.flatMap((booklet) => booklet.rows),
    blocked: [],
    booklets: batch.booklets,
    emptySegments: batch.emptySegments,
  }
  const files = batch.booklets.map((booklet) => ({
    filename: booklet.fileName,
    content: buildBookletCsv(booklet, preview, batch.batchNo),
  }))
  files.push({ filename: readmeFileName(preview), content: buildReadmeCsv(preview, batch) })
  return files
}

function buildReviews(batch: PackBatch): PatrolReviewItem[] {
  const items: PatrolReviewItem[] = []
  let seq = listReviews().length
  for (const booklet of batch.booklets) {
    for (const row of booklet.rows) {
      seq += 1
      items.push({
        id: Date.now() + seq,
        reviewNo: `HD-${batch.packDate.replace(/-/g, '')}-${String(seq).padStart(3, '0')}`,
        batchId: batch.id,
        batchNo: batch.batchNo,
        patrolId: Number(row.id),
        patrolNo: text(row, '巡检编号'),
        station: text(row, '巡检站点'),
        route: text(row, '巡检路线'),
        issueCount: patrolIssueCount(row),
        deadline: patrolDeadline(row),
        segmentName: booklet.segmentName,
        rangeLabel: booklet.rangeLabel,
        bookletNo: booklet.no,
        status: '待核对',
        createdAt: batch.createdAt,
      })
    }
  }
  return items
}

export function listPackBatches(): PackBatch[] {
  return listBatches()
}

// 已出包批次重新下载：不产生新批次、不重复进待核对清单。
export function redownloadBatch(batchId: string): GuardResult {
  const batch = listBatches().find((item) => item.id === batchId)
  if (!batch) {
    return { ok: false, message: '没有找到该分册批次' }
  }
  downloadFiles(batchFiles(batch))
  return { ok: true, message: `批次 ${batch.batchNo} 的分册已重新下载，不会重复登记` }
}

export function listPatrolReviews(): PatrolReviewItem[] {
  return listReviews()
}

export function confirmPatrolReview(reviewId: number): GuardResult {
  const ok = markReviewChecked(reviewId)
  return ok ? { ok: true, message: '该条巡检整改问题已核对' } : { ok: false, message: '待核对条目不存在或已核对' }
}

// 浏览器侧逐册下载：分册彼此独立，一册一个文件，不产出空文件。
export function downloadFiles(files: PackFile[], interval = 300): void {
  files.forEach((file, index) => {
    window.setTimeout(() => {
      const blob = new Blob([file.content], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = file.filename
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      URL.revokeObjectURL(url)
    }, index * interval)
  })
}
