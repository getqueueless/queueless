'use client'
let unlocked = false
let cachedVoice: SpeechSynthesisVoice | null = null

function pickVoice(lang: string) {
  const voices = speechSynthesis.getVoices()
  if (!voices.length) return null
  return voices.find(v => v.lang === lang) ?? voices.find(v => v.lang.startsWith(lang.split('-')[0])) ?? voices[0]
}

if (typeof window !== 'undefined' && window.speechSynthesis) {
  speechSynthesis.onvoiceschanged = () => { cachedVoice = null }
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

export function announce(text: string, lang = 'en-IN') {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  if (!cachedVoice) cachedVoice = pickVoice(lang)
  const utter = new SpeechSynthesisUtterance(text)
  utter.lang = lang
  utter.rate = 0.95
  if (cachedVoice) utter.voice = cachedVoice
  speechSynthesis.speak(utter)
}
