import { describe, expect, it } from "bun:test";
import { mapKeyToCommand, shouldPreventDefault } from "./keys";

function keyEvent(key: string, init: Partial<KeyboardEvent> = {}): KeyboardEvent {
	return {
		key,
		ctrlKey: false,
		metaKey: false,
		shiftKey: false,
		altKey: false,
		...init,
	} as KeyboardEvent;
}

describe("mapKeyToCommand", () => {
	it("maps Tab to editCommit right", () => {
		expect(mapKeyToCommand(keyEvent("Tab"))).toEqual({
			type: "editCommit",
			direction: "right",
		});
	});

	it("maps Shift+Tab to editCommit left", () => {
		expect(mapKeyToCommand(keyEvent("Tab", { shiftKey: true }))).toEqual({
			type: "editCommit",
			direction: "left",
		});
	});

	it("maps Enter to editStart when not handled by the editor", () => {
		expect(mapKeyToCommand(keyEvent("Enter"))).toEqual({ type: "editStart" });
	});

	it("prevents default for Tab navigation", () => {
		const command = mapKeyToCommand(keyEvent("Tab"));
		expect(command).not.toBeNull();
		expect(shouldPreventDefault(command!)).toBe(true);
	});
});
