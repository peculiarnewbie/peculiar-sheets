# Spreadsheet comparison benchmarks

This production-browser suite compares `peculiar-sheets` with the two reference grids from the performance plan: AG Grid Community and Handsontable.

## Scenarios

| Scenario | Dataset | What it isolates |
|---|---:|---|
| `mount-small` | 1,000 x 20 | Baseline initialization and first render |
| `mount-large` | 10,000 x 20 | Initialization scaling, DOM size, and heap |
| `vertical-scroll` | 10,000 x 20 | Two-second full-range vertical scroll and frame latency |
| `horizontal-scroll` | 1,000 x 200 | Two-second full-range horizontal scroll on a wide grid |
| `visible-writes` | 10,000 x 20 | 250 writes concentrated in currently visible rows |
| `offscreen-writes` | 10,000 x 20 | 250 deterministic writes dispersed across the model |
| `batch-writes` | 10,000 x 20 | The same 250 dispersed writes submitted as one public batch |

Scroll scenarios report median, p95, and maximum frame intervals plus Long Tasks API observations. Write scenarios report synchronous mutation time separately from the time to settle through two animation frames, and verify the final value before reporting throughput. Every scenario also records navigation-to-ready, mount-to-two-animation-frames, DOM node count, and JS heap before and after an explicit GC when Chromium exposes it. The pre-GC value shows allocation pressure; the post-GC value is the better retained-memory signal.

## Running

Run three measured iterations of every scenario and implementation:

```sh
pnpm benchmark
```

Select scenarios or implementations while developing:

```sh
BENCHMARK_SCENARIOS=vertical-scroll,horizontal-scroll pnpm benchmark
BENCHMARK_IMPLEMENTATIONS=peculiar-sheets,ag-grid pnpm benchmark
```

Tune repetition without changing source:

```sh
BENCHMARK_WARMUPS=1 BENCHMARK_ITERATIONS=5 pnpm benchmark
```

Transient browser startup failures are retried once. Set `BENCHMARK_RETRIES=0` to disable retries.

## Vertical memory diagnostics

The opt-in same-page diagnostic distinguishes one-time traversal retention from
per-cycle growth. It forces Chromium GC at cumulative cycle checkpoints and
records every cycle's frame metrics, raw and retained heap, DOM count, browser
metadata, and Peculiar Sheets row/cell lifecycle counts:

```sh
BENCHMARK_MEMORY_DIAGNOSTIC=1 \
BENCHMARK_IMPLEMENTATIONS=peculiar-sheets \
BENCHMARK_DIAGNOSTIC_CYCLES=0,1,2,5,10,20 \
BENCHMARK_DIAGNOSTIC_ROWS=1000,5000,10000 \
BENCHMARK_ITERATIONS=1 \
pnpm benchmark
```

PowerShell uses `$env:NAME='value'` assignments before `pnpm benchmark`.
`BENCHMARK_DIAGNOSTIC_COLUMNS` defaults to 20 and
`BENCHMARK_DIAGNOSTIC_DURATION_MS` defaults to 2000. Optional idle probes can
be added with `BENCHMARK_DIAGNOSTIC_IDLE_MS=250,1000`.

When category or retaining-path analysis is warranted, capture post-GC Chrome
heap snapshots at selected cycles with
`BENCHMARK_HEAP_SNAPSHOT_CYCLES=0,1,10`. Snapshots and timestamped raw runs are
written under `.benchmark/`; `vertical-memory-latest.json` always points to the
most recent diagnostic. Heap snapshot collection perturbs the page, so do not
use a snapshot-enabled run as the primary timing curve.

Close other CPU-intensive applications and compare medians from the same machine. Fresh browser processes isolate samples, so the default does not add a warmup. The suite is comparative rather than a universal hardware-independent score.

The first successful run saves both `.benchmark/baseline.json` and `.benchmark/latest.json`. Later runs replace `latest.json` and print changes from the saved baseline. Both files are local and gitignored. Replace the baseline intentionally with:

```sh
BENCHMARK_UPDATE_BASELINE=1 pnpm benchmark
```

AG Grid converts the shared matrix to row objects during measured mount because its public data model requires that representation. Its write adapter uses the public `rowNode.updateData` path. Handsontable runs under its documented non-commercial/evaluation license key. The suite does not change either reference library's licensing terms.

Programmatic independent writes do not represent identical feature work: `peculiar-sheets` records its normal internal edit/history state, while reference grids have different state and history semantics. The batch scenario narrows that gap by using each grid's public batched update path. Treat write scenarios as mutation-path diagnostics; mount, scrolling, DOM size, and heap remain the more direct comparisons.
