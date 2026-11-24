import type { LyricLine, Song } from '../../../shared/document'

/** 连续停留达到这个时长，最高音就算「连续长高音」，需要额外余量。 */
export const LONG_HOLD_SECONDS = 1.2
/** 连续长高音相对上界需要预留的半音数。 */
export const HIGH_HEADROOM = 1

export type LineTag = 'long-high' | 'short-high' | 'low' | 'plain'

export interface LineProfile {
  line: LyricLine
  min: number
  max: number
  /** 在峰值附近（半音内）连续停留的最长时长（秒）。 */
  peakHold: number
  tag: LineTag
}

export interface SongAnalysis {
  songId: string
  min: number
  max: number
  lines: LineProfile[]
}

/** 峰值附近连续停留的最长时长：允许音符间的小间隙，断开即重算。 */
function peakHold(notes: readonly { start: number; end: number; midi: number }[], max: number) {
  let best = 0
  let segStart = -1
  let segEnd = -1
  for (const note of notes) {
    if (note.midi < max - 0.5) {
      segStart = -1
      continue
    }
    if (segStart < 0 || note.start - segEnd > 0.12) segStart = note.start
    segEnd = note.end
    best = Math.max(best, segEnd - segStart)
  }
  return best
}

export function analyzeSong(song: Song): SongAnalysis {
  const sorted = [...song.notes].sort((a, b) => a.start - b.start)
  const songMin = sorted.length ? Math.min(...sorted.map(note => note.midi)) : 0
  const songMax = sorted.length ? Math.max(...sorted.map(note => note.midi)) : 0
  const lines: LineProfile[] = []
  for (const line of song.lines) {
    const notes = sorted.filter(note => note.start >= line.start - 1e-6 && note.end <= line.end + 1e-6)
    if (!notes.length) continue
    const min = Math.min(...notes.map(note => note.midi))
    const max = Math.max(...notes.map(note => note.midi))
    const hold = peakHold(notes, max)
    const tag: LineTag =
      max >= songMax - 1 && hold >= LONG_HOLD_SECONDS ? 'long-high'
        : max >= songMax - 1 ? 'short-high'
          : min <= songMin + 1 ? 'low'
            : 'plain'
    lines.push({ line, min, max, peakHold: hold, tag })
  }
  return { songId: song.id, min: songMin, max: songMax, lines }
}
