import assert from "node:assert/strict";
import { addNode, createEmptyDoc, defaultNode } from "../../../../core/scene";
import { computeSelectionSummary } from "../selectionSummary";

function makeDoc() {
  let doc = createEmptyDoc(1080, 1080);
  doc = addNode(doc, defaultNode("rect", { id: "rect_source", name: "Source" }));
  doc = addNode(doc, defaultNode("rect", { id: "rect_b", name: "Rect B" }));
  const curveRect = defaultNode("path", { id: "path_rect", name: "Curve Rect" });
  curveRect.style = { ...curveRect.style, shape_type: "rect", stroke: null, fill: "#D8C0A8" } as typeof curveRect.style;
  doc = addNode(doc, curveRect);
  doc = addNode(doc, defaultNode("text", { id: "text_a", name: "Text A", text: "A" }));
  doc = addNode(doc, defaultNode("text", { id: "text_b", name: "Text B", text: "B" }));
  doc = addNode(doc, defaultNode("image", { id: "img_a", name: "Img A" }));
  doc = addNode(doc, defaultNode("image", { id: "img_b", name: "Img B" }));
  doc = addNode(doc, defaultNode("frame", { id: "frame_a", name: "Frame A" }));
  doc = addNode(doc, defaultNode("group", { id: "group_a", name: "Group A" }));
  doc = addNode(
    doc,
    defaultNode("rect", {
      id: "instance_a",
      name: "Instance A",
      component_instance: {
        component_id: "comp_a",
        source_node_id: "rect_source",
        override_keys: [],
      },
    }),
  );
  doc = {
    ...doc,
    metadata: {
      ...(doc.metadata || {}),
      components: {
        definitions: [{ id: "comp_a", name: "Comp A", source_node_ids: ["rect_source"] }],
      },
    },
  };
  return doc;
}

export function runSelectionSummaryTests() {
  const doc = makeDoc();

  const none = computeSelectionSummary(doc, []);
  assert.equal(none.kind, "none");
  assert.equal(none.count, 0);

  const singleText = computeSelectionSummary(doc, ["text_a"]);
  assert.equal(singleText.kind, "single_text");
  assert.equal(singleText.count, 1);

  const singleCurveRect = computeSelectionSummary(doc, ["path_rect"]);
  assert.equal(singleCurveRect.kind, "single_shape");
  assert.equal(singleCurveRect.primaryType, "path");
  assert.equal(singleCurveRect.shapeType, "rect");

  const singleSource = computeSelectionSummary(doc, ["rect_source"]);
  assert.equal(singleSource.kind, "single_component_source");

  const singleInstance = computeSelectionSummary(doc, ["instance_a"]);
  assert.equal(singleInstance.kind, "single_component_instance");

  const multiShape = computeSelectionSummary(doc, ["rect_b", "frame_a"]);
  assert.equal(multiShape.kind, "multi_homogeneous_shape");
  assert.equal(multiShape.isMixed, false);

  const multiRectFamily = computeSelectionSummary(doc, ["rect_b", "path_rect"]);
  assert.equal(multiRectFamily.kind, "multi_homogeneous_shape");
  assert.equal(multiRectFamily.shapeType, "rect");

  const multiText = computeSelectionSummary(doc, ["text_a", "text_b"]);
  assert.equal(multiText.kind, "multi_homogeneous_text");

  const multiImage = computeSelectionSummary(doc, ["img_a", "img_b"]);
  assert.equal(multiImage.kind, "multi_homogeneous_image");

  const mixed = computeSelectionSummary(doc, ["text_a", "rect_b"]);
  assert.equal(mixed.kind, "multi_mixed");
  assert.equal(mixed.isMixed, true);
}
