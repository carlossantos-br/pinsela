import assert from "node:assert/strict";
import { defaultNode } from "../../../core/scene";
import { cloneNodeGraph, pasteOffsetForCanvas } from "../cloneNodeGraph";

function runPasteOffsetForCanvasTests() {
  // "Fits in place" case: content already inside the canvas keeps the 18px nudge.
  const small = defaultNode("rect", {
    id: "r1",
    geometry: { ...defaultNode("rect").geometry, x: 100, y: 100, width: 200, height: 120 },
  });
  const fits = pasteOffsetForCanvas([small], { width: 1080, height: 1080 });
  assert.deepEqual(fits, { offsetX: 18, offsetY: 18 }, "content that fits uses the default nudge");

  // Bug case: a group from a 1080x1920 story pasted into a 1920x1080 banner.
  // The bbox at y=1551 is outside the 1080 height -> must recenter inside.
  const group = defaultNode("group", {
    id: "g1",
    geometry: { ...defaultNode("group").geometry, x: 79, y: 1551, width: 980, height: 145 },
  });
  const child = defaultNode("rect", {
    id: "g1_child",
    parent_id: "g1",
    geometry: { ...defaultNode("rect").geometry, x: 79, y: 1551, width: 980, height: 145 },
  });
  const off = pasteOffsetForCanvas([group, child], { width: 1920, height: 1080 });
  // bbox: minX=79 w=980 -> center x = (1920-980)/2 = 470 -> offsetX = 470-79 = 391
  // bbox: minY=1551 h=145 -> center y = (1080-145)/2 = 467.5 -> offsetY = round(467.5-1551) = -1083
  assert.equal(off.offsetX, 391, "offsetX centers the bbox on X");
  assert.equal(off.offsetY, -1083, "offsetY brings the bbox back inside the canvas");
  // After applying the offset, the bbox must be fully inside the canvas.
  const newMinX = 79 + off.offsetX;
  const newMinY = 1551 + off.offsetY;
  assert.ok(newMinX >= 0 && newMinX + 980 <= 1920, "bbox inside the canvas on X");
  assert.ok(newMinY >= 0 && newMinY + 145 <= 1080, "bbox inside the canvas on Y");

  // Missing/zero canvas -> degrades to the default nudge without breaking.
  assert.deepEqual(pasteOffsetForCanvas([small], null), { offsetX: 18, offsetY: 18 });
  assert.deepEqual(pasteOffsetForCanvas([], { width: 1080, height: 1080 }), { offsetX: 18, offsetY: 18 });
}

export function runCloneNodeGraphTests() {
  runPasteOffsetForCanvasTests();

  const frame = defaultNode("frame", {
    id: "frame_a",
    children_ids: ["text_a"],
    geometry: { ...defaultNode("frame").geometry, x: 120, y: 160, width: 320, height: 220 },
    style: { ...defaultNode("frame").style, locked: true },
  });
  const text = defaultNode("text", {
    id: "text_a",
    parent_id: "frame_a",
    text: "Title",
    geometry: { ...defaultNode("text").geometry, x: 140, y: 184, width: 220, height: 84 },
    style: { ...defaultNode("text").style, locked: true },
  });
  const rect = defaultNode("rect", {
    id: "rect_a",
    geometry: { ...defaultNode("rect").geometry, x: 420, y: 320, width: 180, height: 96 },
    style: { ...defaultNode("rect").style, locked: true },
  });

  const { clones, selectionIds } = cloneNodeGraph([frame, text, rect], ["frame_a", "rect_a"], {
    offsetX: 18,
    offsetY: 18,
    unlock: true,
  });

  assert.equal(clones.length, 3);
  assert.equal(selectionIds.length, 2);

  const clonedFrame = clones.find((node) => node.name === frame.name && node.kind === "frame");
  const clonedText = clones.find((node) => node.text === text.text && node.kind === "text");
  const clonedRect = clones.find((node) => node.kind === "rect");

  assert.ok(clonedFrame);
  assert.ok(clonedText);
  assert.ok(clonedRect);
  assert.notEqual(clonedFrame!.id, frame.id);
  assert.notEqual(clonedText!.id, text.id);
  assert.notEqual(clonedRect!.id, rect.id);

  assert.equal(clonedFrame!.parent_id, null);
  assert.equal(clonedText!.parent_id, clonedFrame!.id);
  assert.deepEqual(clonedFrame!.children_ids, [clonedText!.id]);
  assert.equal(clonedRect!.parent_id, null);

  assert.equal(clonedFrame!.style.locked, false);
  assert.equal(clonedText!.style.locked, false);
  assert.equal(clonedRect!.style.locked, false);

  assert.equal(clonedFrame!.geometry.x, frame.geometry.x + 18);
  assert.equal(clonedFrame!.geometry.y, frame.geometry.y + 18);
  assert.equal(clonedText!.geometry.x, text.geometry.x + 18);
  assert.equal(clonedText!.geometry.y, text.geometry.y + 18);
  assert.equal(clonedRect!.geometry.x, rect.geometry.x + 18);
  assert.equal(clonedRect!.geometry.y, rect.geometry.y + 18);

  assert.ok(selectionIds.includes(clonedFrame!.id));
  assert.ok(selectionIds.includes(clonedRect!.id));
  assert.equal(selectionIds.includes(clonedText!.id), false);

  // Cross-doc paste: a node whose parent_id does not exist in the destination → parent_id becomes null (root).
  const orphan = defaultNode("rect", {
    id: "orphan_child",
    parent_id: "parent_not_included",
    geometry: { ...defaultNode("rect").geometry, x: 5, y: 5, width: 20, height: 20 },
  });
  const orphanResult = cloneNodeGraph([orphan], ["orphan_child"], { offsetX: 0, offsetY: 0 });
  assert.equal(orphanResult.clones.length, 1);
  assert.equal(orphanResult.clones[0].parent_id, null, "orphan parent_id must become null on cross-doc paste");
  assert.notEqual(orphanResult.clones[0].id, "orphan_child", "id must be remapped");
}
