# Windows native-wheel scrolling evidence

All six verified frame-p95 headlines pass the 1.2× goal at the candidate source. The production change adds `will-change: scroll-position` to `.se-viewport`. Chrome then gives that viewport an accelerated `OverflowScrolling` layer. Native wheel scrolling retains the existing scroll-event row projection while the compositor can prepare scrolling independently.

Branch: `t3/optimize-streaming-wheel-benchmarks`. Base: `139bf86` (includes editor readiness, isolated timers, and CRLF paste fixes). The exact CSS/test hashes, browser user agent, processor identifier, timer protocol, raw medians and ratios are in [summary.json](summary.json). No public API, workload, dependency version, overscan, data ownership, history or formula behavior changed.

The STEP 0 host baseline is the completed 1,740-sample precise-timer run in the main checkout, `new-host-baseline-3`, at `139bf86`. Its six relevant headlines are:

| Scenario | Peculiar ms | Best ms | Ratio |
| --- | ---: | ---: | ---: |
| scroll-wheel-slow | 33.4650 | 16.8250 | 1.989004 |
| scroll-wheel-bursts | 33.4300 | 16.8450 | 1.984565 |
| scroll-diagonal | 33.4225 | 16.8500 | 1.983531 |
| vertical-scroll | 16.8625 | 16.8375 | 1.001485 |
| scroll-jump | 16.8175 | 16.8075 | 1.000595 |
| streaming-updates | 16.8625 | 16.8375 | 1.001485 |

The earlier six-iteration focused baseline at `26b275b` found streaming 16.9000 ms (1.0000×) and slow wheel 33.5000 ms (1.982249×). It predates the isolated-timer protocol and is not used as optimization evidence. The failed main-checkout `baseline-2` is also not treated as a completed baseline.

The focused before/after runs below each contain 12 samples per scenario and per library: 288 samples per phase, all retained, across Peculiar Sheets, AG Grid, Handsontable and RevoGrid. Each phase ran the three wheels, then the three regression controls. Every run acquired the machine lock and released it in `finally`; holds were about seven to eight minutes. Profiling hooks were removed before these runs. Ratios use the best library's median in that same run and are evaluated without rounding; displayed values below are rounded only for readability.

| Scenario | Before ms | Before best ms | Before ratio | After ms | After best ms | After ratio |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| scroll-wheel-slow | 33.5050 | 16.8400 | 1.989608 | 16.8400 | 16.8300 | 1.000594 |
| scroll-wheel-bursts | 33.4450 | 16.8650 | 1.983101 | 16.8475 | 16.8350 | 1.000743 |
| scroll-diagonal | 33.4300 | 16.8625 | 1.982506 | 16.8575 | 16.8525 | 1.000297 |
| vertical-scroll | 16.8625 | 16.8175 | 1.002676 | 16.8700 | 16.8400 | 1.001781 |
| scroll-jump | 16.9075 | 16.8175 | 1.005352 | 16.8625 | 16.8025 | 1.003571 |
| streaming-updates | 16.8600 | 16.8350 | 1.001485 | 16.8300 | 16.8300 | 1.000000 |

The three wheel p95 values fall by about half. Vertical-scroll, scroll-jump and streaming remain within target. Every streaming sample in both phases completes all 50 batches and 5,000 writes, with 4,777 distinct final destinations verified. [focused-results.json.gz](focused-results.json.gz) preserves all 576 focused raw samples, the relevant 288 host-baseline samples, sampling metadata, and check logs.

Profiling used unchanged workloads under the same machine lock, with separate diagnostic output directories. The clean timeline captures classify missed-vsync intervals using a 25 ms threshold, separating them from ordinary refresh jitter above 16.7 ms. Exact counts above 16.7 ms are also retained in the summary. Unchanged slow/burst/diagonal wheel traces have 39/19/19 missed intervals, all wheel-related; with the hint they have 0/0/1. Streaming has one wheel-related missed interval before and none after; no batch-only or focus-only missed interval occurs in that precise-timer capture. Vertical scrolling and scroll jumps have no missed intervals in either capture.

Slow-wheel scripting is chiefly DOM text replacement and row movement. Sampled native `replaceChild` work totals about 5.8 ms over the two-second diagnostic. The unchanged clean trace has maximum event dispatch 1.622 ms, style recalculation 0.163 ms, layout 0.308 ms, individual paint 1.135 ms and layerization 0.641 ms, with no GC. These are inclusive diagnostic event durations, not additive frame-budget percentages. No application task overrun explains the systematic second vsync. Its sole forced-layout stack is initial deferred grid focus. Streaming retains its focus/layout work and passing p95; it was not changed.

The hint restores cadence with the same 40 scroll events, one scrolling-end timer callback, 27 row rebindings, 378 text changes and 96 child-list mutations in the slow-wheel pair. DOM insertion/removal counters include moves and are not owner-creation counts. Main-thread scroll-target lookups occur 40 times in both versions and in AG Grid; they do not distinguish the failing path. The 150 ms timer fires once after the sequence, so it cannot explain a second frame for every wheel packet. Horizontal notifications and row-boundary work do not produce a repeated forced-layout cost in this capture. Layer inspection is the distinguishing evidence: the viewport has no accelerated scrolling layer before and an `OverflowScrolling` layer with the hint; total observed layers rise from 7 to 10. Programmatic vertical-scroll writes offsets from rAF and scroll-jump writes offsets directly, unlike native wheel delivery.

Alternative diagnostic controls (an explicit viewport background, scroll-position hint, transform hint and opacity hint) restored wheel cadence. The scroll-position hint was retained because it leaves background rendering and containing-block geometry intact. No rejected focus-phase, presentation-cache or DOM-move trial was revived. Full raw traces remain locally under `.benchmark/clean-profile-{baseline,scroll-hint,ag-grid}`; their SHA-256 hashes and extracted metrics/layer reasons are archived in the summary. Temporary counter/trace code is absent from production and benchmark source.

Validation passed: `pnpm test` (244 tests), `pnpm test:solid2` (17), `pnpm benchmark:test` (25), `pnpm benchmark:typecheck` (both projects), and production browser coverage (2 tests, 78 assertions). The added test checks partial-row coverage, contiguous rows, sticky headers, gutter and pinned-column/header alignment, plus coverage in the first rAF after trusted slow, burst and diagonal wheel input. It uses the existing sorted/customized contracts fixture. All check logs are in the compressed evidence.

There is no remaining frame-p95 gap in these six verified scenarios. This focused result does not establish completion of all 39 headlines after integration with other changes. No push was performed.
