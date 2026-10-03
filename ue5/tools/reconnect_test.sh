#!/usr/bin/env bash
# Kill/reconnect test for the UE5 client against the local core (docs/NETWORKING.md "Local core").
# 1. play vs the engine and SIGKILL the client at ply N (simulated crash)
# 2. verify the local core exited with it (no orphan process)
# 3. relaunch: the core restores the game from its journal; the client reconnects with its saved token, rebuilds the
#    board/turn/clocks from authoritative state and finishes the game
set -uo pipefail
OUT=${1:-$HOME/tc-results/reconnect}; N=${2:-12}
rm -rf "$OUT" "$HOME/townchess/ue5/TownChess/Saved/TownChess/core/journal"
~/tctools/run_client.sh cpu "$OUT/part1" -tcauto=cpu:novice:w:5+0 -TCKillAtPly=$N -TCTimeout=600 >/dev/null
python3 -c "import json;d=json.load(open('$OUT/part1/result.json'));print('killed at ply',d.get('killed_at_ply'),d.get('killed_fen'))"
sleep 2
if pgrep -f "[s]idecar.ts" >/dev/null; then echo "FAIL orphan local core still running"; pgrep -af "[s]idecar.ts"; else echo "PASS no orphan local core after client kill"; fi
ls "$HOME/townchess/ue5/TownChess/Saved/TownChess/core/journal/"
~/tctools/run_client.sh reconnect "$OUT/part2" -TCTimeout=1200
