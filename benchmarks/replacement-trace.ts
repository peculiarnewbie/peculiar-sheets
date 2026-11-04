import { writeFile } from "node:fs/promises";
import type { PageLike } from "./browser-types";

/** Diagnostic capture only; traced samples must not be used as rankings. */
export async function startReplacementTrace(page: PageLike, output: string) {
	const session = page.getSessionForFrame(page.mainFrameId());
	const complete = new Promise<{ stream: string }>((resolve) => {
		const handler = (event: { stream: string }) => {
			session.off("Tracing.tracingComplete", handler);
			resolve(event);
		};
		session.on<{ stream: string }>("Tracing.tracingComplete", handler);
	});
	await page.sendCDP("Tracing.start", {
		categories:
			"devtools.timeline,v8,blink.user_timing,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame,cc,viz",
		transferMode: "ReturnAsStream",
	});
	return async () => {
		await page.sendCDP("Tracing.end");
		const { stream } = await complete;
		try {
			let contents = "";
			for (;;) {
				const chunk = await page.sendCDP<{ data: string; eof: boolean }>("IO.read", {
					handle: stream,
				});
				contents += chunk.data;
				if (chunk.eof) break;
			}
			await writeFile(output, contents);
		} finally {
			await page.sendCDP("IO.close", { handle: stream });
		}
	};
}
