import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Result, TaggedError } from "better-result";

class BrowserProfileError extends TaggedError("BrowserProfileError")<{
	phase: "sample" | "close" | "cleanup";
	cause: unknown;
}> {}

/** Own the profile explicitly: Stagehand's internally created profiles can survive close on Windows. */
export function withBrowserProfile<B extends { close(): Promise<void> }, T>(options: {
	create(userDataDir: string): B;
	run(browser: B): Promise<T>;
}) {
	return Result.tryPromise({
		try: async () => {
			const userDataDir = await mkdtemp(path.join(os.tmpdir(), "peculiar-bench-profile-"));
			let browser: B | undefined;
			try {
				browser = options.create(userDataDir);
				return await options.run(browser);
			} finally {
				try {
					if (browser) {
						const closing = browser;
						const closed = await Result.tryPromise({
							try: () => closing.close(),
							catch: (cause) => new BrowserProfileError({ phase: "close", cause }),
						});
						closed.tapError((error) =>
							console.debug("benchmark.browser.close.failed", { userDataDir, cause: error.cause }),
						);
					}
				} finally {
					const cleaned = await Result.tryPromise({
						try: () =>
							rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
						catch: (cause) => new BrowserProfileError({ phase: "cleanup", cause }),
					});
					cleaned.tapError((error) =>
						console.debug("benchmark.browser.profile.cleanup.failed", {
							userDataDir,
							cause: error.cause,
						}),
					);
				}
			}
		},
		catch: (cause) => new BrowserProfileError({ phase: "sample", cause }),
	});
}
