// 整改期限一律按 YYYY-MM-DD 文本处理：与巡检列表里登记的写法保持一致，分册不做日期改写。
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value.trim())) {
    return false
  }
  const [year, month, day] = value.trim().split('-').map(Number)
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false
  }
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export function dayIndex(value: string): number {
  const [year, month, day] = value.split('-').map(Number)
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000)
}

export function addDays(value: string, days: number): string {
  const date = new Date(dayIndex(value) * 86_400_000 + days * 86_400_000)
  return toIsoDate(date)
}

export function toIsoDate(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// 取本机日历日：出包编号、默认期限区间都按操作人当天算，不被 UTC 时区带偏。
export function todayLocalIso(now: Date = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export type WeekSegmentsOptions = {
  anchorDate?: string
  today?: string
}

// 期限区间从某个周一开始按周连续排开；周一缺失时默认取本周周一，保证既有巡检排周计划的做法不变。
export function buildWeekSegments(
  weeks: number,
  anchorDate: string,
  today: string = anchorDate,
): { start: string; end: string }[] {
  if (!Number.isInteger(weeks) || weeks < 1) {
    throw new Error('册数需要是大于 0 的整数')
  }
  if (!isValidIsoDate(anchorDate)) {
    throw new Error('期限区间起始日缺失或不是 YYYY-MM-DD 格式，先补齐再出包')
  }
  if (!isValidIsoDate(today)) {
    throw new Error('当前班次日期不可用，无法核定期限区间')
  }
  const anchor = new Date(dayIndex(anchorDate) * 86_400_000)
  const mondayIndex = dayIndex(anchorDate) - ((anchor.getUTCDay() + 6) % 7)
  const todayIndex = dayIndex(today)
  if (mondayIndex < todayIndex) {
    throw new Error('期限区间起始日不能早于今天，逾期区间不能下发给班组')
  }
  const firstStart = addDays(anchorDate, mondayIndex - dayIndex(anchorDate))
  return Array.from({ length: weeks }, (_, index) => ({
    start: addDays(firstStart, index * 7),
    end: addDays(firstStart, index * 7 + 6),
  }))
}

export function withinRange(value: string, start: string, end: string): boolean {
  const index = dayIndex(value)
  return index >= dayIndex(start) && index <= dayIndex(end)
}
