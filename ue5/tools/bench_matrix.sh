#!/usr/bin/env bash
# Phase 3 benchmark matrix for the RX 6650 XT render VM. Each run: 60 s warm-up, 1200 frames CSV, screenshot.
# Output size is forced with r.SetRes (the offscreen viewport otherwise stays at GameUserSettings' 1280x720), and
# screen percentage is explicit (UE's desktop default would scale render resolution behind our back).
set -u
R=${R:-$HOME/tctools/run_bench.sh}
run() { WARM_SEC=60 "$R" "$@" | tail -1 >> "$HOME/bench-matrix.txt"; }
: > "$HOME/bench-matrix.txt"
# Native resolution, HIGH
run 1920x1080 high 100
run 2560x1440 high 100
run 3840x2160 high 100
# TSR upscaling (internal resolution = output x screen percentage)
run 1920x1080 high 67
run 2560x1440 high 75
run 2560x1440 high 67
run 2560x1440 high 50
run 3840x2160 high 50
run 3840x2160 high 33
# Quality presets at the likely production point: 1440p output, 67% TSR
run 2560x1440 low 67
run 2560x1440 medium 67
run 2560x1440 ultra 67
run 2560x1440 cinematic 67
# Lumen hardware vs software ray tracing at the production point
TAG=swlumen CVARS="r.Lumen.HardwareRayTracing 0" run 2560x1440 high 67
# Phone portrait
run 1170x2532 high 67
echo DONE >> "$HOME/bench-matrix.txt"
