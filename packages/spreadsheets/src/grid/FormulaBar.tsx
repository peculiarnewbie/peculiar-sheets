interface FormulaBarProps {
	address: string;
	value: string;
	onInput: (value: string) => void;
	onFocus: () => void;
	onBlur: () => void;
	onCommit: (options?: { refocus?: boolean }) => void;
	onCancel: () => void;
	onTab: (shift: boolean) => void;
	onSelectionChange: (start: number, end: number) => void;
	inputRef?: (element: HTMLInputElement) => void;
	readOnly: boolean;
}

export default function FormulaBar(props: FormulaBarProps) {
	function handleKeyDown(event: KeyboardEvent) {
		if (event.key === "Enter") {
			event.preventDefault();
			event.stopPropagation();
			props.onCommit();
			return;
		}

		if (event.key === "Tab") {
			event.preventDefault();
			event.stopPropagation();
			props.onCommit({ refocus: false });
			props.onTab(event.shiftKey);
			return;
		}

		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			props.onCancel();
		}
	}

	return (
		<div class="se-formula-bar">
			<div class="se-formula-bar__address" aria-hidden="true">{props.address}</div>
			<div class="se-formula-bar__fx" aria-hidden="true">fx</div>
			<input
				ref={props.inputRef}
				class="se-formula-bar__input"
				aria-label={`Formula for ${props.address}`}
				aria-readonly={props.readOnly || undefined}
				readOnly={props.readOnly}
				value={props.value}
				onFocus={props.onFocus}
				onBlur={props.onBlur}
				onInput={(event) => props.onInput(event.currentTarget.value)}
				onClick={(event) =>
					props.onSelectionChange(
						event.currentTarget.selectionStart ?? 0,
						event.currentTarget.selectionEnd ?? 0,
					)
				}
				onSelect={(event) =>
					props.onSelectionChange(
						event.currentTarget.selectionStart ?? 0,
						event.currentTarget.selectionEnd ?? 0,
					)
				}
				onKeyUp={(event) =>
					props.onSelectionChange(
						event.currentTarget.selectionStart ?? 0,
						event.currentTarget.selectionEnd ?? 0,
					)
				}
				onKeyDown={handleKeyDown}
			/>
		</div>
	);
}
