import { onMount } from "solid-js";
import {
	Sheet,
	rowId,
	type CellValue,
	type ColumnDef,
	type SheetController,
	type SheetCustomization,
} from "peculiar-sheets";

const columns: ColumnDef[] = [
	{ id: "rank", header: "Rank", width: 90, editable: true, pinned: "left" },
	{ id: "name", header: "Name", width: 180, editable: true },
	{ id: "locked", header: "Locked", width: 120, editable: false },
	{ id: "notes", header: "Notes", width: 220, editable: true },
];

const data: CellValue[][] = Array.from({ length: 80 }, (_, index) => [
	index,
	`Record ${String(index).padStart(2, "0")}`,
	`Read only ${index}`,
	`Note ${index}`,
]);

const rowIds = data.map((_, index) => rowId(`contract-${index}`));

const customization: SheetCustomization = {
	getRowClass: (_rowIndex, context) => [
		`row-id-${context.rowId}`,
		`data-row-${context.dataRowIndex}`,
		`visual-row-${context.visualRowIndex}`,
		context.containsFocus ? "row-has-focus" : "",
		context.intersectsSelection ? "row-intersects-selection" : "",
		context.containsActiveEditor ? "row-has-editor" : "",
	].filter(Boolean).join(" "),
	getRowHeaderClass: (rowIndex) => `legacy-header-${rowIndex}`,
	getCellClass: (rowIndex) => `legacy-cell-row-${rowIndex}`,
};

export default function ContractsPage() {
	let controller: SheetController | null = null;

	onMount(() => {
		window.__SHEET_DATA__ = data;
		window.__SHEET_CONTROLLER__ = controller;
	});

	return (
		<main class="contracts-page" data-testid="harness">
			<style>{`
				.contracts-page { height: 100vh; padding: 12px; box-sizing: border-box; background: #ece7dc; }
				.contracts-page__main { height: 320px; }
				.contracts-page__empty { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; height: 180px; margin-top: 12px; }
				.contract-theme {
					--ps-grid-border: #735d3d;
					--ps-text-primary: #2b261e;
					--ps-surface-header: #d7c39d;
					--ps-surface-header-cell: #e3d4b7;
					--ps-active-row-background: rgba(181, 88, 43, 0.12);
					--ps-active-row-header-background: rgba(181, 88, 43, 0.22);
					--ps-focus: #b5582b;
				}
				.row-has-focus { --ps-active-row-background: rgba(181, 88, 43, 0.16); }
			`}</style>

			<button id="before-grid" type="button">Before grid</button>
			<section class="contracts-page__main">
				<Sheet
					class="contract-theme"
					ariaLabel="Inventory authoring grid"
					data={data}
					columns={columns}
					rowIds={rowIds}
					showReferenceHeaders
					defaultSortState={{ columnId: "rank", direction: "desc" }}
					customization={customization}
					ref={(next) => {
						controller = next;
						window.__SHEET_CONTROLLER__ = next;
					}}
				/>
			</section>
			<button id="after-grid" type="button">After grid</button>

			<section class="contracts-page__empty">
				<Sheet class="default-empty" ariaLabel="Default empty grid" data={[]} columns={columns} />
				<Sheet
					class="custom-empty"
					ariaLabel="Custom empty grid"
					data={[]}
					columns={columns}
					emptyState={<button id="create-first-row" type="button">Create first row</button>}
				/>
			</section>
		</main>
	);
}
