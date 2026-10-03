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

export type OperatorRole = '值班员' | '片区负责人' | '巡检班组'

export type Operator = {
  id: string
  name: string
  role: OperatorRole
  area: string
}

// 巡检按巡检路线分片：每条路线归属一个片区，整改期限由该片区负责人核定。
export type RouteSlice = {
  route: string
  area: string
  crew: string
  manager: string
}

export type PackageSegment = {
  start: string
  end: string
}

// 分册包持久化结构：册子 CSV 与清单都随包存，重复提交时下载到的还是同一个包。
export type PatrolPackageRecord = {
  id: number
  packageNo: string
  fingerprint: string
  area: string
  manager: string
  operator: string
  crew: string
  weeks: number
  rangeStart: string
  rangeEnd: string
  issueCount: number
  checked: boolean
  createdAt: string
  zipName: string
  manifestName: string
  manifest: string
  files: { name: string; content: string }[]
}

export type PatrolPackageSubmit = {
  weeks: number
  anchorDate: string
  operator: Operator
  filters: Record<string, string>
}

export type PatrolPackageResult = {
  ok: boolean
  message: string
  record?: PatrolPackageRecord
  duplicated?: boolean
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
