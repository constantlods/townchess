"""Summarize a run_bench.sh result directory: UE CSV profile + sysfs telemetry -> one markdown table row.

    python3 summarize_bench.py <result_dir> [<result_dir> ...]

FPS and frame time come from the CSV profiler's FrameTime column. "1% low" is 1000 / (99th percentile frame time).
GPU, game thread and render thread are mean milliseconds. Telemetry has 0.5 s samples:
gpu_busy%, VRAM MB, edge temp C, power uW, VM MemAvailable MB, loadavg.
"""
import csv
import glob
import os
import statistics
import sys


def pct(values, p):
    v = sorted(values)
    return v[min(len(v) - 1, int(len(v) * p))]


def col(rows, *names):
    for n in names:
        if n in rows[0]:
            out = []
            for r in rows:
                try:
                    out.append(float(r[n]))
                except (TypeError, ValueError):
                    pass
            if out:
                return out
    return []


def read_csv(path):
    with open(path, newline="") as f:
        rows = [r for r in csv.DictReader(f)]
    # The profiler appends metadata rows at the end; keep rows whose FrameTime parses.
    good = []
    for r in rows:
        try:
            float(r.get("FrameTime", ""))
            good.append(r)
        except ValueError:
            break
    return good


def summarize(d):
    name = os.path.basename(d.rstrip("/"))
    csvs = sorted(glob.glob(os.path.join(d, "*.csv")))
    if not csvs:
        return f"| {name} | no CSV |"
    rows = read_csv(csvs[-1])
    ft = col(rows, "FrameTime")
    gpu = col(rows, "GPUTime", "GPU/Total", "GPUTime0")
    gt = col(rows, "GameThreadTime")
    rt = col(rows, "RenderThreadTime")
    tel = []
    tp = os.path.join(d, "telemetry.log")
    if os.path.exists(tp):
        for line in open(tp):
            p = line.split()
            if len(p) >= 6:
                try:
                    tel.append([float(x) for x in p[:7]])
                except ValueError:
                    pass
    busy = [t[1] for t in tel if t[1] > 0]
    vram = [t[2] for t in tel]
    temp = [t[3] for t in tel]
    power = [t[4] / 1e6 for t in tel if t[4] > 0]
    memavail = [t[5] for t in tel]
    avg = statistics.mean(ft)
    out = {
        "run": name, "frames": len(ft), "avg_fps": 1000 / avg, "avg_ms": avg,
        "p99_ms": pct(ft, 0.99), "low1_fps": 1000 / pct(ft, 0.99),
        "gpu_ms": statistics.mean(gpu) if gpu else float("nan"),
        "game_ms": statistics.mean(gt) if gt else float("nan"),
        "render_ms": statistics.mean(rt) if rt else float("nan"),
        "busy_avg": statistics.mean(busy) if busy else float("nan"),
        "vram_max": max(vram) if vram else float("nan"),
        "temp_max": max(temp) if temp else float("nan"),
        "power_avg": statistics.mean(power) if power else float("nan"),
        "memavail_min": min(memavail) if memavail else float("nan"),
    }
    return ("| {run} | {frames} | {avg_fps:.1f} | {avg_ms:.2f} | {low1_fps:.1f} | {gpu_ms:.2f} | {game_ms:.2f} | "
            "{render_ms:.2f} | {busy_avg:.0f}% | {vram_max:.0f} | {temp_max:.0f} | {power_avg:.0f} | {memavail_min:.0f} |"
            ).format(**out)


if __name__ == "__main__":
    print("| Run | Frames | Avg FPS | Avg ms | 1% low FPS | GPU ms | Game ms | Render ms | GPU busy | VRAM MB (max) "
          "| Temp °C (max) | Power W (avg) | VM RAM avail MB (min) |")
    print("|" + "---|" * 13)
    for d in sys.argv[1:]:
        print(summarize(d))
