#!/usr/bin/env bash
# Runs the TownChess UE5 client headless (uncooked -game, offscreen) with the in-game automation driver.
# Usage: run_client.sh <test> <outdir> [extra UE args...]    e.g. run_client.sh cpu ~/tc-results/cpu -tcauto=cpu:novice:w:untimed
set -uo pipefail
TEST=$1; OUT=$2; shift 2
UE_ROOT=${UE_ROOT:-$HOME/ue5/UE_5.8.3}; PROJ=${PROJ:-$HOME/townchess/ue5/TownChess}
if pgrep -f "Engine/Binaries/Linux/[U]nrealEditor" >/dev/null; then echo "another UnrealEditor is running" >&2; exit 1; fi
mkdir -p "$OUT"
"$UE_ROOT/Engine/Binaries/Linux/UnrealEditor" "$PROJ/TownChess.uproject" /Game/TownChess/L_Table \
  -game -RenderOffscreen -windowed -ResX=1920 -ResY=1080 -vulkan -unattended -nosound -nosplash \
  -ExecCmds="r.SetRes 1920x1080w,py $PROJ/Scripts/autotest.py" -TCTest=$TEST -TCOut=$OUT "$@" \
  -log=client-$TEST.log > "$OUT/stdout.log" 2>&1 < /dev/null
cp "$PROJ/Saved/Logs/client-$TEST.log" "$OUT/" 2>/dev/null
grep -E "\[TCTEST\] (PASS|FAIL|RESULT)" "$OUT/client-$TEST.log" | sed 's/.*\[TCTEST\] //'
