<script setup lang="ts">
import { Check, ChevronDown, FlaskConical, Play, SlidersHorizontal, Square, X } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import type { Song, Take } from '../../../shared/document'
import { noteName, offsetLabel } from '../../../shared/notes'
import { clockLabel } from '../../../shared/time'
import { LONG_HOLD_SECONDS } from '../lib/analyze'
import { extractRange, type RangeEvidence, type RangeProfile, type SingFeel } from '../lib/profile'
import { VERDICT_LABELS, type CandidateKey, type ChangeReport, type KeyOutcome, type Verdict } from '../lib/recommend'

const props = defineProps<{
  song: Song
  profile: RangeProfile
  evidence: RangeEvidence[]
  outcome: KeyOutcome
  report: ChangeReport | null
  confirmedOffset: number
  takes: Take[]
  auditioning: string | null
}>()

const emit = defineEmits<{
  audition: [offset: number, lineId: string]
  confirm: [offset: number]
  clear: []
  evidence: [input: { take: Take; feel: SingFeel; octaveSuspect: boolean; useLow: boolean; useHigh: boolean }]
  removeEvidence: [id: string]
}>()

const FEEL_LABELS: Record<SingFeel, string> = { easy: '轻松', tense: '吃力', failed: '没唱上去' }

const open = ref(false)
const inspecting = ref<number | null>(null)
const userPicked = ref(false)
watch(() => props.outcome.best, best => { if (!userPicked.value) inspecting.value = best ?? 0 }, { immediate: true })
watch(() => props.song.id, () => {
  userPicked.value = false
  inspecting.value = props.outcome.best ?? 0
})
function inspect(offset: number) {
  userPicked.value = true
  inspecting.value = offset
}

const groups = computed(() => {
  const by = (verdict: Verdict) => props.outcome.candidates.filter(candidate => candidate.verdict === verdict)
  const conditional = by('conditional')
  const pendingOnly = conditional.length > 0 && conditional.every(candidate => candidate.conditions.some(item => item.bound !== null))
  return [
    { kind: 'auditionable' as Verdict, label: VERDICT_LABELS['auditionable'], items: by('auditionable') },
    { kind: 'conditional' as Verdict, label: pendingOnly ? VERDICT_LABELS['conditional'] : '依赖待复验 / 待测定', items: conditional },
    { kind: 'ruled-out' as Verdict, label: VERDICT_LABELS['ruled-out'], items: by('ruled-out') },
  ]
})

const inspected = computed<CandidateKey | undefined>(() =>
  props.outcome.candidates.find(candidate => candidate.offset === inspecting.value))

const profileSummary = computed(() => {
  if (!props.evidence.length) return '尚未试唱'
  const parts = [
    `下界 ${props.profile.confirmedLow === null ? '未测' : noteName(props.profile.confirmedLow)}`,
    `上界 ${props.profile.confirmedHigh === null ? '未测' : noteName(props.profile.confirmedHigh)}`,
  ]
  if (props.profile.pendingHigh !== null) parts.push(`待复验 ${noteName(props.profile.pendingHigh)}`)
  return parts.join(' · ')
})

const takeId = ref('')
const feel = ref<SingFeel>('easy')
const octaveSuspect = ref(false)
const useLow = ref(true)
const useHigh = ref(true)
const selectedTake = computed(() => props.takes.find(take => take.id === takeId.value) ?? null)
const detected = computed(() => selectedTake.value ? extractRange(selectedTake.value.pitch) : null)
const canSubmit = computed(() =>
  selectedTake.value !== null && detected.value !== null &&
  (detected.value.lowest !== null || detected.value.highest !== null) &&
  (useLow.value || useHigh.value))

function submitEvidence() {
  if (!selectedTake.value || !canSubmit.value) return
  emit('evidence', {
    take: selectedTake.value,
    feel: feel.value,
    octaveSuspect: octaveSuspect.value,
    useLow: useLow.value,
    useHigh: useHigh.value,
  })
  takeId.value = ''
  octaveSuspect.value = false
}

function takeLabel(take: Take) {
  const index = props.takes.length - props.takes.indexOf(take)
  return `录音 ${index}（${clockLabel(take.start, true)}–${clockLabel(take.end, true)}）`
}

function evidenceSummary(item: RangeEvidence) {
  const range = `${item.useLow && item.lowest !== null ? noteName(item.lowest) : '…'}–${item.useHigh && item.highest !== null ? noteName(item.highest) : '…'}`
  const flags = [FEEL_LABELS[item.feel]]
  if (item.octaveSuspect) flags.push('疑似八度')
  return `${range} · ${flags.join(' · ')}`
}
</script>

<template>
  <section class="keyfind" :class="{ open }" aria-labelledby="keyfind-title">
    <button class="keyfind-bar" :aria-expanded="open" @click="open = !open">
      <SlidersHorizontal :size="16" />
      <strong id="keyfind-title">选调助手</strong>
      <span class="keyfind-state mono">练习调 {{ offsetLabel(confirmedOffset) }}</span>
      <span class="keyfind-state">{{ profileSummary }}</span>
      <ChevronDown class="keyfind-caret" :size="16" />
    </button>

    <div v-if="open" class="keyfind-body">
      <div class="keyfind-col">
        <h3 class="keyfind-heading"><FlaskConical :size="14" /> 舒适音域试唱</h3>
        <p v-if="!evidence.length" class="keyfind-hint">先录一句，再把录音标成试唱证据，候选调才会按你的音域分类。</p>
        <template v-else>
          <p class="keyfind-profile">
            <span>下界 <strong class="mono">{{ profile.confirmedLow === null ? '未测' : noteName(profile.confirmedLow) }}</strong></span>
            <span>上界 <strong class="mono">{{ profile.confirmedHigh === null ? '未测' : noteName(profile.confirmedHigh) }}</strong></span>
            <span v-if="profile.pendingHigh !== null" class="pending">待复验 <strong class="mono">{{ noteName(profile.pendingHigh) }}</strong>（疑似八度）</span>
          </p>
          <ul class="evidence-list">
            <li v-for="item in evidence" :key="item.id">
              <div><strong>{{ item.label }}</strong><small class="mono">{{ evidenceSummary(item) }}</small></div>
              <button class="icon-button" :aria-label="`删除证据 ${item.label}`" @click="emit('removeEvidence', item.id)"><X :size="13" /></button>
            </li>
          </ul>
        </template>

        <div class="evidence-form">
          <select v-model="takeId" aria-label="选择用作证据的录音">
            <option value="" disabled>选择这句的录音</option>
            <option v-for="take in takes" :key="take.id" :value="take.id">{{ takeLabel(take) }}</option>
          </select>
          <p v-if="takeId && detected && detected.lowest !== null" class="keyfind-hint">
            检测到 <span class="mono">{{ noteName(detected.lowest!) }}–{{ noteName(detected.highest!) }}</span>；听到的和检测值差一个八度时，勾「疑似八度」。
          </p>
          <p v-else-if="takeId" class="keyfind-hint">这条录音没有检测到足够的音高，换一条试试。</p>
          <div class="feel-picker" role="radiogroup" aria-label="演唱感受">
            <label v-for="(label, key) in FEEL_LABELS" :key="key" :class="{ chosen: feel === key }">
              <input v-model="feel" type="radio" name="feel" :value="key" />{{ label }}
            </label>
          </div>
          <div class="evidence-flags">
            <label><input v-model="useLow" type="checkbox" />确认低音</label>
            <label><input v-model="useHigh" type="checkbox" />确认高音</label>
            <label><input v-model="octaveSuspect" type="checkbox" />疑似八度</label>
          </div>
          <button class="keyfind-action" :disabled="!canSubmit" @click="submitEvidence">生成证据</button>
        </div>
      </div>

      <div class="keyfind-col">
        <h3 class="keyfind-heading"><SlidersHorizontal :size="14" /> 候选调</h3>
        <p v-if="outcome.best !== null" class="keyfind-best">推荐 <strong class="mono">{{ offsetLabel(outcome.best) }}</strong>：{{ outcome.bestReasons[0] }}</p>
        <p v-else class="keyfind-best muted">{{ outcome.bestReasons[0] }}</p>
        <div class="key-groups">
          <div v-for="group in groups" :key="group.kind" class="key-group" :class="group.kind">
            <span class="key-group-label">{{ group.label }} <span class="mono">{{ group.items.length }}</span></span>
            <div class="key-chips">
              <button v-for="candidate in group.items" :key="candidate.offset" class="key-chip mono"
                :class="{ active: inspecting === candidate.offset }"
                @click="inspect(candidate.offset)">
                {{ offsetLabel(candidate.offset) }}<i v-if="candidate.offset === outcome.best" class="best-dot" title="推荐"></i>
              </button>
              <span v-if="!group.items.length" class="key-none">无</span>
            </div>
          </div>
        </div>

        <div v-if="inspected" class="key-detail">
          <p class="key-detail-title">
            <strong class="mono">{{ offsetLabel(inspected.offset) }}</strong>
            <span class="verdict" :class="inspected.verdict">{{ VERDICT_LABELS[inspected.verdict] }}</span>
          </p>
          <ul class="key-reasons">
            <li v-for="(reason, index) in inspected.reasons" :key="index">{{ reason }}</li>
          </ul>
          <p class="keyfind-hint">难唱的句子（按 {{ offsetLabel(inspected.offset) }} 试听）：</p>
          <ul class="hard-lines">
            <li v-for="line in inspected.hardLines" :key="line.line.id">
              <button class="icon-button" :aria-label="`试听「${line.line.text}」`"
                @click="emit('audition', inspected.offset, line.line.id)">
                <Square v-if="auditioning === `${inspected.offset}:${line.line.id}`" :size="12" fill="currentColor" />
                <Play v-else :size="12" fill="currentColor" />
              </button>
              <span class="hard-text">{{ line.line.text }}</span>
              <span class="mono hard-notes">峰 {{ noteName(line.max + inspected.offset) }}<template v-if="line.peakHold >= LONG_HOLD_SECONDS">（长音 {{ line.peakHold.toFixed(1) }}s）</template> · 低 {{ noteName(line.min + inspected.offset) }}</span>
            </li>
          </ul>
          <div class="key-confirm">
            <button v-if="confirmedOffset === inspected.offset" class="keyfind-action" @click="emit('clear')">
              取消练习调（回到原调）
            </button>
            <button v-else class="keyfind-action primary" :disabled="inspected.verdict === 'ruled-out'"
              @click="emit('confirm', inspected.offset)">
              <Check :size="14" /> 用 {{ offsetLabel(inspected.offset) }} 练习
            </button>
            <span v-if="confirmedOffset === inspected.offset" class="keyfind-hint">当前练习调，新录音会按它标记</span>
          </div>
        </div>

        <div v-if="report" class="change-report">
          <h4>新证据带来的变化</h4>
          <ul v-if="report.lines.length">
            <li v-for="(line, index) in report.lines" :key="index">{{ line }}</li>
          </ul>
          <p v-else>新证据没有改变现有结论。</p>
        </div>
      </div>
    </div>
  </section>
</template>
