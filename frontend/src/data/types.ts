/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

// 巡检问题按整改期限分册打包：期限段、分册、批次、抄表侧待核对清单。
export type DeadlineSegmentKey = 'current' | 'within7' | 'within15' | 'within30' | 'over30'

export type DeadlineSegment = {
  key: DeadlineSegmentKey
  name: string
  /** 相对打包基准日的期限跨度（自然日，闭区间） */
  minDays: number
  maxDays: number
  /** 册面标注的期限区间文案，区间在出包时按基准日换算 */
  rangeLabel: string
}

export type PatrolBooklet = {
  /** 册号，按期限段先后排列 */
  no: number
  segmentKey: DeadlineSegmentKey
  segmentName: string
  /** 期限区间，例如 2026-10-03 至 2026-10-10 */
  rangeLabel: string
  fileName: string
  routeCount: number
  issueCount: number
  rows: EntryRow[]
}

export type PatrolBlockedRow = {
  id: number
  patrolNo: string
  station: string
  route: string
  reason: string
}

export type PackPreview = {
  packDate: string
  eligible: EntryRow[]
  blocked: PatrolBlockedRow[]
  booklets: PatrolBooklet[]
  /** 当期没有内容的期限段（不产出空册，只在分册说明里附说明） */
  emptySegments: DeadlineSegment[]
}

export type PackBatch = {
  id: string
  batchNo: string
  fingerprint: string
  packDate: string
  operator: string
  createdAt: number
  bookletCount: number
  recordCount: number
  reviewCount: number
  booklets: PatrolBooklet[]
  emptySegments: DeadlineSegment[]
}

// 分册结果落到抄表侧的待核对清单条目。
export type PatrolReviewItem = {
  id: number
  reviewNo: string
  batchId: string
  batchNo: string
  patrolId: number
  patrolNo: string
  station: string
  route: string
  issueCount: number
  deadline: string
  segmentName: string
  rangeLabel: string
  bookletNo: number
  status: string
  createdAt: number
  reviewedAt?: number
}
