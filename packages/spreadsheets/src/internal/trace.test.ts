import { afterEach, describe, expect, it } from "bun:test";
import { applied, isApplied, isNoop, noop } from "./result";
import {
	emitInternalTrace,
	setInternalTraceSink,
	withTraceContext,
	type InternalTraceEvent,
} from "./trace";

describe("internal trace sink", () => {
	let events: InternalTraceEvent[] = [];
	let reset: (() => void) | null = null;

	afterEach(() => {
		events = [];
		reset?.();
		reset = null;
	});

	it("captures emitted events and can be reset", () => {
		reset = setInternalTraceSink((event) => events.push(event));

		emitInternalTrace({
			module: "test",
			operation: "emit",
			phase: "unit",
			status: "start",
			context: { foo: "bar" },
		});

		expect(events).toHaveLength(1);
		expect(events[0]?.module).toBe("test");
		expect(events[0]?.status).toBe("start");
		expect(typeof events[0]?.timestamp).toBe("string");

		reset();
		emitInternalTrace({
			module: "test",
			operation: "emit",
			phase: "unit",
			status: "ok",
		});
		expect(events).toHaveLength(1);
	});

	it("builds contextual start/ok/noop/err traces", () => {
		reset = setInternalTraceSink((event) => events.push(event));
		const trace = withTraceContext({
			module: "formula-bridge",
			operation: "syncAll",
			phase: "mutation",
			context: { sheetId: 1 },
		});

		trace.start({ rowCount: 3 });
		trace.ok();
		trace.noop({ reason: "sheet-unavailable" });
		trace.err({ errorTag: "FormulaEngineSyncError" });

		expect(events.map((event) => event.status)).toEqual(["start", "ok", "noop", "err"]);
		expect(events[0]?.context).toEqual({ sheetId: 1, rowCount: 3 });
		expect(events[2]?.context.reason).toBe("sheet-unavailable");
		expect(events[3]?.context.errorTag).toBe("FormulaEngineSyncError");
	});
});

describe("internal result helpers", () => {
	it("models applied and noop outcomes explicitly", () => {
		const appliedOutcome = applied(123);
		const noopOutcome = noop("engine-rejected");

		expect(isApplied(appliedOutcome)).toBe(true);
		expect(isNoop(noopOutcome)).toBe(true);
		expect(appliedOutcome.value).toBe(123);
		expect(noopOutcome.reason).toBe("engine-rejected");
	});
});
