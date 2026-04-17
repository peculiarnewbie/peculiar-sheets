import { Sheet } from "peculiar-sheets";
import type { ColumnDef, CellValue } from "peculiar-sheets";

// Custom CSS for status pills — add to your stylesheet:
//   .status-badge { display:inline-flex; padding:2px 10px; border-radius:999px; font-size:0.75rem; font-weight:600; }
//   .status-badge--active  { background:rgba(80,200,120,0.15); color:#50c878; border:1px solid rgba(80,200,120,0.3); }
//   .status-badge--pending { background:rgba(196,163,90,0.15); color:#c4a35a; border:1px solid rgba(196,163,90,0.3); }
//   .status-badge--error   { background:rgba(220,80,80,0.15);  color:#dc5050; border:1px solid rgba(220,80,80,0.3);  }

// ── NSLOCTEXT helpers ────────────────────────────────────────

interface LocParts { area: string; id: string; text: string }

const NSLOC_RE =
  /^NSLOCTEXT\(\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*\)$/;

function parseNSLoc(raw: CellValue): LocParts | null {
  if (typeof raw !== "string") return null;
  const m = raw.match(NSLOC_RE);
  if (!m) return null;
  return { area: m[1] ?? "", id: m[2] ?? "", text: m[3] ?? "" };
}

function serializeNSLoc({ area, id, text }: LocParts): string {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `NSLOCTEXT("${esc(area)}","${esc(id)}","${esc(text)}")`;
}

// ── Column definitions ───────────────────────────────────────

const columns: ColumnDef[] = [
  { id: "label", header: "Label", width: 160, editable: true },
  {
    id: "localized",
    header: "Localized Text",
    width: 220,
    editable: true,
    // Display only the inner human-readable text.
    formatValue: (raw) =>
      parseNSLoc(raw)?.text ?? (raw == null ? "" : String(raw)),
    // On commit, rewrap using the previous value's area + id so structural
    // metadata survives edits.
    parseValue: (text, { previousValue }) => {
      const prev = parseNSLoc(previousValue);
      return serializeNSLoc(
        prev ? { ...prev, text } : { area: "menu", id: "unknown", text },
      );
    },
    // Hover tooltip shows the structural metadata.
    getCellTitle: (raw) => {
      const parts = parseNSLoc(raw);
      return parts ? `area: ${parts.area} · id: ${parts.id}` : undefined;
    },
  },
  {
    id: "status",
    header: "Status",
    width: 140,
    editable: true,
    // renderCell replaces the default cell renderer.
    // Return null while editing so the text input shows through.
    renderCell: ({ value, isEditing }) => {
      if (isEditing) return null;
      const variant =
        value === "active" || value === "pending" || value === "error"
          ? value
          : "unknown";
      return (
        <span class={`status-badge status-badge--${variant}`}>
          {value == null ? "—" : String(value)}
        </span>
      );
    },
  },
];

// ── Data ─────────────────────────────────────────────────────

const data: CellValue[][] = [
  ["Save Button",   `NSLOCTEXT("menu","btn.save","Save")`,       "active" ],
  ["Cancel Button", `NSLOCTEXT("menu","btn.cancel","Cancel")`,   "pending"],
  ["Delete Button", `NSLOCTEXT("menu","btn.delete","Delete")`,   "error"  ],
  ["File / Open",   `NSLOCTEXT("menu","file.open","Open...")`,   "active" ],
  ["File / Save As",`NSLOCTEXT("menu","file.saveas","Save As…")`, "pending"],
];

export default function CustomRenderingSheet() {
  return <Sheet data={data} columns={columns} />;
}
