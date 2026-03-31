import { onMount } from "solid-js";

interface SearchBarProps {
	query: string;
	matchCount: number;
	currentMatchIndex: number;
	onQueryChange: (query: string) => void;
	onNext: () => void;
	onPrev: () => void;
	onClose: () => void;
}

export default function SearchBar(props: SearchBarProps) {
	let inputRef: HTMLInputElement | undefined;

	onMount(() => {
		queueMicrotask(() => inputRef?.focus());
	});

	function handleKeyDown(event: KeyboardEvent) {
		event.stopPropagation();

		if (event.key === "Escape") {
			event.preventDefault();
			props.onClose();
			return;
		}

		if (event.key === "Enter") {
			event.preventDefault();
			if (event.shiftKey) {
				props.onPrev();
			} else {
				props.onNext();
			}
			return;
		}

		if (event.key === "ArrowDown") {
			event.preventDefault();
			props.onNext();
			return;
		}

		if (event.key === "ArrowUp") {
			event.preventDefault();
			props.onPrev();
			return;
		}
	}

	function countLabel(): string {
		if (!props.query) return "";
		if (props.matchCount === 0) return "No results";
		return `${props.currentMatchIndex + 1} of ${props.matchCount}`;
	}

	return (
		<div class="se-search-bar" onKeyDown={handleKeyDown}>
			<input
				ref={inputRef}
				class="se-search-bar__input"
				type="text"
				placeholder="Find..."
				value={props.query}
				onInput={(e) => props.onQueryChange(e.currentTarget.value)}
			/>
			<span class="se-search-bar__count">{countLabel()}</span>
			<button
				class="se-search-bar__nav-btn"
				title="Previous match (Shift+Enter)"
				onClick={() => props.onPrev()}
				disabled={props.matchCount === 0}
			>
				&#x25B2;
			</button>
			<button
				class="se-search-bar__nav-btn"
				title="Next match (Enter)"
				onClick={() => props.onNext()}
				disabled={props.matchCount === 0}
			>
				&#x25BC;
			</button>
			<button
				class="se-search-bar__close-btn"
				title="Close (Escape)"
				onClick={() => props.onClose()}
			>
				&#x2715;
			</button>
		</div>
	);
}
