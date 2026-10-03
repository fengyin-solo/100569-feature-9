import { defineStore } from 'pinia'

// 平台内可切换的岗位：整改期限只认片区负责人（值班管理员代行），巡检员办理按越级挡回。
export const ROLES = ['值班管理员', '片区负责人', '巡检员'] as const
export type OperatorRole = (typeof ROLES)[number]
export const APPROVER_ROLES: OperatorRole[] = ['值班管理员', '片区负责人']

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    scope: '城市集中供热管网与换热站运行管理平台',
    role: '值班管理员' as OperatorRole,
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    canApproveDeadline: (state) => APPROVER_ROLES.includes(state.role),
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setRole(role: OperatorRole) {
      this.role = role
    },
  },
})
