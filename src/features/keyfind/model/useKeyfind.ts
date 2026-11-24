import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import type { Song } from '../../../shared/document'
import { analyzeSong } from '../lib/analyze'
import { createAuditionPlayer } from '../lib/audition'
import { deriveProfile, type RangeEvidence } from '../lib/profile'
import { explainChange, recommend, type ChangeReport } from '../lib/recommend'

const STORE_KEY = 'night-session:keyfind'

interface StoredState {
  evidence: RangeEvidence[]
  confirmed: Record<string, number>
}

function load(): StoredState {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredState>
      return { evidence: parsed.evidence ?? [], confirmed: parsed.confirmed ?? {} }
    }
  } catch { /* 损坏的本地数据按空处理 */ }
  return { evidence: [], confirmed: {} }
}

export function useKeyfind(song: Ref<Song>) {
  const stored = load()
  const evidence = ref<RangeEvidence[]>(stored.evidence)
  const confirmed = ref<Record<string, number>>(stored.confirmed)
  const report = ref<ChangeReport | null>(null)

  const profile = computed(() => deriveProfile(evidence.value))
  const analysis = computed(() => analyzeSong(song.value))
  const outcome = computed(() => recommend(analysis.value, profile.value))
  const confirmedOffset = computed(() => confirmed.value[song.value.id] ?? 0)

  watch([evidence, confirmed], () => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ evidence: evidence.value, confirmed: confirmed.value }))
    } catch { /* 存储不可用时保持本次会话 */ }
  }, { deep: true })

  watch(() => song.value.id, () => { report.value = null; stopAudition() })

  /** 证据变化后重新评估，并留下「结论为什么变了」的解释。 */
  function revise(mutate: () => void) {
    const before = outcome.value
    mutate()
    report.value = explainChange(before, outcome.value)
  }

  function addEvidence(input: Omit<RangeEvidence, 'id' | 'createdAt'>) {
    revise(() => {
      evidence.value = [...evidence.value, { ...input, id: crypto.randomUUID(), createdAt: Date.now() }]
    })
  }

  function removeEvidence(id: string) {
    revise(() => { evidence.value = evidence.value.filter(item => item.id !== id) })
  }

  function confirmKey(offset: number) {
    confirmed.value = { ...confirmed.value, [song.value.id]: offset }
  }

  function clearKey() {
    if (!(song.value.id in confirmed.value)) return
    const next = { ...confirmed.value }
    delete next[song.value.id]
    confirmed.value = next
  }

  const auditioning = ref<string | null>(null)
  const player = createAuditionPlayer(() => { auditioning.value = null })

  function audition(offset: number, lineId: string) {
    const key = `${offset}:${lineId}`
    if (auditioning.value === key) { stopAudition(); return }
    const line = analysis.value.lines.find(item => item.line.id === lineId)
    if (!line) return
    player.play(song.value.notes, line.line, offset)
    auditioning.value = key
  }

  function stopAudition() {
    player.stop()
    auditioning.value = null
  }

  onBeforeUnmount(stopAudition)

  return {
    evidence, profile, analysis, outcome, report, confirmedOffset,
    addEvidence, removeEvidence, confirmKey, clearKey,
    audition, auditioning, stopAudition,
  }
}
