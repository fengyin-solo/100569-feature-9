import type { Operator, RouteSlice } from './types'

// 巡检路线分片表：巡检按路线分片，分册只认路线所属片区，不看站点名。
export const ROUTE_SLICES: RouteSlice[] = [
  { route: '城东一线', area: '城东片区', crew: '城东一班', manager: '周建东' },
  { route: '城东二线', area: '城东片区', crew: '城东二班', manager: '周建东' },
  { route: '城西环线', area: '城西片区', crew: '城西一班', manager: '郑西平' },
  { route: '城南支线', area: '城南片区', crew: '城南一班', manager: '陈南峰' },
]

export const ROUTE_BY_NAME: Map<string, RouteSlice> = new Map(
  ROUTE_SLICES.map((slice) => [slice.route, slice]),
)

// 演示用身份：只有片区负责人能核定本片区整改期限并出包，其余身份触发越级挡回。
export const OPERATORS: Operator[] = [
  { id: 'duty', name: '值班管理员', role: '值班员', area: '全线' },
  { id: 'east', name: '周建东', role: '片区负责人', area: '城东片区' },
  { id: 'west', name: '郑西平', role: '片区负责人', area: '城西片区' },
  { id: 'south', name: '陈南峰', role: '片区负责人', area: '城南片区' },
  { id: 'crew-east', name: '城东一班·老李', role: '巡检班组', area: '城东片区' },
]

export const DEFAULT_OPERATOR = OPERATORS[0]
