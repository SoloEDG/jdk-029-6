import type { GuideNote, TimeRange } from '../../../shared/document'

/**
 * 候选调试听：把一句的参考音按候选调转调后用振荡器唱一遍。
 * 只合成导唱旋律，不改伴奏；播完自动停止并回调。
 */
export function createAuditionPlayer(onEnd?: () => void) {
  let ctx: AudioContext | null = null
  let nodes: { osc: OscillatorNode[]; master: GainNode } | null = null
  let timer = 0

  function stop() {
    window.clearTimeout(timer)
    if (!nodes) return
    for (const osc of nodes.osc) {
      try { osc.stop() } catch { /* 已停止 */ }
    }
    nodes.master.disconnect()
    nodes = null
  }

  function play(notes: readonly GuideNote[], line: TimeRange, offset: number) {
    stop()
    ctx ??= new AudioContext()
    void ctx.resume()
    const master = ctx.createGain()
    master.gain.value = 0.22
    master.connect(ctx.destination)
    const startAt = ctx.currentTime + 0.06
    const played: OscillatorNode[] = []
    for (const note of notes) {
      if (note.start < line.start - 1e-6 || note.end > line.end + 1e-6) continue
      const osc = ctx.createOscillator()
      osc.type = 'triangle'
      osc.frequency.value = 440 * 2 ** ((note.midi + offset - 69) / 12)
      const gain = ctx.createGain()
      const from = startAt + note.start - line.start
      const to = startAt + note.end - line.start
      gain.gain.setValueAtTime(0, from)
      gain.gain.linearRampToValueAtTime(0.9, from + 0.03)
      gain.gain.setValueAtTime(0.9, Math.max(from + 0.03, to - 0.05))
      gain.gain.linearRampToValueAtTime(0, to)
      osc.connect(gain)
      gain.connect(master)
      osc.start(from)
      osc.stop(to + 0.02)
      played.push(osc)
    }
    nodes = { osc: played, master }
    timer = window.setTimeout(() => { stop(); onEnd?.() }, (line.end - line.start) * 1000 + 400)
  }

  return { play, stop }
}
