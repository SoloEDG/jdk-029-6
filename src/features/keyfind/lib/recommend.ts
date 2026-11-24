import { noteName, offsetLabel } from '../../../shared/notes'
import { HIGH_HEADROOM, LONG_HOLD_SECONDS, type LineProfile, type SongAnalysis } from './analyze'
import type { RangeProfile } from './profile'

export type Verdict = 'auditionable' | 'conditional' | 'ruled-out'

export const VERDICT_LABELS: Record<Verdict, string> = {
  'auditionable': '可以直接试唱',
  'conditional': '依赖待复验上界',
  'ruled-out': '已排除',
}

export const CANDIDATE_OFFSETS = [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6]

export interface KeyIssue {
  line: LineProfile
  side: 'low' | 'high'
  /** 转调后的实际音高（高侧已折算长高音余量）。 */
  note: number
  /** 被触碰的边界；「未测定」的情形为 null。 */
  bound: number | null
  message: string
}

export interface CandidateKey {
  offset: number
  verdict: Verdict
  /** 违反已确认边界的硬冲突。 */
  issues: KeyIssue[]
  /** 只有待复验 / 未测定的边界成立才可行的点。 */
  conditions: KeyIssue[]
  /** 该调下真正难唱的句子，用于试听。 */
  hardLines: LineProfile[]
  reasons: string[]
}

export interface KeyOutcome {
  candidates: CandidateKey[]
  best: number | null
  bestReasons: string[]
}

export interface ChangeReport {
  lines: string[]
}

/** 高侧有效音高：连续长高音按上界多留 1 半音余量，短高音可以顶到上界。 */
function effectiveTop(line: LineProfile) {
  return line.max + (line.peakHold >= LONG_HOLD_SECONDS ? HIGH_HEADROOM : 0)
}

function topLabel(line: LineProfile) {
  return line.peakHold >= LONG_HOLD_SECONDS ? '连续长高音' : '最高音'
}

function hardestLines(analysis: SongAnalysis, offset: number): LineProfile[] {
  const picked = new Map<string, LineProfile>()
  const add = (line: LineProfile | undefined) => { if (line) picked.set(line.line.id, line) }
  add(analysis.lines.reduce<LineProfile | undefined>((top, line) => !top || effectiveTop(line) > effectiveTop(top) ? line : top, undefined))
  add(analysis.lines.reduce<LineProfile | undefined>((longest, line) => !longest || line.peakHold > longest.peakHold ? line : longest, undefined))
  add(analysis.lines.reduce<LineProfile | undefined>((lowest, line) => !lowest || line.min + offset < lowest.min + offset ? line : lowest, undefined))
  return [...picked.values()].slice(0, 3)
}

export function evaluateKey(analysis: SongAnalysis, profile: RangeProfile, offset: number): CandidateKey {
  const issues: KeyIssue[] = []
  const conditions: KeyIssue[] = []
  for (const line of analysis.lines) {
    const low = line.min + offset
    if (profile.confirmedLow !== null && low < profile.confirmedLow) {
      issues.push({
        line, side: 'low', note: low, bound: profile.confirmedLow,
        message: `「${line.line.text}」低音落到 ${noteName(low)}，低于已确认下界 ${noteName(profile.confirmedLow)}`,
      })
    } else if (profile.confirmedLow === null && line.min === analysis.min) {
      conditions.push({
        line, side: 'low', note: low, bound: null,
        message: `「${line.line.text}」低音落到 ${noteName(low)}，但下界还没有测过`,
      })
    }

    const top = effectiveTop(line) + offset
    const bound = profile.confirmedHigh
    if (bound !== null && top > bound) {
      if (profile.pendingHigh !== null && top <= profile.pendingHigh) {
        conditions.push({
          line, side: 'high', note: top, bound: profile.pendingHigh,
          message: `「${line.line.text}」${topLabel(line)}到 ${noteName(top)}，超出已确认上界 ${noteName(bound)}，只有待复验上界 ${noteName(profile.pendingHigh)} 成立才唱得了`,
        })
      } else if (profile.pendingHigh !== null) {
        issues.push({
          line, side: 'high', note: top, bound: profile.pendingHigh,
          message: `「${line.line.text}」${topLabel(line)}到 ${noteName(top)}，连待复验上界 ${noteName(profile.pendingHigh)} 都不够`,
        })
      } else {
        issues.push({
          line, side: 'high', note: top, bound,
          message: `「${line.line.text}」${topLabel(line)}到 ${noteName(top)}，超出已确认上界 ${noteName(bound)}`,
        })
      }
    } else if (bound === null) {
      if (profile.pendingHigh !== null && top > profile.pendingHigh) {
        issues.push({
          line, side: 'high', note: top, bound: profile.pendingHigh,
          message: `「${line.line.text}」${topLabel(line)}到 ${noteName(top)}，连待复验上界 ${noteName(profile.pendingHigh)} 都不够`,
        })
      } else if (profile.pendingHigh !== null && line.max === analysis.max) {
        conditions.push({
          line, side: 'high', note: top, bound: profile.pendingHigh,
          message: `「${line.line.text}」${topLabel(line)}到 ${noteName(top)}，上界未确认，依赖待复验上界 ${noteName(profile.pendingHigh)}`,
        })
      } else if (profile.pendingHigh === null && line.max === analysis.max) {
        conditions.push({
          line, side: 'high', note: top, bound: null,
          message: `「${line.line.text}」${topLabel(line)}到 ${noteName(top)}，但上界还没有测过`,
        })
      }
    }
  }

  const verdict: Verdict = issues.length ? 'ruled-out' : conditions.length ? 'conditional' : 'auditionable'
  const involved = new Map<string, LineProfile>()
  for (const item of [...issues, ...conditions]) involved.set(item.line.line.id, item.line)
  const hardLines = involved.size ? [...involved.values()] : hardestLines(analysis, offset)

  const reasons: string[] = []
  if (verdict === 'auditionable' && profile.confirmedLow !== null && profile.confirmedHigh !== null) {
    const topLine = analysis.lines.reduce((a, b) => effectiveTop(a) + offset >= effectiveTop(b) + offset ? a : b)
    const lowLine = analysis.lines.reduce((a, b) => a.min + offset <= b.min + offset ? a : b)
    const topMargin = profile.confirmedHigh - (effectiveTop(topLine) + offset)
    const lowMargin = lowLine.min + offset - profile.confirmedLow
    reasons.push(`「${topLine.line.text}」${topLabel(topLine)}到 ${noteName(topLine.max + offset)}，距已确认上界 ${noteName(profile.confirmedHigh)} 还有 ${topMargin} 半音`)
    reasons.push(`「${lowLine.line.text}」低音落到 ${noteName(lowLine.min + offset)}，距已确认下界 ${noteName(profile.confirmedLow)} 还有 ${lowMargin} 半音`)
  } else {
    for (const item of [...issues, ...conditions]) reasons.push(item.message)
  }
  return { offset, verdict, issues, conditions, hardLines, reasons }
}

/** 在可以直接试唱的调里，让最紧张的一侧尽量宽松；同等宽松时离原调更近的优先。 */
export function recommend(analysis: SongAnalysis, profile: RangeProfile, offsets: readonly number[] = CANDIDATE_OFFSETS): KeyOutcome {
  const candidates = offsets.map(offset => evaluateKey(analysis, profile, offset))
  const playable = candidates.filter(candidate => candidate.verdict === 'auditionable' && analysis.lines.length)
  if (!playable.length || profile.confirmedLow === null || profile.confirmedHigh === null) {
    const hint = analysis.lines.length
      ? '当前证据下没有可以直接试唱的调。先补一次试唱，确认或推翻待定的边界后再定调。'
      : '这首歌没有参考音数据，无法评估候选调。'
    return { candidates, best: null, bestReasons: [hint] }
  }
  const score = (candidate: CandidateKey): [number, number] => {
    const topMargin = profile.confirmedHigh! - Math.max(...analysis.lines.map(line => effectiveTop(line) + candidate.offset))
    const lowMargin = analysis.min + candidate.offset - profile.confirmedLow!
    return [Math.min(topMargin, lowMargin, 4), -Math.abs(candidate.offset)]
  }
  const best = playable.reduce((a, b) => {
    const [sa, ta] = score(a)
    const [sb, tb] = score(b)
    return sb > sa || (sb === sa && tb > ta) ? b : a
  })
  return { candidates, best: best.offset, bestReasons: best.reasons }
}

/** 对比新旧两轮评估，用变化解释推荐原因：哪个调换了分类、为什么。 */
export function explainChange(prev: KeyOutcome, next: KeyOutcome): ChangeReport {
  const lines: string[] = []
  if (prev.best !== next.best) {
    lines.push(`推荐调从 ${prev.best === null ? '暂无' : offsetLabel(prev.best)} 改为 ${next.best === null ? '暂无' : offsetLabel(next.best)}`)
  }
  for (const candidate of next.candidates) {
    const before = prev.candidates.find(item => item.offset === candidate.offset)
    if (!before || before.verdict === candidate.verdict) continue
    const detail = candidate.issues[0]?.message ?? candidate.conditions[0]?.message ?? candidate.reasons[0] ?? ''
    lines.push(`${offsetLabel(candidate.offset)}：${VERDICT_LABELS[before.verdict]} → ${VERDICT_LABELS[candidate.verdict]}。${detail}`)
  }
  return { lines }
}
