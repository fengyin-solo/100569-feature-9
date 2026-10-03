import { listCollection, listRows, saveCollection } from '@/data/local-store'
import { ROUTE_BY_NAME } from '@/data/routes'
import type {
  EntryRow,
  PatrolPackageRecord,
  PatrolPackageResult,
  PatrolPackageSubmit,
} from '@/data/types'
import { buildWeekSegments, isValidIsoDate, todayLocalIso, withinRange } from '@/utils/date'
import { buildZipBlob } from '@/utils/zip'

const COLLECTION_KEY = 'patrol-packages'
const MODULE_KEY = 'stationpatrol'

const BOOKLET_FIELDS = ['巡检编号', '巡检站点', '巡检路线', '巡检人', '巡检日期', '发现问题数', '整改期限']

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function csvLine(values: unknown[]): string {
  return values.map(csvCell).join(',')
}

function issueCount(row: EntryRow): number {
  const value = Number(row['发现问题数'])
  return Number.isFinite(value) ? value : 0
}

// 已整改或没有发现问题的记录不再下发给班组。
function needsDispatch(row: EntryRow): boolean {
  return String(row.status) !== '已整改' && issueCount(row) > 0
}

function fnv1aHex(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

function loadPackages(): PatrolPackageRecord[] {
  return listCollection<PatrolPackageRecord>(COLLECTION_KEY).sort((a, b) => b.id - a.id)
}

function persistPackages(items: PatrolPackageRecord[]): void {
  saveCollection(COLLECTION_KEY, items)
}

// 册子与巡检列表同源：直接取 stationpatrol 列表数据，整改期限不在分册环节改写，多处展示对得上。
function bookletCsv(
  area: string,
  crew: string,
  manager: string,
  segment: { start: string; end: string },
  rows: EntryRow[],
): string {
  const lines = [
    csvLine([`片区`, area]),
    csvLine(['下发班组', crew]),
    csvLine(['片区负责人', manager]),
    csvLine(['期限区间', `${segment.start} 至 ${segment.end}`]),
    csvLine(['整改期限（不晚于）', segment.end]),
    csvLine(['发现问题数（合计）', rows.reduce((sum, row) => sum + issueCount(row), 0)]),
    '',
    csvLine(BOOKLET_FIELDS),
  ]
  for (const row of rows) {
    lines.push(csvLine(BOOKLET_FIELDS.map((field) => row[field] ?? '')))
  }
  return `﻿${lines.join('\n')}`
}

function manifestCsv(
  record: {
    packageNo: string
    area: string
    manager: string
    operator: string
    crew: string
    createdAt: string
  },
  segments: { start: string; end: string; rows: EntryRow[] }[],
): string {
  const lines = [
    csvLine(['巡检问题整改分册包清单']),
    csvLine(['分册包编号', record.packageNo]),
    csvLine(['片区', record.area]),
    csvLine(['核定负责人', record.manager]),
    csvLine(['操作人', record.operator]),
    csvLine(['下发班组', record.crew]),
    csvLine(['出包时间', record.createdAt]),
    '',
    csvLine(['册号', '期限区间', '文件名', '发现问题数', '入册巡检数', '说明']),
  ]
  segments.forEach((segment, index) => {
    const count = segment.rows.reduce((sum, row) => sum + issueCount(row), 0)
    const note = segment.rows.length
      ? ''
      : `本期限段（${segment.start} 至 ${segment.end}）当期没有待整改问题，不单独出册，未生成空文件`
    lines.push(
      csvLine([
        `第${index + 1}册`,
        `${segment.start} 至 ${segment.end}`,
        segment.rows.length ? bookletName(index + 1, segment) : '—',
        count,
        segment.rows.length,
        note,
      ]),
    )
  })
  return `﻿${lines.join('\n')}`
}

function bookletName(bookletIndex: number, segment: { start: string; end: string }): string {
  return `巡检整改第${bookletIndex}册_${segment.start}_${segment.end}.csv`
}

function buildFingerprint(area: string, segments: { start: string; end: string; rows: EntryRow[] }[]): string {
  const parts = [`片区:${area}`]
  segments.forEach((segment, index) => {
    parts.push(`段${index + 1}:${segment.start}~${segment.end}`)
    for (const row of [...segment.rows].sort((a, b) => Number(a.id) - Number(b.id))) {
      parts.push(
        [
          row.id,
          row['巡检编号'],
          row['巡检站点'],
          issueCount(row),
          row['整改期限'],
          row.status,
        ].join('@'),
      )
    }
  })
  return fnv1aHex(parts.join('|'))
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

// 按整改期限分册打包。越级（非本片区负责人/跨片区）、期限区间缺失、记录整改期限缺失，一律先挡下。
export function submitPatrolPackage(input: PatrolPackageSubmit): PatrolPackageResult {
  const { operator, filters } = input

  if (operator.role !== '片区负责人') {
    return {
      ok: false,
      message: `越级挡回：整改期限由片区负责人核定，当前身份「${operator.name}（${operator.role}）」不能出包`,
    }
  }

  let segments
  try {
    segments = buildWeekSegments(input.weeks, input.anchorDate, todayLocalIso()).map((segment) => ({ ...segment, rows: [] as EntryRow[] }))
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : '期限区间缺失或不合法，先挡下补齐再出包',
    }
  }

  const allRows = listRows(MODULE_KEY)
  const activeFilters = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  const hasFilters = activeFilters.length > 0
  const scoped = hasFilters
    ? allRows.filter((row) =>
        activeFilters.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
      )
    : allRows

  // 带筛选出包才检查越级：巡检按巡检路线分片，筛到外片区路线属于跨片核定，挡回；
  // 路线没登记分片也挡回，不能蒙混出包。不带筛选时隐式只出本片区，外片区记录天然不入册。
  if (hasFilters) {
    const foreign: string[] = []
    const unregistered: string[] = []
    for (const row of scoped) {
      const route = String(row['巡检路线'] ?? '')
      const slice = ROUTE_BY_NAME.get(route)
      if (!slice) {
        unregistered.push(route || `#${row.id}`)
      } else if (slice.area !== operator.area) {
        foreign.push(route)
      }
    }
    if (unregistered.length > 0) {
      return {
        ok: false,
        message: `越级挡回：巡检路线「${[...new Set(unregistered)].join('、')}」没有登记片区分片，请先补分片再出包`,
      }
    }
    if (foreign.length > 0) {
      return {
        ok: false,
        message: `越级挡回：巡检路线「${[...new Set(foreign)].join('、')}」不属于${operator.area}，片区负责人只能核定本片区整改期限`,
      }
    }
  }

  const candidates = scoped.filter(
    (row) => needsDispatch(row) && ROUTE_BY_NAME.get(String(row['巡检路线']))?.area === operator.area,
  )
  if (candidates.length === 0) {
    return {
      ok: false,
      message: `${operator.area}在当前筛选下没有待整改问题记录可入册，请核对巡检路线与筛选条件`,
    }
  }

  // 期限区间缺失/非法先挡下；期限落在任何区间之外也不入册，避免册子漏掉记录悄悄下发。
  const badDeadline = candidates.filter((row) => !isValidIsoDate(row['整改期限']))
  if (badDeadline.length > 0) {
    const refs = badDeadline
      .map((row) => `${String(row['巡检编号'])}（${String(row['巡检站点'])}）`)
      .join('、')
    return {
      ok: false,
      message: `先挡下：${refs} 的整改期限缺失或不是 YYYY-MM-DD，请由片区负责人核定后再出包`,
    }
  }
  const firstStart = segments[0].start
  const lastEnd = segments[segments.length - 1].end
  const outOfRange = candidates.filter(
    (row) => !withinRange(String(row['整改期限']), firstStart, lastEnd),
  )
  if (outOfRange.length > 0) {
    const refs = outOfRange
      .map(
        (row) =>
          `${String(row['巡检编号'])}（期限 ${String(row['整改期限'])}）`,
      )
      .join('、')
    return {
      ok: false,
      message: `先挡下：${refs} 的整改期限不在 ${firstStart} 至 ${lastEnd} 的分册区间内，请调整期限或增加册数`,
    }
  }

  for (const row of candidates) {
    const deadline = String(row['整改期限'])
    const target = segments.find((segment) => withinRange(deadline, segment.start, segment.end))
    target?.rows.push(row)
  }

  const fingerprint = buildFingerprint(operator.area, segments)
  const existing = loadPackages().find((item) => item.fingerprint === fingerprint)
  if (existing) {
    // 重复提交：只记一次。复用原包重新下载，不再向抄表待核对清单补记。
    downloadPackage(existing.id)
    return {
      ok: true,
      duplicated: true,
      record: existing,
      message: `分册包 ${existing.packageNo} 此前已提交，按重复提交处理：只记一次，已重新下载原包`,
    }
  }

  const slices = [...new Set(candidates.map((row) => ROUTE_BY_NAME.get(String(row['巡检路线']))!))]
  const manager = operator.name
  const crew = [...new Set(slices.map((slice) => slice.crew))].join('、')
  const createdAt = new Date()
  const today = todayLocalIso(createdAt)
  const packageNo = `XJFB-${today.replace(/-/g, '')}-${String(loadPackages().length + 1).padStart(3, '0')}`
  const files = segments
    .map((segment, index) => ({
      segment,
      index,
    }))
    .filter(({ segment }) => segment.rows.length > 0)
    .map(({ segment, index }) => ({
      name: bookletName(index + 1, segment),
      content: bookletCsv(operator.area, crew, manager, segment, segment.rows),
    }))

  const record: PatrolPackageRecord = {
    id: (loadPackages()[0]?.id ?? 0) + 1,
    packageNo,
    fingerprint,
    area: operator.area,
    manager,
    operator: operator.name,
    crew,
    weeks: segments.length,
    rangeStart: firstStart,
    rangeEnd: lastEnd,
    issueCount: candidates.reduce((sum, row) => sum + issueCount(row), 0),
    checked: false,
    createdAt: today + ' ' + createdAt.toTimeString().slice(0, 8),
    zipName: '',
    manifestName: '',
    manifest: '',
    files,
  }
  record.manifestName = `巡检整改分册清单_${packageNo}.csv`
  record.manifest = manifestCsv(record, segments)
  record.zipName = `巡检整改分册包_${operator.area}_${firstStart}_${lastEnd}_${packageNo}.zip`

  const items = loadPackages()
  items.unshift(record)
  persistPackages(items)
  downloadPackage(record.id)

  const filled = files.length
  const empty = segments.length - filled
  return {
    ok: true,
    record,
    message:
      `已按整改期限打成 ${segments.length} 册（${filled} 册有内容、${empty} 个空期限段只在清单里说明），` +
      `分册结果已落到抄表待核对清单，分册包开始下载：${record.zipName}`,
  }
}

export function listPatrolPackages(): PatrolPackageRecord[] {
  return loadPackages()
}

// 分册结果落到抄表那边的待核对清单：只看未核对的包。
export function listPendingMeterChecks(): PatrolPackageRecord[] {
  return loadPackages().filter((item) => !item.checked)
}

export function downloadPackage(id: number): PatrolPackageResult {
  const record = loadPackages().find((item) => item.id === id)
  if (!record) {
    return { ok: false, message: '没有找到对应的分册包' }
  }
  const zip = buildZipBlob([
    ...record.files.map((file) => ({ filename: file.name, content: file.content })),
    { filename: record.manifestName, content: record.manifest },
  ])
  triggerDownload(zip, record.zipName)
  return { ok: true, record, message: `分册包 ${record.packageNo} 已开始下载` }
}

export function checkPatrolPackage(id: number): PatrolPackageResult {
  const items = loadPackages()
  const target = items.find((item) => item.id === id)
  if (!target) {
    return { ok: false, message: '没有找到对应的分册包' }
  }
  if (target.checked) {
    return { ok: false, message: `分册包 ${target.packageNo} 已经核对过，不用重复核对` }
  }
  target.checked = true
  persistPackages(items)
  return { ok: true, record: target, message: `分册包 ${target.packageNo} 已核对，从待核对清单移除` }
}
