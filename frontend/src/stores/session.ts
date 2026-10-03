import { defineStore } from 'pinia'

import { DEFAULT_OPERATOR, OPERATORS } from '@/data/routes'
import type { Operator } from '@/data/types'

export const useSessionStore = defineStore('session', {
  state: () => ({
    current: { ...DEFAULT_OPERATOR } as Operator,
    shiftLabel: '白班 08:00-20:00',
    scope: '城市集中供热管网与换热站运行管理平台',
  }),
  getters: {
    // 头部展示仍取 operator 文本，既有页面不用改。
    operator: (state) => `${state.current.name}（${state.current.role}${state.current.role === '值班员' ? '' : '·' + state.current.area}）`,
    canOperate: (state) => state.current.name.length > 0,
    operators: () => OPERATORS,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    selectOperator(id: string) {
      const next = OPERATORS.find((item) => item.id === id)
      if (next) {
        this.current = { ...next }
      }
    },
  },
})
