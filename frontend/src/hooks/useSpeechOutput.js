/**
 * useSpeechOutput.js
 *
 * Manages text-to-speech (TTS) output with voice-native conversational pacing.
 * Provider-agnostic — replace the _utterance internals for ElevenLabs
 * or Cartesia without touching any call sites.
 *
 * Key behaviour:
 *   - Streaming text chunks are accumulated and split at sentence boundaries
 *   - Voice tags ([PAUSE:N], [WAIT]) create silence entries in the queue
 *   - Each complete sentence is queued and spoken immediately (low latency)
 *   - Pauses create deliberate silence between speech — the tutor "breathes"
 *   - [WAIT] at end stops playback and signals the orchestrator to listen
 *   - cancel() stops mid-sentence and clears the entire queue
 *   - Markdown and voice tags are stripped before speaking
 *
 * Queue entry types:
 *   { type: 'speech', text: 'sentence here' }
 *   { type: 'pause',  seconds: 2 }
 *   { type: 'wait' }  — stop speaking, wait for student
 *
 * Interface:
 *   state   → { isSpeaking, currentSentence, isSupported }
 *   control → { feedChunk, flushBuffer, cancel, setRate }
 *   events  → { onSpeakStart, onSpeakEnd, onSentenceStart, onSentenceEnd, onWaitForStudent }
 */

import { useState, useRef, useCallback, useEffect } from 'react';

// ── Voice tag patterns ───────────────────────────────────────────
const PAUSE_TAG_RE = /\[PAUSE:\s*(\d+)\]/gi;
const WAIT_TAG_RE  = /\[WAIT\]/gi;

// ── Sentence splitting ───────────────────────────────────────────
// Split at sentence-terminating punctuation followed by whitespace or end.
// Also split at em-dashes for conversational breaks.
const SENTENCE_END_RE = /(?<=[.!?])\s+|(?<=[.!?])$/;

/**
 * Extract complete sentences and voice tags from accumulated text.
 * Returns structured queue entries (speech, pause, wait) and any leftover.
 */
function extractEntries(text) {
  const entries  = [];
  let   leftover = '';

  // First, split on voice tags to create interleaved segments
  // e.g. "Right.[PAUSE:1] What now?[WAIT]" →
  //   ["Right.", {pause:1}, " What now?", {wait}]
  const segments = [];
  let cursor = 0;
  const tagRe = /\[PAUSE:\s*(\d+)\]|\[WAIT\]/gi;
  let match;

  while ((match = tagRe.exec(text)) !== null) {
    // Text before this tag
    if (match.index > cursor) {
      segments.push({ type: 'text', content: text.slice(cursor, match.index) });
    }
    // The tag itself
    if (match[1] !== undefined) {
      segments.push({ type: 'pause', seconds: parseInt(match[1], 10) });
    } else {
      segments.push({ type: 'wait' });
    }
    cursor = match.index + match[0].length;
  }
  // Remaining text after last tag
  if (cursor < text.length) {
    segments.push({ type: 'text', content: text.slice(cursor) });
  }

  // Now process each segment
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];

    if (seg.type === 'pause') {
      entries.push({ type: 'pause', seconds: seg.seconds });
      continue;
    }
    if (seg.type === 'wait') {
      entries.push({ type: 'wait' });
      continue;
    }

    // Text segment — split into sentences
    const isLast = (i === segments.length - 1);
    const parts  = seg.content.split(SENTENCE_END_RE);

    for (let j = 0; j < parts.length; j++) {
      const part = parts[j].trim();
      if (!part) continue;

      if (j < parts.length - 1) {
        // Complete sentence
        entries.push({ type: 'speech', text: part });
      } else if (isLast) {
        // Last part of last segment — may be incomplete
        leftover = parts[j]; // preserve original whitespace for accumulation
      } else {
        // Last part but more segments follow (a tag comes next) — treat as complete
        entries.push({ type: 'speech', text: part });
      }
    }
  }

  return { entries, leftover };
}

// ── Markdown stripper ────────────────────────────────────────────
// Remove markdown formatting that sounds odd when spoken aloud.
function stripMarkdown(text) {
  return text
    .replace(/```[\s\S]*?```/g, '')         // fenced code blocks → omit
    .replace(/`[^`]+`/g,         '')        // inline code → omit
    .replace(/\*\*([^*]+)\*\*/g, '$1')      // bold → plain
    .replace(/\*([^*]+)\*/g,     '$1')      // italic → plain
    .replace(/#{1,6}\s+/g,       '')        // headers → plain
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links → label only
    .replace(/^[-*+]\s+/gm,      '')        // list bullets → omit
    .replace(/\s{2,}/g,          ' ')       // collapse whitespace
    .trim();
}

// ── Strip any remaining voice tags from spoken text ──────────────
function stripVoiceTags(text) {
  return text.replace(PAUSE_TAG_RE, '').replace(WAIT_TAG_RE, '').trim();
}

// ── Voice picker ─────────────────────────────────────────────────
// Try to find a high-quality English voice, prefer neural / Google ones.
function pickEnglishVoice() {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  return (
    voices.find(v =>
      v.lang.startsWith('en') &&
      (v.name.includes('Google') || v.name.includes('Natural') ||
       v.name.includes('Neural')  || v.name.includes('Premium'))
    ) ||
    voices.find(v => v.lang.startsWith('en-US')) ||
    voices.find(v => v.lang.startsWith('en'))    ||
    null
  );
}

// ── Hook ─────────────────────────────────────────────────────────

export function useSpeechOutput({
  rate           = 1.05,
  pitch          = 1.0,
  onSpeakStart,
  onSpeakEnd,
  onSentenceStart,
  onSentenceEnd,
  onWaitForStudent,
} = {}) {
  const isSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  const [isSpeaking,      setIsSpeaking]      = useState(false);
  const [currentSentence, setCurrentSentence] = useState('');

  // Internal refs
  const queueRef        = useRef([]);      // pending entry queue (speech | pause | wait)
  const bufferRef       = useRef('');      // partial chunk accumulator
  const isPlayingRef    = useRef(false);   // are we currently in a playback cycle?
  const cancelledRef    = useRef(false);   // was cancel() called?
  const pauseTimerRef   = useRef(null);    // active pause timeout
  const rateRef         = useRef(rate);
  const pitchRef        = useRef(pitch);
  const voiceRef        = useRef(null);

  // Callback refs — callers don't need to memoize
  const onSpeakStartRef      = useRef(onSpeakStart);
  const onSpeakEndRef        = useRef(onSpeakEnd);
  const onSentenceStartRef   = useRef(onSentenceStart);
  const onSentenceEndRef     = useRef(onSentenceEnd);
  const onWaitForStudentRef  = useRef(onWaitForStudent);
  useEffect(() => { onSpeakStartRef.current      = onSpeakStart;      }, [onSpeakStart]);
  useEffect(() => { onSpeakEndRef.current        = onSpeakEnd;        }, [onSpeakEnd]);
  useEffect(() => { onSentenceStartRef.current   = onSentenceStart;   }, [onSentenceStart]);
  useEffect(() => { onSentenceEndRef.current     = onSentenceEnd;     }, [onSentenceEnd]);
  useEffect(() => { onWaitForStudentRef.current  = onWaitForStudent;  }, [onWaitForStudent]);

  // Pick a voice once on mount (voices may not be ready immediately)
  useEffect(() => {
    if (!isSupported) return;
    const init = () => { voiceRef.current = pickEnglishVoice(); };
    init();
    window.speechSynthesis.addEventListener('voiceschanged', init);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', init);
  }, [isSupported]);

  // ── Internal: play next entry from queue ──────────────────────
  const playNextRef = useRef(null); // forward-declare for mutual recursion

  playNextRef.current = () => {
    if (!isSupported || cancelledRef.current) return;

    if (queueRef.current.length === 0) {
      // Queue drained — playback cycle is done
      if (isPlayingRef.current) {
        isPlayingRef.current = false;
        setIsSpeaking(false);
        setCurrentSentence('');
        onSpeakEndRef.current?.();
      }
      return;
    }

    const entry = queueRef.current.shift();

    // ── Pause entry: deliberate silence ──────────────────────
    if (entry.type === 'pause') {
      setCurrentSentence('…'); // subtle visual indicator of pause
      pauseTimerRef.current = setTimeout(() => {
        pauseTimerRef.current = null;
        if (!cancelledRef.current) playNextRef.current();
      }, entry.seconds * 1000);
      return;
    }

    // ── Wait entry: stop and signal orchestrator ─────────────
    if (entry.type === 'wait') {
      // End the playback cycle — the tutor is waiting for the student
      isPlayingRef.current = false;
      setIsSpeaking(false);
      setCurrentSentence('');
      onWaitForStudentRef.current?.();
      // Do NOT call playNextRef — the orchestrator decides what happens next
      return;
    }

    // ── Speech entry: speak the sentence ─────────────────────
    const sentence = entry.text;
    setCurrentSentence(sentence);
    onSentenceStartRef.current?.(sentence);

    const utterance       = new SpeechSynthesisUtterance(sentence);
    utterance.rate        = rateRef.current;
    utterance.pitch       = pitchRef.current;
    if (voiceRef.current) utterance.voice = voiceRef.current;

    utterance.onend = () => {
      onSentenceEndRef.current?.(sentence);
      if (!cancelledRef.current) playNextRef.current();
    };

    utterance.onerror = (e) => {
      // 'interrupted' / 'canceled' happen on cancel() — not real errors
      if (e.error !== 'interrupted' && e.error !== 'canceled') {
        console.warn('[SpeechOutput] utterance error:', e.error);
      }
      if (!cancelledRef.current) playNextRef.current(); // skip and continue
    };

    window.speechSynthesis.speak(utterance);
  };

  // ── Enqueue a structured entry and start playback if idle ───
  const enqueueEntry = useCallback((entry) => {
    if (!isSupported) return;

    // For speech entries, strip markdown and voice tags
    if (entry.type === 'speech') {
      const clean = stripVoiceTags(stripMarkdown(entry.text));
      if (!clean) return;
      entry = { type: 'speech', text: clean };
    }

    queueRef.current.push(entry);

    if (!isPlayingRef.current) {
      isPlayingRef.current = true;
      cancelledRef.current = false;
      setIsSpeaking(true);
      onSpeakStartRef.current?.();
      playNextRef.current();
    }
  }, [isSupported]);

  // ── Public: feed streaming chunk ─────────────────────────────
  // Accumulates partial text and produces queue entries as they complete.
  const feedChunk = useCallback((chunk) => {
    bufferRef.current += chunk;
    const { entries, leftover } = extractEntries(bufferRef.current);
    bufferRef.current = leftover;
    entries.forEach(enqueueEntry);
  }, [enqueueEntry]);

  // ── Public: flush remaining buffer at end of stream ──────────
  const flushBuffer = useCallback(() => {
    const remaining = bufferRef.current.trim();
    bufferRef.current = '';
    if (remaining) {
      // Process any final tags/text
      const { entries } = extractEntries(remaining + ' '); // trailing space forces sentence completion
      entries.forEach(enqueueEntry);
    }
  }, [enqueueEntry]);

  // ── Public: cancel all speech immediately ────────────────────
  const cancel = useCallback(() => {
    cancelledRef.current = true;
    queueRef.current     = [];
    bufferRef.current    = '';
    if (pauseTimerRef.current) {
      clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = null;
    }
    if (isSupported) window.speechSynthesis.cancel();
    isPlayingRef.current = false;
    setIsSpeaking(false);
    setCurrentSentence('');
  }, [isSupported]);

  // ── Public: adjust rate at runtime ───────────────────────────
  const setRate = useCallback((r) => { rateRef.current = r; }, []);

  // ── Cleanup ───────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
      if (isSupported) window.speechSynthesis.cancel();
    };
  }, [isSupported]);

  return {
    isSpeaking,
    currentSentence,
    isSupported,
    feedChunk,
    flushBuffer,
    cancel,
    setRate,
  };
}
