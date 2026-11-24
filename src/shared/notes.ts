import type { GuideNote } from './document'

export function noteName(midi: number) {
  const note = Math.round(midi)
  return ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][note % 12] + (Math.floor(note / 12) - 1)
}

export function offsetLabel(offset: number | undefined) {
  if (!offset) return '原调'
  return `${offset > 0 ? '+' : ''}${offset} 调`
}

export function transposeNotes(notes: readonly GuideNote[], offset: number): GuideNote[] {
  return offset ? notes.map(note => ({ ...note, midi: note.midi + offset })) : [...notes]
}
