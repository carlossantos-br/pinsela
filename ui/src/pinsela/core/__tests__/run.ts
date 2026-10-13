import assert from "node:assert/strict";
import { aabbWithRotation, addNode, createEmptyDoc, defaultNode, moveSelection, removeNodes, rotateNode } from "../scene";
import { createHistory, historyPush, historyRedo, historyReplacePresent, historyUndo } from "../history";
import { cycleHitUnderCursor, hitTestAll, hitTestTop, queryNodesInRect } from "../hitTest";
import { alignSelection, selectionBounds, snapMove } from "../layout";
import { applyAutoLayoutDoc, reparentNodesToContainer, upsertAutoLayoutContentLimitRule } from "../autoLayout";
import { detectOverrideKeys, mergeOverrideKeys, readComponentsMeta, writeComponentsMeta } from "../../engine/core/components";
import { beginHistoryOperation, commitHistorySnapshot, replaceHistoryPresent } from "../../engine/core/historyOps";
import { parseCsvPayloads } from "../../engine/core/documentUtils";
import { createComputeClient } from "../../engine/workers/computeClient";
import { computeDirtyRegions } from "../../engine/render/invalidations";
import { createSceneSnapshot } from "../../engine/render/snapshot";
import { EngineController, applyCommand, applyCommands } from "../../engine/core/engineController";
import { normalizeTextDoc, updateTextNodeContent, bridgeTextColorFromFill } from "../textModels";
import { runCloneNodeGraphTests } from "../../engine/core/__tests__/cloneNodeGraph.test";
import { runClipboardStoreTests } from "../../__tests__/clipboardStore.test";
import { runSelectionSummaryTests } from "../../ui/darkglass/canvas/__tests__/selectionSummary.test";
import { runInteractionMathTests } from "../../ui/darkglass/canvas/__tests__/interactionMath.test";
import { runToolbarModelTests } from "../../ui/darkglass/canvas/__tests__/toolbarModel.test";
import { runZoomMappingTests } from "../../ui/darkglass/canvas/__tests__/zoomMapping.test";
import { runSvgCompatTests } from "./svgCompat.test";
import { runImageCropTests } from "./imageCrop.test";
import { runApiUrlTests } from "./apiUrl.test";
import { runExportMultiTests } from "./exportMulti.test";
import { runRotatedResizeTests } from "./rotatedResize.test";
import { runProjectPagesTests } from "./projectPages.test";
import { runLiveDiffTests } from "../../platform/live/__tests__/liveDiff.test";
import {
  areSelectionAllHidden,
  areSelectionAllLocked,
  groupSelectionIntoNewGroup,
  reorderSelection,
  setSelectionLocked,
  setSelectionVisible,
  ungroupSelectedGroups,
} from "../../engine/core/layerOps";

function testHitTestAndCycleUnderCursor() {
  let doc = createEmptyDoc(1200, 1200);
  const low = defaultNode("rect", {
    id: "low",
    geometry: { ...defaultNode("rect").geometry, x: 100, y: 100, width: 280, height: 180 },
    style: { ...defaultNode("rect").style, fill: "#111111" },
  });
  const high = defaultNode("rect", {
    id: "high",
    geometry: { ...defaultNode("rect").geometry, x: 130, y: 120, width: 280, height: 180 },
    style: { ...defaultNode("rect").style, fill: "#222222" },
  });
  doc = addNode(doc, low);
  doc = addNode(doc, high);

  const top = hitTestTop(doc, 160, 150, { includeLocked: false });
  assert.equal(top?.id, "high");

  const cycled = cycleHitUnderCursor(doc, 160, 150, "high");
  assert.equal(cycled?.id, "low");
}

function testLineHitAreaWithThinLineBoost() {
  let doc = createEmptyDoc(900, 900);
  const thin = defaultNode("line", {
    id: "line_thin",
    geometry: { ...defaultNode("line").geometry, x: 120, y: 140, width: 360, height: 0, rotation: 0 },
    style: { ...defaultNode("line").style, stroke: { color: "#ffffff", width: 1, dash: [], cap: "round" } },
  });
  const thick = defaultNode("line", {
    id: "line_thick",
    geometry: { ...defaultNode("line").geometry, x: 120, y: 260, width: 360, height: 0, rotation: 0 },
    style: { ...defaultNode("line").style, stroke: { color: "#ffffff", width: 14, dash: [], cap: "round" } },
  });
  doc = addNode(doc, thin);
  doc = addNode(doc, thick);

  const nearThin = hitTestTop(doc, 250, 147, { includeLocked: false });
  assert.equal(nearThin?.id, "line_thin");
  const farThin = hitTestTop(doc, 250, 152, { includeLocked: false });
  assert.notEqual(farThin?.id, "line_thin");

  const nearThick = hitTestTop(doc, 250, 266, { includeLocked: false });
  assert.equal(nearThick?.id, "line_thick");
  const farThick = hitTestTop(doc, 250, 272, { includeLocked: false });
  assert.notEqual(farThick?.id, "line_thick");
}

function testLineHitScalesForZoomedOutViewport() {
  let doc = createEmptyDoc(900, 900);
  const thin = defaultNode("line", {
    id: "line_scale",
    geometry: { ...defaultNode("line").geometry, x: 120, y: 140, width: 360, height: 0, rotation: 0 },
    style: { ...defaultNode("line").style, stroke: { color: "#ffffff", width: 1, dash: [], cap: "round" } },
  });
  doc = addNode(doc, thin);

  const regularScaleHit = hitTestTop(doc, 240, 153, { includeLocked: false, viewportScale: 1 });
  assert.notEqual(regularScaleHit?.id, "line_scale");

  const zoomedOutHit = hitTestTop(doc, 240, 153, { includeLocked: false, viewportScale: 0.35 });
  assert.equal(zoomedOutHit?.id, "line_scale");
}

function testTransformAndBoundsWithRotation() {
  let doc = createEmptyDoc(900, 900);
  const node = defaultNode("rect", {
    id: "n1",
    geometry: { ...defaultNode("rect").geometry, x: 200, y: 240, width: 240, height: 120, rotation: 0 },
  });
  doc = addNode(doc, node);
  doc = rotateNode(doc, "n1", 45);

  const rotated = doc.nodes.find((n) => n.id === "n1");
  assert.ok(rotated);
  const box = aabbWithRotation(rotated!);
  assert.ok(box.w > rotated!.geometry.width);
  assert.ok(box.h > rotated!.geometry.height);

  const moved = moveSelection(doc, ["n1"], 10, -8);
  const b = selectionBounds(moved, ["n1"]);
  assert.ok(b);
  assert.ok(Math.round((b?.x || 0) - box.x) === 10);
}

function testAlignSingleSelectionToCanvas() {
  let doc = createEmptyDoc(900, 700);
  const node = defaultNode("rect", {
    id: "align_single",
    geometry: { ...defaultNode("rect").geometry, x: 140, y: 80, width: 240, height: 120, rotation: 0 },
  });
  doc = addNode(doc, node);

  const centeredX = alignSelection(doc, ["align_single"], "center");
  const centeredY = alignSelection(doc, ["align_single"], "middle");
  const aligned = alignSelection(centeredY, ["align_single"], "center");
  const centeredNode = aligned.nodes.find((entry) => entry.id === "align_single");
  assert.ok(centeredNode);
  assert.equal(Math.round(Number(centeredX.nodes.find((entry) => entry.id === "align_single")?.geometry.x || 0)), 330);
  assert.equal(Math.round(Number(centeredY.nodes.find((entry) => entry.id === "align_single")?.geometry.y || 0)), 290);
  assert.equal(Math.round(Number(centeredNode?.geometry.x || 0)), 330);
  assert.equal(Math.round(Number(centeredNode?.geometry.y || 0)), 290);
}

function testSnappingToleranceAndToggle() {
  let doc = createEmptyDoc(1000, 1000);
  const anchor = defaultNode("rect", {
    id: "anchor",
    geometry: { ...defaultNode("rect").geometry, x: 500, y: 200, width: 120, height: 120 },
  });
  const moving = defaultNode("rect", {
    id: "moving",
    geometry: { ...defaultNode("rect").geometry, x: 360, y: 200, width: 120, height: 120 },
  });
  doc = addNode(doc, anchor);
  doc = addNode(doc, moving);

  // Near anchor left edge => should snap to x=500 for moving right edge.
  const rawDx = 18; // moving right edge: 360 + 120 + 18 = 498 (within tolerance 6).
  const withSnap = snapMove(doc, ["moving"], rawDx, 0, 6, { enabled: true, toPage: false, toObjects: true, toGrid: false, gridSize: 8 });
  assert.equal(withSnap.dx, 20);
  assert.ok(withSnap.guides.length >= 1);

  const withoutSnap = snapMove(doc, ["moving"], rawDx, 0, 6, { enabled: false, toPage: false, toObjects: true, toGrid: false, gridSize: 8 });
  assert.equal(withoutSnap.dx, rawDx);
  assert.equal(withoutSnap.guides.length, 0);
}

function testSnappingPriorityModes() {
  let doc = createEmptyDoc(1000, 1000);
  const anchor = defaultNode("rect", {
    id: "anchor_priority",
    geometry: { ...defaultNode("rect").geometry, x: 504, y: 200, width: 120, height: 120 },
  });
  const moving = defaultNode("rect", {
    id: "moving_priority",
    geometry: { ...defaultNode("rect").geometry, x: 360, y: 200, width: 120, height: 120 },
  });
  doc = addNode(doc, anchor);
  doc = addNode(doc, moving);

  const rawDx = 18;
  const distanceFirst = snapMove(doc, ["moving_priority"], rawDx, 0, 8, {
    enabled: true,
    toPage: true,
    toObjects: true,
    toGrid: false,
    gridSize: 8,
    priorityMode: "distance",
  });
  assert.equal(distanceFirst.dx, 20);
  assert.equal(distanceFirst.guides[0]?.source, "page");

  const objectFirst = snapMove(doc, ["moving_priority"], rawDx, 0, 8, {
    enabled: true,
    toPage: true,
    toObjects: true,
    toGrid: false,
    gridSize: 8,
    priorityMode: "object_first",
  });
  assert.equal(objectFirst.dx, 24);
  assert.equal(objectFirst.guides[0]?.source, "object");
}

function testSmartDistributionSnap() {
  let doc = createEmptyDoc(1200, 900);
  const left = defaultNode("rect", {
    id: "dist_left",
    geometry: { ...defaultNode("rect").geometry, x: 120, y: 240, width: 120, height: 140 },
  });
  const right = defaultNode("rect", {
    id: "dist_right",
    geometry: { ...defaultNode("rect").geometry, x: 560, y: 240, width: 120, height: 140 },
  });
  const moving = defaultNode("rect", {
    id: "dist_mid",
    geometry: { ...defaultNode("rect").geometry, x: 300, y: 250, width: 120, height: 120 },
  });
  doc = addNode(doc, left);
  doc = addNode(doc, right);
  doc = addNode(doc, moving);

  // Equal gaps target between left/right:
  // left gap = 300 - (120 + 120) = 60
  // right gap = 560 - (300 + 120) = 140
  // required shift = (140 - 60) / 2 = +40
  const snapped = snapMove(doc, ["dist_mid"], 36, 0, 6, {
    enabled: true,
    toPage: false,
    toObjects: true,
    toGrid: false,
    gridSize: 8,
    priorityMode: "distance",
  });
  assert.equal(snapped.dx, 40);
  assert.ok(snapped.guides.length >= 1);
  assert.equal(snapped.guides[0]?.source, "object");
}

function testThinLineObjectSnap() {
  let doc = createEmptyDoc(1000, 1000);
  const anchorLine = defaultNode("line", {
    id: "snap_line_anchor",
    geometry: { ...defaultNode("line").geometry, x: 500, y: 120, width: 0, height: 520, rotation: 0 },
    style: { ...defaultNode("line").style, stroke: { color: "#ffffff", width: 6, dash: [], cap: "round" } },
  });
  const movingLine = defaultNode("line", {
    id: "snap_line_moving",
    geometry: { ...defaultNode("line").geometry, x: 460, y: 120, width: 0, height: 520, rotation: 0 },
    style: { ...defaultNode("line").style, stroke: { color: "#ffffff", width: 6, dash: [], cap: "round" } },
  });
  doc = addNode(doc, anchorLine);
  doc = addNode(doc, movingLine);

  const rawDx = 39;
  const snapped = snapMove(doc, ["snap_line_moving"], rawDx, 0, 6, {
    enabled: true,
    toPage: false,
    toObjects: true,
    toGrid: false,
    gridSize: 8,
    priorityMode: "distance",
  });
  assert.equal(snapped.dx, 40);
  assert.equal(snapped.guides[0]?.source, "object");
}

function referencePointInRotatedNode(node: ReturnType<typeof defaultNode>, px: number, py: number): boolean {
  const g = node.geometry;
  const x = Number(g.x || 0);
  const y = Number(g.y || 0);
  const w = Math.max(0, Number(g.width || 0));
  const h = Math.max(0, Number(g.height || 0));
  if (w <= 0 || h <= 0) return false;
  const rot = Number(g.rotation || 0);
  if (!rot) return px >= x && px <= x + w && py >= y && py <= y + h;
  const box = aabbWithRotation(node);
  return px >= box.x && px <= box.x + box.w && py >= box.y && py <= box.y + box.h;
}

function referenceHitTestAll(doc: ReturnType<typeof createEmptyDoc>, px: number, py: number, includeLocked: boolean): string[] {
  const sourceOrder = new Map(doc.nodes.map((node, index) => [node.id, index] as const));
  return [...doc.nodes]
    .filter((n) => n.id !== doc.root_id)
    .filter((n) => n.style.visible !== false)
    .filter((n) => includeLocked || !n.style.locked)
    .sort((a, b) => {
      const aIsGroup = a.kind === "group";
      const bIsGroup = b.kind === "group";
      if (aIsGroup !== bIsGroup) return aIsGroup ? 1 : -1;
      const az = Number(a.geometry.z_index || 0);
      const bz = Number(b.geometry.z_index || 0);
      if (az !== bz) return bz - az;
      return Number(sourceOrder.get(b.id) || 0) - Number(sourceOrder.get(a.id) || 0);
    })
    .filter((n) => referencePointInRotatedNode(n as ReturnType<typeof defaultNode>, px, py))
    .map((n) => n.id);
}

function referenceQueryNodesInRect(
  doc: ReturnType<typeof createEmptyDoc>,
  rect: { x: number; y: number; w: number; h: number },
  includeLocked: boolean
): string[] {
  return [...doc.nodes]
    .filter((n) => n.id !== doc.root_id)
    .filter((n) => n.style.visible !== false)
    .filter((n) => includeLocked || !n.style.locked)
    .sort((a, b) => Number(b.geometry.z_index || 0) - Number(a.geometry.z_index || 0))
    .filter((n) => {
      const box = aabbWithRotation(n);
      const ax2 = rect.x + rect.w;
      const ay2 = rect.y + rect.h;
      const bx2 = box.x + box.w;
      const by2 = box.y + box.h;
      return !(ax2 < box.x || bx2 < rect.x || ay2 < box.y || by2 < rect.y);
    })
    .map((n) => n.id);
}

function testSpatialHitTestParity() {
  let doc = createEmptyDoc(2200, 2200);
  for (let i = 0; i < 260; i += 1) {
    const x = 40 + (i % 26) * 78;
    const y = 40 + Math.floor(i / 26) * 70;
    doc = addNode(
      doc,
      defaultNode("rect", {
        id: `grid_${i}`,
        geometry: {
          ...defaultNode("rect").geometry,
          x,
          y,
          width: 70 + (i % 4) * 6,
          height: 50 + (i % 5) * 4,
          rotation: i % 7 === 0 ? (i % 24) - 12 : 0,
        },
      })
    );
  }
  doc = addNode(
    doc,
    defaultNode("rect", {
      id: "free_mid",
      geometry: { ...defaultNode("rect").geometry, x: 420, y: 420, width: 180, height: 180, rotation: 6 },
    })
  );
  doc = addNode(
    doc,
    defaultNode("rect", {
      id: "locked_top",
      style: { ...defaultNode("rect").style, locked: true },
      geometry: { ...defaultNode("rect").geometry, x: 420, y: 420, width: 180, height: 180, rotation: 10 },
    })
  );

  const points = [
    { x: 80, y: 80 },
    { x: 300, y: 220 },
    { x: 500, y: 500 },
    { x: 1200, y: 860 },
    { x: 1900, y: 1600 },
    { x: 2150, y: 2150 },
  ];

  for (const p of points) {
    const expectedUnlocked = referenceHitTestAll(doc, p.x, p.y, false);
    const actualUnlocked = hitTestAll(doc, p.x, p.y, { includeLocked: false }).map((n) => n.id);
    assert.deepEqual(actualUnlocked, expectedUnlocked);

    const expectedLocked = referenceHitTestAll(doc, p.x, p.y, true);
    const actualLocked = hitTestAll(doc, p.x, p.y, { includeLocked: true }).map((n) => n.id);
    assert.deepEqual(actualLocked, expectedLocked);
  }

  const rects = [
    { x: 60, y: 60, w: 260, h: 180 },
    { x: 380, y: 380, w: 340, h: 280 },
    { x: 1000, y: 700, w: 620, h: 560 },
  ];
  for (const rect of rects) {
    const expectedUnlockedRect = referenceQueryNodesInRect(doc, rect, false);
    const actualUnlockedRect = queryNodesInRect(doc, rect, { includeLocked: false }).map((n) => n.id);
    assert.deepEqual(actualUnlockedRect, expectedUnlockedRect);

    const expectedLockedRect = referenceQueryNodesInRect(doc, rect, true);
    const actualLockedRect = queryNodesInRect(doc, rect, { includeLocked: true }).map((n) => n.id);
    assert.deepEqual(actualLockedRect, expectedLockedRect);
  }

  const topUnlocked = hitTestTop(doc, 500, 500, { includeLocked: false });
  assert.notEqual(topUnlocked?.id, "locked_top");
  const topLocked = hitTestTop(doc, 500, 500, { includeLocked: true });
  assert.equal(topLocked?.id, "locked_top");
}

function testHistoryGroupingUndoRedo() {
  let doc = createEmptyDoc(600, 600);
  const n = defaultNode("rect", { id: "h1" });
  doc = addNode(doc, n);

  let hist = createHistory(doc);
  const start = hist.present;

  const dragStep1 = moveSelection(hist.present, ["h1"], 10, 0);
  hist = historyReplacePresent(hist, dragStep1);
  const dragStep2 = moveSelection(hist.present, ["h1"], 5, 0);
  hist = historyReplacePresent(hist, dragStep2);

  // End of drag => one push transaction.
  hist = historyPush({ ...hist, present: start }, hist.present);
  assert.equal(hist.past.length, 1);

  const undone = historyUndo(hist);
  assert.equal(undone.past.length, 0);
  assert.equal(undone.future.length, 1);

  const redone = historyRedo(undone);
  assert.equal(redone.past.length, 1);
  assert.equal(redone.future.length, 0);
}

function testHistoryOpsHelpers() {
  const base = createHistory({ value: 1 });
  const begun = beginHistoryOperation(base, (x) => ({ ...x }), 10);
  assert.equal(begun.past.length, 1);
  assert.equal(begun.present.value, 1);

  const replaced = replaceHistoryPresent(begun, { value: 2 });
  assert.equal(replaced.present.value, 2);

  const committed = commitHistorySnapshot(replaced, { value: 3 }, (x) => ({ ...x }), 10);
  assert.equal(committed.present.value, 3);
  assert.ok(committed.past.length >= 1);
}

function testComponentCleanupOnSourceDelete() {
  let doc = createEmptyDoc(900, 900);
  const source = defaultNode("rect", { id: "source" });
  const inst = defaultNode("rect", {
    id: "inst",
    component_instance: { component_id: "cmp_card", source_node_id: "source", override_keys: [] },
  });
  doc = addNode(doc, source);
  doc = addNode(doc, inst);
  doc.metadata = {
    ...(doc.metadata || {}),
    components: {
      definitions: [{ id: "cmp_card", name: "Card", source_node_ids: ["source"] }],
    },
  };

  const next = removeNodes(doc, ["source"]);
  const n = next.nodes.find((x) => x.id === "inst");
  assert.ok(n);
  assert.equal(n?.component_instance, null);
  assert.equal((next.metadata?.components?.definitions || []).length, 0);
}

function testComponentMetadataHelpers() {
  const doc = createEmptyDoc(1080, 1080);
  const written = writeComponentsMeta(doc, [{ id: "cmp_1", name: "Card", source_node_ids: ["root"] }]);
  const meta = readComponentsMeta(written);
  assert.equal(meta.definitions.length, 1);
  assert.equal(meta.definitions[0].id, "cmp_1");
}

function testOverrideDetectionAndMerge() {
  const base = defaultNode("rect", { id: "n1", name: "BASE" });
  const changed = {
    ...base,
    name: "UPDATED",
    geometry: { ...base.geometry, x: base.geometry.x + 10 },
    style: { ...base.style, visible: false },
  };
  const keys = detectOverrideKeys(base, changed);
  assert.ok(keys.includes("name"));
  assert.ok(keys.includes("geometry"));
  assert.ok(keys.includes("style"));

  const merged = mergeOverrideKeys(
    { component_id: "cmp_1", source_node_id: "src_1", override_keys: ["name"] },
    ["geometry", "name"]
  );
  assert.deepEqual(merged?.override_keys, ["geometry", "name"]);
}

function testCsvParsingHelper() {
  const rows = parseCsvPayloads("title,price\nfoo,10\nbar,20");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].title, "foo");
  assert.equal(rows[0].price, "10");
  assert.equal(rows[1].title, "bar");
}

function testBridgeTextColorFromFill() {
  // Composer node: color lives in style.fill, no text_style.color -> bridged.
  const composer: any = { kind: "text", style: { fill: "#936947" }, text_style: { size: 90 } };
  bridgeTextColorFromFill(composer);
  assert.equal(composer.text_style.color, "#936947", "composer fill bridged into text_style.color");

  // Explicit editor color edit (only text_style.color set) -> preserved, not clobbered.
  const edited: any = { kind: "text", style: { fill: "#111111" }, text_style: { color: "#0000ff" } };
  bridgeTextColorFromFill(edited);
  assert.equal(edited.text_style.color, "#0000ff", "explicit text_style.color preserved");

  // Corrupted: injected #111111 default over a different solid fill -> healed to fill.
  const corrupted: any = { kind: "text", style: { fill: "#936947" }, text_style: { color: "#111111" } };
  bridgeTextColorFromFill(corrupted);
  assert.equal(corrupted.text_style.color, "#936947", "injected #111111 default healed to fill");

  // Genuinely black text (fill === #111111) -> left alone.
  const black: any = { kind: "text", style: { fill: "#111111" }, text_style: { color: "#111111" } };
  bridgeTextColorFromFill(black);
  assert.equal(black.text_style.color, "#111111", "genuine black text not altered");

  // Gradient fill (object) -> not bridged to a string color.
  const grad: any = { kind: "text", style: { fill: { type: "gradient" } }, text_style: {} };
  bridgeTextColorFromFill(grad);
  assert.ok(!grad.text_style.color, "gradient fill not bridged");

  // Non-text node -> untouched.
  const rect: any = { kind: "rect", style: { fill: "#abcdef" }, text_style: {} };
  bridgeTextColorFromFill(rect);
  assert.ok(!rect.text_style.color, "non-text node untouched");
}

function testTextModelNormalization() {
  const rawDoc = createEmptyDoc(800, 600);
  const legacyLike = {
    ...defaultNode("text"),
    id: "legacy_text",
    text_model: undefined,
    text: "ABC",
    text_runs: [
      { start: -10, end: 99, style: { color: "#ff0000" } },
      { start: 2, end: 2, style: { color: "#00ff00" } },
    ],
  };
  const normalized = normalizeTextDoc({
    ...rawDoc,
    nodes: [...rawDoc.nodes, legacyLike],
  });
  const normalizedNode = normalized.nodes.find((node) => node.id === "legacy_text");
  assert.ok(normalizedNode && normalizedNode.kind === "text");
  assert.equal(normalizedNode?.text_model, "legacy");
  assert.equal(normalizedNode?.text_runs?.length, 1);
  assert.equal(normalizedNode?.text_runs?.[0]?.start, 0);
  assert.equal(normalizedNode?.text_runs?.[0]?.end, 3);

  const richCreated = defaultNode("text");
  assert.equal(richCreated.text_model, "rich");
}

function testRichTextStateChangesInvalidateSnapshot() {
  let doc = createEmptyDoc(800, 600);
  let textNode = defaultNode("text", {
    id: "rich_text",
    text: "Canva SVG",
    text_model: "rich",
    geometry: { ...defaultNode("text").geometry, x: 120, y: 140, width: 320, height: 120 },
    text_runs: [
      { start: 0, end: 5, style: { color: "#7c3aed", style: "Bold" } },
    ],
  });
  doc = addNode(doc, textNode);
  const before = createSceneSnapshot({ doc });
  const beforeNode = before.nodes.find((node) => node.id === "rich_text");
  assert.ok(beforeNode);

  textNode = updateTextNodeContent(textNode, "Canva SVG edited");
  doc = {
    ...doc,
    nodes: doc.nodes.map((node) => (node.id === "rich_text" ? textNode : node)),
  };
  const after = createSceneSnapshot({ doc });
  const afterNode = after.nodes.find((node) => node.id === "rich_text");
  assert.ok(afterNode);
  assert.equal(afterNode?.text_runs?.length, 0);
  assert.notEqual(beforeNode?.renderHash, afterNode?.renderHash);
}

function testTextFitNormalizationAndSnapshot() {
  let doc = createEmptyDoc(800, 600);
  doc = addNode(doc, defaultNode("text", {
    id: "fit_text",
    text_model: "legacy",
    text: "Large text that should fit inside the box",
    geometry: { ...defaultNode("text").geometry, x: 120, y: 140, width: 220, height: 80 },
    text_style: { ...(defaultNode("text").text_style || {}), size: 48 },
    fit: { start_size: 48, min_size: 6, max_lines: 2, truncate_mode: "none" },
  }));

  const normalized = normalizeTextDoc(doc);
  const normalizedNode = normalized.nodes.find((node) => node.id === "fit_text");
  assert.equal(normalizedNode?.fit?.start_size, 48);
  assert.equal(normalizedNode?.fit?.min_size, 6);
  assert.equal(normalizedNode?.fit?.max_lines, 2);

  const before = createSceneSnapshot({ doc: normalized });
  const beforeNode = before.nodes.find((node) => node.id === "fit_text");
  assert.equal(beforeNode?.fit?.min_size, 6);

  const after = createSceneSnapshot({
    doc: {
      ...normalized,
      nodes: normalized.nodes.map((node) => (
        node.id === "fit_text"
          ? { ...node, fit: { ...(node.fit || {}), min_size: 10 } }
          : node
      )),
    },
  });
  const afterNode = after.nodes.find((node) => node.id === "fit_text");
  assert.notEqual(beforeNode?.renderHash, afterNode?.renderHash);
}

function testCompoundPathEvenOddHitTest() {
  let doc = createEmptyDoc(800, 600);
  const path = defaultNode("path", {
    id: "compound_path",
    geometry: { ...defaultNode("path").geometry, x: 100, y: 100, width: 220, height: 220 },
    style: { ...defaultNode("path").style, fill: "#111111", stroke: null },
    path_data: {
      closed: true,
      fill_rule: "evenodd",
      points: [
        { x: 0, y: 0 },
        { x: 220, y: 0 },
        { x: 220, y: 220 },
        { x: 0, y: 220 },
      ],
      subpaths: [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 220, y: 0 },
            { x: 220, y: 220 },
            { x: 0, y: 220 },
          ],
        },
        {
          closed: true,
          points: [
            { x: 60, y: 60 },
            { x: 160, y: 60 },
            { x: 160, y: 160 },
            { x: 60, y: 160 },
          ],
        },
      ],
    },
  });
  doc = addNode(doc, path);

  const insideOuter = hitTestTop(doc, 120, 120, { includeLocked: false });
  assert.equal(insideOuter?.id, "compound_path");

  const insideHole = hitTestTop(doc, 200, 200, { includeLocked: false });
  assert.notEqual(insideHole?.id, "compound_path");
}

function testLayerOpsHelpers() {
  let doc = createEmptyDoc(900, 900);
  const a = defaultNode("rect", { id: "a", geometry: { ...defaultNode("rect").geometry, x: 100, y: 100 } });
  const b = defaultNode("rect", { id: "b", geometry: { ...defaultNode("rect").geometry, x: 240, y: 120 } });
  doc = addNode(doc, a);
  doc = addNode(doc, b);

  const grouped = groupSelectionIntoNewGroup(doc, ["a", "b"]);
  assert.ok(grouped);
  assert.ok(grouped?.groupId);
  assert.ok(grouped?.doc.nodes.find((n) => n.id === grouped?.groupId));

  const ungrouped = ungroupSelectedGroups(grouped!.doc, [grouped!.groupId]);
  assert.ok(ungrouped);
  assert.equal(ungrouped?.childIds.length, 2);

  const locked = setSelectionLocked(doc, ["a", "b"], true);
  assert.equal(areSelectionAllLocked(locked, ["a", "b"]), true);
  const hidden = setSelectionVisible(locked, ["a", "b"], false);
  assert.equal(areSelectionAllHidden(hidden, ["a", "b"]), true);

  const reordered = reorderSelection(doc, ["a"], "front");
  const nodeA = reordered.nodes.find((n) => n.id === "a");
  const nodeB = reordered.nodes.find((n) => n.id === "b");
  assert.ok(nodeA && nodeB);
  assert.ok((nodeA?.geometry.z_index || 0) >= (nodeB?.geometry.z_index || 0));
}

function testGroupMoveIncludesDescendants() {
  let doc = createEmptyDoc(900, 900);
  const a = defaultNode("rect", { id: "gm_a", geometry: { ...defaultNode("rect").geometry, x: 120, y: 150, width: 120, height: 80 } });
  const b = defaultNode("rect", { id: "gm_b", geometry: { ...defaultNode("rect").geometry, x: 280, y: 170, width: 110, height: 70 } });
  doc = addNode(doc, a);
  doc = addNode(doc, b);

  const grouped = groupSelectionIntoNewGroup(doc, ["gm_a", "gm_b"]);
  assert.ok(grouped);
  const moved = moveSelection(grouped!.doc, [grouped!.groupId], 24, -18);

  const movedA = moved.nodes.find((n) => n.id === "gm_a");
  const movedB = moved.nodes.find((n) => n.id === "gm_b");
  const movedGroup = moved.nodes.find((n) => n.id === grouped!.groupId);
  assert.ok(movedA && movedB && movedGroup);
  assert.equal(Math.round(Number(movedA?.geometry.x || 0)), 144);
  assert.equal(Math.round(Number(movedA?.geometry.y || 0)), 132);
  assert.equal(Math.round(Number(movedB?.geometry.x || 0)), 304);
  assert.equal(Math.round(Number(movedB?.geometry.y || 0)), 152);
  assert.equal(Math.round(Number(movedGroup?.geometry.x || 0)), 144);
}

function testGroupSnapIgnoresOwnChildrenTargets() {
  let doc = createEmptyDoc(1100, 900);
  const anchor = defaultNode("rect", {
    id: "gs_anchor",
    geometry: { ...defaultNode("rect").geometry, x: 500, y: 180, width: 120, height: 120 },
  });
  const child = defaultNode("rect", {
    id: "gs_child",
    geometry: { ...defaultNode("rect").geometry, x: 360, y: 180, width: 120, height: 120 },
  });
  const helper = defaultNode("rect", {
    id: "gs_helper",
    geometry: { ...defaultNode("rect").geometry, x: 120, y: 180, width: 100, height: 100 },
  });
  doc = addNode(doc, anchor);
  doc = addNode(doc, child);
  doc = addNode(doc, helper);
  const grouped = groupSelectionIntoNewGroup(doc, ["gs_child", "gs_helper"]);
  assert.ok(grouped);

  const snapped = snapMove(grouped!.doc, [grouped!.groupId], 18, 0, 6, {
    enabled: true,
    toPage: false,
    toObjects: true,
    toGrid: false,
    gridSize: 8,
    priorityMode: "distance",
  });
  assert.equal(snapped.dx, 20);
  assert.equal(snapped.guides[0]?.source, "object");
}

function testGroupSelectionBoundsTrackChildrenArea() {
  let doc = createEmptyDoc(1200, 900);
  const childA = defaultNode("rect", {
    id: "gb_child_a",
    geometry: { ...defaultNode("rect").geometry, x: 80, y: 90, width: 120, height: 80, rotation: 0 },
  });
  const childB = defaultNode("rect", {
    id: "gb_child_b",
    geometry: { ...defaultNode("rect").geometry, x: 460, y: 410, width: 140, height: 110, rotation: 0 },
  });
  doc = addNode(doc, childA);
  doc = addNode(doc, childB);

  const grouped = groupSelectionIntoNewGroup(doc, ["gb_child_a", "gb_child_b"]);
  assert.ok(grouped);
  const groupId = grouped!.groupId;
  const staleGroupDoc: typeof grouped.doc = {
    ...grouped!.doc,
    nodes: grouped!.doc.nodes.map((node) => (
      node.id !== groupId
        ? node
        : {
          ...node,
          geometry: {
            ...node.geometry,
            // Deliberately stale and wrong container box.
            x: 18,
            y: 22,
            width: 72,
            height: 68,
          },
        }
    )),
  };

  const bounds = selectionBounds(staleGroupDoc, [groupId]);
  assert.ok(bounds);
  assert.equal(Math.round(Number(bounds?.x || 0)), 80);
  assert.equal(Math.round(Number(bounds?.y || 0)), 90);
  assert.equal(Math.round(Number(bounds?.w || 0)), 520);
  assert.equal(Math.round(Number(bounds?.h || 0)), 430);
}

function testGroupHitPrefersChildBeforeContainer() {
  let doc = createEmptyDoc(800, 600);
  doc = addNode(doc, defaultNode("rect", {
    id: "gh_child",
    geometry: { ...defaultNode("rect").geometry, x: 100, y: 100, width: 100, height: 80, rotation: 0 },
    style: { ...defaultNode("rect").style, fill: "#ef4444" },
  }));
  doc = addNode(doc, defaultNode("rect", {
    id: "gh_helper",
    geometry: { ...defaultNode("rect").geometry, x: 260, y: 100, width: 60, height: 60, rotation: 0 },
    style: { ...defaultNode("rect").style, fill: "#22c55e" },
  }));

  const grouped = groupSelectionIntoNewGroup(doc, ["gh_child", "gh_helper"]);
  assert.ok(grouped);

  const childHit = hitTestTop(grouped!.doc, 150, 130, { includeLocked: false });
  assert.equal(childHit?.id, "gh_child");

  const groupHit = hitTestTop(grouped!.doc, 230, 130, { includeLocked: false });
  assert.equal(groupHit?.id, grouped!.groupId);
}

function testAutoLayoutReflowAndReparent() {
  let doc = createEmptyDoc(1200, 900);
  const container = defaultNode("group", {
    id: "auto_container",
    geometry: { ...defaultNode("group").geometry, x: 100, y: 100, width: 420, height: 220, corner_radius: 0, clip: false },
    layout: {
      ...defaultNode("group").layout,
      direction: "horizontal",
      gap: 12,
      padding_top: 16,
      padding_right: 20,
      padding_bottom: 16,
      padding_left: 20,
      align_main: "start",
      align_cross: "start",
      sizing_mode: "fixed",
      wrap: false,
      wrap_mode: "flow",
      grid_columns: 0,
      grid_rows: 0,
    },
    children_ids: [],
  });
  const itemA = defaultNode("rect", {
    id: "item_a",
    geometry: { ...defaultNode("rect").geometry, x: 0, y: 0, width: 80, height: 40 },
  });
  const itemB = defaultNode("rect", {
    id: "item_b",
    geometry: { ...defaultNode("rect").geometry, x: 0, y: 0, width: 100, height: 50 },
  });
  doc = addNode(doc, container);
  doc = addNode(doc, itemA);
  doc = addNode(doc, itemB);

  doc = reparentNodesToContainer(doc, ["item_a", "item_b"], "auto_container", { placement: "end" });
  const reflowed = applyAutoLayoutDoc(doc);
  const nextA = reflowed.nodes.find((node) => node.id === "item_a");
  const nextB = reflowed.nodes.find((node) => node.id === "item_b");
  assert.ok(nextA && nextB);
  assert.equal(nextA?.parent_id, "auto_container");
  assert.equal(nextB?.parent_id, "auto_container");
  assert.equal(Math.round(Number(nextA?.geometry.x || 0)), 120);
  assert.equal(Math.round(Number(nextA?.geometry.y || 0)), 116);
  assert.equal(Math.round(Number(nextB?.geometry.x || 0)), 212);
  assert.equal(Math.round(Number(nextB?.geometry.y || 0)), 116);
}

function testAutoLayoutGridModeReflow() {
  let doc = createEmptyDoc(1200, 900);
  const container = defaultNode("group", {
    id: "grid_container",
    geometry: { ...defaultNode("group").geometry, x: 100, y: 100, width: 520, height: 320, corner_radius: 0, clip: false },
    layout: {
      ...defaultNode("group").layout,
      direction: "horizontal",
      gap: 10,
      padding_top: 10,
      padding_right: 10,
      padding_bottom: 10,
      padding_left: 10,
      align_main: "start",
      align_cross: "start",
      sizing_mode: "fixed",
      wrap: true,
      wrap_mode: "grid",
      grid_columns: 2,
      grid_rows: 0,
    },
    children_ids: [],
  });
  const item1 = defaultNode("rect", {
    id: "grid_item_1",
    geometry: { ...defaultNode("rect").geometry, x: 0, y: 0, width: 60, height: 20 },
  });
  const item2 = defaultNode("rect", {
    id: "grid_item_2",
    geometry: { ...defaultNode("rect").geometry, x: 0, y: 0, width: 80, height: 30 },
  });
  const item3 = defaultNode("rect", {
    id: "grid_item_3",
    geometry: { ...defaultNode("rect").geometry, x: 0, y: 0, width: 70, height: 24 },
  });
  doc = addNode(doc, container);
  doc = addNode(doc, item1);
  doc = addNode(doc, item2);
  doc = addNode(doc, item3);
  doc = reparentNodesToContainer(doc, [item1.id, item2.id, item3.id], container.id, { placement: "end" });

  const next = applyAutoLayoutDoc(doc);
  const next1 = next.nodes.find((node) => node.id === item1.id);
  const next2 = next.nodes.find((node) => node.id === item2.id);
  const next3 = next.nodes.find((node) => node.id === item3.id);
  assert.ok(next1 && next2 && next3);
  assert.equal(Math.round(Number(next1?.geometry.x || 0)), 110);
  assert.equal(Math.round(Number(next1?.geometry.y || 0)), 110);
  assert.equal(Math.round(Number(next2?.geometry.x || 0)), 180);
  assert.equal(Math.round(Number(next2?.geometry.y || 0)), 110);
  assert.equal(Math.round(Number(next3?.geometry.x || 0)), 110);
  assert.equal(Math.round(Number(next3?.geometry.y || 0)), 150);
}

function testAutoLayoutContentLimitRule() {
  let doc = createEmptyDoc(1080, 1080);
  const container = defaultNode("group", {
    id: "rule_container",
    geometry: { ...defaultNode("group").geometry, x: 80, y: 80, width: 360, height: 180, corner_radius: 0, clip: true },
    layout: {
      ...defaultNode("group").layout,
      direction: "vertical",
      gap: 8,
      padding_top: 12,
      padding_right: 12,
      padding_bottom: 12,
      padding_left: 12,
      align_main: "start",
      align_cross: "start",
      sizing_mode: "fixed",
      wrap: false,
      wrap_mode: "flow",
      grid_columns: 0,
      grid_rows: 0,
    },
    children_ids: [],
  });
  const text = defaultNode("text", {
    id: "rule_text",
    text: "ABCDEFGHIJKL",
    geometry: { ...defaultNode("text").geometry, x: 0, y: 0, width: 260, height: 60 },
    text_style: {
      ...(defaultNode("text").text_style || {}),
      size: 40,
    },
  });
  doc = addNode(doc, container);
  doc = addNode(doc, text);
  doc = reparentNodesToContainer(doc, ["rule_text"], "rule_container", { placement: "end" });
  doc = upsertAutoLayoutContentLimitRule(doc, "rule_container", {
    enabled: true,
    maxChars: 5,
    startFontSize: 40,
    minFontSize: 24,
    shrinkStep: 2,
    truncateMode: "ellipsis",
  });
  const next = applyAutoLayoutDoc(doc);
  const nextText = next.nodes.find((node) => node.id === "rule_text");
  assert.ok(nextText && nextText.kind === "text");
  assert.equal(nextText?.text, "ABCD…");
  assert.ok(Number(nextText?.text_style?.size || 0) <= 40);
  assert.ok(Number(nextText?.text_style?.size || 0) >= 24);
}

function testRenderSnapshotAndDirtyRegions() {
  let doc = createEmptyDoc(640, 360);
  const node = defaultNode("rect", {
    id: "r1",
    geometry: { ...defaultNode("rect").geometry, x: 120, y: 80, width: 200, height: 100 },
  });
  doc = addNode(doc, node);

  const base = createSceneSnapshot({ doc, guides: [], selectionBounds: null });
  const same = createSceneSnapshot({ doc, guides: [], selectionBounds: null });
  assert.equal(base.key, same.key);
  assert.ok(Object.isFrozen(base));
  assert.ok(Object.isFrozen(base.nodes));
  assert.deepEqual(computeDirtyRegions(base, same), []);

  const guided = createSceneSnapshot({
    doc,
    guides: [{ axis: "x", value: 140, source: "object" }],
    selectionBounds: null,
  });
  const guideDirty = computeDirtyRegions(base, guided);
  assert.ok(Array.isArray(guideDirty));
  assert.ok((guideDirty || []).length >= 1);

  const moved = moveSelection(doc, ["r1"], 12, 0);
  const movedSnapshot = createSceneSnapshot({ doc: moved, guides: [], selectionBounds: null });
  const moveDirty = computeDirtyRegions(base, movedSnapshot);
  assert.ok(Array.isArray(moveDirty));
  assert.ok((moveDirty || []).length >= 1);

  const withEffect = {
    ...doc,
    nodes: doc.nodes.map((entry) => (
      entry.id === "r1"
        ? {
            ...entry,
            style: {
              ...entry.style,
              effects: [
                {
                  id: "fx_a",
                  type: "drop_shadow",
                  enabled: true,
                  visible: true,
                  x: 0,
                  y: 10,
                  blur: 24,
                  spread: 0,
                  color: "#000000",
                  opacity: 45,
                },
              ],
            },
          }
        : entry
    )),
  };
  const withEffectSnapshot = createSceneSnapshot({ doc: withEffect, guides: [], selectionBounds: null });
  assert.notEqual(base.key, withEffectSnapshot.key);
  assert.equal(computeDirtyRegions(base, withEffectSnapshot), null);
}

function testEngineCommandApplyAndController() {
  let doc = createEmptyDoc(900, 900);
  doc = addNode(doc, defaultNode("rect", { id: "e1" }));
  doc = addNode(doc, defaultNode("rect", { id: "e2", geometry: { ...defaultNode("rect").geometry, x: 220 } }));

  const moved = applyCommand(doc, { type: "move_selection", ids: ["e1"], dx: 30, dy: -10 });
  const e1Moved = moved.nodes.find((n) => n.id === "e1");
  assert.ok(e1Moved);
  assert.equal(Math.round(Number(e1Moved?.geometry.x || 0)), 110);

  const batch = applyCommands(moved, [
    { type: "rotate_node", nodeId: "e1", rotation: 25 },
    { type: "patch_node_style", nodeId: "e1", patch: { opacity: 0.6 } },
    { type: "reorder_node", nodeId: "e2", direction: "front" },
  ]);
  const e1Batch = batch.nodes.find((n) => n.id === "e1");
  assert.ok(e1Batch);
  assert.equal(Math.round(Number(e1Batch?.geometry.rotation || 0)), 25);
  assert.equal(Number(e1Batch?.style.opacity || 0), 0.6);

  const controller = EngineController.fromDoc(doc, {
    cloneDoc: (x) => JSON.parse(JSON.stringify(x)),
    maxHistory: 24,
  });
  controller.beginOperation();
  controller.applyCommand({ type: "move_selection", ids: ["e1"], dx: 8, dy: 0 }, "replace");
  controller.applyCommand({ type: "move_selection", ids: ["e1"], dx: 4, dy: 0 }, "replace");
  const duringDragX = Number(controller.getDoc().nodes.find((n) => n.id === "e1")?.geometry.x || 0);
  assert.equal(Math.round(duringDragX), 92);
  controller.commitDoc(controller.getDoc());
  const committed = controller.getHistory();
  assert.ok(committed.past.length >= 1);
}

async function testComputeClientFallbackParity() {
  let doc = createEmptyDoc(1000, 1000);
  const anchor = defaultNode("rect", {
    id: "anchor",
    geometry: { ...defaultNode("rect").geometry, x: 500, y: 200, width: 120, height: 120 },
  });
  const moving = defaultNode("rect", {
    id: "moving",
    geometry: { ...defaultNode("rect").geometry, x: 430, y: 200, width: 120, height: 120 },
  });
  doc = addNode(doc, anchor);
  doc = addNode(doc, moving);

  const client = createComputeClient({ enabled: false, requestTimeoutMs: 150 });
  try {
    const top = await client.hitTestTop(doc, 520, 240, false);
    assert.equal(top?.id, "moving");

    const all = await client.hitTestAll(doc, 520, 240, false);
    assert.equal(all.length, 2);

    const cycled = await client.cycleHitUnderCursor(doc, 520, 240, "moving");
    assert.equal(cycled?.id, "anchor");

    const expectedSnap = snapMove(doc, ["moving"], 18, 0, 6, {
      enabled: true,
      toPage: false,
      toObjects: true,
      toGrid: false,
      gridSize: 8,
    });
    const computedSnap = await client.snapMove(doc, ["moving"], 18, 0, 6, {
      enabled: true,
      toPage: false,
      toObjects: true,
      toGrid: false,
      gridSize: 8,
    });
    assert.deepEqual(computedSnap, expectedSnap);

    const expectedBounds = selectionBounds(doc, ["moving"]);
    const computedBounds = await client.selectionBounds(doc, ["moving"]);
    assert.deepEqual(computedBounds, expectedBounds);

    const rows = await client.parseCsvPayloads("title,price\nfoo,10\nbar,20");
    assert.equal(rows.length, 2);
    assert.equal(rows[1].title, "bar");
  } finally {
    client.dispose();
  }
}

async function run() {
  testHitTestAndCycleUnderCursor();
  testLineHitAreaWithThinLineBoost();
  testLineHitScalesForZoomedOutViewport();
  testTransformAndBoundsWithRotation();
  testAlignSingleSelectionToCanvas();
  testSnappingToleranceAndToggle();
  testSnappingPriorityModes();
  testSmartDistributionSnap();
  testThinLineObjectSnap();
  testSpatialHitTestParity();
  testHistoryGroupingUndoRedo();
  testHistoryOpsHelpers();
  testComponentCleanupOnSourceDelete();
  testComponentMetadataHelpers();
  testOverrideDetectionAndMerge();
  testCsvParsingHelper();
  testBridgeTextColorFromFill();
  testTextModelNormalization();
  testRichTextStateChangesInvalidateSnapshot();
  testTextFitNormalizationAndSnapshot();
  testCompoundPathEvenOddHitTest();
  testLayerOpsHelpers();
  testGroupMoveIncludesDescendants();
  testGroupSnapIgnoresOwnChildrenTargets();
  testGroupSelectionBoundsTrackChildrenArea();
  testGroupHitPrefersChildBeforeContainer();
  testAutoLayoutReflowAndReparent();
  testAutoLayoutGridModeReflow();
  testAutoLayoutContentLimitRule();
  runSvgCompatTests();
  runImageCropTests();
  runApiUrlTests();
  await runExportMultiTests();
  runRotatedResizeTests();
  runProjectPagesTests();
  runSelectionSummaryTests();
  runInteractionMathTests();
  runToolbarModelTests();
  runZoomMappingTests();
  runCloneNodeGraphTests();
  runClipboardStoreTests();
  console.log("clipboardStore: ok");
  runLiveDiffTests();
  testRenderSnapshotAndDirtyRegions();
  testEngineCommandApplyAndController();
  await testComputeClientFallbackParity();
  // Keep output concise for CI logs.
  console.log("pinsela-core: ok");
}

void run().catch((err) => {
  console.error(err);
  process.exit(1);
});
