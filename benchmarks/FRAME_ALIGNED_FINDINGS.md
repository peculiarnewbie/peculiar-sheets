# Frame-aligned replacement validation (Windows, 2026-11-05)

This is a measurement correction, not a library speedup. No packages/ files changed. The full-suite 39-headline goal was not tested.

## Implementation and protocol

Every step begins timing and synchronous adapter submission inside an initial rAF callback. This avoids a promise continuation before submission and gives every adapter the same start-of-frame scheduling opportunity. Earlier callbacks and browser work can still consume that budget. The endpoint remains the second subsequent rAF callback entry, not proof of two presented frames. Dataset construction, state setup and every-cell integrity scans remain outside timing. All replace-* scenarios and structural scenarios share the helper; both roundtrip steps acquire their own boundary.

Snapshots and journals use api-completion-v2-frame-aligned-v1; replacement samples identify frame-aligned-v1. Reports and overview reject mixed samples, preserve write API-completion scoring and label exports. Baseline comparisons reject historical protocols. firstFrameMs is start-to-rAF1; secondFrameMs is rAF1-to-rAF2. Synchronous submission is included in the first interval.

## Profile leak correction

Separate leak-fix commit: 2e54065. Normal and memory diagnostic samples use explicit owned profiles under os.tmpdir(). In finally, the harness closes the browser then removes its profile with recursive/force rm, maxRetries 10 and retryDelay 100. Best-effort failures are logged; remaining owned profiles are listed in the final summary and cause a nonzero exit status. The shared E2E launcher also owns its profile and retries cleanup.

The final eight-sample smoke held the Stagehand profile count at 377 before/after, with zero owned profiles remaining; all 8 were removed. Across the final pair: Stagehand profiles 377/377, owned profiles 0/0; each pass created and removed all 480. Real-filesystem tests cover constructor, initialization, workload and close failures.

## Execution and exclusions

Both final passes used 12 iterations, all 10 replacement-category scenarios, all four libraries, 480 samples each, zero warmups/retries/discards. All integrity checks passed. Source was identical in both passes. Times below are milliseconds. Roundtrip headlines are medians of per-sample sums, not sums of step medians.

Every browser benchmark used the mandatory machine-wide directory lock, owner harness-replace and EXIT-trap release. Final holds (Asia/Jakarta): A 00:18:25–00:26:01 (7m36s), B 00:26:01–00:33:42 (7m41s). The script released and immediately reacquired between passes because both together exceed 15 minutes. No intervening benchmark ran and no source changed. Final smoke: 00:18:03–00:18:14.

The initial attempt failed with ENOSPC and is excluded (.benchmark/frame-aligned-a/); its lock was released at 23:59:04 after 6m37s. The subsequent pre-leak-fix A and interrupted B (frame-aligned-a-complete and frame-aligned-b-complete) are also excluded from this pair. Inactive failed-attempt profiles were preserved on D: before the user freed C:. Logs, lock records and count observations remain in .benchmark/frame-aligned-validation/.

## Headline medians and unrounded ratios

PS = Peculiar Sheets; AG = AG Grid; HOT = Handsontable; RV = RevoGrid. Full numeric precision is retained below and in [summary.json](evidence/2026-11-05-frame-aligned/summary.json).

### Run A

Raw snapshot: .benchmark\frame-aligned-final-a\latest.json; SHA-256: 7f41401c075aa63ab9ade4e399c6c8b606bc7a0e0868f99afe1802ab52084146.

| Scenario | PS | AG | HOT | RV | Best | PS / best |
| --- | ---: | ---: | ---: | ---: | --- | ---: |
| replace-large-disjoint | 27.092500001192093 | 33.5249999910593 | 83.4699999988079 | 34.90499998629093 | peculiar-sheets | 1.0 |
| replace-large-retained | 33.400000020861626 | 33.53500001132488 | 83.49750000238419 | 34.59000000357628 | peculiar-sheets | 1.0 |
| replace-small-disjoint | 28.447500005364418 | 33.394999995827675 | 98.53499998152256 | 34.43749998509884 | peculiar-sheets | 1.0 |
| replace-small-large | 29.672499999403954 | 33.51250000298023 | 100.16500000655651 | 35.67249999940395 | peculiar-sheets | 1.0 |
| replace-filter-roundtrip | 61.95499999821186 | 66.91000001132488 | 108.87749999761581 | 70.79749999940395 | peculiar-sheets | 1.0 |
| replace-few-cells | 33.47249999642372 | 33.51000000536442 | 83.22999998927116 | 34.525000005960464 | peculiar-sheets | 1.0 |
| replace-wide-retained | 26.66499999165535 | 33.474999994039536 | 67.14750000834465 | 23.875 | revogrid | 1.1168586383939414 |
| replace-wide-grow | 33.417500004172325 | 49.80750000476837 | 66.67749999463558 | 33.43000000715256 | peculiar-sheets | 1.0 |
| row-reorder | 33.457499995827675 | 50.099999994039536 | 33.50499999523163 | 34.742499992251396 | peculiar-sheets | 1.0 |
| row-insert-delete | 66.65000000596046 | 84.23000001907349 | 56.64249999821186 | 70.97499999403954 | handsontable | 1.1766782894128 |

### Run B

Raw snapshot: .benchmark\frame-aligned-final-b\latest.json; SHA-256: fe767270c266633d61c33f60483df9bddf50edf8b2e1428b1d22b1f44b5d128c.

| Scenario | PS | AG | HOT | RV | Best | PS / best |
| --- | ---: | ---: | ---: | ---: | --- | ---: |
| replace-large-disjoint | 29.6875 | 33.54000000655651 | 83.49999998509884 | 34.13500002026558 | peculiar-sheets | 1.0 |
| replace-large-retained | 24.592500001192093 | 33.51250000298023 | 83.42749999463558 | 34.70250000059605 | peculiar-sheets | 1.0 |
| replace-small-disjoint | 31.489999994635582 | 33.48749999701977 | 100.1700000166893 | 34.0799999833107 | peculiar-sheets | 1.0 |
| replace-small-large | 24.617499992251396 | 33.492499992251396 | 100.17750000953674 | 35.310000002384186 | peculiar-sheets | 1.0 |
| replace-filter-roundtrip | 59.747500002384186 | 66.94499999284744 | 104.58500000834465 | 70.42750000953674 | peculiar-sheets | 1.0 |
| replace-few-cells | 20.987499997019768 | 33.47750000655651 | 83.30749998986721 | 34.47250001132488 | peculiar-sheets | 1.0 |
| replace-wide-retained | 32.60750000178814 | 33.51000000536442 | 82.28500001132488 | 28.84000000357628 | revogrid | 1.1306345352893439 |
| replace-wide-grow | 33.34499999880791 | 50.16499999165535 | 66.63000001013279 | 34.75999999046326 | peculiar-sheets | 1.0 |
| row-reorder | 33.38249999284744 | 50.09000000357628 | 33.49500000476837 | 34.72000001370907 | peculiar-sheets | 1.0 |
| row-insert-delete | 66.73499999940395 | 83.40000000596046 | 57.07999999821186 | 70.9724999666214 | handsontable | 1.1691485634459453 |

## Repeatability limits

All ten PS/best ratios are <=1.2 in both passes. This focused pair does not prove the full-suite goal or stable absolute timings. Six of forty scenario/library median pairs have a larger/smaller ratio above 1.2 (four PS cases, HOT wide-retained and RV wide-retained). PS few-cells moves from about 33.47 to 20.99 ms; large-retained and wide-retained also move substantially. Alignment controls submission phase but cannot eliminate callback dispatch delays, scheduling or refresh quantization. No comparison with the unaligned protocol is a library speedup.

Handsontable has long first intervals in several non-structural cases (roughly 67–100 ms settled medians), while reorder and insert/delete are shorter. AG Grid stays near two refresh intervals for most cases, but wide growth, reorder and insertion often need about 50 ms. RevoGrid and PS still show shorter-than-two-refresh wall-clock intervals in some cases. These observations describe callback entry, not physical presentation; no causal library explanation is established.

## Per-step callback diagnostics

Medians in ms, rounded to three decimals here; exact values are in summary.json. F1 is start-to-rAF1 (including synchronous work); F2 is rAF1-to-rAF2. Component medians need not sum to a total median.

| Run | Scenario / step | Library | Sync | F1 | F2 | Settled |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| A | replace-large-disjoint / replace | peculiar-sheets | 0.045 | 10.273 | 16.800 | 27.093 |
| A | replace-large-disjoint / replace | ag-grid | 5.473 | 18.255 | 15.260 | 33.525 |
| A | replace-large-disjoint / replace | handsontable | 6.735 | 71.965 | 7.828 | 83.470 |
| A | replace-large-disjoint / replace | revogrid | 0.312 | 18.257 | 16.590 | 34.905 |
| A | replace-large-retained / replace | peculiar-sheets | 0.052 | 16.627 | 16.740 | 33.400 |
| A | replace-large-retained / replace | ag-grid | 5.540 | 18.310 | 15.252 | 33.535 |
| A | replace-large-retained / replace | handsontable | 6.608 | 70.343 | 7.655 | 83.498 |
| A | replace-large-retained / replace | revogrid | 0.280 | 18.225 | 16.585 | 34.590 |
| A | replace-small-disjoint / replace | peculiar-sheets | 0.045 | 11.740 | 16.703 | 28.448 |
| A | replace-small-disjoint / replace | ag-grid | 2.700 | 16.805 | 16.620 | 33.395 |
| A | replace-small-disjoint / replace | handsontable | 3.672 | 85.950 | 4.577 | 98.535 |
| A | replace-small-disjoint / replace | revogrid | 0.202 | 18.042 | 16.323 | 34.437 |
| A | replace-small-large / replace | peculiar-sheets | 0.170 | 12.850 | 16.760 | 29.672 |
| A | replace-small-large / replace | ag-grid | 13.245 | 19.030 | 14.335 | 33.513 |
| A | replace-small-large / replace | handsontable | 12.795 | 88.028 | 10.840 | 100.165 |
| A | replace-small-large / replace | revogrid | 1.975 | 18.965 | 16.735 | 35.672 |
| A | replace-filter-roundtrip / replace | peculiar-sheets | 0.050 | 12.155 | 16.703 | 28.533 |
| A | replace-filter-roundtrip / restore | peculiar-sheets | 0.095 | 17.053 | 16.303 | 33.330 |
| A | replace-filter-roundtrip / replace | ag-grid | 5.530 | 18.373 | 15.232 | 33.578 |
| A | replace-filter-roundtrip / restore | ag-grid | 8.707 | 19.013 | 14.402 | 33.380 |
| A | replace-filter-roundtrip / replace | handsontable | 6.700 | 74.495 | 10.865 | 83.495 |
| A | replace-filter-roundtrip / restore | handsontable | 9.868 | 10.770 | 14.638 | 25.333 |
| A | replace-filter-roundtrip / replace | revogrid | 0.360 | 18.575 | 16.692 | 35.065 |
| A | replace-filter-roundtrip / restore | revogrid | 1.263 | 19.007 | 16.812 | 35.820 |
| A | replace-few-cells / replace | peculiar-sheets | 0.137 | 16.712 | 16.850 | 33.472 |
| A | replace-few-cells / replace | ag-grid | 12.065 | 16.813 | 16.695 | 33.510 |
| A | replace-few-cells / replace | handsontable | 7.177 | 69.940 | 11.415 | 83.230 |
| A | replace-few-cells / replace | revogrid | 1.280 | 18.260 | 16.340 | 34.525 |
| A | replace-wide-retained / replace | peculiar-sheets | 0.047 | 10.960 | 16.733 | 26.665 |
| A | replace-wide-retained / replace | ag-grid | 10.522 | 19.910 | 13.485 | 33.475 |
| A | replace-wide-retained / replace | handsontable | 11.088 | 64.493 | 6.870 | 67.148 |
| A | replace-wide-retained / replace | revogrid | 0.305 | 8.795 | 15.078 | 23.875 |
| A | replace-wide-grow / replace | peculiar-sheets | 0.120 | 16.605 | 16.825 | 33.418 |
| A | replace-wide-grow / replace | ag-grid | 29.157 | 41.882 | 6.395 | 49.808 |
| A | replace-wide-grow / replace | handsontable | 18.713 | 60.477 | 10.063 | 66.677 |
| A | replace-wide-grow / replace | revogrid | 14.608 | 23.323 | 10.167 | 33.430 |
| A | row-reorder / replace | peculiar-sheets | 0.115 | 16.830 | 16.642 | 33.457 |
| A | row-reorder / replace | ag-grid | 29.048 | 34.140 | 14.575 | 50.100 |
| A | row-reorder / replace | handsontable | 13.978 | 16.755 | 16.730 | 33.505 |
| A | row-reorder / replace | revogrid | 12.338 | 20.495 | 14.127 | 34.742 |
| A | row-insert-delete / replace | peculiar-sheets | 0.142 | 16.978 | 16.363 | 33.342 |
| A | row-insert-delete / delete-inserted | peculiar-sheets | 0.130 | 16.615 | 16.738 | 33.385 |
| A | row-insert-delete / replace | ag-grid | 38.328 | 42.113 | 8.442 | 50.163 |
| A | row-insert-delete / delete-inserted | ag-grid | 29.782 | 33.002 | 1.110 | 33.775 |
| A | row-insert-delete / replace | handsontable | 13.880 | 16.733 | 16.790 | 33.505 |
| A | row-insert-delete / delete-inserted | handsontable | 12.745 | 14.052 | 8.555 | 23.090 |
| A | row-insert-delete / replace | revogrid | 12.388 | 21.078 | 14.462 | 35.453 |
| A | row-insert-delete / delete-inserted | revogrid | 11.420 | 21.040 | 14.492 | 35.525 |
| B | replace-large-disjoint / replace | peculiar-sheets | 0.045 | 12.888 | 16.788 | 29.688 |
| B | replace-large-disjoint / replace | ag-grid | 5.505 | 18.303 | 15.215 | 33.540 |
| B | replace-large-disjoint / replace | handsontable | 6.683 | 70.510 | 11.718 | 83.500 |
| B | replace-large-disjoint / replace | revogrid | 0.290 | 17.483 | 16.613 | 34.135 |
| B | replace-large-retained / replace | peculiar-sheets | 0.045 | 7.823 | 16.817 | 24.593 |
| B | replace-large-retained / replace | ag-grid | 5.605 | 18.312 | 15.210 | 33.513 |
| B | replace-large-retained / replace | handsontable | 6.850 | 67.780 | 9.942 | 83.427 |
| B | replace-large-retained / replace | revogrid | 0.290 | 18.345 | 16.532 | 34.703 |
| B | replace-small-disjoint / replace | peculiar-sheets | 0.045 | 14.582 | 16.778 | 31.490 |
| B | replace-small-disjoint / replace | ag-grid | 2.728 | 16.877 | 16.648 | 33.487 |
| B | replace-small-disjoint / replace | handsontable | 3.597 | 89.543 | 10.620 | 100.170 |
| B | replace-small-disjoint / replace | revogrid | 0.180 | 17.855 | 16.292 | 34.080 |
| B | replace-small-large / replace | peculiar-sheets | 0.150 | 7.917 | 16.640 | 24.617 |
| B | replace-small-large / replace | ag-grid | 12.823 | 19.040 | 14.435 | 33.492 |
| B | replace-small-large / replace | handsontable | 12.530 | 88.650 | 10.680 | 100.178 |
| B | replace-small-large / replace | revogrid | 1.778 | 18.800 | 16.698 | 35.310 |
| B | replace-filter-roundtrip / replace | peculiar-sheets | 0.045 | 9.498 | 16.790 | 26.385 |
| B | replace-filter-roundtrip / restore | peculiar-sheets | 0.112 | 17.058 | 16.320 | 33.392 |
| B | replace-filter-roundtrip / replace | ag-grid | 5.478 | 18.233 | 15.263 | 33.495 |
| B | replace-filter-roundtrip / restore | ag-grid | 8.913 | 18.882 | 14.575 | 33.457 |
| B | replace-filter-roundtrip / replace | handsontable | 6.617 | 70.665 | 8.168 | 82.418 |
| B | replace-filter-roundtrip / restore | handsontable | 9.995 | 11.195 | 13.873 | 24.868 |
| B | replace-filter-roundtrip / replace | revogrid | 0.350 | 18.348 | 16.292 | 34.883 |
| B | replace-filter-roundtrip / restore | revogrid | 1.203 | 19.112 | 16.470 | 35.502 |
| B | replace-few-cells / replace | peculiar-sheets | 0.108 | 3.970 | 16.780 | 20.987 |
| B | replace-few-cells / replace | ag-grid | 11.910 | 16.838 | 16.615 | 33.478 |
| B | replace-few-cells / replace | handsontable | 7.093 | 68.695 | 13.790 | 83.307 |
| B | replace-few-cells / replace | revogrid | 1.263 | 18.145 | 16.250 | 34.473 |
| B | replace-wide-retained / replace | peculiar-sheets | 0.050 | 15.828 | 16.770 | 32.608 |
| B | replace-wide-retained / replace | ag-grid | 10.845 | 19.908 | 13.597 | 33.510 |
| B | replace-wide-retained / replace | handsontable | 10.965 | 69.612 | 9.320 | 82.285 |
| B | replace-wide-retained / replace | revogrid | 0.295 | 13.847 | 15.040 | 28.840 |
| B | replace-wide-grow / replace | peculiar-sheets | 0.110 | 16.575 | 16.817 | 33.345 |
| B | replace-wide-grow / replace | ag-grid | 28.707 | 42.105 | 7.460 | 50.165 |
| B | replace-wide-grow / replace | handsontable | 18.962 | 58.803 | 8.912 | 66.630 |
| B | replace-wide-grow / replace | revogrid | 14.770 | 22.955 | 12.015 | 34.760 |
| B | row-reorder / replace | peculiar-sheets | 0.125 | 16.820 | 16.570 | 33.382 |
| B | row-reorder / replace | ag-grid | 29.113 | 34.660 | 14.917 | 50.090 |
| B | row-reorder / replace | handsontable | 14.333 | 16.782 | 16.697 | 33.495 |
| B | row-reorder / replace | revogrid | 12.093 | 20.660 | 14.058 | 34.720 |
| B | row-insert-delete / replace | peculiar-sheets | 0.123 | 16.855 | 16.513 | 33.417 |
| B | row-insert-delete / delete-inserted | peculiar-sheets | 0.125 | 16.602 | 16.690 | 33.300 |
| B | row-insert-delete / replace | ag-grid | 37.318 | 40.963 | 9.127 | 50.075 |
| B | row-insert-delete / delete-inserted | ag-grid | 29.115 | 32.245 | 1.110 | 33.337 |
| B | row-insert-delete / replace | handsontable | 13.657 | 16.728 | 16.763 | 33.517 |
| B | row-insert-delete / delete-inserted | handsontable | 13.155 | 14.472 | 8.892 | 23.552 |
| B | row-insert-delete / replace | revogrid | 12.530 | 20.998 | 14.493 | 35.457 |
| B | row-insert-delete / delete-inserted | revogrid | 10.933 | 20.910 | 14.640 | 35.502 |

## Checks

- pnpm benchmark:test: 28 passed, 0 failed.
- pnpm benchmark:typecheck: runner and benchmark app passed.
- E2E setup targeted typecheck with apps/e2e/src/global.d.ts: passed.
- git diff --check: passed.
- No push performed.
