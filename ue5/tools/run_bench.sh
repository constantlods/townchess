#!/usr/bin/env bash
# Runs one UE5 benchmark pass inside the render VM and samples GPU telemetry from sysfs.
# Usage: run_bench.sh <WxH> <preset> [screen_percentage]     (env: UE_ROOT, PROJ, OUT, TAG, CVARS="r.X 1,r.Y 0")
set -euo pipefail
# Refuse to start if another Unreal process is alive: a stuck editor once ate 3.5 GB and wrecked a run.
if pgrep -f "Engine/Binaries/Linux/UnrealEditor" >/dev/null; then echo "another UnrealEditor is running" >&2; exit 1; fi
RES=${1:-2560x1440}; PRESET=${2:-high}; SP=${3:-}
UE_ROOT=${UE_ROOT:-$HOME/ue5/UE_5.8.3}; PROJ=${PROJ:-$HOME/projects/TownChessBench}
OUT=${OUT:-$HOME/bench-results}/${RES}-${PRESET}${SP:+-sp$SP}${TAG:+-$TAG}-$(date +%Y%m%d-%H%M%S)
mkdir -p "$OUT"
mkdir -p "$OUT"
W=${RES%x*}; H=${RES#*x}
# The VM also has an emulated display adapter; pick the AMD GPU by PCI vendor id.
CARD=$(for c in /sys/class/drm/card[0-9]*/device; do [ "$(cat $c/vendor 2>/dev/null)" = 0x1002 ] && echo $c && break; done)
( while true; do
    echo "$(date +%s.%N) $(cat $CARD/gpu_busy_percent) $(( $(cat $CARD/mem_info_vram_used) / 1048576 )) $(( $(cat $CARD/hwmon/hwmon*/temp1_input | head -1) / 1000 )) $(cat $CARD/hwmon/hwmon*/power1_average 2>/dev/null | head -1 || echo 0) $(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo) $(awk '{print $1}' /proc/loadavg)"
    sleep 0.5
  done ) > "$OUT/telemetry.log" &
MON=$!
trap 'kill $MON 2>/dev/null || true' EXIT
rm -rf "$PROJ/Saved/Profiling/CSV" "$PROJ/Saved/Screenshots"
/usr/bin/time -v "$UE_ROOT/Engine/Binaries/Linux/UnrealEditor" "$PROJ/TownChessBench.uproject" /Game/Bench/L_Bench \
  -game -RenderOffscreen -windowed -ResX=$W -ResY=$H -vulkan -unattended -nosound -nosplash -csvGpuStats \
  -ExecCmds="${CVARS:+$CVARS,}py $PROJ/Scripts/bench_game.py" -TCShot=$OUT/shot-$RES-$PRESET.png -TCShotRes=$RES -TCPreset=$PRESET -TCWarmSec=${WARM_SEC:-20} ${SP:+-TCScreenPercentage=$SP} \
  -log=bench.log > "$OUT/stdout.log" 2> "$OUT/time.log" || true
cp "$PROJ"/Saved/Profiling/CSV/*.csv "$OUT/" 2>/dev/null || true
find "$PROJ/Saved/Screenshots" -name "*.png" -exec cp {} "$OUT/" \; 2>/dev/null || true
cp "$PROJ/Saved/Logs/bench.log" "$OUT/" 2>/dev/null || true
echo "$OUT"
