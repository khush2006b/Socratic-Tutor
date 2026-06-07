/**
 * tutor.js
 * Real API layer — connects to the SocraticDS FastAPI backend.
 *
 * Public contract:
 *   parseProblem(input)                        → Problem
 *   streamTutorResponse(payload, cbs)          → AbortController
 *   requestHint(nextHintIndex, context)        → HintResponse
 *   submitReflection(data)                     → void
 *
 * All functions accept and return the same shapes as before.
 * Components don't need to change.
 */

import useAuthStore from '../store/authStore';
import { apiFetch, getAuthHeaders, API_BASE_URL } from './client.js';

/* ── parseProblem ─────────────────────────────────────────────── */

/**
 * Parse a problem from user input (number, URL, or title).
 * @param {string} input
 * @returns {Promise<object>} Problem object
 */
export async function parseProblem(input) {
  const res = await apiFetch('/api/problems/parse', {
    method: 'POST',
    body: JSON.stringify({ input }),
  });
  return res.json();
}

/* ── streamTutorResponse ──────────────────────────────────────── */

/**
 * Stream a Socratic tutor response via SSE.
 *
 * SSE event types from backend:
 *   { type: 'chunk', content: '...' }
 *   { type: 'tags',  misconceptions, mastery, vizTriggers, waitSeconds }
 *   { type: 'done' }
 *   { type: 'error', message: '...' }
 *
 * Callbacks:
 *   onChunk(text)          — called for each streamed text chunk
 *   onTags(tagsEvent)      — called once when Gemini tag event arrives
 *   onDone(sessionId)      — called when stream ends; sessionId from X-Session-Id header
 *   onError(Error)         — called on network/backend error
 *
 * @param {object}   payload
 * @param {object}   callbacks { onChunk, onTags, onDone, onError }
 * @returns {AbortController}
 */
export function streamTutorResponse(payload, callbacks = {}) {
  const { onChunk, onTags, onDone, onError } = callbacks;

  const controller = new AbortController();
  const { signal } = controller;

  (async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/tutor/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          // student_id in body is informational only — backend uses JWT for identity
          student_id:     useAuthStore.getState().userId() ?? 'anonymous',
          sessionId:      payload.sessionId ?? null,
          problem:        payload.problem ?? null,
          code:           payload.code ?? '',
          language:       payload.language ?? 'python',
          messages:       payload.messages ?? [],
          hintLevelIndex: payload.hintLevelIndex ?? -1,
          signals:        payload.signals ?? {},
          voiceMode:      payload.voiceMode ?? false,
        }),
        signal,
      });

      if (!res.ok) {
        let detail = `Stream error ${res.status}`;
        try { const b = await res.json(); detail = b.detail ?? detail; } catch { /* ignore */ }
        throw new Error(detail);
      }

      // Extract session ID from response header (may be null if CORS doesn't expose it)
      const headerSessionId = res.headers.get('X-Session-Id') || null;
      let resolvedSessionId = headerSessionId;

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const event of events) {
          const line = event.trim();
          if (!line.startsWith('data:')) continue;

          const jsonStr = line.slice('data:'.length).trim();
          if (!jsonStr) continue;

          try {
            const parsed = JSON.parse(jsonStr);
            switch (parsed.type) {
              case 'chunk':
                onChunk?.(parsed.content);
                break;
              case 'tags':
                onTags?.(parsed);
                break;
              case 'done':
                // SSE body is the most reliable source — doesn't need CORS expose_headers
                resolvedSessionId = parsed.sessionId || headerSessionId || null;
                onDone?.(resolvedSessionId);
                return;
              case 'error':
                onError?.(new Error(parsed.message ?? 'Unknown stream error'));
                return;
            }
          } catch { /* malformed JSON */ }
        }
      }

      onDone?.(resolvedSessionId);
    } catch (err) {
      if (err.name !== 'AbortError') onError?.(err);
    }
  })();

  return controller;
}

/* ── requestHint ──────────────────────────────────────────────── */

/**
 * Request the next hint in the ladder.
 * @param {number} nextHintIndex  0–3
 * @param {object} context        { problem, code, studentId }
 * @returns {Promise<{ level, label, content }>}
 */
export async function requestHint(nextHintIndex, context) {
  const res = await apiFetch('/api/hints', {
    method: 'POST',
    body: JSON.stringify({
      nextHintIndex,
      problem: context.problem ?? null,
      code:    context.code ?? '',
    }),
  });
  return res.json();
}

/* ── submitReflection ─────────────────────────────────────────── */

/**
 * Submit session reflection data to the backend.
 * @param {object} data
 * @returns {Promise<void>}
 */
export async function submitReflection(data) {
  // Always use the real authenticated user's ID — never fall back to 'anonymous'
  const studentId = useAuthStore.getState().userId() ?? data.studentId;
  if (!studentId) {
    console.warn('submitReflection: no authenticated user — reflection not saved');
    return;
  }

  const sessionId = data.sessionId;
  if (!sessionId) {
    console.warn('submitReflection: no sessionId — reflection not saved (session was never created)');
    return;
  }

  await apiFetch(`/api/sessions/${sessionId}/reflect`, {
    method: 'POST',
    body: JSON.stringify({
      student_id:      studentId,
      problem_id:      data.problemId   ?? null,
      problem_title:   data.problemTitle ?? null,
      problem_data:    data.problem      ?? null,
      messages:        data.messages     ?? [],
      answers:         data.answers      ?? {},
      hints_used:      data.hintsUsed    ?? 0,
      elapsed_seconds: data.elapsedSeconds ?? 0,
      timestamp:       data.timestamp   ?? new Date().toISOString(),
    }),
  });
}

/* Re-export REFLECTION_PROMPTS so ReflectionModal import still works */
export { REFLECTION_PROMPTS } from './mockData.js';
