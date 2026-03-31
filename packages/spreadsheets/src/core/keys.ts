import type { Direction } from "./selection";

// ── Command Types ────────────────────────────────────────────────────────────

export type SheetCommand =
	| { type: "move"; direction: Direction; shift: boolean; ctrl: boolean }
	| { type: "editStart"; initialChar?: string }
	| { type: "editCommit"; direction: Direction }
	| { type: "editCancel" }
	| { type: "delete" }
	| { type: "selectAll" }
	| { type: "copy" }
	| { type: "cut" }
	| { type: "paste" }
	| { type: "undo" }
	| { type: "redo" }
	| { type: "search" };

// ── Key → Command Mapping ────────────────────────────────────────────────────

export function mapKeyToCommand(event: KeyboardEvent): SheetCommand | null {
	const ctrl = event.ctrlKey || event.metaKey;
	const shift = event.shiftKey;

	// Navigation
	if (event.key === "ArrowUp") return { type: "move", direction: "up", shift, ctrl };
	if (event.key === "ArrowDown") return { type: "move", direction: "down", shift, ctrl };
	if (event.key === "ArrowLeft") return { type: "move", direction: "left", shift, ctrl };
	if (event.key === "ArrowRight") return { type: "move", direction: "right", shift, ctrl };

	// Edit commit with navigation
	if (event.key === "Tab") {
		return { type: "editCommit", direction: shift ? "left" : "right" };
	}
	if (event.key === "Enter") {
		return { type: "editCommit", direction: shift ? "up" : "down" };
	}

	// Edit mode
	if (event.key === "F2") return { type: "editStart" };
	if (event.key === "Escape") return { type: "editCancel" };

	// Delete
	if (event.key === "Delete" || event.key === "Backspace") return { type: "delete" };

	// Clipboard & undo
	if (ctrl) {
		if (event.key === "a") return { type: "selectAll" };
		if (event.key === "c") return { type: "copy" };
		if (event.key === "x") return { type: "cut" };
		if (event.key === "v") return { type: "paste" };
		if (event.key === "z") return { type: "undo" };
		if (event.key === "y") return { type: "redo" };
		if (event.key === "f") return { type: "search" };
	}

	// Printable character → enter edit mode with that character
	if (!ctrl && !event.altKey && event.key.length === 1) {
		return { type: "editStart", initialChar: event.key };
	}

	return null;
}

/**
 * Returns true if the command should preventDefault on the event.
 * Some keys (Tab, Enter, arrows) have default browser behavior we want to suppress.
 */
export function shouldPreventDefault(command: SheetCommand): boolean {
	switch (command.type) {
		case "move":
		case "editStart":
		case "editCommit":
		case "selectAll":
		case "delete":
		case "search":
			return true;
		default:
			return false;
	}
}
