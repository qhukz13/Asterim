/**
 * TerminalStreamThrottler
 *
 * Buffers high-frequency PTY stdout/stderr output chunks and flushes them
 * to the xterm.js instance on 16ms animation frames (60 FPS) to prevent
 * DOM rendering lockups and UI freezes during massive log bursts.
 */
export class TerminalStreamThrottler {
  private queue: string[] = [];
  private totalBufferedLength = 0;
  private maxBufferedLength = 500000; // 500KB safety cap
  private animationFrameId: number | null = null;
  private writeTarget: (data: string) => void;

  constructor(writeTarget: (data: string) => void, maxBufferedLength: number = 500000) {
    this.writeTarget = writeTarget;
    this.maxBufferedLength = maxBufferedLength;
  }

  /**
   * Push incoming raw PTY stream chunk into the throttled buffer queue.
   */
  public push(chunk: string): void {
    if (!chunk) return;

    // Drop oldest chunks if queue exceeds maximum buffer size to protect DOM memory
    if (this.totalBufferedLength + chunk.length > this.maxBufferedLength) {
      while (this.queue.length > 0 && this.totalBufferedLength + chunk.length > this.maxBufferedLength) {
        const dropped = this.queue.shift();
        if (dropped) {
          this.totalBufferedLength -= dropped.length;
        }
      }
    }

    this.queue.push(chunk);
    this.totalBufferedLength += chunk.length;

    this.scheduleFlush();
  }

  /**
   * Schedule next frame flush if not already scheduled.
   */
  private scheduleFlush(): void {
    if (this.animationFrameId !== null) return;

    if (typeof window !== 'undefined' && window.requestAnimationFrame) {
      this.animationFrameId = window.requestAnimationFrame(() => this.flush());
    } else {
      setTimeout(() => this.flush(), 16);
    }
  }

  /**
   * Flush accumulated chunks into xterm.js target writer.
   */
  public flush(): void {
    this.animationFrameId = null;
    if (this.queue.length === 0) return;

    const payload = this.queue.join('');
    this.queue = [];
    this.totalBufferedLength = 0;

    try {
      this.writeTarget(payload);
    } catch (e) {
      console.error('[TerminalStreamThrottler] Error flushing to xterm instance:', e);
    }
  }

  /**
   * Immediately clear all pending buffer queues and cancel pending animation frames.
   */
  public clear(): void {
    if (this.animationFrameId !== null) {
      if (typeof window !== 'undefined' && window.cancelAnimationFrame) {
        window.cancelAnimationFrame(this.animationFrameId);
      }
      this.animationFrameId = null;
    }
    this.queue = [];
    this.totalBufferedLength = 0;
  }
}
