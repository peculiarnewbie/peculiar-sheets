const fs = require("node:fs");
const median = (x) => {
	x.sort((a, b) => a - b);
	return (x[Math.floor((x.length - 1) / 2)] + x[Math.floor(x.length / 2)]) / 2;
};
const archived = process.argv.includes("--archive");
for (const run of ["before", "after", "final", "final-focused", "confirmation"]) {
	const names = { after: "revision-experiment", final: "revision-experiment-confirmation" };
	const file = archived
		? `${__dirname}/${names[run] ?? run}.json`
		: `.benchmark/r4-${run}/baseline.json`;
	if (!fs.existsSync(file)) continue;
	const d = JSON.parse(fs.readFileSync(file));
	for (const s of ["batch-writes", "offscreen-writes", "visible-writes"]) {
		const times = {};
		for (const i of new Set(d.results.map((r) => r.implementation)))
			times[i] = median(
				d.results
					.filter((r) => r.scenario === s && r.implementation === i)
					.map((r) => r.writes.completionDurationMs),
			);
		console.log(
			run,
			s,
			JSON.stringify(times),
			"ratio",
			times["peculiar-sheets"] / Math.min(...Object.values(times)),
		);
	}
}
for (const run of ["before", "after", "retained"]) {
	const dir = archived
		? `${__dirname}/profile-${run === "after" ? "revision-experiment" : run}`
		: `.benchmark/r4-profile-${run}`;
	if (!fs.existsSync(dir)) continue;
	const durations = {},
		counts = {};
	let samples = 0;
	for (const file of fs.readdirSync(dir).filter((f) => f.startsWith("phases-"))) {
		const marks = JSON.parse(fs.readFileSync(`${dir}/${file}`));
		const start = marks.find((m) => m.name === "r4.timer-entry"),
			end = marks.find((m) => m.name === "r4.timer-complete");
		if (!start || !end) continue;
		samples++;
		const inCall = marks.filter((m) => m.time >= start.time && m.time <= end.time);
		for (const name of ["signal-write", "computation-update", "computation-run"])
			(counts[name] ??= []).push(inCall.filter((m) => m.name === `r4.${name}`).length);
		const phases = inCall.filter(
			(m) => !["r4.signal-write", "r4.computation-update", "r4.computation-run"].includes(m.name),
		);
		for (let i = 1; i < phases.length; i++) {
			const p = phases[i],
				prev = phases[i - 1];
			(durations[`${prev.name} → ${p.name}`] ??= []).push(p.time - prev.time);
		}
		(durations.total ??= []).push(end.time - start.time);
	}
	console.log(
		"PHASES",
		run,
		samples,
		JSON.stringify(
			Object.fromEntries(Object.entries(durations).map(([k, v]) => [k, median(v)])),
			null,
			2,
		),
	);
	console.log(
		"COUNTS",
		run,
		JSON.stringify(
			Object.fromEntries(
				Object.entries(counts).map(([k, v]) => [
					k,
					{ median: median(v), min: Math.min(...v), max: Math.max(...v) },
				]),
			),
		),
	);
}
