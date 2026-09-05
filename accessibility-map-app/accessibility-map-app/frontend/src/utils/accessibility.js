// Person 2: TTS read-back for report cards (Web Speech API) + shared ARIA helpers.
export function speak(text) {
  const utterance = new SpeechSynthesisUtterance(text)
  window.speechSynthesis.speak(utterance)
}
