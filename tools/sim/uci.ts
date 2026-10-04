/**
 * Minimal UCI client for a separate engine process (Stockfish or any UCI engine). Separate process on purpose: GPL
 * engines must never be linked into TownChess (see packages/learning/src/engineService.ts).
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export class UciEngine {
  private p: ChildProcessWithoutNullStreams;
  private buf = '';
  private waiters: { test: (line: string) => boolean; lines: string[]; resolve: (lines: string[]) => void }[] = [];
  name = 'unknown';

  constructor(readonly path: string) {
    this.p = spawn(path, [], { stdio: 'pipe' });
    this.p.stdout.setEncoding('utf8');
    this.p.stdout.on('data', (d: string) => {
      this.buf += d;
      let i: number;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        for (const w of this.waiters) w.lines.push(line);
        const done = this.waiters.findIndex((w) => w.test(line));
        if (done >= 0) {
          const [w] = this.waiters.splice(done, 1);
          w.resolve(w.lines);
        }
      }
    });
  }

  private send(cmd: string) { this.p.stdin.write(cmd + '\n'); }

  private until(test: (line: string) => boolean, cmd?: string): Promise<string[]> {
    return new Promise((resolve) => {
      this.waiters.push({ test, lines: [], resolve });
      if (cmd) this.send(cmd);
    });
  }

  async init(options: Record<string, string | number | boolean> = {}) {
    const lines = await this.until((l) => l === 'uciok', 'uci');
    this.name = lines.find((l) => l.startsWith('id name '))?.slice(8) ?? 'unknown';
    for (const [k, v] of Object.entries(options)) this.send(`setoption name ${k} value ${v}`);
    await this.until((l) => l === 'readyok', 'isready');
    return this;
  }

  async setOptions(options: Record<string, string | number | boolean>) {
    for (const [k, v] of Object.entries(options)) this.send(`setoption name ${k} value ${v}`);
    await this.until((l) => l === 'readyok', 'isready');
  }

  /** Legal moves (UCI) in a position, from the engine's own move generator ("go perft 1"). */
  async legalMoves(fen: string): Promise<string[]> {
    this.send(`position fen ${fen}`);
    const lines = await this.until((l) => l.startsWith('Nodes searched'), 'go perft 1');
    return lines.filter((l) => /^[a-h][1-8][a-h][1-8][qrbn]?: \d+$/.test(l)).map((l) => l.split(':')[0]).sort();
  }

  /** The engine's view of a position: its normalised FEN and the checking pieces ("d" command). */
  async describe(fen: string): Promise<{ fen: string; checkers: string[] }> {
    this.send(`position fen ${fen}`);
    const lines = await this.until((l) => l.startsWith('Checkers:'), 'd');
    const f = lines.find((l) => l.startsWith('Fen: '))?.slice(5) ?? '';
    const c = lines.find((l) => l.startsWith('Checkers:'))?.slice(9).trim() ?? '';
    return { fen: f, checkers: c ? c.split(/\s+/) : [] };
  }

  async bestMove(fen: string, opts: { movetime?: number; nodes?: number; depth?: number }): Promise<string | null> {
    this.send(`position fen ${fen}`);
    const go = opts.nodes ? `go nodes ${opts.nodes}` : opts.depth ? `go depth ${opts.depth}` : `go movetime ${opts.movetime ?? 100}`;
    const lines = await this.until((l) => l.startsWith('bestmove'), go);
    const m = lines[lines.length - 1].split(/\s+/)[1];
    return m && m !== '(none)' ? m : null;
  }

  async newGame() {
    this.send('ucinewgame');
    await this.until((l) => l === 'readyok', 'isready');
  }

  quit() {
    try { this.send('quit'); } catch { /* already gone */ }
    setTimeout(() => this.p.kill(), 500).unref();
  }
}
