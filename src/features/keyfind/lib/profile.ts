import type { PitchPoint } from '../../../shared/document'

export type SingFeel = 'easy' | 'tense' | 'failed'

export interface RangeEvidence {
  id: string
  createdAt: number
  /** 来源描述，例如「潮汐之后 · 如果星光还能停留」。 */
  label: string
  /** 本次试唱确认的最低音（midi）。useLow 为 false 时为 null。 */
  lowest: number | null
  /** 本次试唱确认的最高音（midi）。useHigh 为 false 时为 null。 */
  highest: number | null
  useLow: boolean
  useHigh: boolean
  /** 检测值与听到的音差了一个八度：高读数只能作待复验上界，不能直接确认。 */
  octaveSuspect: boolean
  feel: SingFeel
}

export interface RangeProfile {
  /** 已确认下界：唱到过且不费力的最低音。 */
  confirmedLow: number | null
  /** 已确认上界：唱到过的最高音（受「上不去」证据约束）。 */
  confirmedHigh: number | null
  /** 待复验上界：疑似八度误判的高读数，复测确认前不作为已确认上界。 */
  pendingHigh: number | null
}

/** 从一次录音的音高轨迹提取确认音域。取 5% / 95% 分位，避免个别离群检测点。 */
export function extractRange(points: readonly PitchPoint[]): { lowest: number | null; highest: number | null } {
  const hits = points.map(point => point.midi).filter((midi): midi is number => midi !== null).sort((a, b) => a - b)
  if (hits.length < 3) return { lowest: null, highest: null }
  const at = (ratio: number) => hits[Math.min(hits.length - 1, Math.max(0, Math.round(ratio * (hits.length - 1))))]
  return { lowest: Math.round(at(0.05)), highest: Math.round(at(0.95)) }
}

export function deriveProfile(evidence: readonly RangeEvidence[]): RangeProfile {
  let low: number | null = null
  let high: number | null = null
  let pending: number | null = null
  let ceiling: number | null = null
  for (const item of evidence) {
    if (item.useLow && item.feel !== 'failed' && item.lowest !== null) {
      low = low === null ? item.lowest : Math.min(low, item.lowest)
    }
    if (!item.useHigh || item.highest === null) continue
    if (item.feel === 'failed') {
      // 没唱上去的音是上界的天花板：确认上界必须比它低。
      ceiling = ceiling === null ? item.highest : Math.min(ceiling, item.highest)
    } else if (item.octaveSuspect) {
      pending = pending === null ? item.highest : Math.max(pending, item.highest)
    } else {
      high = high === null ? item.highest : Math.max(high, item.highest)
    }
  }
  if (ceiling !== null) high = high === null ? ceiling - 1 : Math.min(high, ceiling - 1)
  if (pending !== null && high !== null && pending <= high) pending = null
  return { confirmedLow: low, confirmedHigh: high, pendingHigh: pending }
}
