#!/usr/bin/env node
// Fake UCI engine for CI (no Stockfish needed). Speaks just enough UCI for the core's adapter.
// Usage: node fake-uci.mjs <mode> [stateFile] [logFile]
//   legal       bestmove = first legal move (sorted UCI) of the current position
//   illegal     bestmove e2e5 (never legal: a pawn cannot move three squares)
//   crash-once  first `go` kills the process if stateFile does not exist yet (and creates it); later runs: legal
//   no-start    exits before answering `uci`
//   hang        never answers `go`, ignores `stop` (the adapter must kill it)
//   stop-only   answers `go` only after `stop` (the adapter's stop path)
// logFile, when given, receives every command line read from stdin (for assertions on setoption/ucinewgame).
import fs from 'node:fs';
import readline from 'node:readline';
import { Chess } from 'chess.js';

const [mode = 'legal', stateFile, logFile] = process.argv.slice(2);
if (mode === 'no-start') process.exit(4);
const out = (s) => process.stdout.write(s + '\n');
let chess = new Chess();
let pendingGo = false;

const legalBest = () => {
  const moves = chess.moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion ?? '')).sort();
  return moves[0] ?? '(none)';
};

const rl = readline.createInterface({ input: process.stdin });
rl.on('close', () => process.exit(0)); // stdin EOF = parent gone (Stockfish behaves the same)
rl.on('line', (raw) => {
  const line = raw.trim();
  if (logFile) fs.appendFileSync(logFile, line + '\n');
  const [cmd, ...rest] = line.split(/\s+/);
  switch (cmd) {
    case 'uci':
      out('id name FakeUCI 1.0');
      out('id author TownChess tests');
      out('option name UCI_LimitStrength type check default false');
      out('option name UCI_Elo type spin default 1320 min 1320 max 3190');
      out('uciok');
      break;
    case 'isready': out('readyok'); break;
    case 'ucinewgame': chess = new Chess(); break;
    case 'position': {
      const mi = rest.indexOf('moves');
      const head = mi >= 0 ? rest.slice(0, mi) : rest;
      chess = head[0] === 'fen' ? new Chess(head.slice(1).join(' ')) : new Chess();
      if (mi >= 0) for (const m of rest.slice(mi + 1)) chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
      break;
    }
    case 'go':
      if (mode === 'hang') break;
      if (mode === 'stop-only') { pendingGo = true; break; }
      if (mode === 'crash-once' && stateFile && !fs.existsSync(stateFile)) { fs.writeFileSync(stateFile, 'crashed'); process.exit(3); }
      out('info depth 1 score cp 0 pv ' + legalBest());
      out('bestmove ' + (mode === 'illegal' ? 'e2e5' : legalBest()));
      break;
    case 'stop':
      if (mode === 'stop-only' && pendingGo) { pendingGo = false; out('bestmove ' + legalBest()); }
      break;
    case 'quit': process.exit(0);
  }
});
