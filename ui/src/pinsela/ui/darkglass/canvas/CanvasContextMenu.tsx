import React from "react";
import { PinselaIcon } from "../PinselaIcon";

export interface CanvasContextMenuProps {
  open: boolean;
  x: number; // clientX
  y: number; // clientY
  hasSelection: boolean;
  canPaste: boolean;
  selectionCount?: number;
  canGroup?: boolean;
  canUngroup?: boolean;
  isLocked?: boolean;
  isHidden?: boolean;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onSelectAll?: () => void;
  onBringForward?: () => void;
  onSendBackward?: () => void;
  onBringToFront?: () => void;
  onSendToBack?: () => void;
  onGroup?: () => void;
  onUngroup?: () => void;
  onToggleLock?: () => void;
  onToggleVisibility?: () => void;
  onAlign?: (mode: "left" | "center" | "right" | "top" | "middle" | "bottom") => void;
  onDistribute?: (axis: "horizontal" | "vertical") => void;
  onClose: () => void;
}

type Item =
  | { kind: "sep"; id: string }
  | {
      kind: "item";
      id: string;
      label: string;
      icon: React.ComponentProps<typeof PinselaIcon>["name"];
      run: () => void;
      disabled?: boolean;
      danger?: boolean;
      shortcut?: string;
    };

const CMD = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || "") ? "⌘" : "Ctrl";

export function CanvasContextMenu(props: CanvasContextMenuProps) {
  const { open, x, y, hasSelection, canPaste, onClose } = props;
  const menuRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Close on outside click. Ignore clicks INSIDE the menu (capture runs before
    // the item onClick; without the guard the menu would unmount before the click fires).
    const onDown = (e: PointerEvent) => {
      const el = menuRef.current;
      if (el && e.target instanceof Node && el.contains(e.target)) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [open, onClose]);

  if (!open) return null;

  const run = (fn?: () => void) => () => {
    fn?.();
    onClose();
  };

  const selectionCount = props.selectionCount ?? (hasSelection ? 1 : 0);

  const items: Item[] = [];
  const sep = (id: string) => items.push({ kind: "sep", id });
  const add = (it: Omit<Extract<Item, { kind: "item" }>, "kind">) => items.push({ kind: "item", ...it });

  if (hasSelection) {
    add({ id: "copy", label: "Copy", icon: "Copy", run: run(props.onCopy), shortcut: `${CMD}C` });
    add({ id: "cut", label: "Cut", icon: "Scissors", run: run(props.onCut), shortcut: `${CMD}X` });
    add({ id: "paste", label: "Paste", icon: "ClipboardPaste", run: run(props.onPaste), disabled: !canPaste, shortcut: `${CMD}V` });
    add({ id: "duplicate", label: "Duplicate", icon: "CopyPlus", run: run(props.onDuplicate), shortcut: `${CMD}D` });
    sep("sep-order");
    add({ id: "front", label: "Bring to front", icon: "ArrowUpToLine", run: run(props.onBringToFront), disabled: !props.onBringToFront, shortcut: `${CMD}⇧]` });
    add({ id: "forward", label: "Bring forward", icon: "ArrowUp", run: run(props.onBringForward), disabled: !props.onBringForward, shortcut: `${CMD}]` });
    add({ id: "backward", label: "Send backward", icon: "ArrowDown", run: run(props.onSendBackward), disabled: !props.onSendBackward, shortcut: `${CMD}[` });
    add({ id: "back", label: "Send to back", icon: "ArrowDownToLine", run: run(props.onSendToBack), disabled: !props.onSendToBack, shortcut: `${CMD}⇧[` });
    sep("sep-group");
    if (props.canGroup) add({ id: "group", label: "Group", icon: "Group", run: run(props.onGroup), shortcut: `${CMD}G` });
    if (props.canUngroup) add({ id: "ungroup", label: "Ungroup", icon: "Ungroup", run: run(props.onUngroup), shortcut: `${CMD}⇧G` });
    add({ id: "lock", label: props.isLocked ? "Unlock" : "Lock", icon: props.isLocked ? "Unlock" : "Lock", run: run(props.onToggleLock), disabled: !props.onToggleLock });
    add({ id: "visibility", label: props.isHidden ? "Show" : "Hide", icon: props.isHidden ? "Eye" : "EyeOff", run: run(props.onToggleVisibility), disabled: !props.onToggleVisibility });
    if (selectionCount >= 2 && (props.onAlign || props.onDistribute)) {
      sep("sep-align");
      if (props.onAlign) {
        add({ id: "align-left", label: "Align left", icon: "AlignLeft", run: run(() => props.onAlign?.("left")) });
        add({ id: "align-hcenter", label: "Center horizontally", icon: "AlignCenter", run: run(() => props.onAlign?.("center")) });
        add({ id: "align-right", label: "Align right", icon: "AlignRight", run: run(() => props.onAlign?.("right")) });
        add({ id: "align-top", label: "Align top", icon: "AlignVerticalJustifyStart", run: run(() => props.onAlign?.("top")) });
        add({ id: "align-vcenter", label: "Center vertically", icon: "AlignVerticalJustifyCenter", run: run(() => props.onAlign?.("middle")) });
        add({ id: "align-bottom", label: "Align bottom", icon: "AlignVerticalJustifyEnd", run: run(() => props.onAlign?.("bottom")) });
      }
      if (props.onDistribute && selectionCount >= 3) {
        add({ id: "dist-h", label: "Distribute horizontally", icon: "AlignHorizontalDistributeCenter", run: run(() => props.onDistribute?.("horizontal")) });
        add({ id: "dist-v", label: "Distribute vertically", icon: "AlignVerticalDistributeCenter", run: run(() => props.onDistribute?.("vertical")) });
      }
    }
    sep("sep-delete");
    add({ id: "delete", label: "Delete", icon: "Trash2", run: run(props.onDelete), danger: true, shortcut: "Del" });
  } else {
    add({ id: "paste", label: "Paste", icon: "ClipboardPaste", run: run(props.onPaste), disabled: !canPaste, shortcut: `${CMD}V` });
    if (props.onSelectAll) add({ id: "selectall", label: "Select all", icon: "BoxSelect", run: run(props.onSelectAll), shortcut: `${CMD}A` });
  }

  // Collapse leading/duplicate/trailing separators so the menu never shows a
  // dangling divider when an optional group (group/ungroup) is absent.
  const cleaned: Item[] = [];
  for (const it of items) {
    if (it.kind === "sep") {
      if (cleaned.length === 0 || cleaned[cleaned.length - 1].kind === "sep") continue;
    }
    cleaned.push(it);
  }
  while (cleaned.length && cleaned[cleaned.length - 1].kind === "sep") cleaned.pop();

  const itemCount = cleaned.length;
  const vw = typeof window !== "undefined" ? window.innerWidth : x + 240;
  const vh = typeof window !== "undefined" ? window.innerHeight : y + 400;
  const left = Math.max(8, Math.min(x, vw - 232));
  const top = Math.max(8, Math.min(y, vh - 36 * itemCount - 16));

  const headLabel = selectionCount > 1 ? `${selectionCount} elements` : null;

  return (
    <div
      ref={menuRef}
      role="menu"
      className="ec-context-menu"
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      style={{ position: "fixed", left, top, zIndex: 10000 }}
    >
      {headLabel ? <div className="ec-ctx-head">{headLabel}</div> : null}
      {cleaned.map((it) =>
        it.kind === "sep" ? (
          <div key={it.id} className="ec-ctx-sep" />
        ) : (
          <button
            key={it.id}
            role="menuitem"
            className={`ec-ctx-item${it.danger ? " danger" : ""}`}
            disabled={it.disabled}
            onClick={it.disabled ? undefined : it.run}
          >
            <PinselaIcon name={it.icon} size={15} />
            <span className="ec-ctx-label">{it.label}</span>
            {it.shortcut ? <span className="ec-ctx-shortcut">{it.shortcut}</span> : null}
          </button>
        ),
      )}
    </div>
  );
}
