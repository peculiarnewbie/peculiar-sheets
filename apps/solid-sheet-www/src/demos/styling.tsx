import { Sheet, createRangeStyles } from "peculiar-sheets";
import type { ColumnDef, CellValue } from "peculiar-sheets";

// ── Columns ──────────────────────────────────────────────────

const columns: ColumnDef[] = [
  { id: "region", header: "Region", width: 110, editable: true },
  { id: "q1",     header: "Q1",     width: 80,  editable: true },
  { id: "q2",     header: "Q2",     width: 80,  editable: true },
  { id: "q3",     header: "Q3",     width: 80,  editable: true },
  { id: "q4",     header: "Q4",     width: 80,  editable: true },
  { id: "ytd",    header: "YTD",    width: 90,  editable: true },
];

// ── Data ─────────────────────────────────────────────────────

const data: CellValue[][] = [
  ["North",  120, 140, 155, 180,  595],
  ["South",   95, 110,  88, 125,  418],
  ["East",   200, 215, 230, 250,  895], // top performer
  ["West",   105,  98, 112, 130,  445],
  ["Total",  520, 563, 585, 685, 2353],
];

// ── Style rules ──────────────────────────────────────────────
// createRangeStyles compiles declarative range → style rules into an
// efficient per-cell lookup. Rules evaluate in order; later rules
// shallow-merge over earlier (CSS-cascade semantics).

const getCellStyle = createRangeStyles([
  // Winner row spotlight — East (row 2) across every column.
  {
    range: { start: { row: 2, col: 0 }, end: { row: 2, col: 5 } },
    style: {
      "background-color": "rgba(80, 200, 120, 0.12)",
      color: "#a0e5b8",
    },
  },

  // Standout cell — East Q4 (row 2, col 4). Overrides the row's
  // background with a brighter green and adds weight. `color` from
  // the row rule above still cascades through.
  {
    range: { row: 2, col: 4 },
    style: {
      "background-color": "rgba(80, 200, 120, 0.28)",
      "font-weight": 700,
    },
  },

  // Alert cell — South Q3 missed target (row 1, col 3).
  // Single CellAddress target, no start/end.
  {
    range: { row: 1, col: 3 },
    style: {
      "background-color": "rgba(220, 80, 80, 0.18)",
      color: "#f0a0a0",
      "font-weight": 600,
    },
  },

  // Totals row — visual divider + emphasis across the whole row.
  {
    range: { start: { row: 4, col: 0 }, end: { row: 4, col: 5 } },
    style: {
      "border-top": "2px solid rgba(255, 255, 255, 0.18)",
      "font-weight": 600,
    },
  },

  // YTD column — subtle left rule across every data row.
  // Array of targets: each entry gets the same style.
  {
    range: [
      { row: 0, col: 5 },
      { row: 1, col: 5 },
      { row: 2, col: 5 },
      { row: 3, col: 5 },
      { row: 4, col: 5 },
    ],
    style: { "border-left": "1px solid rgba(255, 255, 255, 0.08)" },
  },
]);

export default function StylingSheet() {
  return (
    <Sheet
      class="ledger-sheet"
      data={data}
      columns={columns}
      showReferenceHeaders
      customization={{
        getCellStyle,
        getRowClass: (_rowIndex, context) =>
          context.containsFocus ? "ledger-sheet__focused-row" : "",
      }}
    />
  );
}
