import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";
import { runInNewContext } from "node:vm";
import { editorReady, editorsClosed } from "./editor-readiness";

test("page readiness functions serialize without driver-side runtime helpers", () => {
	const window = new Window();
	window.document.body.innerHTML = '<div id="benchmark-root"></div>';
	const globals = {
		document: window.document,
		HTMLElement: window.HTMLElement,
		ShadowRoot: window.ShadowRoot,
	};
	assert.equal(runInNewContext(`(${editorsClosed.toString()})()`, globals), true);
	assert.equal(runInNewContext(`(${editorReady.toString()})(false)`, globals), false);
});

test("editor readiness requires grid focus and complete text selection, including shadow DOM", (context) => {
	const window = new Window();
	for (const name of [
		"document",
		"HTMLElement",
		"HTMLInputElement",
		"HTMLTextAreaElement",
		"ShadowRoot",
	] as const) {
		const previous = Object.getOwnPropertyDescriptor(globalThis, name);
		Object.defineProperty(globalThis, name, { configurable: true, value: window[name] });
		context.after(() => {
			if (previous) Object.defineProperty(globalThis, name, previous);
			else Reflect.deleteProperty(globalThis, name);
		});
	}
	window.document.body.innerHTML =
		'<input id="outside"><div id="benchmark-root"><div id="host"></div></div>';
	const outside = window.document.getElementById("outside");
	const host = window.document.querySelector("#host");
	assert.ok(outside instanceof window.HTMLInputElement && host);
	outside.focus();
	assert.equal(editorReady(false), false);
	const shadow = host.attachShadow({ mode: "open" });
	const input = window.document.createElement("input");
	input.value = "20";
	shadow.append(input);
	assert.equal(editorReady(false), false);
	input.focus();
	input.setSelectionRange(0, 0);
	assert.equal(editorReady(false), true);
	assert.equal(editorReady(true), false);
	input.setSelectionRange(0, 1);
	assert.equal(editorReady(true), false);
	input.select();
	assert.equal(editorReady(true), true);
	input.readOnly = true;
	assert.equal(editorReady(false), false);
});
