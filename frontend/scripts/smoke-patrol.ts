// 巡检分册打包核心规则冒烟测试：esbuild 打包后在 node 下运行，localStorage 用内存桩。
import { listRows, saveRows, resetRows } from '../src/data/local-store'
import { resetPatrolPacks } from '../src/data/patrol-store'
import {
  approvePatrolDeadline,
  buildPackPreview,
  listPackBatches,
  listPatrolReviews,
  patrolDeadline,
  runPatrolAction,
  submitPack,
} from '../src/api/patrol-pack'

let passed = 0
let failed = 0
function assert(cond: boolean, label: string) {
  if (cond) {
    passed += 1
    console.log(`  ✓ ${label}`)
  } else {
    failed += 1
    console.error(`  ✗ ${label}`)
  }
}

resetRows('stationpatrol')
resetPatrolPacks()
const BASE = '2026-10-03'

console.log('1) 分册预览：按期分段、按路线分片、空段不给空文件')
const preview = buildPackPreview(BASE)
assert(preview.packDate === BASE, '打包基准日回显正确')
assert(preview.eligible.length === 6, `可下发记录 6 条（实际 ${preview.eligible.length}）`)
assert(preview.blocked.length === 1, `被挡下 1 条（实际 ${preview.blocked.length}）`)
assert(preview.blocked[0].patrolNo === 'XJ-2026-1007', '挡回的是巡检中未核定期限的记录')
assert(/未由片区负责人核定/.test(preview.blocked[0].reason), '挡回原因为期限未核定')
const segNames = preview.booklets.map((b) => b.segmentName)
assert(JSON.stringify(segNames) === JSON.stringify(['当期到期', '7日内到期', '16至30日到期', '30日以上']), `分册段顺序正确：${segNames.join('/')}`)
assert(preview.emptySegments.length === 1 && preview.emptySegments[0].name === '8至15日到期', '8至15日段当期为空段')
const current = preview.booklets[0]
assert(current.rows.length === 1, '当期册含 1 条（10-03 当日到期）')
assert(current.issueCount === 3, '当期册问题数合计 3')
assert(current.rangeLabel === '截至2026-10-03（含当日，已到期）', `当期区间文案：${current.rangeLabel}`)
const within7 = preview.booklets[1]
assert(within7.rows.length === 1 && within7.rows[0]['巡检编号'] === 'XJ-2026-1002', '7日内册为 10-06 那一条')
assert(within7.rangeLabel === '2026-10-04 至 2026-10-10', `7日内区间文案：${within7.rangeLabel}`)
const over30 = preview.booklets[3]
assert(over30.rows.length === 2, '30日以上册含 2 条（11-10、11-20）')
assert(over30.rangeLabel === '2026-11-03 起', `30日以上区间文案：${over30.rangeLabel}`)
assert(/截至2026-10-03\.csv$/.test(current.fileName), `册文件名带期限区间：${current.fileName}`)
assert(current.rows[0]['巡检路线'] === '城东片区·北线', '册内按巡检路线分片排序')

console.log('2) 有挡回记录时整批挡下，不出任何文件')
const blockedSubmit = submitPack(BASE, '片区负责人·张队')
assert(!blockedSubmit.ok, '存在挡回记录时不允许出包')

console.log('3) 越级流转挡回：已上报不能重复上报；巡检中不能直接确认整改')
const idReported = Number(listRows('stationpatrol').find((r) => String(r['巡检编号']) === 'XJ-2026-1001')!.id)
assert(!runPatrolAction(idReported, '上报问题').ok, '已上报记录重复上报被挡回')
const idInspecting = Number(listRows('stationpatrol').find((r) => String(r['巡检编号']) === 'XJ-2026-1007')!.id)
assert(/越级/.test(runPatrolAction(idInspecting, '确认整改').message), '巡检中直接确认整改按越级挡回')

console.log('4) 期限由片区负责人核定：巡检员越级挡回；缺失/非法先挡下')
assert(!approvePatrolDeadline({ id: idInspecting, deadline: '2026-10-20', issueCount: 2, operator: '王巡', role: '巡检员' }).ok, '巡检员核定期限被挡回')
assert(!approvePatrolDeadline({ id: idInspecting, deadline: '', issueCount: 2, operator: '张队', role: '片区负责人' }).ok, '期限缺失先挡下')
assert(!approvePatrolDeadline({ id: idInspecting, deadline: '2026-09-01', issueCount: 2, operator: '张队', role: '片区负责人' }).ok, '期限早于巡检日期被挡回')
assert(!approvePatrolDeadline({ id: idInspecting, deadline: '2026-10-20', issueCount: 0, operator: '张队', role: '片区负责人' }).ok, '问题数为 0 不予上报')
const approved = approvePatrolDeadline({ id: idInspecting, deadline: '2026-10-09', issueCount: 2, operator: '张队', role: '片区负责人' })
assert(approved.ok, '片区负责人核定期限成功并上报')
const afterApprove = listRows('stationpatrol').find((r) => Number(r.id) === idInspecting)!
assert(String(afterApprove.status) === '已上报' && patrolDeadline(afterApprove) === '2026-10-09', '核定后状态为已上报且期限落表')
assert(patrolDeadline(afterApprove) === String(afterApprove['整改期限']), '列表与册子取的是同一个整改期限字段')

console.log('5) 出包：每册含编号/站点/问题数/期限与区间；无空文件；空段入分册说明')
const preview2 = buildPackPreview(BASE)
assert(preview2.blocked.length === 0 && preview2.booklets.length === 4, '核定后 4 册无挡回')
const result = submitPack(BASE, '片区负责人·张队')
assert(result.ok && !result.duplicated, '首次出包成功')
if (result.ok) {
  assert(result.files.length === 5, `共 5 个文件：4 册 + 1 分册说明（实际 ${result.files.length}）`)
  const names = result.files.map((f) => f.filename)
  assert(names.every((n) => /分册|说明/.test(n)), '文件名均为分册/说明')
  const booklet1 = result.files[0].content
  assert(/XJ-2026-1001/.test(booklet1) && /滨河一号换热站/.test(booklet1) && /2026-10-03/.test(booklet1), '册面含巡检编号、站点、问题、期限')
  assert(/期限区间/.test(booklet1), '册内标注期限区间')
  assert(/【分片】城东片区·北线/.test(booklet1), '册内标出巡检路线分片')
  const readme = result.files.find((f) => f.filename.includes('说明'))!.content
  assert(/8至15日到期/.test(readme) && /不生成空册/.test(readme), '空段只在分册说明里附说明')
  assert(!names.some((n) => n.includes('8至15日')), '确实没有为空段生成文件')
}

console.log('6) 重复提交出包只记一次')
const again = submitPack(BASE, '片区负责人·张队')
assert(again.ok && again.duplicated, '同内容再次提交识别为重复')
assert(listPackBatches().length === 1, `批次仍只有 1 个（实际 ${listPackBatches().length}）`)
assert(listPatrolReviews().length === 7, `抄表待核对清单仍为 7 条（实际 ${listPatrolReviews().length}）`)

console.log('7) 分册结果落到抄表待核对清单，口径一致')
const reviews = listPatrolReviews()
const r1 = reviews.find((r) => r.patrolNo === 'XJ-2026-1001')!
assert(!!r1 && r1.status === '待核对' && r1.deadline === '2026-10-03' && r1.issueCount === 3, '清单条目期限/问题数与巡检一致')
assert(r1.bookletNo === 1 && r1.segmentName === '当期到期', '清单条目带分册号与期限段')

console.log('8) 兼容既有巡检做法：整表数据仍可读写、泛型导出不受影响')
const rows = listRows('stationpatrol')
assert(rows.length === 8, '巡检整表记录完整')
saveRows('stationpatrol', rows)
assert(listRows('stationpatrol').length === 8, '既有本地保存方式照旧可用')

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) {
  process.exit(1)
}
