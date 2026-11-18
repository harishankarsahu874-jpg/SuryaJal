import { useCallback, useEffect, useRef, useState } from "react"

export type VoiceLanguage = "en-IN" | "hi-IN"

export interface VoiceNotice {
  kind: "info" | "success" | "error"
  message: string
}

export type MicrophoneAccess = "unknown" | "requesting" | "granted" | "blocked" | "unsupported" | "not-found"

interface SpeechRecognitionAlternativeLike {
  readonly transcript: string
}

interface SpeechRecognitionResultLike {
  readonly [index: number]: SpeechRecognitionAlternativeLike
  readonly isFinal: boolean
  readonly length: number
}

interface SpeechRecognitionEventLike {
  readonly resultIndex: number
  readonly results: ArrayLike<SpeechRecognitionResultLike>
}

interface SpeechRecognitionErrorEventLike {
  readonly error: string
}

interface SpeechRecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives: number
  onend: (() => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onstart: (() => void) | null
  abort(): void
  start(): void
  stop(): void
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor
  webkitSpeechRecognition?: SpeechRecognitionConstructor
}

function getRecognitionConstructor(): SpeechRecognitionConstructor | undefined {
  if (typeof window === "undefined") return undefined
  const speechWindow = window as SpeechWindow
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition
}

function plainTextForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/[ \t]*\n[ \t]*/g, ". ")
    .replace(/\s+/g, " ")
    .trim()
}

function recognitionErrorMessage(error: string): string {
  switch (error) {
    case "not-allowed":
    case "service-not-allowed":
      return "Your browser blocked microphone access. Use Enable mic or How to allow below."
    case "no-speech":
      return "I didn’t hear anything. Tap the microphone and try again."
    case "audio-capture":
      return "No microphone was found. Check your device, or type your question instead."
    case "network":
      return "Your browser’s voice recognition needs a network connection. Try again or type your question."
    default:
      return "Voice input stopped unexpectedly. Try again or type your question."
  }
}

export function useVoiceAssistant() {
  const [speechInputSupported] = useState(() => Boolean(getRecognitionConstructor()))
  const [speechOutputSupported] = useState(() =>
    typeof window !== "undefined" &&
    typeof window.speechSynthesis !== "undefined" &&
    typeof SpeechSynthesisUtterance !== "undefined",
  )
  const [listening, setListening] = useState(false)
  const [voiceReplies, setVoiceReplies] = useState(false)
  const [microphoneAccess, setMicrophoneAccess] = useState<MicrophoneAccess>("unknown")
  const [language, setLanguage] = useState<VoiceLanguage>("en-IN")
  const [notice, setNotice] = useState<VoiceNotice | null>(null)
  const [speakingId, setSpeakingId] = useState<string | null>(null)

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const recognizedSpeechRef = useRef(false)
  const recognitionErrorRef = useRef(false)
  const voiceRepliesRef = useRef(false)
  const currentSpeechIdRef = useRef<string | null>(null)

  const clearNotice = useCallback(() => setNotice(null), [])

  const stopSpeaking = useCallback(() => {
    currentSpeechIdRef.current = null
    setSpeakingId(null)
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel()
    }
  }, [])

  const speak = useCallback((text: string, id: string) => {
    if (!speechOutputSupported || typeof window === "undefined") return
    const plainText = plainTextForSpeech(text)
    if (!plainText) return

    const synthesis = window.speechSynthesis
    currentSpeechIdRef.current = null
    synthesis.cancel()

    const utterance = new SpeechSynthesisUtterance(plainText)
    utterance.lang = language
    const voices = synthesis.getVoices()
    const languageCode = language.toLowerCase().split("-")[0]
    const selectedVoice = voices.find((voice) => voice.lang.toLowerCase() === language.toLowerCase())
      ?? voices.find((voice) => voice.lang.toLowerCase().startsWith(`${languageCode}-`))
    if (selectedVoice) utterance.voice = selectedVoice

    currentSpeechIdRef.current = id
    setSpeakingId(id)
    utterance.onend = () => {
      if (currentSpeechIdRef.current === id) {
        currentSpeechIdRef.current = null
        setSpeakingId(null)
      }
    }
    utterance.onerror = (event) => {
      if (currentSpeechIdRef.current !== id) return
      currentSpeechIdRef.current = null
      setSpeakingId(null)
      if (event.error !== "canceled" && event.error !== "interrupted") {
        setNotice({ kind: "error", message: "Couldn’t play speech. Tap the speaker on an answer to try again." })
      }
    }
    synthesis.speak(utterance)
  }, [language, speechOutputSupported])

  const speakNewReply = useCallback((text: string, id: string) => {
    if (voiceRepliesRef.current) speak(text, id)
  }, [speak])

  const startListening = useCallback((currentDraft: string, onTranscript: (text: string) => void) => {
    const Recognition = getRecognitionConstructor()
    if (!Recognition) {
      setMicrophoneAccess("unsupported")
      setNotice({ kind: "error", message: "Voice input isn’t supported in this browser. Try Chrome or Edge, or keep chatting by text." })
      return
    }
    if (recognitionRef.current) return

    let recognition: SpeechRecognitionLike
    try {
      recognition = new Recognition()
    } catch {
      setNotice({ kind: "error", message: "Couldn’t start voice input. Try again or type your question." })
      return
    }

    recognizedSpeechRef.current = false
    recognitionErrorRef.current = false
    recognition.lang = language
    recognition.continuous = false
    recognition.interimResults = true
    recognition.maxAlternatives = 1
    recognition.onstart = () => {
      if (recognitionRef.current === recognition) {
        setListening(true)
        setNotice({ kind: "info", message: `Listening in ${language === "hi-IN" ? "Hindi" : "English (India)"}… speak now.` })
      }
    }
    recognition.onresult = (event) => {
      if (recognitionRef.current !== recognition) return
      const finalParts: string[] = []
      const interimParts: string[] = []
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index]
        const transcript = result?.[0]?.transcript.trim()
        if (!transcript) continue
        ;(result.isFinal ? finalParts : interimParts).push(transcript)
      }
      const transcript = [...finalParts, ...interimParts].join(" ").trim()
      if (!transcript) return
      recognizedSpeechRef.current = true
      const prefix = currentDraft.trim()
      onTranscript([prefix, transcript].filter(Boolean).join(" ").slice(0, 1500))
    }
    recognition.onerror = (event) => {
      if (recognitionRef.current !== recognition) return
      recognitionErrorRef.current = true
      setListening(false)
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setMicrophoneAccess("blocked")
      }
      if (event.error !== "aborted") {
        setNotice({ kind: "error", message: recognitionErrorMessage(event.error) })
      }
    }
    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return
      recognitionRef.current = null
      setListening(false)
      if (recognitionErrorRef.current) return
      setNotice(recognizedSpeechRef.current
        ? { kind: "success", message: "Voice captured — review the transcript, then tap send." }
        : { kind: "error", message: "I didn’t hear anything. Tap the microphone and try again." })
    }

    recognitionRef.current = recognition
    setListening(true)
    setNotice({ kind: "info", message: "Starting microphone…" })
    try {
      recognition.start()
    } catch {
      recognitionRef.current = null
      setListening(false)
      setNotice({ kind: "error", message: "Couldn’t start voice input. Check microphone access and try again." })
    }
  }, [language])

  const requestMicrophoneAccess = useCallback(async (): Promise<boolean> => {
    if (
      !speechInputSupported ||
      typeof window === "undefined" ||
      !window.isSecureContext ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setMicrophoneAccess("unsupported")
      setNotice({
        kind: "error",
        message: "This browser or page can’t request microphone access. Try Chrome or Edge on HTTPS, or continue by text.",
      })
      return false
    }

    setMicrophoneAccess("requesting")
    setNotice({ kind: "info", message: "Waiting for your browser’s microphone permission…" })
    let stream: MediaStream | undefined
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((track) => track.stop())
      setMicrophoneAccess("granted")
      setNotice({ kind: "success", message: "Microphone allowed. Tap the mic button to start speaking." })
      return true
    } catch (error) {
      const errorName = error instanceof Error ? error.name : ""
      if (["NotAllowedError", "PermissionDeniedError", "SecurityError"].includes(errorName)) {
        setMicrophoneAccess("blocked")
        setNotice({
          kind: "error",
          message: "Your browser still blocks this site. Use How to allow for browser-setting steps, then try again.",
        })
      } else if (["NotFoundError", "DevicesNotFoundError"].includes(errorName)) {
        setMicrophoneAccess("not-found")
        setNotice({ kind: "error", message: "No microphone was found. Connect one, or continue chatting by text." })
      } else {
        setMicrophoneAccess("unknown")
        setNotice({ kind: "error", message: "Couldn’t request microphone access. Check your browser settings and try again." })
      }
      return false
    } finally {
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [speechInputSupported])

  const stopListening = useCallback(() => {
    const recognition = recognitionRef.current
    if (!recognition) return
    setNotice({ kind: "info", message: "Finishing voice capture…" })
    try {
      recognition.stop()
    } catch {
      recognitionRef.current = null
      setListening(false)
    }
  }, [])

  const abortListening = useCallback(() => {
    const recognition = recognitionRef.current
    if (!recognition) return
    recognitionRef.current = null
    recognition.onresult = null
    recognition.onerror = null
    recognition.onend = null
    setListening(false)
    try {
      recognition.abort()
    } catch {
      // It may already have stopped; the conversation can still continue normally.
    }
  }, [])

  const toggleVoiceReplies = useCallback(() => {
    if (!speechOutputSupported) {
      setNotice({ kind: "error", message: "Spoken replies aren’t supported in this browser. You can still read every answer." })
      return
    }
    const next = !voiceRepliesRef.current
    voiceRepliesRef.current = next
    setVoiceReplies(next)
    if (next) {
      setNotice({ kind: "success", message: "Voice replies are on — new answers will be read aloud." })
    } else {
      stopSpeaking()
      setNotice({ kind: "info", message: "Voice replies are off." })
    }
  }, [speechOutputSupported, stopSpeaking])

  useEffect(() => () => {
    const recognition = recognitionRef.current
    if (recognition) {
      recognitionRef.current = null
      recognition.onresult = null
      recognition.onerror = null
      recognition.onend = null
      try {
        recognition.abort()
      } catch {
        // Ignore teardown errors from browsers that already ended recognition.
      }
    }
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel()
    }
  }, [])

  return {
    speechInputSupported,
    speechOutputSupported,
    listening,
    voiceReplies,
    microphoneAccess,
    language,
    setLanguage,
    notice,
    speakingId,
    clearNotice,
    startListening,
    requestMicrophoneAccess,
    stopListening,
    abortListening,
    speak,
    speakNewReply,
    stopSpeaking,
    toggleVoiceReplies,
  }
}
