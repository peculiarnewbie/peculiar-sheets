import { createSignal } from "solid-js";

interface CellEditorProps {
	value: string;
	ariaLabel: string;
	left: number;
	top: number;
	width: number;
	height: number;
	inputRef?: (element: HTMLInputElement) => void;
	onInput: (value: string) => void;
	onSelectionChange: (start: number, end: number) => void;
	onCommit: (options?: { refocus?: boolean }) => void;
	onCancel: () => void;
	onTab: (shift: boolean) => void;
	onEnter: (shift: boolean) => void;
	onArrowNav: (direction: "up" | "down" | "left" | "right") => void;
}

export default function CellEditor(props: CellEditorProps) {
	let inputRef: HTMLInputElement | undefined;
	const [didInitSelection, setDidInitSelection] = createSignal(false);

	function handleKeyDown(event: KeyboardEvent) {
		if (event.key === "Enter") {
			event.preventDefault();
			event.stopPropagation();
			props.onCommit({ refocus: false });
			props.onEnter(event.shiftKey);
		} else if (event.key === "Tab") {
			event.preventDefault();
			event.stopPropagation();
			props.onCommit({ refocus: false });
			props.onTab(event.shiftKey);
		} else if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			props.onCancel();
		} else if (
			event.key === "ArrowUp" ||
			event.key === "ArrowDown"
		) {
			event.preventDefault();
			event.stopPropagation();
			const direction = event.key === "ArrowUp" ? "up"
				: "down";
			props.onCommit({ refocus: false });
			props.onArrowNav(direction);
		} else if (
			event.key === "ArrowLeft" ||
			event.key === "ArrowRight"
		) {
			// Keep native caret movement inside the editor, but don't let the grid
			// treat horizontal arrows as cell navigation while editing.
			event.stopPropagation();
		}
	}

	return (
		<input
			ref={(element) => {
				inputRef = element;
				props.inputRef?.(element);
			}}
			class="se-cell-editor"
			aria-label={props.ariaLabel}
			style={{
				position: "absolute",
				left: `${props.left}px`,
				top: `${props.top}px`,
				width: `${props.width}px`,
				height: `${props.height}px`,
			}}
			value={props.value}
			onInput={(e) => {
				props.onInput(e.currentTarget.value);
				props.onSelectionChange(
					e.currentTarget.selectionStart ?? 0,
					e.currentTarget.selectionEnd ?? 0,
				);
			}}
			onClick={(e) =>
				props.onSelectionChange(
					e.currentTarget.selectionStart ?? 0,
					e.currentTarget.selectionEnd ?? 0,
				)
			}
			onSelect={(e) =>
				props.onSelectionChange(
					e.currentTarget.selectionStart ?? 0,
					e.currentTarget.selectionEnd ?? 0,
				)
			}
			onKeyUp={(e) =>
				props.onSelectionChange(
					e.currentTarget.selectionStart ?? 0,
					e.currentTarget.selectionEnd ?? 0,
				)
			}
			onFocus={() => {
				if (!didInitSelection() && inputRef) {
					inputRef.setSelectionRange(props.value.length, props.value.length);
					props.onSelectionChange(props.value.length, props.value.length);
					setDidInitSelection(true);
				}
			}}
			onKeyDown={handleKeyDown}
			onBlur={() => props.onCommit()}
		/>
	);
}
