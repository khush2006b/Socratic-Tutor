/**
 * TypingIndicator.jsx
 * Animated three-dot indicator shown while the tutor is "thinking".
 */

import styles from './TypingIndicator.module.css';

export default function TypingIndicator() {
  return (
    <div className={`${styles.wrapper} animate-message-in`} aria-label="Tutor is typing" role="status">
      <div className={styles.avatar} aria-hidden="true">⬡</div>
      <div className={styles.bubble}>
        <span className={styles.dot} style={{ animationDelay: '0ms' }} />
        <span className={styles.dot} style={{ animationDelay: '160ms' }} />
        <span className={styles.dot} style={{ animationDelay: '320ms' }} />
      </div>
    </div>
  );
}
