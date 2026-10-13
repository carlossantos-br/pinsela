const MENU_SCOPE_SELECTOR = [
  ".dg-context-toolbar",
  ".dg-function-panel",
  ".dg-left-panel",
  ".dg-right-panel",
  ".dg-right-inspector",
  ".dg-topbar",
  ".dg-bottom-toolbelt",
  ".dg-floating-popover-layer",
  ".dg-rules-popover",
  ".dg-history-popover",
  ".dg-modal-overlay",
  ".dg-modal-panel",
].join(", ");

const BLOCKING_OVERLAY_SELECTOR = [
  ".dg-function-panel-layer",
  ".dg-floating-popover-layer",
  ".dg-modal-overlay",
  // ModalFrame renders `.dg-modal-backdrop` (not `.dg-modal-overlay`); without this,
  // canvas shortcuts (Delete/undo/etc.) fired through an open modal when focus was
  // outside the dialog. Treat an open modal as a blocking overlay.
  ".dg-modal-backdrop",
].join(", ");

function isInsideMenuScope(el: Element | null): boolean {
  if (!el) return false;
  return Boolean(el.closest(MENU_SCOPE_SELECTOR));
}

export function isKeyboardEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if ((target as HTMLElement).isContentEditable) return true;
  return Boolean(target.closest("textarea, input, select, [contenteditable='true'], [role='textbox']"));
}

export function isKeyboardInMenuContext(target: EventTarget | null): boolean {
  if (typeof document === "undefined") return false;
  const targetElement = target instanceof Element ? target : null;
  const activeElement = document.activeElement instanceof Element ? document.activeElement : null;
  return (
    isInsideMenuScope(targetElement)
    || isInsideMenuScope(activeElement)
    || Boolean(document.querySelector(BLOCKING_OVERLAY_SELECTOR))
  );
}
