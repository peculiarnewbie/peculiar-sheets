import { batch, createSignal, Show, Switch, Match } from "solid-js";
import { highlight } from "sugar-high";
import "peculiar-sheets/styles";
import "./styles.css";

// ── Scenario replay ─────────────────────────────────────────
import { SCENARIOS } from "sheet-scenarios/scenarios";
import { ScenarioPlayer } from "./player/ScenarioPlayer";
import type { ReplayHostHandle } from "./player/ReplayHost";

// ── Demo components (one file per demo) ─────────────────────
import BasicSheet          from "./demos/basic";
import FormulasSheet       from "./demos/formulas";
import ClipboardSheet      from "./demos/clipboard";
import AutofillSheet       from "./demos/autofill";
import HistorySheet        from "./demos/history";
import ReadonlySheet       from "./demos/readonly";
import LargeSheet          from "./demos/large";
import RowsSheet           from "./demos/rows";
import SortViewSheet       from "./demos/sort-view";
import SortMutationSheet   from "./demos/sort-mutation";
import SortExternalSheet   from "./demos/sort-external";
import SortMutationFormulasSheet from "./demos/sort-mutation-formulas";
import FormulaRowsSheet    from "./demos/formula-rows";
import FormulaRowDeleteSheet from "./demos/formula-row-delete";
import CrossSheetDemo      from "./demos/cross-sheet";
import CustomRenderingSheet from "./demos/custom-rendering";
import StylingSheet         from "./demos/styling";

// ── Raw source strings for the code toggle ──────────────────
import basicCode                from "./demos/basic?raw";
import formulasCode             from "./demos/formulas?raw";
import clipboardCode            from "./demos/clipboard?raw";
import autofillCode             from "./demos/autofill?raw";
import historyCode              from "./demos/history?raw";
import readonlyCode             from "./demos/readonly?raw";
import largeCode                from "./demos/large?raw";
import rowsCode                 from "./demos/rows?raw";
import sortViewCode             from "./demos/sort-view?raw";
import sortMutationCode         from "./demos/sort-mutation?raw";
import sortExternalCode         from "./demos/sort-external?raw";
import sortMutationFormulasCode from "./demos/sort-mutation-formulas?raw";
import formulaRowsCode          from "./demos/formula-rows?raw";
import formulaRowDeleteCode     from "./demos/formula-row-delete?raw";
import crossSheetCode           from "./demos/cross-sheet?raw";
import customRenderingCode      from "./demos/custom-rendering?raw";
import stylingCode              from "./demos/styling?raw";

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
  {
    id: "rows",
    tab: "Row Ops",
    title: "Row Insert / Delete",
    desc: "Right-click a row to insert above, insert below, or delete. Row operations update references and keep formulas consistent.",
    badges: ["insert above", "insert below", "delete row", "context menu"],
    tall: false,
  },
  {
    id: "sort-view",
    tab: "Sort (View)",
    title: "Sort \u2014 View Mode",
    desc: "Click a column header to select the full column. Use the header context menu to sort A-Z or Z-A. Rows reorder visually but the underlying data stays in its original order.",
    badges: [
      "header select",
      "A-Z / Z-A",
      "visual only",
      "data unchanged",
    ],
    tall: false,
  },
  {
    id: "sort-mutation",
    tab: "Sort (Mutate)",
    title: "Sort \u2014 Mutation Mode",
    desc: "Click a column header to select the full column. Use the header context menu to sort A-Z or Z-A. Unlike view mode, this physically reorders the data array.",
    badges: [
      "header select",
      "A-Z / Z-A",
      "reorders data",
      "row indices update",
    ],
    tall: false,
  },
  {
    id: "sort-external",
    tab: "Sort (External)",
    title: "Sort \u2014 External Mode",
    desc: "Click a column header to select the full column. Use the header context menu to fire onSort intents and update sort indicators while the host owns the actual data order.",
    badges: [
      "sort indicators",
      "onSort callback",
      "host-controlled",
      "server-side friendly",
    ],
    tall: false,
  },
  {
    id: "sort-mutation-formulas",
    tab: "Sort + Formulas",
    title: "Sort with Formulas",
    desc: "Mutation sort combined with a HyperFormula engine. Use the header context menu to sort by any column and formulas re-evaluate with the new row order.",
    badges: [
      "mutation sort",
      "=A1+B1",
      "formula bar",
      "refs shift on sort",
    ],
    tall: false,
  },
  {
    id: "formula-rows",
    tab: "Formula + Rows",
    title: "Formulas + Row Ops",
    desc: "Insert or delete rows in a sheet with formulas. =SUM ranges expand, cell references shift, and the formula engine stays in sync automatically.",
    badges: [
      "=B1+C1",
      "=SUM(D1:D3)",
      "insert row",
      "refs auto-shift",
      "formula bar",
    ],
    tall: false,
  },
  {
    id: "formula-row-delete",
    tab: "Formula + Delete",
    title: "Formula Row Delete",
    desc: "Delete rows that are referenced by formulas. Cross-row references like =B3 and =B3+B4 update or error gracefully when their target row is removed.",
    badges: [
      "delete row",
      "=B3 ref shift",
      "=SUM range shrink",
      "dangling ref \u2192 error",
    ],
    tall: false,
  },
  {
    id: "cross-sheet",
    tab: "Cross-Sheet",
    title: "Cross-Sheet References",
    desc: "Two sheets side by side with a shared workbook coordinator. The summary sheet references cells from the data sheet via =Data!B1 syntax. Edit a value on the left and watch the right update.",
    badges: [
      "=SUM(Data!B1:B3)",
      "=Data!A1",
      "workbook coordinator",
      "live sync",
    ],
    tall: false,
  },
  {
    id: "custom-rendering",
    tab: "Custom Cells",
    title: "Custom Cell Rendering",
    desc: "Four column-level hooks: formatValue (display transform), parseValue (commit transform, preserves hidden metadata), renderCell (custom JSX), getCellTitle (hover). The Localized column stores the full NSLOCTEXT(...) wrapper but displays just the inner text; edits preserve area/id. The Status column renders colored pills via renderCell.",
    badges: [
      "formatValue",
      "parseValue",
      "renderCell",
      "getCellTitle",
      "NSLOCTEXT round-trip",
      "status pills",
    ],
    tall: false,
  },
  {
    id: "styling",
    tab: "Styling",
    title: "Range Styling",
    desc: "Declarative range-based cell styling. createRangeStyles compiles a list of range \u2192 style rules into an O(rules) per-cell lookup, wired into the grid via customization.getCellStyle. Later rules shallow-merge over earlier (CSS-cascade semantics). Targets can be a single cell, a rectangular range, or an array mixing both.",
    badges: [
      "createRangeStyles",
      "getCellStyle",
      "range \u2192 CSS",
      "cascade merge",
      "single cell / range / mixed",
    ],
    tall: false,
  },
] as const;

type DemoId = (typeof DEMOS)[number]["id"];

const DEMO_CODE: Record<DemoId, string> = {
  "basic":                  basicCode,
  "formulas":               formulasCode,
  "clipboard":              clipboardCode,
  "autofill":               autofillCode,
  "history":                historyCode,
  "readonly":               readonlyCode,
  "large":                  largeCode,
  "rows":                   rowsCode,
  "sort-view":              sortViewCode,
  "sort-mutation":          sortMutationCode,
  "sort-external":          sortExternalCode,
  "sort-mutation-formulas": sortMutationFormulasCode,
  "formula-rows":           formulaRowsCode,
  "formula-row-delete":     formulaRowDeleteCode,
  "cross-sheet":            crossSheetCode,
  "custom-rendering":       customRenderingCode,
  "styling":                stylingCode,
};

const GROUPS = [
  { name: "Basics", ids: ["basic", "readonly"] },
  { name: "Formulas", ids: ["formulas", "cross-sheet"] },
  { name: "Editing", ids: ["clipboard", "autofill", "history"] },
  { name: "Rows", ids: ["rows", "formula-rows", "formula-row-delete"] },
  {
    name: "Sorting",
    ids: [
      "sort-view",
      "sort-mutation",
      "sort-external",
      "sort-mutation-formulas",
    ],
  },
  { name: "Advanced", ids: ["large", "custom-rendering", "styling"] },
] as const satisfies readonly {
  readonly name: string;
  readonly ids: readonly DemoId[];
}[];

type GroupName = (typeof GROUPS)[number]["name"];

const DEMO_BY_ID = new Map<DemoId, (typeof DEMOS)[number]>(
  DEMOS.map((d) => [d.id, d])
);

// ── Site header ─────────────────────────────────────────────

function SiteHeader() {
  return (
    <header class="site-header">
      <div class="section-wrap site-header-inner">
        <a href="/" class="site-logo">
          peculiar-sheets
        </a>
        <nav class="site-header-nav">
          <a href="#demos" class="nav-section-link">
            Demos
          </a>
          <a href="#features" class="nav-section-link">
            Features
          </a>
          <a href="#quickstart" class="nav-section-link">
            Quick Start
          </a>
          <span class="nav-divider" aria-hidden="true" />
          <a
            href="https://github.com/peculiarnewbie/peculiar-sheets"
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
            autofill, undo/redo — powered by fine-grained reactivity and built
            to stay performant.
          </p>
          <InstallCommand />
          <div class="hero-stats">
            <span>HyperFormula</span>
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
      </div>
    </section>
  );
}

// ── Features ────────────────────────────────────────────────

const FEATURES = [
  {
    claim: "Every cell is a signal.",
    line: "Edit one cell — only that cell re-renders. No VDOM, no reconcile, no wasted work downstream.",
    chip: "SolidJS primitives",
  },
  {
    claim: "Round-trip rich values.",
    line: "Four column hooks handle display, parse, render, and hover. Store NSLOCTEXT — show just the inner text. Edits preserve every byte of metadata.",
    chip: "formatValue · parseValue · renderCell · getCellTitle",
  },
  {
    claim: "One sort, three semantics.",
    line: "View-sort without touching the data. Mutate in place for export. Or delegate to the host for server-side sorting.",
    chip: 'sortMode: "view" | "mutation" | "external"',
  },
  {
    claim: "Refs survive row ops.",
    line: "Insert, delete, reorder — HyperFormula follows along. Ranges expand, references shift, nothing breaks silently.",
    chip: "=SUM(B1:B3)  →  =SUM(B1:B4)",
  },
  {
    claim: "Sheets that talk to each other.",
    line: "One coordinator, many sheets. Cross-sheet references like =Data!B1 sync live across every instance in the workbook.",
    chip: "createWorkbookCoordinator()",
  },
];

function FeaturesSection() {
  return (
    <section class="features-section" id="features">
      <div class="section-wrap">
        <p class="features-kicker">
          <span class="features-kicker-mark">§</span> what makes it peculiar
        </p>
        <ol class="features-index">
          {FEATURES.map((f, i) => (
            <li class="feature-row">
              <span class="feature-num" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div class="feature-body">
                <h3 class="feature-claim">{f.claim}</h3>
                <p class="feature-line">{f.line}</p>
              </div>
              <code class="feature-chip">{f.chip}</code>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

// ── Demo playground ─────────────────────────────────────────

type ViewMode = "live" | "code" | "replay";

function DemoPlayground() {
  const [activeGroup, setActiveGroup] = createSignal<GroupName>(GROUPS[0].name);
  const [activeId, setActiveId] = createSignal<DemoId>(GROUPS[0].ids[0]);
  const [replayHandle, setReplayHandle] = createSignal<ReplayHostHandle | null>(null);

  const hasScenarios = () => (SCENARIOS[activeId()] ?? []).length > 0;
  const scenarios = () => SCENARIOS[activeId()] ?? [];

  // Default to Replay when the active demo ships scenarios, else Live. Replay
  // acts as the demo's "trailer" — one click on the sheet drops back to Live.
  const [viewMode, setViewMode] = createSignal<ViewMode>(
    hasScenarios() ? "replay" : "live"
  );

  const group = () => GROUPS.find((g) => g.name === activeGroup()) ?? GROUPS[0];
  const demo = () => DEMO_BY_ID.get(activeId()) ?? DEMOS[0];

  // When the user picks a different demo, batch-update three things atomically:
  //   1. drop the stale replay handle (the old ReplayHost is about to unmount)
  //   2. switch activeId (which re-mounts the demo tree; a fresh ReplayHost,
  //      if any, will populate replayHandle via onReplayReady during its render)
  //   3. reset the view mode based on whether the new demo ships scenarios
  //
  // Why not use `createEffect(on(activeId, ...))`? That effect runs AFTER the
  // render pass, meaning it would null out the freshly-mounted handle. Doing
  // the work inline in the click handler — before setActiveId triggers the
  // Match re-evaluation — avoids that ordering bug.
  const selectDemo = (id: DemoId) => {
    const nextHasScenarios = (SCENARIOS[id] ?? []).length > 0;
    batch(() => {
      setReplayHandle(null);
      setActiveId(id);
      setViewMode(nextHasScenarios ? "replay" : "live");
    });
  };

  const selectGroup = (name: GroupName) => {
    const g = GROUPS.find((gr) => gr.name === name);
    if (!g) return;
    setActiveGroup(name);
    selectDemo(g.ids[0]);
  };

  return (
    <section class="demos-section" id="demos">
      <div class="section-wrap">
        <h2 class="section-heading">Try it out</h2>

        <div class="demo-tabs-wrap">
          <div class="demo-tabs">
            {GROUPS.map((g) => (
              <button
                class={`demo-tab${activeGroup() === g.name ? " active" : ""}`}
                onClick={() => selectGroup(g.name)}
              >
                {g.name}
              </button>
            ))}
          </div>
        </div>

        <div class="demo-tabs-wrap demo-tabs-wrap-secondary">
          <div class="demo-tabs demo-tabs-secondary">
            {group().ids.map((id) => {
              const d = DEMO_BY_ID.get(id);
              if (!d) return null;
              return (
                <button
                  class={`demo-tab${activeId() === id ? " active" : ""}`}
                  onClick={() => selectDemo(id)}
                >
                  {d.tab}
                </button>
              );
            })}
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

          <div class="demo-sheet-frame">
            <div class="demo-view-toggle-row">
              <div class="demo-view-toggle" role="tablist" aria-label="View mode">
                <button
                  type="button"
                  class={`demo-view-toggle__btn${viewMode() === "live" ? " active" : ""}`}
                  onClick={() => setViewMode("live")}
                  title="Live interactive demo"
                >
                  Live
                </button>
                <Show when={hasScenarios()}>
                  <button
                    type="button"
                    class={`demo-view-toggle__btn${viewMode() === "replay" ? " active" : ""}`}
                    onClick={() => setViewMode("replay")}
                    title="Replay test scenarios"
                  >
                    Replay
                  </button>
                </Show>
                <button
                  type="button"
                  class={`demo-view-toggle__btn${viewMode() === "code" ? " active" : ""}`}
                  onClick={() => setViewMode("code")}
                  title="Source code"
                >
                  {"</>"}
                </button>
              </div>
            </div>

            <div class={`demo-sheet-wrap${demo().tall ? " tall" : ""}`}>
              <div class={`demo-sheet-inner${demo().tall ? " tall" : ""}`}>
                <Show
                  when={viewMode() === "code"}
                  fallback={
                    <div class="demo-sheet-stage" classList={{ "replay-mode": viewMode() === "replay" }}>
                      <div class="demo-sheet-stage__sheet-area">
                        <Switch>
                          <Match when={activeId() === "basic"}>
                            <BasicSheet onReplayReady={setReplayHandle} />
                          </Match>
                          <Match when={activeId() === "formulas"}>
                            <FormulasSheet />
                          </Match>
                          <Match when={activeId() === "clipboard"}>
                            <ClipboardSheet />
                          </Match>
                          <Match when={activeId() === "autofill"}>
                            <AutofillSheet />
                          </Match>
                          <Match when={activeId() === "history"}>
                            <HistorySheet />
                          </Match>
                          <Match when={activeId() === "readonly"}>
                            <ReadonlySheet />
                          </Match>
                          <Match when={activeId() === "large"}>
                            <LargeSheet />
                          </Match>
                          <Match when={activeId() === "rows"}>
                            <RowsSheet />
                          </Match>
                          <Match when={activeId() === "sort-view"}>
                            <SortViewSheet />
                          </Match>
                          <Match when={activeId() === "sort-mutation"}>
                            <SortMutationSheet />
                          </Match>
                          <Match when={activeId() === "sort-external"}>
                            <SortExternalSheet />
                          </Match>
                          <Match when={activeId() === "sort-mutation-formulas"}>
                            <SortMutationFormulasSheet />
                          </Match>
                          <Match when={activeId() === "formula-rows"}>
                            <FormulaRowsSheet />
                          </Match>
                          <Match when={activeId() === "formula-row-delete"}>
                            <FormulaRowDeleteSheet />
                          </Match>
                          <Match when={activeId() === "cross-sheet"}>
                            <CrossSheetDemo />
                          </Match>
                          <Match when={activeId() === "custom-rendering"}>
                            <CustomRenderingSheet />
                          </Match>
                          <Match when={activeId() === "styling"}>
                            <StylingSheet />
                          </Match>
                        </Switch>
                        <Show when={viewMode() === "replay" && hasScenarios()}>
                          <button
                            type="button"
                            class="demo-sheet-stage__shield"
                            aria-label="Exit replay and return to Live mode"
                            title="Click anywhere to edit"
                            onClick={() => setViewMode("live")}
                          >
                            <span class="demo-sheet-stage__shield-hint">
                              Click to edit — switch to Live
                            </span>
                          </button>
                        </Show>
                      </div>
                      <Show when={viewMode() === "replay" && hasScenarios()}>
                        <ScenarioPlayer scenarios={scenarios()} host={replayHandle()} />
                      </Show>
                    </div>
                  }
                >
                  <div class="demo-code-view">
                    <pre><code class="sh" innerHTML={highlight(DEMO_CODE[activeId()])} /></pre>
                  </div>
                </Show>
              </div>
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
            <code class="sh" innerHTML={highlight(code)} />
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
        <DemoPlayground />
        <FeaturesSection />
        <QuickStart />
      </main>
      <footer class="site-footer">
        <a
          href="https://github.com/peculiarnewbie/peculiar-sheets"
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
