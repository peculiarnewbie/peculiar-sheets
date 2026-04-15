import {
	Err,
	Ok,
	Result as BetterResult,
	TaggedError,
	matchError,
	type TaggedErrorClass,
	type TaggedErrorInstance,
} from "better-result";

export { Err, Ok, TaggedError, matchError };

export const Result = BetterResult;

export type ResultLike<T, E> = Ok<T, E> | Err<T, E>;

export interface AppliedOutcome<T> {
	kind: "applied";
	value: T;
}

export interface NoopOutcome<Reason extends string> {
	kind: "noop";
	reason: Reason;
}

export type OperationOutcome<T, Reason extends string> =
	| AppliedOutcome<T>
	| NoopOutcome<Reason>;

export function applied<T>(value: T): AppliedOutcome<T> {
	return { kind: "applied", value };
}

export function noop<Reason extends string>(reason: Reason): NoopOutcome<Reason> {
	return { kind: "noop", reason };
}

export function isApplied<T, Reason extends string>(
	outcome: OperationOutcome<T, Reason>,
): outcome is AppliedOutcome<T> {
	return outcome.kind === "applied";
}

export function isNoop<T, Reason extends string>(
	outcome: OperationOutcome<T, Reason>,
): outcome is NoopOutcome<Reason> {
	return outcome.kind === "noop";
}

export function getErrorMessage(cause: unknown): string {
	if (cause instanceof Error && cause.message) {
		return cause.message;
	}

	return String(cause);
}

export type {
	TaggedErrorClass,
	TaggedErrorInstance,
};
