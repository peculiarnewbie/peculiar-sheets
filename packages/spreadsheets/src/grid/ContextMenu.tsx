import { createSignal, For, onCleanup, onMount, Show } from "solid-js";

export interface ContextMenuItem {
	label: string;
	shortcut?: string | undefined;
	disabled?: boolean | undefined;
	action: () => void;
}

interface ContextMenuProps {
	x: number;
	y: number;
	items: ContextMenuItem[];
	onClose: () => void;
}

export default function ContextMenu(props: ContextMenuProps) {
	let menuRef: HTMLDivElement | undefined;
	const itemRefs: HTMLButtonElement[] = [];
	const [focusedIndex, setFocusedIndex] = createSignal(-1);

	function handleClick(item: ContextMenuItem) {
		if (item.disabled) return;
		item.action();
		props.onClose();
	}

	function handleClickOutside(event: MouseEvent) {
		if (menuRef && !menuRef.contains(event.target as Node)) {
			props.onClose();
		}
	}

	function focusItem(index: number) {
		setFocusedIndex(index);
		itemRefs[index]?.focus();
	}

	function findNextEnabled(from: number, direction: 1 | -1): number {
		const len = props.items.length;
		let next = from;
		for (let i = 0; i < len; i++) {
			next = (next + direction + len) % len;
			if (!props.items[next]?.disabled) return next;
		}
		return from;
	}

	function handleMenuKeyDown(event: KeyboardEvent) {
		switch (event.key) {
			case "Escape":
				event.preventDefault();
				event.stopPropagation();
				props.onClose();
				break;
			case "ArrowDown": {
				event.preventDefault();
				focusItem(findNextEnabled(focusedIndex(), 1));
				break;
			}
			case "ArrowUp": {
				event.preventDefault();
				focusItem(findNextEnabled(focusedIndex(), -1));
				break;
			}
			case "Enter":
			case " ": {
				event.preventDefault();
				const item = props.items[focusedIndex()];
				if (item && !item.disabled) handleClick(item);
				break;
			}
			case "Home": {
				event.preventDefault();
				focusItem(findNextEnabled(-1, 1));
				break;
			}
			case "End": {
				event.preventDefault();
				focusItem(findNextEnabled(props.items.length, -1));
				break;
			}
		}
	}

	onMount(() => {
		document.addEventListener("mousedown", handleClickOutside);
		const firstEnabled = props.items.findIndex((item) => !item.disabled);
		if (firstEnabled >= 0) {
			queueMicrotask(() => focusItem(firstEnabled));
		}
	});

	onCleanup(() => {
		document.removeEventListener("mousedown", handleClickOutside);
	});

	return (
		<div
			ref={menuRef}
			class="se-context-menu"
			role="menu"
			onKeyDown={handleMenuKeyDown}
			style={{
				position: "fixed",
				left: `${props.x}px`,
				top: `${props.y}px`,
			}}
		>
			<For each={props.items}>
				{(item, index) => (
					<button
						ref={(el) => { itemRefs[index()] = el; }}
						class="se-context-menu__item"
						classList={{
							"se-context-menu__item--disabled": item.disabled,
							"se-context-menu__item--focused": index() === focusedIndex(),
						}}
						role="menuitem"
						tabIndex={index() === focusedIndex() ? 0 : -1}
						aria-disabled={item.disabled || undefined}
						onClick={() => handleClick(item)}
						onMouseEnter={() => {
							if (!item.disabled) focusItem(index());
						}}
					>
						<span>{item.label}</span>
						<Show when={item.shortcut}>
							<span class="se-context-menu__shortcut">{item.shortcut}</span>
						</Show>
					</button>
				)}
			</For>
		</div>
	);
}
