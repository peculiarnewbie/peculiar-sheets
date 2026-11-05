# Spreadsheet comparison benchmarks

This production-browser suite compares `peculiar-sheets` with AG Grid Community, Handsontable, and [RevoGrid](https://rv-grid.com/) by default. [GridSheet](https://gridsheet.walkframe.com/) and [Univer](https://univer.ai/) remain available as opt-in implementations. Each implementation is loaded separately, with the same deterministic datasets, 28px rows, and 100px columns.

| Implementation ID | Integration                               | Bulk update path                                         |
| ----------------- | ----------------------------------------- | -------------------------------------------------------- |
| `peculiar-sheets` | Solid component                           | Controlled `data` + `rowIds`                             |
| `ag-grid`         | Community JavaScript grid                 | Keyed `rowData`                                          |
| `handsontable`    | JavaScript spreadsheet                    | `updateData`                                             |
| `gridsheet`       | React component (`@gridsheet/react-core`) | Public row insertion/removal and one `sheet.update` diff |
| `revogrid`        | Community web component                   | Replace `source`                                         |
| `univer`          | Open-source Sheets Core preset            | Clear on shrink, resize, and range `setValues`           |

## Scenarios

| Scenario                    |                                 Dataset | What it isolates                                                                           |
| --------------------------- | --------------------------------------: | ------------------------------------------------------------------------------------------ |
| `mount-small`               |                              1,000 x 20 | Baseline initialization and first render                                                   |
| `mount-large`               |                             10,000 x 20 | Initialization scaling, DOM size, and heap                                                 |
| `vertical-scroll`           |                             10,000 x 20 | Two-second full-range vertical scroll and frame latency                                    |
| `horizontal-scroll`         |                             1,000 x 200 | Two-second full-range horizontal scroll on a wide grid                                     |
| `visible-writes`            |                             10,000 x 20 | 250 writes concentrated in currently visible rows                                          |
| `offscreen-writes`          |                             10,000 x 20 | 250 deterministic writes dispersed across the model                                        |
| `batch-writes`              |                             10,000 x 20 | The same 250 dispersed writes submitted as one public batch                                |
| `replace-large-disjoint`    |                     10,000 x 1 → 10 x 1 | Controlled replacement with no retained row IDs                                            |
| `replace-large-retained`    |                     10,000 x 1 → 10 x 1 | Controlled replacement retaining the last ten row IDs                                      |
| `replace-small-disjoint`    |                         10 x 1 → 10 x 1 | Small controlled-replacement baseline                                                      |
| `replace-small-large`       |                     10 x 1 → 10,000 x 1 | Controlled growth with disjoint row IDs                                                    |
| `replace-filter-roundtrip`  |        10,000 x 1 → 10 x 1 → 10,000 x 1 | Filter-like shrink and restore                                                             |
| `replace-few-cells`         |                              10,000 x 1 | Stable row IDs with three changed cells                                                    |
| `edit-commit`               |                             10,000 x 20 | Five double-click, replace-text, Enter edits through trusted input                         |
| `keyboard-navigation`       |                             10,000 x 20 | 40 down, 12 Tab, and 5 up steps across both viewport boundaries                            |
| `paste-small / paste-large` |                             10,000 x 20 | Native clipboard paste of 100 x 20 / 1,000 x 20 cells                                      |
| `clear-undo-redo`           |                             10,000 x 20 | Clear a 100 x 20 selection, undo, redo; verify every value                                 |
| `scroll-wheel-slow`         |                             10,000 x 20 | Forty 24px wheel steps paced over two seconds                                              |
| `scroll-wheel-bursts`       |                             10,000 x 20 | Twenty 350px wheel steps paced over two seconds                                            |
| `scroll-diagonal`           |                             1,000 x 200 | Twenty 120px horizontal + 350px vertical wheel steps over two seconds                      |
| `scroll-jump`               |                             10,000 x 20 | Jump to 75%, 25%, and 90%; verify and click destination cells                              |
| `replace-wide-retained`     |                   10,000 x 20 → 10 x 20 | Retained-row replacement with realistic width                                              |
| `replace-wide-grow`         |                  10 x 200 → 1,000 x 200 | Growth on a wide dataset                                                                   |
| `row-reorder`               |                             10,000 x 20 | Reverse row order, preserving IDs and an edited value                                      |
| `row-insert-delete`         | 10,000 x 20 → 10,100 x 20 → 10,000 x 20 | Insert 100 rows in the middle, then remove them through bulk replacement                   |
| `streaming-updates`         |                             10,000 x 20 | Five-second feed, all 50 batches of 100 writes, while editing, navigating, and scrolling |
| `mount-tall`                |                            100,000 x 20 | Initialization scaling for a tall matrix                                                   |
| `mount-wide`                |                             1,000 x 200 | Initialization of a wide matrix                                                            |
| `mount-mixed`               |                             10,000 x 20 | Numbers, strings, blanks, booleans, and long text                                          |
| `mount-sparse`              |                            100,000 x 20 | Dense matrix with 95% blanks; not a sparse storage API                                     |

Scroll scenarios report median, p95, and maximum frame intervals plus Long Tasks API observations. Write headlines measure API completion, including returned promises, with synchronous submission and two-frame settling reported separately. Every final written cell is verified immediately after API completion before reporting throughput. Repeated writes to the same cell are checked against their last value. Mount scenarios check the first and last model cell; the four default DOM adapters also wait for the first visible cell to render before ending mount timing. Every scenario also records navigation-to-ready, mount-to-two-animation-frames, DOM element count (including open shadow roots), and JS heap before and after an explicit GC when Chromium exposes it. The pre-GC value shows allocation pressure; the post-GC value is the better retained-memory signal.

GridSheet uses its native scroll container. RevoGrid has separate containers for the two axes, so its public `scrollToCoordinate` API moves them together with its virtual viewport. Univer renders cells on canvas and uses its public `scrollToCell` API to traverse the same normalized full range. The harness awaits asynchronous scroll submissions before requesting the next frame. Univer's DOM count describes the canvas UI rather than individual cells. Both rendering approaches are included in memory and frame measurements.

Replacement scenarios exercise the public bulk paths listed above. Peculiar Sheets and AG Grid receive stable row IDs. The other adapters use positional bulk replacement, so retained-ID scenarios are bulk-replacement baselines rather than identity-contract comparisons for those libraries. The scenarios report synchronous reconciliation separately from two-frame settling; Peculiar Sheets also records internal operation counts and phase durations under `replacement.profile` in `.benchmark/latest.json`. Use `BENCHMARK_ROWS` or `BENCHMARK_COLUMNS` to override the starting dimensions for scaling diagnostics.

The core suite has 31 scenarios. Browser workloads use CDP to generate trusted mouse, key, text-input, wheel, and native paste events. Clipboard payloads are seeded with the browser Clipboard API after granting localhost permission. Range selection is prepared through public APIs before clear/undo/redo; clear and history actions use keyboard shortcuts. Navigation verifies each step before the next input, allowing asynchronous focus changes.

Interaction results separate event-handler-entry-to-two-frame response from verified completion. The former is measured inside the browser and is a rendering-response proxy, not INP or a final-paint guarantee. Verified completion includes the driver's verification roundtrip, checks resulting data/focus, and excludes the cell-scan cost. Scripted total duration includes driver overhead and pacing and is not ranked as throughput. Frame intervals and long tasks are also recorded. Streaming results require all 50 batches and 5,000 writes, including any backlog after five seconds. The probe remains active until they complete.

Every replacement cell is verified outside the measured interval. Row reorder and middle insertion/removal also preserve an edited value and record focus/scroll state before and after. Whether focus follows a retained row is an observation, since identity contracts differ. These are host-provided bulk updates, rather than native sorting or structural-edit commands. Long-session and formula tests are excluded from the core suite; the older memory diagnostic remains opt-in.

AG Grid Community's rectangular clipboard and range-selection cases are unsupported; those features require Enterprise. RevoGrid Community's clear/undo/redo case is unsupported because history requires Pro. GridSheet and Univer support new mount and replacement workloads, but their new browser interaction adapters are not implemented. These omissions have distinct reasons saved in `skipped`; omitted timings are never recorded as zero.

## Running

Install workspace dependencies with `pnpm install`, then run the default adaptive sampling plan using Node and the workspace's `tsx` runner: four to twelve measured repetitions per case and library (up to 96 for `replace-large-disjoint`), stopping each case once its headline ratios are decided. See [Adaptive sampling](#adaptive-sampling):

```sh
pnpm benchmark
```

Select scenarios or implementations while developing:

```sh
BENCHMARK_SCENARIOS=vertical-scroll,horizontal-scroll pnpm benchmark
BENCHMARK_IMPLEMENTATIONS=peculiar-sheets,ag-grid pnpm benchmark
pnpm benchmark --include=gridsheet,univer
```

GridSheet and Univer are omitted by default; `--include` adds implementations to the default selection. `BENCHMARK_IMPLEMENTATIONS` still selects an exact set (including optional libraries), and `--include` can extend that set.

Handsontable is omitted from `visible-writes`, `offscreen-writes`, and `batch-writes` by default. Its other scenarios remain enabled. Restore those write cases, or inspect the selected scenario/library pairs without launching a browser:

```sh
pnpm benchmark --include-handsontable-writes
pnpm benchmark --include=gridsheet,univer --include-handsontable-writes
pnpm benchmark --list
```

The default run has 117 supported scenario/library pairs. The fixed plan (`BENCHMARK_SAMPLING=fixed`) takes 1,740 measured samples: twelve repetitions per pair, with 96 for the four `replace-large-disjoint` pairs. The adaptive default takes between 468 and that maximum. Explicit skips are printed and saved in the snapshot. `--include=gridsheet,univer` adds their supported cases; `--include-handsontable-writes` restores the three older write scenarios. Unsupported edition features remain omitted. `--list` includes each pair's effective repetition count, or its adaptive minimum and maximum.

Each completed run saves timestamped raw results and generates `.benchmark/overview.html` (six expandable summary categories), `comparison-table.html`, `summary.csv`, `summary.json`, and `report.md`. Regenerate reports without launching a browser, or validate the harness:

```sh
pnpm benchmark:report
pnpm benchmark:test
pnpm benchmark:typecheck
```

Use `BENCHMARK_OUTPUT_DIR=.benchmark/smoke` to isolate development runs from the main results and baseline. Snapshots record run start time, total elapsed time (including builds), and omission reasons.

Tune repetition without changing source:

```sh
BENCHMARK_WARMUPS=1 BENCHMARK_ITERATIONS=5 pnpm benchmark
BENCHMARK_SAMPLING=fixed pnpm benchmark
BENCHMARK_MIN_ITERATIONS=6 BENCHMARK_MAX_ITERATIONS=20 pnpm benchmark
```

An explicit `BENCHMARK_ITERATIONS` selects fixed sampling and overrides every selected case, including the 96-repetition precision allowance. Snapshots store the base `iterations` and any `scenarioIterations` overrides. Reports validate each pair against its own count and display the effective counts; CSV and JSON exports retain the actual sample count for every bar. Historical snapshots without overrides retain their original uniform counts. Baseline speed comparisons require matching counts for every selected case.

Failed samples stop the run by default, preserving partial results and the per-sample journal. Set `BENCHMARK_RETRIES=1` to opt into retrying failures for diagnostics; retries are printed. Completed timing samples are never discarded or retried for their timing values. The journal is flushed to disk between samples, after browser cleanup.

Stagehand discovers a local Chrome installation by default. Set `BENCHMARK_CHROME_PATH=/absolute/path/to/chrome` to select another executable. Restricted environments that require Chromium's sandbox disabled can opt in with `BENCHMARK_NO_SANDBOX=1`. These launch options also apply to memory diagnostics.

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

GridSheet uses one public update diff for batched writes. RevoGrid uses `setDataAt` for independent writes and in-place source edits followed by one public `refresh` for a batch. Univer uses single-cell ranges for independent writes and one sparse range `setValues` call for a batch. All adapters check data from the live library model, including offscreen writes. Conversion from the shared matrix into a library's required data representation is included in measured mount or replacement time.

The workloads contain values, without formulas. Handsontable uses no wrapping or automatic row sizing, with theme padding reduced to allow an actual 28px row; AG Grid disables inferred cell data types so plain text edits are accepted consistently. GridSheet and the Univer Sheets Core preset include formula support in their standard distributions; this suite does not measure formula-engine speed or equalize every editor feature. Univer's header, toolbar, formula bar, and footer are hidden to focus the viewport on cells; GridSheet's formula bar is also hidden.

## Measurement protocol: API completion v2

### Isolated timer and editor readiness (new-host harness correction)

The runner builds `apps/benchmarks` and serves that build with Vite **preview**.
Both preview and development send COOP `same-origin` and COEP `require-corp`.
The app bundles its libraries and styles locally; it has no configured remote
fonts or CDN dependencies. Each sample must be `crossOriginIsolated` and records
`timingEnvironment`: isolation status, the smallest positive `performance.now()`
step observed across up to 128 ticks / 100,000 reads, and the positive tick count.
This probe runs outside workload timing. The observed minimum is an empirical
granularity observation, not a guarantee of clock accuracy.

Snapshots and sample journals record `timerProtocol: "cross-origin-isolated-v1"`;
baseline comparisons reject snapshots without that protocol. API completion v2
still defines the write metric. Higher timer resolution is a **measurement
correction, not a library speedup**; establish a fresh baseline and do not compare
the old coarsened-clock scores as optimization evidence.

Trusted edits retain double-click, Ctrl+A, insert text, Enter, and read-back.
After the existing two-frame settle, the driver waits for a writable editor to
hold focus inside the benchmark root (following open shadow roots), then verifies
that Ctrl+A selected all text before inserting. Every library uses the same
checks, timeout, and polling interval, including the edit during streaming.
After Enter, the driver also waits for visible editors to close before verifying
the saved value and starting another input. RevoGrid commits its model before
its delayed Enter navigation closes the editor; two frames can finish before
that navigation on a fast host. Starting the next edit earlier lets the pending
navigation cancel that editor, intercept Ctrl+A, and leave the old text in place.
Readiness waiting remains inside the interaction window: users cannot replace
text before an editor is ready, and moving that cost outside would hide required
work. Polling adds uniform driver overhead; scripted duration is not throughput.
No input is retried and failed selection stops the sample before inserting text.

The three write headline observations measure time from the first submission until every returned promise resolves. Read-back immediately verifies the promised model changes. This includes asynchronous adapter work; synchronous submission time alone is not comparable across synchronous and asynchronous APIs. Throughput uses completed operations, rather than only submission cost.

Synchronous submission and frame-settled wall time remain separate diagnostics. The latter includes validation and two animation frames and is not used to rank write API completion. Frame callbacks share a frame timestamp even when invoked at different wall-clock times; waiting for two callbacks can therefore reward a late start. See the [HTML animation-frame callback algorithm](https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#run-the-animation-frame-callbacks). Browser probes also found large identical-code differences in this proxy. This protocol change is a measurement correction, not a library optimization.

The default is twelve fixed repetitions, with 96 for the fast `replace-large-disjoint` workload. Its short frame-settled measurement showed excessive identical-code variation at twelve repetitions; two independent 96-repetition controls validated the higher count across every default library. This is a precision correction for a case Peculiar Sheets already led, not a library speedup. Both counts balance every run position exactly for the default two-, three-, and four-library comparison groups. All samples are retained; no timing outliers are discarded. Each repetition still uses a fresh browser and the same short workload. An explicit `BENCHMARK_ITERATIONS` overrides all cases for diagnostics.

Snapshots record `measurementProtocol: "api-completion-v2"`. Historical snapshots retain their legacy interpretation and are not compared as speedups against v2. A fresh baseline is required when the timing protocol, CPU placement, or effective sample counts change. The same 39 headline observations, 31 scenarios, library versions, capability exclusions, datasets, and workloads remain; only the three write timing definitions and sampling/order policy change. The final default sampling plan produces 1,740 samples; the initial uniform twelve-repetition v2 plan produced 1,404, and the older three-repetition plan produced 351.

On Linux the launcher reads the process's allowed CPU list and per-core capacity. On heterogeneous CPUs it pins the entire runner and all browser descendants to the highest-capacity homogeneous cluster, using `taskset`. Homogeneous hosts retain their allowed CPUs. No system-wide governor or affinity setting changes. `BENCHMARK_CPUSET=all` opts out; an explicit list such as `BENCHMARK_CPUSET=6,7` overrides selection. Snapshots record effective CPU placement, and comparisons reject a baseline with different placement. The development machine has six cores with capacity 382 and two with capacity 1024; uncontrolled migration was a measured source of variation.

## Replacement timing: frame-aligned v1

New snapshots and per-sample/failure checkpoints use
`measurementProtocol: "api-completion-v2-frame-aligned-v1"`; replacement samples
also carry `replacement.timingProtocol: "frame-aligned-v1"`. Write API completion
scoring and all other categories are unchanged. Baseline comparison rejects old
protocols; report and overview reject mixed replacement samples and label the
protocol (also exported in CSV). Establish a fresh baseline: this is a
**measurement change, never a library speedup**.

Every step of all `replace-*`, `row-reorder`, and `row-insert-delete` scenarios
starts timing and calls the adapter **inside an initial requestAnimationFrame
callback**. Both shrink/restore and insert/delete independently acquire this
boundary. This gives each adapter the start-of-frame budget, without a promise
continuation before submission or an arbitrary delay. Other callbacks or browser
work can still consume part of that budget; this does not guarantee identical
physical presentation. The endpoint remains callback entry after two subsequent
rAF callbacks, a rendering-response proxy, not proof of two presented frames.
Dataset construction, state preparation and integrity scans remain outside timing.

Each step records `firstFrameMs` (start to rAF1 callback entry) and `secondFrameMs`
(rAF1 to rAF2 callback entry), using the same wall clock as `settledMs`. The first
interval includes synchronous submission and asynchronous rendering; subtract
`synchronousMs` for the wait after submission. Diagnostic component medians need
not add to a median total. Unaligned starts previously let long synchronous work
receive two closely spaced callbacks while shorter work waited a full refresh
interval. Frame alignment controls this source of phase bias uniformly across
libraries; it does not eliminate scheduler noise or prove repeatability.


Final results are summarized in [RESULTS.md](RESULTS.md).

## Competitor configuration: scenario modules v1

New snapshots, sample journals and partial checkpoints record
`competitorConfig: "scenario-modules-v1"`. Report footers, `report.md`, the
overview and a `summary.csv` column label it. Snapshots without the field are
labeled `legacy-full-bundles`. Those snapshots registered AG Grid's
`AllCommunityModule` and imported the full `handsontable` package, which
registers every plugin, cell type, editor, renderer and validator. Reference
libraries now load only what the scenarios exercise. Opening time
(navigation-to-ready includes adapter loading), retained heap and other timings
can change for AG Grid and Handsontable. Baseline comparison rejects a different
configuration. This is a **measurement change, never a Peculiar Sheets speedup
or regression**; do not compare ratios across configurations. Peculiar Sheets
is unchanged: it keeps its full feature set and still loads no formula engine.

AG Grid Community 36.2.0 registers only these modules:

| Module                        | Used by                                                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `ClientSideRowModelModule`    | `rowData`, `getRowId`, `rowNode.updateData`, replacement (also a `CommunityCoreModule` dependency)                                |
| `ClientSideRowModelApiModule` | `api.applyTransaction` for batch writes                                                                                           |
| `RowApiModule`                | `api.getDisplayedRowAtIndex` for reads and writes                                                                                 |
| `ScrollApiModule`             | `api.ensureIndexVisible` for focus and `scrollToRow`                                                                              |
| `TextEditorModule`            | Default editor for `editable: true` (edits, including during streaming); adds `EditCoreModule`, `PopupModule` and `TooltipModule` |

AG Grid always registers `CommunityCoreModule`. Its dependencies include keyboard
navigation (`setFocusedCell` / `getFocusedCell`, arrows and Tab), sorting, column
resize and move, headers, overlays, ARIA and data types; they cannot be removed.
The other `AllCommunityModule` modules are no longer loaded. These include filters,
other editors, undo/redo, CSV export, pagination, row selection and drag,
pinned rows, cell and row styles, grid state, locale, aligned grids and the
infinite row model. During development, `ValidationModule` was registered and
every default AG Grid scenario ran without error #200 / #272 or any other console
message. As a negative control, removing `ScrollApiModule` and `TextEditorModule`
produced error #200 naming both. `ValidationModule` is not part of the timed
configuration. The production adapter chunk shrank from 1,123 kB to 759 kB
(312 kB to 213 kB gzip).

Handsontable 18.1.2 imports `handsontable/base` and registers only:

| Registration   | Used by                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| `TextCellType` | Default text editor and renderer; the base package already registers it (re-registering is idempotent) |
| `CopyPaste`    | Native clipboard paste in `paste-small` and `paste-large`                                              |
| `UndoRedo`     | Ctrl+Z / Ctrl+Y in `clear-undo-redo`                                                                   |

Core selection, keyboard navigation, Delete clearing, `setDataAtCell`,
`updateData`, headers and viewport scrolling need no registration. Without either
plugin, its scenario fails verification. Handsontable constructs every registered
plugin for each instance. With these settings, the full package also enabled
Autofill (fill handle), DragToScroll and ExportFile, which no scenario uses.
AutoColumnSize and AutoRowSize were already disabled by `colWidths` and
`autoRowSize: false`. All other cell types, editors, renderers, validators and
plugins are no longer loaded. The production adapter chunk shrank from 1,476 kB
to 793 kB (347 kB to 176 kB gzip). Stylesheets are unchanged.

RevoGrid 4.30.0 is unchanged. `defineCustomElements()` registers lazy Stencil
proxies only; component chunks load when rendered, and the filter-panel chunk is
never fetched. Optional plugins (filter, export, column auto-size, column move)
are instantiated only when enabled. Its internal sorting, grouping, row-resize,
RTL and accessibility plugins have no public opt-out. `range = true` loads no
additional code: disabling it loaded identical chunks and retained identical heap.
It provides range selection, which Handsontable and Peculiar Sheets include in
core. `useClipboard = true` is RevoGrid's default and is used by paste. RevoGrid
has no bundle-wide registration to trim.

Every scenario/library pair that ran before still runs with the same capability
skips and passes the same data, focus and interaction checks. No reference library
logs a console warning or error in any default scenario. The only browser message
is the preview server's `favicon.ico` 404, which occurs for every library.

## Temporary browser profiles

Normal samples and memory diagnostics explicitly own a fresh profile under
os.tmpdir(). After browser close, finally removes it with up to ten 100 ms
backoff retries, handling Windows child-process file handles. Cleanup failures
are logged without masking sample errors. The final run summary lists created,
removed and leaked profiles; remaining owned directories make the run exit
unsuccessfully. The shared E2E launcher also owns and retries profile cleanup.
This prevents Stagehand 3.7.3's immediate, silently failing Windows cleanup from
accumulating a profile for every sample.

## Adaptive sampling

Adaptive sampling is the default (`BENCHMARK_SAMPLING=adaptive`). Most cases are
clear after a few samples: Peculiar Sheets is best, or another library is two
to three times faster. Only headlines near the 1.2x line need more.

Each case takes rounds. A round measures every library in the case once, in the
same rotating order as fixed sampling, so drift affects every library equally.
From the minimum round on, the runner computes each overview headline of that
case. It uses the same categories, metric readers and best-of-all-libraries
rule as `overview.html`. For each headline it computes the ratio of the Peculiar
Sheets median to the best median, with a percentile bootstrap interval. Each
library's samples are resampled independently and the best library is chosen
again in every resample. The bootstrap is seeded per case and headline, so the
same samples always give the same interval.

A headline is decided when its whole interval is at or below the threshold
(pass) or above it (fail). A case stops when every headline is decided, or at
its maximum. A headline still undecided at the maximum is within noise of the
line and counts as a pass. It is reported as within 1.2x, or best if the best
rule applies. The overview keeps exactly three buckets: best, within 1.2x and
outside. Cases that reached the maximum are listed as an informational note in
`overview.html`, `comparison-table.html` and `report.md`. They are not a verdict.

| Variable                    |  Default | Meaning                                                      |
| --------------------------- | -------: | ------------------------------------------------------------ |
| `BENCHMARK_SAMPLING`        | adaptive | `fixed` keeps the historical plan                            |
| `BENCHMARK_MIN_ITERATIONS`  |        4 | Rounds before the first stopping check (at least 2)          |
| `BENCHMARK_MAX_ITERATIONS`  |       12 | Most rounds; 96 for `replace-large-disjoint` unless set      |
| `BENCHMARK_CONFIDENCE`      |     0.95 | Two-sided bootstrap interval level                           |
| `BENCHMARK_RATIO_THRESHOLD` |      1.2 | Ratio line the interval must clear                           |

An explicit `BENCHMARK_ITERATIONS` keeps fixed sampling at that count, as
before; combining it with `BENCHMARK_SAMPLING=adaptive` is rejected. Adaptive
options are rejected in fixed mode. The threshold only moves the stopping line;
overview buckets stay at 1.2x. The interval is rechecked after each round
without a multiple-comparison correction, so its nominal confidence is
optimistic. The stopping rule only buys samples where they are needed; it is
not a significance test.

Snapshots record `samplingMode` and, for adaptive runs, `adaptiveSampling`:
the `sequential-bootstrap-median-ratio-v1` protocol, minimum, confidence,
threshold, resample count and seed. They also record every pair's sample count
and stop reason (`decided` or `max-reached`), and each headline's final ratio,
interval and verdict. `iterations` and `scenarioIterations` hold the maxima.
Reports check every pair against its recorded count; `summary.json` and
`summary.csv` export `samplingMode` and `stopReason`. Sample journals tag each
sample with its mode and append one `samplingDecision` record when a case stops.
Partial checkpoints keep the decisions of completed cases. Snapshots without
`samplingMode` are fixed. Baseline comparison rejects a different mode, and
adaptive runs compare only under the same stopping rule. Per-pair counts may
differ and are printed. This is a sampling change, never a speedup.
