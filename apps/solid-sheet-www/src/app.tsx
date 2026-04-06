import { createSignal, Switch, Match } from "solid-js";
import HyperFormula from "hyperformula";
import {
  Sheet,
  type CellValue,
  type ColumnDef,
} from "peculiar-sheets";
import "peculiar-sheets/styles";
import "./styles.css";

// ── Install command ─────────────────────────────────────────

function InstallCommand() {
  const [copied, setCopied] = createSignal(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText("npm i peculiar-sheets");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* noop — clipboard requires HTTPS */
    }
  };

  return (
    <button class="install-cmd" onClick={copy} title="Copy to clipboard">
      <span class="install-dollar">$</span>
      <code class="install-text">npm i peculiar-sheets</code>
      <span class="install-copy-btn">{copied() ? "Copied!" : "Copy"}</span>
    </button>
  );
}

// ── Hero sheet (live formulas in the hero) ──────────────────

function HeroSheet() {
  const columns: ColumnDef[] = [
    { id: "a", header: "Team", width: 120, editable: true },
    { id: "b", header: "Q1", width: 85, editable: true },
    { id: "c", header: "Q2", width: 85, editable: true },
    { id: "d", header: "Total", width: 95, editable: true },
  ];

  const data: CellValue[][] = [
    ["Engineering", 48, 52, "=B1+C1"],
    ["Design", 32, 35, "=B2+C2"],
    ["Marketing", 28, 31, "=B3+C3"],
    [null, null, "Sum", "=SUM(D1:D3)"],
  ];

  const hf = HyperFormula.buildEmpty({ licenseKey: "gpl-v3" });
  const sheetName = hf.addSheet("hero");
  const sheetId = hf.getSheetId(sheetName)!;

  return (
    <Sheet
      data={data}
      columns={columns}
      formulaEngine={{ instance: hf, sheetId, sheetName }}
    />
  );
}

// ── Sheet-only demo components ──────────────────────────────

function BasicSheet() {
  const columns: ColumnDef[] = [
    { id: "a", header: "Name", width: 140, editable: true },
    { id: "b", header: "Age", width: 80, editable: true },
    { id: "c", header: "City", width: 120, editable: true },
    { id: "d", header: "Score", width: 100, editable: true },
  ];

  const data: CellValue[][] = [
    ["Alice", 30, "Portland", 88],
    ["Bob", 25, "Seattle", 72],
    ["Carol", 35, "Denver", 95],
    ["Dave", 28, "Austin", 61],
    ["Eve", 22, "Boston", 83],
  ];

  return <Sheet data={data} columns={columns} />;
}

function FormulasSheet() {
  const columns: ColumnDef[] = [
    { id: "a", header: "A", width: 100, editable: true },
    { id: "b", header: "B", width: 100, editable: true },
    { id: "c", header: "C", width: 140, editable: true },
  ];

  const data: CellValue[][] = [
    [10, 20, "=A1+B1"],
    [30, 40, "=A2+B2"],
    [50, 60, "=A3+B3"],
    [null, null, "=SUM(C1:C3)"],
  ];

  const hf = HyperFormula.buildEmpty({ licenseKey: "gpl-v3" });
  const sheetName = hf.addSheet("formulas");
  const sheetId = hf.getSheetId(sheetName)!;

  return (
    <Sheet
      data={data}
      columns={columns}
      formulaEngine={{ instance: hf, sheetId, sheetName }}
      showFormulaBar
      showReferenceHeaders
    />
  );
}

function ClipboardSheet() {
  const columns: ColumnDef[] = [
    { id: "a", header: "X", width: 100, editable: true },
    { id: "b", header: "Y", width: 100, editable: true },
    { id: "c", header: "Z", width: 100, editable: true },
  ];

  const data: CellValue[][] = [
    [1, 2, 3],
    [4, 5, 6],
    [7, 8, 9],
    [null, null, null],
    [null, null, null],
  ];

  return <Sheet data={data} columns={columns} />;
}

function AutofillSheet() {
  const columns: ColumnDef[] = [
    { id: "a", header: "Sequence", width: 120, editable: true },
    { id: "b", header: "Labels", width: 120, editable: true },
    { id: "c", header: "Values", width: 120, editable: true },
  ];

  const data: CellValue[][] = [
    [1, "alpha", 100],
    [2, "beta", 200],
    [3, "gamma", 300],
    [null, null, null],
    [null, null, null],
    [null, null, null],
    [null, null, null],
    [null, null, null],
  ];

  return <Sheet data={data} columns={columns} />;
}

function HistorySheet() {
  const columns: ColumnDef[] = [
    { id: "a", header: "Col A", width: 120, editable: true },
    { id: "b", header: "Col B", width: 120, editable: true },
  ];

  const data: CellValue[][] = [
    ["original", 100],
    ["untouched", 200],
  ];

  return <Sheet data={data} columns={columns} />;
}

function ReadonlySheet() {
  const columns: ColumnDef[] = [
    { id: "a", header: "Locked", width: 120, editable: false },
    { id: "b", header: "Editable", width: 120, editable: true },
    { id: "c", header: "Also Locked", width: 120, editable: false },
  ];

  const data: CellValue[][] = [
    ["no-edit", "can-edit", "no-edit"],
    ["fixed", "free", "fixed"],
    ["locked", "open", "locked"],
  ];

  return <Sheet data={data} columns={columns} />;
}

function LargeSheet() {
  const COL_COUNT = 20;
  const ROW_COUNT = 10_000;

  const columns: ColumnDef[] = Array.from({ length: COL_COUNT }, (_, i) => ({
    id: `col${i}`,
    header: `Col ${i}`,
    width: 100,
    editable: true,
  }));

  const data: CellValue[][] = Array.from({ length: ROW_COUNT }, (_, row) =>
    Array.from({ length: COL_COUNT }, (_, col) => row * COL_COUNT + col),
  );

  return <Sheet data={data} columns={columns} />;
}

// ── Demo metadata ───────────────────────────────────────────

const DEMOS = [
  {
    id: "basic",
    tab: "Editing",
    title: "Basic Editing",
    desc: "Click to select, double-click or start typing to edit. Arrow keys, Tab, and Enter for navigation. Escape to cancel, Delete to clear.",
    badges: [
      "click selection",
      "arrow keys",
      "Tab / Enter",
      "double-click edit",
      "Escape cancel",
      "Delete clear",
    ],
    tall: false,
  },
  {
    id: "formulas",
    tab: "Formulas",
    title: "Formulas",
    desc: "HyperFormula engine with 400+ functions. Column C computes =A+B per row. C4 sums the column. Edit a value and watch dependents update.",
    badges: [
      "=A1+B1",
      "=SUM(C1:C3)",
      "formula bar",
      "reactive updates",
      "reference highlighting",
    ],
    tall: false,
  },
  {
    id: "clipboard",
    tab: "Clipboard",
    title: "Clipboard",
    desc: "Ctrl+C to copy, Ctrl+X to cut, Ctrl+V to paste. Data serializes as TSV — round-trips cleanly with Excel and Google Sheets.",
    badges: ["Ctrl+C copy", "Ctrl+X cut", "Ctrl+V paste", "TSV format"],
    tall: false,
  },
  {
    id: "autofill",
    tab: "Autofill",
    title: "Autofill",
    desc: "Select rows 1\u20133 and drag the fill handle down. Numbers detect series: [1,2,3] becomes [4,5,6]. Text repeats cyclically.",
    badges: [
      "fill handle",
      "linear series",
      "copy mode",
      "multi-column",
      "Escape cancel",
    ],
    tall: false,
  },
  {
    id: "history",
    tab: "History",
    title: "Undo / Redo",
    desc: "Ctrl+Z to undo, Ctrl+Y to redo. Batch operations like paste and autofill record as a single history step.",
    badges: ["Ctrl+Z undo", "Ctrl+Y redo", "batch grouping", "200 entry max"],
    tall: false,
  },
  {
    id: "readonly",
    tab: "Read-Only",
    title: "Read-Only Columns",
    desc: 'Columns A and C have editable\u00a0:\u00a0false \u2014 double-click, Delete, and paste are all blocked. Column B works normally.',
    badges: [
      "per-column flag",
      "blocks edit",
      "blocks delete",
      "blocks paste",
    ],
    tall: false,
  },
  {
    id: "large",
    tab: "Large Dataset",
    title: "Large Dataset",
    desc: "10,000 rows \u00d7 20 columns = 200,000 cells. Row virtualization keeps the DOM light. Scroll anywhere and edit.",
    badges: [
      "10K rows",
      "200K cells",
      "virtual scrolling",
      "full edit support",
    ],
    tall: true,
  },
] as const;

// ── Site header ─────────────────────────────────────────────

function SiteHeader() {
  return (
    <header class="site-header">
      <div class="section-wrap site-header-inner">
        <a href="/" class="site-logo">
          peculiar-sheets
        </a>
        <nav class="site-header-nav">
          <a href="#features" class="nav-section-link">
            Features
          </a>
          <a href="#demos" class="nav-section-link">
            Demos
          </a>
          <a href="#quickstart" class="nav-section-link">
            Quick Start
          </a>
          <span class="nav-divider" aria-hidden="true" />
          <a
            href="https://github.com/peculiarnewbie/spreadsheets"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
          <a
            href="https://www.npmjs.com/package/peculiar-sheets"
            target="_blank"
            rel="noopener noreferrer"
          >
            npm
          </a>
        </nav>
      </div>
    </header>
  );
}

// ── Hero ────────────────────────────────────────────────────

function HeroSection() {
  return (
    <section class="hero-section">
      <div class="section-wrap">
        <div class="hero-shell rise-in">
          <p class="island-kicker">peculiar-sheets</p>
          <h1 class="hero-title">
            A spreadsheet engine{" "}
            <span class="hero-title-accent">built on signals.</span>
          </h1>
          <p class="hero-subtitle">
            Full spreadsheet UX for SolidJS — editing, formulas, clipboard,
            autofill, undo/redo — powered by fine-grained reactivity and virtual
            scrolling for 200K+ cells.
          </p>
          <InstallCommand />
          <div class="hero-stats">
            <span>200K+ cells</span>
            <span class="hero-stat-sep" aria-hidden="true">
              ·
            </span>
            <span>400+ formulas</span>
            <span class="hero-stat-sep" aria-hidden="true">
              ·
            </span>
            <span>SolidJS-native</span>
            <span class="hero-stat-sep" aria-hidden="true">
              ·
            </span>
            <span>GPL-3.0</span>
          </div>
        </div>

        <div class="hero-sheet-area">
          <p class="hero-sheet-label">
            Try it — edit a number and watch the totals update
          </p>
          <div class="hero-sheet-wrap">
            <div class="hero-sheet-inner">
              <HeroSheet />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Features ────────────────────────────────────────────────

const FEATURES = [
  {
    title: "Signals, not state",
    desc: "Every cell is a fine-grained signal. Updates touch only what changed — no reconciliation, no diffing, no wasted renders.",
  },
  {
    title: "200K+ cells",
    desc: "Row virtualization via @tanstack/solid-virtual. 10,000 rows scroll and edit without a hitch.",
  },
  {
    title: "400+ formulas",
    desc: "Optional HyperFormula engine with =SUM, =VLOOKUP, cross-sheet refs. Or skip it — not a hard dependency.",
  },
  {
    title: "Excel clipboard",
    desc: "Copy/paste as TSV. Data round-trips with Excel and Google Sheets. Cut, copy, and paste all work.",
  },
  {
    title: "Smart autofill",
    desc: "Drag the fill handle — series detection turns [1, 2, 3] into [4, 5, 6]. Formulas shift references automatically.",
  },
  {
    title: "Full undo/redo",
    desc: "Ctrl+Z/Y with batch awareness. Paste 100 cells? One undo step. Selection state restores too.",
  },
];

function FeaturesSection() {
  return (
    <section class="features-section" id="features">
      <div class="section-wrap">
        <h2 class="section-heading">Why peculiar-sheets</h2>
        <div class="features-grid">
          {FEATURES.map((f) => (
            <div class="feature-card">
              <h3 class="feature-title">{f.title}</h3>
              <p class="feature-desc">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Demo playground ─────────────────────────────────────────

function DemoPlayground() {
  const [activeIdx, setActiveIdx] = createSignal(0);
  const demo = () => DEMOS[activeIdx()];

  return (
    <section class="demos-section" id="demos">
      <div class="section-wrap">
        <h2 class="section-heading">Try it out</h2>
        <p class="section-subheading">
          Every demo below is live and interactive.
        </p>

        <div class="demo-tabs-wrap">
          <div class="demo-tabs">
            {DEMOS.map((d, i) => (
              <button
                class={`demo-tab${activeIdx() === i ? " active" : ""}`}
                onClick={() => setActiveIdx(i)}
              >
                {d.tab}
              </button>
            ))}
          </div>
        </div>

        <div class="demo-content">
          <div class="demo-meta">
            <h3 class="demo-title">{demo().title}</h3>
            <p class="demo-desc">{demo().desc}</p>
            <div class="demo-badges">
              {demo().badges.map((b) => (
                <span class="demo-badge">{b}</span>
              ))}
            </div>
          </div>

          <div class={`demo-sheet-wrap${demo().tall ? " tall" : ""}`}>
            <div class={`demo-sheet-inner${demo().tall ? " tall" : ""}`}>
              <Switch>
                <Match when={activeIdx() === 0}>
                  <BasicSheet />
                </Match>
                <Match when={activeIdx() === 1}>
                  <FormulasSheet />
                </Match>
                <Match when={activeIdx() === 2}>
                  <ClipboardSheet />
                </Match>
                <Match when={activeIdx() === 3}>
                  <AutofillSheet />
                </Match>
                <Match when={activeIdx() === 4}>
                  <HistorySheet />
                </Match>
                <Match when={activeIdx() === 5}>
                  <ReadonlySheet />
                </Match>
                <Match when={activeIdx() === 6}>
                  <LargeSheet />
                </Match>
              </Switch>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Quick start ─────────────────────────────────────────────

function QuickStart() {
  const code = `import { Sheet } from "peculiar-sheets";
import "peculiar-sheets/styles";

const columns = [
  { id: "name", header: "Name", width: 140, editable: true },
  { id: "role", header: "Role", width: 120, editable: true },
  { id: "score", header: "Score", width: 100, editable: true },
];

const data = [
  ["Alice", "Engineer", 92],
  ["Bob", "Designer", 87],
];

export default () => <Sheet data={data} columns={columns} />;`;

  return (
    <section class="quickstart-section" id="quickstart">
      <div class="section-wrap">
        <h2 class="section-heading">Get started</h2>
        <div class="code-block">
          <div class="code-header">
            <span class="code-filename">App.tsx</span>
          </div>
          <pre>
            <code>{code}</code>
          </pre>
        </div>
      </div>
    </section>
  );
}

// ── App ─────────────────────────────────────────────────────

export default function App() {
  return (
    <>
      <SiteHeader />
      <main>
        <HeroSection />
        <FeaturesSection />
        <DemoPlayground />
        <QuickStart />
      </main>
      <footer class="site-footer">
        <a
          href="https://github.com/peculiarnewbie/spreadsheets"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub
        </a>
        {" · "}
        <a
          href="https://www.npmjs.com/package/peculiar-sheets"
          target="_blank"
          rel="noopener noreferrer"
        >
          npm
        </a>
      </footer>
    </>
  );
}
