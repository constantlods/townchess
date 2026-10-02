import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Cosmetics, PlayerPublic } from '@hc/shared';
import { DEFAULT_COSMETICS } from '@hc/shared';

export interface PlayerRecord {
  id: string;
  username: string;
  rating: number;
  cosmetics: Cosmetics;
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  /** sha256 of the client's secret token. The token itself is never stored. */
  tokenHash: string;
  createdAt: number;
}

const hash = (t: string) => createHash('sha256').update(t).digest('hex');

/**
 * Player store. In-memory with optional JSON-file persistence (no database yet, by design).
 * Identity is an anonymous bearer token issued on first connect and kept by the client.
 */
export class PlayerStore {
  private byId = new Map<string, PlayerRecord>();
  private byToken = new Map<string, string>();
  private dirty = false;

  constructor(private file: string | null) {
    if (file && fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8')) as PlayerRecord[];
      for (const p of data) { this.byId.set(p.id, p); this.byToken.set(p.tokenHash, p.id); }
    }
    if (file) setInterval(() => this.flush(), 5000).unref();
  }

  flush() {
    if (!this.file || !this.dirty) return;
    this.dirty = false;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify([...this.byId.values()]));
    fs.renameSync(tmp, this.file);
  }

  /** Resume by token, or create a new identity. Returns the (possibly new) token. */
  authenticate(token: string | undefined, username?: string): { player: PlayerRecord; token: string } {
    if (token) {
      const id = this.byToken.get(hash(token));
      const p = id ? this.byId.get(id) : undefined;
      if (p) {
        if (username && username !== p.username) { p.username = username; this.dirty = true; }
        return { player: p, token };
      }
    }
    const newToken = randomBytes(24).toString('hex');
    const p: PlayerRecord = {
      id: 'P-' + randomBytes(5).toString('hex').toUpperCase(),
      username: username ?? 'PATIENT_' + String(Math.floor(Math.random() * 90) + 10),
      rating: 1200, cosmetics: { ...DEFAULT_COSMETICS }, gamesPlayed: 0, wins: 0, losses: 0, draws: 0,
      tokenHash: hash(newToken), createdAt: Date.now(),
    };
    this.byId.set(p.id, p);
    this.byToken.set(p.tokenHash, p.id);
    this.dirty = true;
    return { player: p, token: newToken };
  }

  get(id: string) { return this.byId.get(id); }

  setCosmetics(id: string, c: Cosmetics) {
    const p = this.byId.get(id);
    if (p) { p.cosmetics = c; this.dirty = true; }
  }

  publicOf(id: string): PlayerPublic | null {
    const p = this.byId.get(id);
    return p ? { id: p.id, username: p.username, rating: Math.round(p.rating), cosmetics: p.cosmetics } : null;
  }

  /** Record a finished game. Elo (K=32) only when rated. score: 1 white win, 0 black win, 0.5 draw. */
  recordResult(whiteId: string, blackId: string, score: 1 | 0 | 0.5, rated: boolean) {
    const w = this.byId.get(whiteId), b = this.byId.get(blackId);
    if (!w || !b) return;
    for (const [p, s] of [[w, score], [b, 1 - score]] as const) {
      p.gamesPlayed++;
      if (s === 1) p.wins++; else if (s === 0) p.losses++; else p.draws++;
    }
    if (rated) {
      const ew = 1 / (1 + 10 ** ((b.rating - w.rating) / 400));
      const k = 32;
      w.rating += k * (score - ew);
      b.rating += k * ((1 - score) - (1 - ew));
    }
    this.dirty = true;
  }
}
