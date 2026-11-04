import { Result, TaggedError } from "better-result";

class ReplacementTimingError extends TaggedError("ReplacementTimingError")<{
	cause: unknown;
}> {}

/** Submit inside rAF, then stop at the second subsequent callback (not presented paint). */
export function measureFrameAlignedReplacement(submit: () => void) {
	return Result.tryPromise({
		try: () =>
			new Promise<{
				synchronousMs: number;
				firstFrameMs: number;
				secondFrameMs: number;
				settledMs: number;
			}>((resolve, reject) => {
				requestAnimationFrame(() => {
					try {
						const start = performance.now();
						submit();
						const synchronousMs = performance.now() - start;
						requestAnimationFrame(() => {
							const firstFrameMs = performance.now() - start;
							requestAnimationFrame(() => {
								const settledMs = performance.now() - start;
								resolve({
									synchronousMs,
									firstFrameMs,
									secondFrameMs: settledMs - firstFrameMs,
									settledMs,
								});
							});
						});
					} catch (cause) {
						reject(cause);
					}
				});
			}),
		catch: (cause) => new ReplacementTimingError({ cause }),
	});
}
