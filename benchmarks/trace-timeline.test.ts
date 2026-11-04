import assert from "node:assert/strict";
import test from "node:test";
import { replacementTimeline, type TimelineEvent } from "./trace-timeline";

test("replacement timeline includes enclosing tasks and separates threads and roundtrip steps", () => {
	const event = (name: string, ts: number, dur = 0): TimelineEvent => ({
		name,
		ts,
		dur,
		pid: 1,
		tid: 2,
	});
	const events = [
		event("RunTask", 900, 500),
		event("replace:replace:start", 1000),
		event("Layout", 1200, 100),
		event("replace:replace:raf1", 2000),
		event("Paint", 2200, 200),
		event("replace:replace:raf2", 3000),
		{ ...event("OtherThread", 1500), tid: 3 },
		event("replace:restore:start", 4000),
		event("replace:restore:raf1", 5000),
		event("replace:restore:raf2", 6000),
	];
	const timelines = replacementTimeline(events);
	assert.equal(timelines.length, 2);
	assert.equal(timelines[0]?.firstFrameMs, 1);
	assert.equal(timelines[0]?.secondFrameMs, 1);
	assert.equal(timelines[0]?.events[0]?.startMs, -0.1);
	assert.equal(timelines[0]?.events.find((entry) => entry.name === "Paint")?.phase, "raf1-to-raf2");
	assert.ok(
		timelines.every((timeline) => !timeline.events.some((entry) => entry.name === "OtherThread")),
	);
	assert.throws(() => replacementTimeline([event("replace:replace:start", 0)]), /Incomplete/);
});
