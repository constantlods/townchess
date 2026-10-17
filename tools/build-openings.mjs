// Builds packages/shared/src/openings/book.json from the vendored Lichess chess-openings TSVs (CC0).
// Each named line is replayed with chess.js; the final position (normalised key, see positionKey) maps to the name.
// Several names can reach the same position (transpositions/aliases): the shortest line is canonical, others are
// kept as aliases. Run: npm run build:openings
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'packages/shared/data/openings');
const out = path.join(root, 'packages/shared/src/openings/book.json');

function key(chess) {
  const [placement, turn, castling, ep] = chess.fen().split(' ');
  const legalEp = ep !== '-' && chess.moves({ verbose: true }).some((m) => m.flags.includes('e'));
  return `${placement} ${turn} ${castling} ${legalEp ? ep : '-'}`;
}

const byKey = new Map();
let rows = 0;
for (const f of ['a', 'b', 'c', 'd', 'e']) {
  const lines = fs.readFileSync(path.join(dataDir, `${f}.tsv`), 'utf8').trim().split('\n').slice(1);
  for (const line of lines) {
    const [eco, name, pgn] = line.split('\t');
    const chess = new Chess();
    const sans = pgn.replace(/\d+\.(\.\.)?/g, ' ').trim().split(/\s+/).filter(Boolean);
    for (const san of sans) chess.move(san); // throws on bad data, which is what we want
    const k = key(chess);
    const entry = { eco, name, plies: sans.length, pgn };
    const prev = byKey.get(k);
    if (!prev) byKey.set(k, { ...entry, aliases: [] });
    else if (entry.plies < prev.plies || (entry.plies === prev.plies && entry.name < prev.name)) {
      byKey.set(k, { ...entry, aliases: [...prev.aliases, prev.name] });
    } else prev.aliases.push(name);
    rows++;
  }
}

// Compact form: key -> [eco, name, plies, pgn, aliases?]
const book = {};
for (const [k, e] of [...byKey.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
  book[k] = e.aliases.length ? [e.eco, e.name, e.plies, e.pgn, e.aliases] : [e.eco, e.name, e.plies, e.pgn];
}
fs.writeFileSync(out, JSON.stringify(book));
console.log(`openings: ${rows} named lines -> ${byKey.size} positions -> ${path.relative(root, out)} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
