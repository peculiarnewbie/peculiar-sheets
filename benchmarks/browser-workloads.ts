import { Result, TaggedError } from "better-result";
import { setTimeout as delay } from "node:timers/promises";
import type { BenchmarkPoint, BenchmarkWrite, ScenarioName } from "../apps/benchmarks/src/types";
import type { PageLike } from "./browser-types";
import { editorReady, editorsClosed } from "./editor-readiness";

class BrowserWorkloadError extends TaggedError("BrowserWorkloadError")<{
	scenario: ScenarioName;
	message: string;
	cause: unknown;
}> {}

const keyCodes: Record<string, number> = {
	Enter: 13,
	Tab: 9,
	Escape: 27,
	Delete: 46,
	ArrowDown: 40,
	ArrowUp: 38,
	ArrowLeft: 37,
	ArrowRight: 39,
};

async function press(page: PageLike, key: string, modifiers = 0): Promise<void> {
	const keyCode = keyCodes[key] ?? key.toUpperCase().charCodeAt(0);
	const code = key.length === 1 ? `Key${key.toUpperCase()}` : key;
	await page.sendCDP("Input.dispatchKeyEvent", {
		type: "keyDown",
		key,
		code,
		windowsVirtualKeyCode: keyCode,
		modifiers,
	});
	await page.sendCDP("Input.dispatchKeyEvent", {
		type: "keyUp",
		key,
		code,
		windowsVirtualKeyCode: keyCode,
		modifiers,
	});
}

async function click(page: PageLike, point: BenchmarkPoint, double = false): Promise<void> {
	await page.sendCDP("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
	for (let count = 1; count <= (double ? 2 : 1); count++) {
		await page.sendCDP("Input.dispatchMouseEvent", {
			type: "mousePressed",
			...point,
			button: "left",
			clickCount: count,
		});
		await page.sendCDP("Input.dispatchMouseEvent", {
			type: "mouseReleased",
			...point,
			button: "left",
			clickCount: count,
		});
	}
}

async function settle(page: PageLike): Promise<void> {
	await page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			),
	);
}

async function pointForCell(page: PageLike, row: number, column: number): Promise<BenchmarkPoint> {
	for (let attempt = 0; attempt < 100; attempt++) {
		const point = await page.evaluate(
			({ row, column }) => {
				if (!window.__BENCHMARK__) throw new Error("Benchmark API missing");
				return window.__BENCHMARK__.getCellPoint(row, column);
			},
			{ row, column },
		);
		if (point) return point;
		await delay(20);
	}
	throw new Error(`Cell ${row},${column} did not render within the readiness timeout`);
}

async function verify(page: PageLike, writes: BenchmarkWrite[]): Promise<void> {
	await settle(page);
	await page.evaluate((writes) => {
		if (!window.__BENCHMARK__) throw new Error("Benchmark API missing");
		window.__BENCHMARK__.verifyCells(writes);
	}, writes);
}

async function edit(page: PageLike, row: number, column: number, value: string): Promise<void> {
	await click(page, await pointForCell(page, row, column), true);
	await settle(page);
	await waitForEditor(page, false);
	await press(page, "a", 2);
	await waitForEditor(page, true);
	await page.sendCDP("Input.insertText", { text: value });
	await press(page, "Enter");
	const deadline = Date.now() + 3_000;
	while (!(await page.evaluate(editorsClosed))) {
		if (Date.now() >= deadline)
			throw new Error("Editor did not close after Enter within the readiness timeout");
		await delay(10);
	}
	await verify(page, [{ row, column, value }]);
}

async function waitForEditor(page: PageLike, requireSelection: boolean): Promise<void> {
	const deadline = Date.now() + 3_000;
	do {
		if (await page.evaluate(editorReady, requireSelection)) return;
		await delay(10);
	} while (Date.now() < deadline);
	throw new Error(
		`Editor did not become ${requireSelection ? "fully selected" : "focused"} within the readiness timeout`,
	);
}

async function wheel(
	page: PageLike,
	point: BenchmarkPoint,
	deltaX: number,
	deltaY: number,
): Promise<void> {
	await page.sendCDP("Input.dispatchMouseEvent", { type: "mouseWheel", ...point, deltaX, deltaY });
}

async function run(page: PageLike, scenario: ScenarioName): Promise<void> {
	const point = await pointForCell(page, 0, 0);
	await click(page, point);
	await settle(page);
	await page.evaluate(() => {
		if (!window.__BENCHMARK__) throw new Error("Benchmark API missing");
		window.__BENCHMARK__.startInteraction();
	});
	switch (scenario) {
		case "edit-commit":
			for (let row = 0; row < 5; row++) await edit(page, row, 0, `edited-${row}`);
			return;
		case "keyboard-navigation": {
			const move = async (key: string, row: number, column: number) => {
				await press(page, key);
				await page.evaluate(
					async ({ row, column }) => {
						if (!window.__BENCHMARK__) throw new Error("Benchmark API missing");
						await window.__BENCHMARK__.verifyActiveCell(row, column);
					},
					{ row, column },
				);
			};
			for (let index = 0; index < 40; index++) await move("ArrowDown", index + 1, 0);
			for (let index = 0; index < 12; index++) await move("Tab", 40, index + 1);
			for (let index = 0; index < 5; index++) await move("ArrowUp", 39 - index, 12);
			await settle(page);
			await page.evaluate(async () => {
				if (!window.__BENCHMARK__) throw new Error("Benchmark API missing");
				await window.__BENCHMARK__.verifyActiveCell(35, 12);
				window.__BENCHMARK__.verifyVisibleCell(35, 12);
			});
			return;
		}
		case "paste-small":
		case "paste-large": {
			const rows = scenario === "paste-small" ? 100 : 1_000;
			const writes = Array.from({ length: rows * 20 }, (_, index) => ({
				row: Math.floor(index / 20),
				column: index % 20,
				value: `p${index}`,
			}));
			const text = Array.from({ length: rows }, (_, row) =>
				writes
					.slice(row * 20, row * 20 + 20)
					.map((write) => write.value)
					.join("\t"),
			).join("\n");
			await page.sendCDP("Browser.grantPermissions", {
				origin: "http://localhost:4178",
				permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"],
			});
			await page.evaluate((text) => navigator.clipboard.writeText(text), text);
			await press(page, "v", 2);
			await verify(page, writes);
			return;
		}
		case "clear-undo-redo": {
			await page.evaluate(() => {
				if (!window.__BENCHMARK__) throw new Error("Benchmark API missing");
				return window.__BENCHMARK__.selectRange(100, 20);
			});
			await press(page, "Delete");
			const cleared = Array.from({ length: 2_000 }, (_, index) => ({
				row: Math.floor(index / 20),
				column: index % 20,
				value: null,
			}));
			await verify(page, cleared);
			await press(page, "z", 2);
			await verify(
				page,
				cleared.map((write, index) => ({ ...write, value: index })),
			);
			await press(page, "y", 2);
			await verify(page, cleared);
			return;
		}
		case "scroll-wheel-slow":
		case "scroll-wheel-bursts":
		case "scroll-diagonal": {
			const viewport = await page.evaluate(() => {
				if (!window.__BENCHMARK__) throw new Error("Benchmark API missing");
				return window.__BENCHMARK__.getViewportPoint();
			});
			const count = scenario === "scroll-wheel-slow" ? 40 : 20;
			const start = Date.now();
			for (let index = 0; index < count; index++) {
				await wheel(
					page,
					viewport,
					scenario === "scroll-diagonal" ? 120 : 0,
					scenario === "scroll-wheel-slow" ? 24 : 350,
				);
				const remaining = start + ((index + 1) * 2_000) / count - Date.now();
				if (remaining > 0) await delay(remaining);
			}
			await settle(page);
			const snapshot = await page.evaluate(() => {
				if (!window.__BENCHMARK__) throw new Error("Benchmark API missing");
				return window.__BENCHMARK__.getDiagnosticSnapshot();
			});
			if (
				snapshot.scrollPosition.top < 100 ||
				(scenario === "scroll-diagonal" && snapshot.scrollPosition.left < 100)
			)
				throw new Error(
					`Wheel scrolling did not move the expected axes: ${JSON.stringify(snapshot.scrollPosition)}`,
				);
			await page.evaluate(() => {
				if (!window.__BENCHMARK__) throw new Error("Benchmark API missing");
				const cell = window.__BENCHMARK__.getVisibleCell();
				if (!cell) throw new Error("No visible cell after wheel scrolling");
				window.__BENCHMARK__.verifyVisibleCell(cell.row, cell.column);
			});
			return;
		}
		case "scroll-jump":
			for (const progress of [0.75, 0.25, 0.9]) {
				await page.evaluate((progress) => {
					if (!window.__BENCHMARK__) throw new Error("Benchmark API missing");
					return window.__BENCHMARK__.scrollToProgress("vertical", progress);
				}, progress);
				await settle(page);
				// A trusted click at each destination exercises hit testing on recycled cells.
				const target = await page.evaluate(() => {
					if (!window.__BENCHMARK__) throw new Error("Benchmark API missing");
					const cell = window.__BENCHMARK__.getVisibleCell();
					if (!cell) throw new Error("No visible cell at jump destination");
					window.__BENCHMARK__.verifyVisibleCell(cell.row, cell.column);
					return window.__BENCHMARK__.getCellPoint(cell.row, cell.column);
				});
				if (!target) throw new Error("Jump destination cell did not render");
				await click(page, target);
			}
			return;
		case "streaming-updates": {
			await page.evaluate(() => {
				if (!window.__BENCHMARK__) throw new Error("Benchmark API missing");
				return window.__BENCHMARK__.startStream();
			});
			await edit(page, 0, 0, "edited-during-stream");
			const viewport = await page.evaluate(() => {
				if (!window.__BENCHMARK__) throw new Error("Benchmark API missing");
				return window.__BENCHMARK__.getViewportPoint();
			});
			for (let index = 0; index < 20; index++) {
				await press(page, "ArrowDown");
				await wheel(page, viewport, 0, 50);
				await delay(100);
			}
			await verify(page, [{ row: 0, column: 0, value: "edited-during-stream" }]);
			return;
		}
		default:
			throw new Error(`No browser workload for ${scenario}`);
	}
}

export async function runBrowserWorkload(page: PageLike, scenario: ScenarioName) {
	const result = await Result.tryPromise({
		try: () => run(page, scenario),
		catch: (cause) =>
			new BrowserWorkloadError({ scenario, message: `Browser workload ${scenario} failed`, cause }),
	});
	if (result.isErr()) {
		const details = await Result.tryPromise({
			try: () =>
				page.evaluate(() => ({
					error: window.__BENCH_ERROR__,
					focus: document.activeElement?.outerHTML.slice(0, 700),
					cells: [...document.querySelectorAll("revogr-data")].map((element) =>
						element.outerHTML.slice(0, 300),
					),
				})),
			catch: (cause) =>
				new BrowserWorkloadError({ scenario, message: "Could not inspect failing page", cause }),
		});
		console.debug("benchmark.interaction.failed", { scenario, cause: result.error.cause, details });
	}
	return result;
}
