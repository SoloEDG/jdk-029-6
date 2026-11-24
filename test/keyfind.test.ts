import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import type { Song } from '../src/shared/document'
import { analyzeSong } from '../src/features/keyfind/lib/analyze'
import { deriveProfile, extractRange, type RangeEvidence } from '../src/features/keyfind/lib/profile'
import { evaluateKey, explainChange, recommend } from '../src/features/keyfind/lib/recommend'
import { useKeyfind } from '../src/features/keyfind/model/useKeyfind'

/** 构造测试歌曲：每句 4 秒，音符时间为句内相对时间 [start, end, midi]。 */
function makeSong(id: string, lines: Array<{ text: string; notes: Array<[number, number, number]> }>): Song {
  return {
    id, title: id, artist: '测试', bpm: 120, key: 'C 大调', duration: lines.length * 4, audio: '', cover: '',
    lines: lines.map((line, index) => ({ id: `${id}-${index + 1}`, text: line.text, start: index * 4, end: index * 4 + 4 })),
    notes: lines.flatMap((line, index) =>
      line.notes.map(([start, end, midi]) => ({ start: start + index * 4, end: end + index * 4, midi }))),
  }
}

let seq = 0
function evidence(input: Partial<RangeEvidence>): RangeEvidence {
  return {
    id: `e${++seq}`, createdAt: seq, label: '试唱', lowest: null, highest: null,
    useLow: true, useHigh: true, octaveSuspect: false, feel: 'easy', ...input,
  }
}

const LOW_LINE = { text: '低下去的句', notes: [[0, 1, 60], [1, 2, 58], [2, 3, 55], [3, 4, 60]] as Array<[number, number, number]> }

describe('最高音相同、却分布在不同句长的两首歌', () => {
  const profile = { confirmedLow: 48, confirmedHigh: 72, pendingHigh: null }
  // 两首歌音域都是 55–70（G3–A♯4），最高音都是 70，只是一个短促、一个长音。
  const shortPeak = makeSong('short', [
    LOW_LINE,
    { text: '短促的高音', notes: [[0, 0.7, 65], [0.7, 1.2, 70], [1.2, 3, 64], [3, 4, 62]] },
  ])
  const longPeak = makeSong('long', [
    LOW_LINE,
    { text: '拖长的高音', notes: [[0, 0.7, 65], [0.7, 2.7, 70], [2.7, 4, 64]] },
  ])

  it('分句标签区分短高音与连续长高音', () => {
    expect(analyzeSong(shortPeak).lines.map(line => line.tag)).toEqual(['low', 'short-high'])
    expect(analyzeSong(longPeak).lines.map(line => line.tag)).toEqual(['low', 'long-high'])
    expect(analyzeSong(longPeak).lines[1].peakHold).toBeCloseTo(2, 5)
  })

  it('同一候选调给出不同结论：短高音可顶到上界，长高音要留余量', () => {
    // +2 调让两首歌的最高音都到 72，正好等于已确认上界。
    expect(evaluateKey(analyzeSong(shortPeak), profile, 2).verdict).toBe('auditionable')
    const longVerdict = evaluateKey(analyzeSong(longPeak), profile, 2)
    expect(longVerdict.verdict).toBe('ruled-out')
    expect(longVerdict.issues[0].message).toContain('连续长高音')
    expect(longVerdict.issues[0].message).toContain('已确认上界')
  })

  it('推荐调因此不同', () => {
    expect(recommend(analyzeSong(shortPeak), profile).best).toBe(-2)
    expect(recommend(analyzeSong(longPeak), profile).best).toBe(-3)
  })
})

describe('疑似八度误判的试唱', () => {
  // 一遍试唱里中低音已确认（48–67），高处检测值 76 与听到的差一个八度。
  const sung = [
    evidence({ label: '中低音句', lowest: 48, highest: 67 }),
    evidence({ label: '高音句', highest: 76, useLow: false, octaveSuspect: true, feel: 'tense' }),
  ]
  const profile = deriveProfile(sung)
  // 歌曲音域 55–73，最高句是连续长高音。
  const song = makeSong('octave', [
    LOW_LINE,
    { text: '够不着的合唱', notes: [[0, 0.7, 65], [0.7, 2.7, 73], [2.7, 4, 64]] },
  ])
  const analysis = analyzeSong(song)

  it('疑似八度的高读数进入待复验上界，而不是确认上界', () => {
    expect(profile).toEqual({ confirmedLow: 48, confirmedHigh: 67, pendingHigh: 76 })
  })

  it('候选调按「已排除 / 依赖待复验上界 / 可以直接试唱」分清', () => {
    // 降 7 调：低音 48 正好贴已确认下界，长高音 67 贴上界——可以直接试唱。
    expect(evaluateKey(analysis, profile, -7).verdict).toBe('auditionable')
    // 再降 1 调：已确认的低音就唱不了——已排除。
    const tooLow = evaluateKey(analysis, profile, -8)
    expect(tooLow.verdict).toBe('ruled-out')
    expect(tooLow.issues[0].message).toContain('低于已确认下界')
    // 降 6 调：长高音 68 超出确认上界 67，只有待复验的 76 成立才行。
    const depends = evaluateKey(analysis, profile, -6)
    expect(depends.verdict).toBe('conditional')
    expect(depends.conditions[0].message).toContain('待复验上界')
    // 升 1 调：长高音负担被拉长到 75，同样压在待复验上界上。
    expect(evaluateKey(analysis, profile, 1).verdict).toBe('conditional')
    // 升 3 调：连待复验上界都不够——已排除。
    const beyond = evaluateKey(analysis, profile, 3)
    expect(beyond.verdict).toBe('ruled-out')
    expect(beyond.issues[0].message).toContain('连待复验上界')
  })

  it('若误信八度读数，同一候选调会被错放行进可试唱', () => {
    const trusting = deriveProfile([
      evidence({ label: '中低音句', lowest: 48, highest: 67 }),
      evidence({ label: '高音句', highest: 76, useLow: false, feel: 'tense' }),
    ])
    expect(trusting.confirmedHigh).toBe(76)
    expect(evaluateKey(analysis, trusting, 1).verdict).toBe('auditionable')
    expect(evaluateKey(analysis, profile, 1).verdict).toBe('conditional')
  })
})

describe('只测出单侧边界的试唱', () => {
  // 只确认了低音 50，上界完全没测。
  const profile = deriveProfile([evidence({ label: '低音句', lowest: 50, useHigh: false })])
  const song = makeSong('oneside', [
    LOW_LINE,
    { text: '没测过的高度', notes: [[0, 0.7, 65], [0.7, 2.7, 73], [2.7, 4, 64]] },
  ])
  const outcome = recommend(analyzeSong(song), profile)

  it('档案只有确认下界，上界与待复验上界都为空', () => {
    expect(profile).toEqual({ confirmedLow: 50, confirmedHigh: null, pendingHigh: null })
  })

  it('没有任何可以直接试唱的调，推荐暂缓', () => {
    expect(outcome.candidates.every(candidate => candidate.verdict !== 'auditionable')).toBe(true)
    expect(outcome.best).toBeNull()
    expect(outcome.bestReasons[0]).toContain('补一次试唱')
  })

  it('压过已确认下界的调被排除，其余依赖待测定的上界', () => {
    const ruledOut = outcome.candidates.find(candidate => candidate.offset === -6)!
    expect(ruledOut.verdict).toBe('ruled-out')
    expect(ruledOut.issues[0].message).toContain('低于已确认下界')
    const unsure = outcome.candidates.find(candidate => candidate.offset === 0)!
    expect(unsure.verdict).toBe('conditional')
    expect(unsure.conditions[0].message).toContain('上界还没有测过')
  })
})

describe('再试唱得到新证据时重新解释推荐', () => {
  const song = makeSong('revise', [
    LOW_LINE,
    { text: '最高的那句', notes: [[0, 0.7, 65], [0.7, 2.7, 70], [2.7, 4, 64]] },
  ])
  const analysis = analyzeSong(song)
  const before = recommend(analysis, deriveProfile([evidence({ lowest: 48, highest: 72 })]))
  // 新证据：68 没唱上去，确认上界从 72 收紧到 67。
  const after = recommend(analysis, deriveProfile([
    evidence({ lowest: 48, highest: 72 }),
    evidence({ label: '冲高失败', highest: 68, useLow: false, feel: 'failed' }),
  ]))
  const report = explainChange(before, after)

  it('上不去的音把确认上界压到它之下', () => {
    expect(after.candidates.every(candidate => candidate.verdict !== 'conditional')).toBe(true)
    expect(after.best).toBe(-5)
    expect(before.best).toBe(-3)
  })

  it('变化解释说明推荐为何改变、哪些调换了分类', () => {
    expect(report.lines.some(line => line.includes('推荐调从 -3 调 改为 -5 调'))).toBe(true)
    const demoted = report.lines.find(line => line.includes('-2 调'))
    expect(demoted).toContain('可以直接试唱 → 已排除')
    expect(demoted).toContain('超出已确认上界')
  })
})

describe('试唱录音的音域提取', () => {  it('取分位数，个别八度误检的离群点不污染结果', () => {
    const points = [
      ...Array.from({ length: 19 }, (_, index) => ({ time: index * 0.1, midi: 60 + (index % 3) })),
      { time: 2, midi: 84 }, // 检测窜了一个八度以上的离群点
      { time: 2.1, midi: null },
    ]
    const range = extractRange(points)
    expect(range.highest).toBeLessThan(84)
    expect(range.lowest).toBe(60)
  })

  it('有效点太少时不硬造边界', () => {
    expect(extractRange([{ time: 0, midi: 60 }, { time: 0.1, midi: null }])).toEqual({ lowest: null, highest: null })
  })
})

describe('试唱 → 选调 → 再试唱的完整链路', () => {
  const song = makeSong('flow', [
    LOW_LINE,
    { text: '最高的那句', notes: [[0, 0.7, 65], [0.7, 2.7, 70], [2.7, 4, 64]] },
  ])

  it('证据逐条进入后，推荐与变化解释跟着更新', () => {
    const keyfind = useKeyfind(ref(song))
    // 还没有证据：不给推荐，提示先补试唱。
    expect(keyfind.outcome.value.best).toBeNull()

    keyfind.addEvidence({
      label: '第一遍', lowest: 48, highest: 72,
      useLow: true, useHigh: true, octaveSuspect: false, feel: 'easy',
    })
    expect(keyfind.profile.value).toEqual({ confirmedLow: 48, confirmedHigh: 72, pendingHigh: null })
    expect(keyfind.outcome.value.best).toBe(-3)

    // 再试唱发现 68 没唱上去：推荐改写，并留下变化解释。
    keyfind.addEvidence({
      label: '冲高失败', lowest: null, highest: 68,
      useLow: false, useHigh: true, octaveSuspect: false, feel: 'failed',
    })
    expect(keyfind.profile.value.confirmedHigh).toBe(67)
    expect(keyfind.outcome.value.best).toBe(-5)
    expect(keyfind.report.value?.lines.some(line => line.includes('推荐调从 -3 调 改为 -5 调'))).toBe(true)

    // 确认练习调，随后可以取消回到原调。
    keyfind.confirmKey(keyfind.outcome.value.best!)
    expect(keyfind.confirmedOffset.value).toBe(-5)
    keyfind.clearKey()
    expect(keyfind.confirmedOffset.value).toBe(0)
  })
})
