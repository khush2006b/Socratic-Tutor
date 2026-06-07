/**
 * TutorChat.jsx
 * Right panel — message history, streaming AI response, voice + text input.
 *
 * Architecture note:
 *   - streamTutorResponse returns an AbortController so we can cancel mid-stream
 *     (e.g., user sends a new message before tutor finishes)
 *   - Streaming content lives in sessionStore.streamingContent (not local state)
 *     so it's accessible to other components if needed
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import useSessionStore from '../store/sessionStore';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { streamTutorResponse } from '../api/tutor';
import TypingIndicator from './TypingIndicator';
import styles from './TutorChat.module.css';


/* ── Message bubble ───────────────────────────────────────────── */

function MessageBubble({ message }) {
  const isStudent = message.role === 'student';

  return (
    <div
      className={`${styles.messageRow} ${isStudent ? styles.studentRow : styles.tutorRow} animate-message-in`}
    >
      {!isStudent && (
        <div className={styles.tutorAvatar} aria-hidden="true">⬡</div>
      )}
      <div className={`${styles.bubble} ${isStudent ? styles.studentBubble : styles.tutorBubble}`}>
        <div className={`${styles.messageContent} prose`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {message.content}
          </ReactMarkdown>
        </div>
        <time
          className={styles.timestamp}
          dateTime={message.timestamp}
          title={new Date(message.timestamp).toLocaleTimeString()}
        >
          {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </time>
      </div>
    </div>
  );
}

/* ── Streaming message bubble ─────────────────────────────────── */

function StreamingBubble({ content }) {
  return (
    <div className={`${styles.messageRow} ${styles.tutorRow}`}>
      <div className={styles.tutorAvatar} aria-hidden="true">⬡</div>
      <div className={`${styles.bubble} ${styles.tutorBubble}`}>
        <div className={`${styles.messageContent} prose`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {content || ''}
          </ReactMarkdown>
          <span className={styles.cursor} aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

/* ── Main component ───────────────────────────────────────────── */

export default function TutorChat() {
  const messages         = useSessionStore((s) => s.messages);
  const isStreaming      = useSessionStore((s) => s.isStreaming);
  const streamingContent = useSessionStore((s) => s.streamingContent);
  const problem          = useSessionStore((s) => s.problem);
  const code             = useSessionStore((s) => s.code);
  const language         = useSessionStore((s) => s.language);
  const phase            = useSessionStore((s) => s.phase);
  const signals          = useSessionStore((s) => s.signals);
  const hintLevelIndex   = useSessionStore((s) => s.hintLevelIndex);
  const studentId        = useSessionStore((s) => s.studentId);
  const sessionId        = useSessionStore((s) => s.sessionId);
  const problemSolved    = useSessionStore((s) => s.problemSolved);

  const addMessage       = useSessionStore((s) => s.addMessage);
  const startStreaming   = useSessionStore((s) => s.startStreaming);
  const appendChunk      = useSessionStore((s) => s.appendStreamChunk);
  const finalizeStream   = useSessionStore((s) => s.finalizeStream);
  const handleTagEvent   = useSessionStore((s) => s.handleTagEvent);
  const setSessionId     = useSessionStore((s) => s.setSessionId);

  const [inputValue, setInputValue] = useState('');
  const scrollRef    = useRef(null);
  const abortRef     = useRef(null);
  const inputRef     = useRef(null);

  /* Auto-scroll to bottom on new messages */
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [messages, isStreaming, streamingContent]);

  /* Abort any in-flight stream on unmount */
  useEffect(() => () => abortRef.current?.abort(), []);

  /* Voice transcript → input field */
  const handleTranscriptRef = useRef(null);
  const handleTranscript = useCallback((text) => {
    setInputValue((prev) => prev ? `${prev} ${text}` : text);
    inputRef.current?.focus();
    useSessionStore.getState().markVoiceReasoningGiven();
  }, []);
  handleTranscriptRef.current = handleTranscript;

  const { isListening, isSupported, startListening, stopListening } = useVoiceInput({
    onUtteranceEnd: (text) => handleTranscriptRef.current?.(text),
  });

  const sendMessage = useCallback(async (text) => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;

    /* Cancel any ongoing stream */
    abortRef.current?.abort();

    addMessage('student', trimmed);
    setInputValue('');
    startStreaming();

    // Include the new message in the history sent to the backend
    const updatedMessages = [
      ...messages,
      { role: 'student', content: trimmed, timestamp: new Date().toISOString() },
    ];

    const controller = streamTutorResponse(
      {
        studentId,
        sessionId,
        problem,
        code,
        language,
        messages: updatedMessages,
        hintLevelIndex,
        signals,
      },
      {
        onChunk:  appendChunk,
        onTags:   handleTagEvent,
        onDone:   (returnedSessionId) => {
          finalizeStream();
          if (returnedSessionId && returnedSessionId !== sessionId) {
            setSessionId(returnedSessionId);
          }
        },
        onError: (err) => {
          console.error('[TutorChat] Stream error:', err);
          finalizeStream();
        },
      }
    );

    abortRef.current = controller;
  }, [
    isStreaming, problem, code, language, messages, signals,
    hintLevelIndex, studentId, sessionId,
    addMessage, startStreaming, appendChunk, finalizeStream,
    handleTagEvent, setSessionId,
  ]);

  const handleSubmit = useCallback((e) => {
    e.preventDefault();
    sendMessage(inputValue);
  }, [inputValue, sendMessage]);

  const handleKeyDown = useCallback((e) => {
    /* Ctrl/Cmd + Enter = send */
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      sendMessage(inputValue);
    }
  }, [inputValue, sendMessage]);

  const isInputDisabled = phase === 'idle' || phase === 'complete' || isStreaming;

  return (
    <div className={styles.panel}>
      {/* Panel header */}
      <div className={styles.panelHeader}>
        <div className={styles.headerLeft}>
          <span className={styles.panelTitle}>Tutor</span>
          {isStreaming && (
            <span className={styles.thinkingBadge} aria-live="polite">thinking…</span>
          )}
        </div>
        <span className={styles.messageCount}>
          {messages.length} {messages.length === 1 ? 'message' : 'messages'}
        </span>
      </div>

      {/* Message list */}
      <div className={styles.messageList} ref={scrollRef} role="log" aria-label="Conversation">
        {/* 🎉 Problem Solved Banner */}
        {problemSolved && (
          <div className={styles.solvedBanner} role="status" aria-live="polite">
            <span className={styles.solvedIcon}>🎉</span>
            <div className={styles.solvedText}>
              <strong>Problem Solved!</strong>
              <span>Click <em>End Session</em> in the header to save your notes.</span>
            </div>
          </div>
        )}

        {messages.length === 0 && phase === 'idle' && (
          <div className={`${styles.emptyState} animate-fade-in`}>
            <span className={styles.emptyIcon} aria-hidden="true">⬡</span>
            <p className={styles.emptyTitle}>SocraticDS Tutor</p>
            <p className={styles.emptyText}>
              Load a problem to begin. The tutor will guide you through it with questions — not answers.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {isStreaming && streamingContent && (
          <StreamingBubble content={streamingContent} />
        )}

        {isStreaming && !streamingContent && (
          <TypingIndicator />
        )}
      </div>

      {/* Input area */}
      <form
        className={styles.inputArea}
        onSubmit={handleSubmit}
        id="form-tutor-input"
      >
        <div className={styles.inputRow}>
          {/* Voice button */}
          {isSupported && (
            <button
              id="btn-voice-input"
              type="button"
              className={`${styles.voiceButton} ${isListening ? styles.voiceActive : ''}`}
              onClick={isListening ? stopListening : startListening}
              disabled={isInputDisabled && !isListening}
              aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
              title={isListening ? 'Click to stop' : 'Speak your reasoning'}
            >
              {isListening ? '◉' : '🎤'}
            </button>
          )}

          {/* Text input */}
          <textarea
            id="input-tutor-message"
            ref={inputRef}
            className={styles.textarea}
            placeholder={
              phase === 'idle'
                ? 'Load a problem first…'
                : 'Explain your reasoning, ask a question…  (Ctrl+Enter to send)'
            }
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isInputDisabled}
            rows={1}
            aria-label="Message to tutor"
          />

          {/* Send button */}
          <button
            id="btn-send-message"
            type="submit"
            className={styles.sendButton}
            disabled={isInputDisabled || !inputValue.trim()}
            aria-label="Send message"
          >
            ↑
          </button>
        </div>

        {isListening && (
          <p className={styles.listeningIndicator} aria-live="polite">
            🔴 Listening — speak your reasoning…
          </p>
        )}

        <p className={styles.hint}>
          The tutor guides with questions. Share your reasoning freely.
        </p>
      </form>
    </div>
  );
}
