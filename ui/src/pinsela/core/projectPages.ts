/**
 * Pure helpers for multi-page projects.
 *
 * The order of `project_pages_v1.pages[]` (the order shown in the Pages panel)
 * is the single source of truth: export, ZIP file numbering and PDF page order
 * all follow it, never the order in which pages were ticked.
 */

/** Pages from `pages` (in project order) whose id is in `selectedIds`. */
export function selectPagesInProjectOrder<T extends { id: string }>(pages: readonly T[], selectedIds: Iterable<string>): T[] {
  const wanted = new Set(selectedIds);
  return pages.filter((page) => wanted.has(page.id));
}

/** "Page N" with N one above the highest existing "Page N" (and above the page count). */
export function nextPageName(existingNames: readonly string[]): string {
  let highest = existingNames.length;
  for (const name of existingNames) {
    const match = /^Page (\d+)$/.exec(String(name || "").trim());
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `Page ${highest + 1}`;
}

export type PageRect = { x: number; y: number; width: number; height: number };

function overlaps(a: PageRect, b: PageRect, gap: number): boolean {
  return a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;
}

/**
 * Position for a new page placed to the "right" of / "below" the anchor page.
 * If that slot is already taken by another page, keep sliding in the same
 * direction until it is free, so new pages never stack on top of each other.
 */
export function findFreeAdjacentPageRect(
  anchor: PageRect,
  size: { width: number; height: number },
  placement: "right" | "below",
  existing: readonly PageRect[],
  gap: number,
): PageRect {
  let rect: PageRect = placement === "right"
    ? { x: anchor.x + anchor.width + gap, y: anchor.y, width: size.width, height: size.height }
    : { x: anchor.x, y: anchor.y + anchor.height + gap, width: size.width, height: size.height };
  for (let guard = 0; guard < 1000; guard += 1) {
    const hit = existing.find((other) => overlaps(rect, other, 0));
    if (!hit) break;
    rect = placement === "right"
      ? { ...rect, x: hit.x + hit.width + gap }
      : { ...rect, y: hit.y + hit.height + gap };
  }
  return rect;
}
