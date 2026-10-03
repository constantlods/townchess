#!/usr/bin/env bash
# Phase 3 benchmark matrix for the RX 6650 XT render VM. Each run: 60 s warm-up, 1200 frames CSV, screenshot.
# Screen percentage is always explicit (UE's desktop default scales render resolution with output resolution).
set -u
R=${R:-$HOME/tctools/run_bench.sh}
run() { WARM_SEC=60 "$R" "$@" | tail -1 >> "$HOME/bench-matrix.txt"; }
: > "$HOME/bench-matrix.txt"
run 1920x1080 high 100
run 2560x1440 high 100
run 3840x2160 high 100
run 2560x1440 low 100
run 2560x1440 medium 100
run 2560x1440 ultra 100
run 2560x1440 cinematic 100
run 2560x1440 high 67                                   # TSR 1440p from ~965p
run 3840x2160 high 50                                   # TSR 4K from 1080p
run 3840x2160 ultra 67                                  # TSR 4K from 1440p
TAG=swlumen CVARS="r.Lumen.HardwareRayTracing 0" run 2560x1440 high 100
TAG=noRT CVARS="r.RayTracing.Enable 0" run 2560x1440 high 100
run 1170x2532 high 100
echo DONE >> "$HOME/bench-matrix.txt"
