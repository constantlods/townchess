import type { Color, TimeControl } from './types.js';

/**
 * Pure chess clock. Time is injected (`now`) so it is deterministic in tests
 * and authoritative on the server. The client only ever *displays* a clock.
 */
export class ChessClock {
  remaining: Record<Color, number>;
  running: Color | null = null;
  private lastTick = 0;

  constructor(public readonly tc: TimeControl) {
    this.remaining = { w: tc.initialMs, b: tc.initialMs };
  }

  start(color: Color, now: number): void {
    this.running = color;
    this.lastTick = now;
  }

  /** Bring `remaining` up to date with wall time. */
  sync(now: number): void {
    if (!this.running) return;
    const dt = Math.max(0, now - this.lastTick);
    this.remaining[this.running] = Math.max(0, this.remaining[this.running] - dt);
    this.lastTick = now;
  }

  /** Called after `color` completed a move. Applies increment and hands the clock over. */
  press(color: Color, now: number): void {
    this.sync(now);
    this.remaining[color] += this.tc.incrementMs;
    this.running = color === 'w' ? 'b' : 'w';
    this.lastTick = now;
  }

  stop(now: number): void {
    this.sync(now);
    this.running = null;
  }

  flagged(now: number): Color | null {
    this.sync(now);
    if (this.running && this.remaining[this.running] <= 0) return this.running;
    return null;
  }

  /** Remaining ms for display at `now`, without mutating. */
  peek(color: Color, now: number): number {
    if (this.running !== color) return this.remaining[color];
    return Math.max(0, this.remaining[color] - Math.max(0, now - this.lastTick));
  }
}

export function formatClock(ms: number): string {
  const total = Math.max(0, ms);
  if (total < 10_000) {
    const s = Math.floor(total / 1000);
    const t = Math.floor((total % 1000) / 100);
    return `00:0${s}.${t}`;
  }
  const s = Math.ceil(total / 1000);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
