interface FormulaBarProps {
	address: string;
	value: string;
	onInput: (value: string) => void;
	onFocus: () => void;
	onBlur: () => void;
	onCommit: () => void;
	onCancel: () => void;
	onSelectionChange: (start: number, end: number) => void;
	inputRef?: (element: HTMLInputElement) => void;
}

export default function FormulaBar(props: FormulaBarProps) {
	function handleKeyDown(event: KeyboardEvent) {
		if (event.key === "Enter") {
			event.preventDefault();
			event.stopPropagation();
			props.onCommit();
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
			<div class="se-formula-bar__address">{props.address}</div>
			<div class="se-formula-bar__fx">fx</div>
			<input
				ref={props.inputRef}
				class="se-formula-bar__input"
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
