import { createMemo, createSignal, For, onCleanup, onSettled, Show } from "solid-js";

export type ContextMenuEntry =
	| { type?: "action"; label: string; shortcut?: string; disabled?: boolean; action: () => void }
	| { type: "separator" };

/** @deprecated Use ContextMenuEntry instead */
export type ContextMenuItem = ContextMenuEntry;

interface ContextMenuProps {
	x: number;
	y: number;
	items: ContextMenuEntry[];
	onClose: () => void;
}

type ActionEntry = Exclude<ContextMenuEntry, { type: "separator" }>;

interface ResolvedEntry {
	entry: ContextMenuEntry;
	/** Index into the action-only list, or -1 for separators. */
	actionIndex: number;
}

function isActionEntry(entry: ContextMenuEntry): entry is ActionEntry {
	return entry.type !== "separator";
}

export default function ContextMenu(props: ContextMenuProps) {
	let menuRef: HTMLDivElement | undefined;
	const itemRefs: HTMLButtonElement[] = [];
	const [focusedIndex, setFocusedIndex] = createSignal(-1);

	const resolved = createMemo<ResolvedEntry[]>(() => {
		let ai = 0;
		return props.items.map((entry) => ({
			entry,
			actionIndex: isActionEntry(entry) ? ai++ : -1,
		}));
	});

	const actionItems = createMemo(() =>
		resolved()
			.filter((r) => r.actionIndex >= 0)
			.map((r) => r.entry as ActionEntry),
	);

	function handleClick(item: ActionEntry) {
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
		const items = actionItems();
		const len = items.length;
		let next = from;
		for (let i = 0; i < len; i++) {
			next = (next + direction + len) % len;
			if (!items[next]?.disabled) return next;
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
				const item = actionItems()[focusedIndex()];
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
				focusItem(findNextEnabled(actionItems().length, -1));
				break;
			}
		}
	}

	onSettled(() => {
		document.addEventListener("mousedown", handleClickOutside);
		let disposed = false;
		const firstEnabled = actionItems().findIndex((item) => !item.disabled);
		if (firstEnabled >= 0) {
			queueMicrotask(() => {
				if (!disposed) focusItem(firstEnabled);
			});
		}
		return () => {
			disposed = true;
			document.removeEventListener("mousedown", handleClickOutside);
		};
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
			<For each={resolved()}>
				{(r) => {
					if (r.actionIndex < 0) {
						return <div class="se-context-menu__separator" role="separator" />;
					}
					const item = r.entry as ActionEntry;
					const ai = r.actionIndex;
					return (
						<button
							ref={(el) => {
								itemRefs[ai] = el;
							}}
							class={[
								"se-context-menu__item",
								{
									"se-context-menu__item--disabled": !!item.disabled,
									"se-context-menu__item--focused": ai === focusedIndex(),
								},
							]}
							role="menuitem"
							tabindex={ai === focusedIndex() ? 0 : -1}
							aria-disabled={item.disabled ? "true" : "false"}
							onClick={() => handleClick(item)}
							onMouseEnter={() => {
								if (!item.disabled) focusItem(ai);
							}}
						>
							<span>{item.label}</span>
							<Show when={item.shortcut}>
								<span class="se-context-menu__shortcut">{item.shortcut}</span>
							</Show>
						</button>
					);
				}}
			</For>
		</div>
	);
}
