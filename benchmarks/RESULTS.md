# Benchmark results: within 1.2x of the best library

Goal: every one of the 39 headline observations within 1.2x of the best library
(Peculiar Sheets ÷ best median, unrounded). Raw runs are not stored in the
repository; rerun the suite to reproduce them (see [README](README.md)).

## Final result (Windows, 2026-11-05)

Library source `7061c5f`, released as `0.17.0`. Competitor configuration
`scenario-modules-v1`, replacement timing `api-completion-v2-frame-aligned-v1`.
Two full fixed-12 runs (1,740 samples each) and one adaptive run (572 samples)
agree on every pass/fail verdict.

**37 of 39 headlines are within 1.2x.** Two accepted exceptions:

| Headline | Peculiar Sheets | Best | Ratio |
| --- | ---: | ---: | ---: |
| Batch API writes | 0.39–0.41 ms | RevoGrid 0.20–0.22 ms | 1.86–1.95 |
| Memory, `mount-tall` | 27.2 MB | Handsontable 21.0 MB | 1.29 |

RevoGrid's batch adapter assigns properties and refreshes; Peculiar Sheets also
records undo history, row revisions and notifications. Handsontable's lower
100k-row footprint became visible once its unused plugins were removed.

Closest passing headlines: replace-wide-retained (up to 1.19, noisy),
replace-small-large (1.15–1.16 vs AG Grid), memory mount-sparse (1.14 vs
Handsontable) and row-insert-delete (1.11 vs Handsontable).

Geometric mean of each library's ratio to the best, over the headlines it runs:

| Library | Run A | Run B |
| --- | ---: | ---: |
| Peculiar Sheets | 1.038 | 1.035 |
| Handsontable | 1.435 | 1.442 |
| RevoGrid | 1.447 | 1.457 |
| AG Grid | 1.601 | 1.594 |

AG Grid has no paste or clear-undo-redo adapter, Handsontable's write scenarios
are off by default and RevoGrid has no undo/redo, so compare these means with the
per-scenario counts in the generated overview.

## What changed in the library

- Reused viewport rows and column slots, virtualized headers, shared cell
  geometry, lazily observed row revisions and compact owned rows.
- Row geometry retained across controlled data replacements.
- Distinct batch writes fused into one commit with forward-only undo records.
- Viewport promoted to an accelerated scroll layer for native wheel input.

## Measurement corrections

These change what is measured, not library speed, and each is recorded in
snapshots so baselines cannot mix them:

- Cross-origin-isolated timers and API-completion write timing.
- Frame-aligned replacement timing: each step starts inside a rAF callback.
- Owned browser profiles removed after every sample.
- Competitor adapters load only the modules the scenarios use.
- Adaptive sampling: 4–12 rounds per scenario, stopping once every headline's
  95% bootstrap interval is clearly on one side of 1.2x; still undecided at the
  cap counts as a pass.
