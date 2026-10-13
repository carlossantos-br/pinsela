import assert from "node:assert/strict";
import {
  buildSvgRectSubpaths,
  parseSvgPathDataSubpaths,
  parseSvgPoints,
} from "../../import/svgCompat";

export function runSvgCompatTests() {
  const points = parseSvgPoints("0,0 10,5 20,15");
  assert.deepEqual(points, [
    { x: 0, y: 0 },
    { x: 10, y: 5 },
    { x: 20, y: 15 },
  ]);

  const roundedRect = buildSvgRectSubpaths(10, 20, 120, 80, 18, 12);
  assert.equal(roundedRect.length, 1);
  assert.equal(roundedRect[0].closed, true);
  assert.ok(roundedRect[0].anchors.length >= 8);
  assert.equal(roundedRect[0].anchors[0].mode, "smooth");

  const multi = parseSvgPathDataSubpaths("M0 0 L20 0 L20 20 Z M40 40 l10 0 l0 10");
  assert.equal(multi.length, 2);
  assert.equal(multi[0].closed, true);
  assert.equal(multi[1].closed, false);
  assert.deepEqual(multi[0].anchors.map((anchor) => [anchor.x, anchor.y]), [
    [0, 0],
    [20, 0],
    [20, 20],
  ]);
  assert.deepEqual(multi[1].anchors.map((anchor) => [anchor.x, anchor.y]), [
    [40, 40],
    [50, 40],
    [50, 50],
  ]);

  const cubic = parseSvgPathDataSubpaths("M0 0 C 10 0 10 20 20 20");
  assert.equal(cubic.length, 1);
  assert.equal(cubic[0].anchors.length, 2);
  assert.deepEqual(cubic[0].anchors[0].out, { x: 10, y: 0 });
  assert.deepEqual(cubic[0].anchors[1].in, { x: 10, y: 20 });
  assert.equal(cubic[0].anchors[0].mode, "smooth");
  assert.equal(cubic[0].anchors[1].mode, "smooth");

  const arc = parseSvgPathDataSubpaths("M10 10 A 30 20 0 0 1 80 40");
  assert.equal(arc.length, 1);
  assert.ok(arc[0].anchors.length >= 2);
  const last = arc[0].anchors[arc[0].anchors.length - 1];
  assert.equal(last.x, 80);
  assert.equal(last.y, 40);
  assert.equal(last.mode, "smooth");
}
