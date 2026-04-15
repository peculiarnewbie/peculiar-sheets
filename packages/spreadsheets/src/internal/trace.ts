import { TaggedError } from "./result";

export type InternalTraceStatus = "start" | "ok" | "noop" | "err";

export interface InternalTraceEvent {
	module: string;
	operation: string;
	phase: string;
	status: InternalTraceStatus;
	timestamp: string;
	context: Record<string, unknown>;
}

export type InternalTraceSink = (event: InternalTraceEvent) => void;

let currentSink: InternalTraceSink = () => {};

export function emitInternalTrace(
	event: Omit<InternalTraceEvent, "timestamp" | "context"> & {
		context?: Record<string, unknown>;
	},
): void {
	currentSink({
		...event,
		timestamp: new Date().toISOString(),
		context: event.context ?? {},
	});
}

export function setInternalTraceSink(sink: InternalTraceSink | null | undefined): () => void {
	currentSink = sink ?? (() => {});
	return () => {
		currentSink = () => {};
	};
}

export function withTraceContext(
	base: Pick<InternalTraceEvent, "module" | "operation" | "phase"> & {
		context?: Record<string, unknown>;
	},
) {
	function emit(status: InternalTraceStatus, context?: Record<string, unknown>) {
		emitInternalTrace({
			...base,
			status,
			context: {
				...(base.context ?? {}),
				...(context ?? {}),
			},
		});
	}

	return {
		start: (context?: Record<string, unknown>) => emit("start", context),
		ok: (context?: Record<string, unknown>) => emit("ok", context),
		noop: (context?: Record<string, unknown>) => emit("noop", context),
		err: (context?: Record<string, unknown>) => emit("err", context),
	};
}

export function errorTraceContext(error: unknown): Record<string, unknown> {
	if (TaggedError.is(error)) {
		return {
			errorTag: error._tag,
			message: error.message,
		};
	}

	if (error instanceof Error) {
		return {
			errorName: error.name,
			message: error.message,
		};
	}

	return {
		message: String(error),
	};
}
