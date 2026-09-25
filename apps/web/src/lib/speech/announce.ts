'use client'
let unlocked = false
// Keyed by lang tag now instead of one bare variable -- announce() can be
// asked for more than one language in the same session (the display board's
// language selector), so a single cached voice would leak the first
// language's pick onto every later one.
const matchCache = new Map<string, SpeechSynthesisVoice | null>()

// Exact tag or same base language only (no voices[0] catch-all) -- the
// honest "does this browser actually have a voice for this" answer, cached
// per lang until the voice list changes.
function matchVoice(lang: string): SpeechSynthesisVoice | null {
  if (!matchCache.has(lang)) {
    const voices = speechSynthesis.getVoices()
    const match = voices.length
      ? (voices.find(v => v.lang === lang) ?? voices.find(v => v.lang.startsWith(lang.split('-')[0])) ?? null)
      : null
    matchCache.set(lang, match)
  }
  return matchCache.get(lang) ?? null
}

if (typeof window !== 'undefined' && window.speechSynthesis) {
  speechSynthesis.onvoiceschanged = () => { matchCache.clear() }
  setInterval(() => {
    if (speechSynthesis.speaking && !speechSynthesis.paused) { speechSynthesis.pause(); speechSynthesis.resume() }
  }, 14000)
}

export function unlockSpeech() {
  if (unlocked || typeof window === 'undefined' || !window.speechSynthesis) return
  const warm = new SpeechSynthesisUtterance('')
  warm.volume = 0
  speechSynthesis.speak(warm)
  speechSynthesis.cancel()
  unlocked = true
}

// True when the browser has a REAL voice for `lang` -- announce() itself
// still falls back to any available voice so a call never goes silent, but a
// caller deciding whether a translated string is worth speaking (vs. falling
// back to English) needs the honest answer: no match here means don't try.
export function hasVoiceFor(lang: string): boolean {
  if (typeof window === 'undefined' || !window.speechSynthesis) return false
  return matchVoice(lang) !== null
}

export function announce(text: string, lang = 'en-IN') {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  const voices = speechSynthesis.getVoices()
  const voice = matchVoice(lang) ?? (voices.length ? voices[0] : null)
  const utter = new SpeechSynthesisUtterance(text)
  utter.lang = lang
  utter.rate = 0.95
  if (voice) utter.voice = voice
  speechSynthesis.speak(utter)
}
