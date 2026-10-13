import assert from "node:assert/strict";
import { buildToolbarModel } from "../toolbarModel";
import type { SelectionSummary } from "../selectionSummary";

function flattenActions(model: ReturnType<typeof buildToolbarModel>): string[] {
  return model.groups.flatMap((group) => group.actions.map((action) => action.id));
}

function selection(kind: SelectionSummary["kind"], count = 0): SelectionSummary {
  return { kind, count, isMixed: kind === "multi_mixed", selectedIds: [] };
}

export function runToolbarModelTests() {
  const noneSelect = buildToolbarModel({
    canvasMode: "select",
    selection: selection("none", 0),
  });
  assert.deepEqual(flattenActions(noneSelect), [
    "tool_select",
    "artboard_fill",
  ]);

  const singleText = buildToolbarModel({
    canvasMode: "select",
    selection: selection("single_text", 1),
  });
  const textActions = flattenActions(singleText);
  assert.ok(textActions.includes("text_font"));
  assert.ok(textActions.includes("text_fit_mode"));
  assert.ok(textActions.includes("text_size"));
  assert.ok(textActions.includes("text_color"));
  assert.equal(textActions.includes("shape_stroke"), false);
  assert.ok(textActions.includes("element_opacity"));
  assert.equal(textActions.includes("toggle_lock"), false);
  assert.equal(textActions.includes("toggle_visibility"), false);

  const singleLine = buildToolbarModel({
    canvasMode: "select",
    selection: { ...selection("single_shape", 1), primaryType: "line", shapeType: "line" },
  });
  const lineActions = flattenActions(singleLine);
  // A selected line must expose its stroke controls (color/weight/style); these are
  // wired end-to-end (ContextToolbar render + page patchSelectedLineStyle handler).
  assert.ok(lineActions.includes("line_color"));
  assert.ok(lineActions.includes("line_weight"));
  assert.ok(lineActions.includes("line_style"));
  assert.ok(lineActions.includes("element_opacity"));
  assert.equal(lineActions.includes("shape_radius"), false);

  const mixed = buildToolbarModel({
    canvasMode: "select",
    selection: selection("multi_mixed", 3),
  });
  const mixedActions = flattenActions(mixed);
  assert.equal(mixedActions.includes("shape_fill"), false);
  assert.equal(mixedActions.includes("text_font"), false);
  assert.equal(mixedActions.includes("image_crop"), false);
  assert.ok(mixedActions.includes("element_opacity"));
  assert.ok(mixedActions.includes("group"));
  assert.equal(mixedActions.includes("ungroup"), false);
  assert.equal(mixedActions.includes("toggle_lock"), false);
  assert.equal(mixedActions.includes("toggle_visibility"), false);

  const singleShape = buildToolbarModel({
    canvasMode: "select",
    selection: selection("single_shape", 1),
  });
  const singleShapeActions = flattenActions(singleShape);
  assert.equal(singleShapeActions.includes("group"), false);
  assert.equal(singleShapeActions.includes("ungroup"), false);
  assert.ok(singleShapeActions.includes("shape_stroke"));

  const singleGroup = buildToolbarModel({
    canvasMode: "select",
    selection: selection("single_group", 1),
  });
  const singleGroupActions = flattenActions(singleGroup);
  assert.equal(singleGroupActions.includes("group"), false);
  assert.ok(singleGroupActions.includes("ungroup"));
  assert.equal(singleGroupActions.includes("toggle_lock"), false);
  assert.equal(singleGroupActions.includes("toggle_visibility"), false);

  const multiShape = buildToolbarModel({
    canvasMode: "select",
    selection: { ...selection("multi_homogeneous_shape", 2), primaryType: "rect", shapeType: "rect" },
  });
  const multiShapeActions = flattenActions(multiShape);
  assert.ok(multiShapeActions.includes("shape_radius"));

  const curveRect = buildToolbarModel({
    canvasMode: "select",
    selection: { ...selection("single_shape", 1), primaryType: "path", shapeType: "rect" },
  });
  const curveRectActions = flattenActions(curveRect);
  assert.ok(curveRectActions.includes("shape_radius"));
  assert.ok(curveRectActions.includes("shape_fill"));
  assert.ok(curveRectActions.includes("shape_stroke"));
  assert.equal(curveRectActions.includes("convert_to_curves"), false);

  const cropImage = buildToolbarModel({
    canvasMode: "crop",
    selection: selection("single_image", 1),
  });
  const cropActions = flattenActions(cropImage);
  assert.ok(cropActions.includes("shape_radius"));
  assert.ok(cropActions.includes("mode_confirm"));
  assert.ok(cropActions.includes("mode_cancel"));
  assert.ok(cropActions.includes("mode_reset_crop"));

  const cropNoSelection = buildToolbarModel({
    canvasMode: "crop",
    selection: selection("none", 0),
  });
  const cropNoSelectionActions = flattenActions(cropNoSelection);
  assert.ok(cropNoSelectionActions.includes("mode_confirm"));
  assert.ok(cropNoSelectionActions.includes("mode_cancel"));
  assert.ok(cropNoSelectionActions.includes("mode_reset_crop"));
}
