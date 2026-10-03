#!/usr/bin/env bash
# Rebuilds /Game/Bench/L_Bench headless in the render VM. The editor sometimes lingers after quit_editor (it once held
# 3.5 GB of swap), so wait for the script's BUILD marker and then make sure the process is gone.
set -uo pipefail
UE_ROOT=${UE_ROOT:-$HOME/ue5/UE_5.8.3}; PROJ=${PROJ:-$HOME/projects/TownChessBench}
UPROJECT=${UPROJECT:-$(ls "$PROJ"/*.uproject | head -1)}; SCRIPT=${SCRIPT:-$PROJ/Scripts/build_scene.py}
LOG=$PROJ/Saved/Logs/build.log
rm -f "$LOG"
"$UE_ROOT/Engine/Binaries/Linux/UnrealEditor" "$UPROJECT" \
  -ExecutePythonScript="$SCRIPT" -RenderOffscreen -unattended -nosplash -vulkan -log=build.log \
  > "$HOME/build_stdout.log" 2>&1 < /dev/null &
PID=$!
until grep -qE "TCBENCH\] BUILD (OK|FAILED)" "$LOG" 2>/dev/null || ! kill -0 $PID 2>/dev/null; do sleep 5; done
for _ in $(seq 1 24); do kill -0 $PID 2>/dev/null || break; sleep 5; done
kill -9 $PID 2>/dev/null || true
grep -E "TCBENCH\] (BUILD|WARNING)" "$LOG"; grep -A12 "BUILD FAILED" "$LOG" | head -14
