import type { PackBatch, PatrolReviewItem } from './types'

// 分册批次与抄表待核对清单的本地持久化：与业务记录分开存，互不影响既有巡检做法。
const PACK_STORAGE_KEY = 'district-heating:patrol-packs'

export type PatrolPackState = {
  batches: PackBatch[]
  reviews: PatrolReviewItem[]
}

const EMPTY_STATE: PatrolPackState = { batches: [], reviews: [] }

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readState(): PatrolPackState {
  if (typeof window === 'undefined' || !window.localStorage) {
    return clone(EMPTY_STATE)
  }
  const raw = window.localStorage.getItem(PACK_STORAGE_KEY)
  if (!raw) {
    return clone(EMPTY_STATE)
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PatrolPackState>
    return {
      batches: Array.isArray(parsed.batches) ? parsed.batches : [],
      reviews: Array.isArray(parsed.reviews) ? parsed.reviews : [],
    }
  } catch {
    return clone(EMPTY_STATE)
  }
}

let cache: PatrolPackState | null = null

export function patrolPackState(): PatrolPackState {
  if (cache === null) {
    cache = readState()
  }
  return cache
}

export function listBatches(): PackBatch[] {
  return patrolPackState().batches
}

export function listReviews(): PatrolReviewItem[] {
  return patrolPackState().reviews
}

export function findBatchByFingerprint(fingerprint: string): PackBatch | undefined {
  return patrolPackState().batches.find((batch) => batch.fingerprint === fingerprint)
}

export function addPack(batch: PackBatch, reviews: PatrolReviewItem[]): void {
  const next: PatrolPackState = {
    batches: [batch, ...patrolPackState().batches],
    reviews: [...reviews, ...patrolPackState().reviews],
  }
  cache = next
  persist(next)
}

export function markReviewChecked(reviewId: number): boolean {
  const state = patrolPackState()
  const index = state.reviews.findIndex((item) => item.id === reviewId)
  if (index < 0 || state.reviews[index].status === '已核对') {
    return false
  }
  const next = clone(state)
  next.reviews[index] = {
    ...next.reviews[index],
    status: '已核对',
    reviewedAt: Date.now(),
  }
  cache = next
  persist(next)
  return true
}

export function resetPatrolPacks(): void {
  cache = clone(EMPTY_STATE)
  persist(cache)
}

export function packStorageKey(): string {
  return PACK_STORAGE_KEY
}

function persist(state: PatrolPackState): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(PACK_STORAGE_KEY, JSON.stringify(state))
  }
}
