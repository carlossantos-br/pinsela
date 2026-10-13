import assert from "node:assert/strict";
import {
  writeClipboard,
  readClipboard,
  readClipboardMatching,
  clearClipboard,
  buildClipboardMarkerHtml,
  parseClipboardMarkerId,
  __test__,
  type PinselaClipboardPayload,
} from "../clipboardStore";
import type { PinselaNode } from "../core/types";

function installFakeLocalStorage(): Map<string, string> {
  const map = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
  return map;
}

function node(id: string): PinselaNode {
  return {
    id,
    kind: "rect",
    geometry: { x: 0, y: 0, width: 10, height: 10, rotation: 0, cornerRadius: 0, zIndex: 0 },
  } as unknown as PinselaNode;
}

export function runClipboardStoreTests(): void {
  // round-trip
  installFakeLocalStorage();
  const payload: PinselaClipboardPayload = { id: "id-a", nodes: [node("a")], selectedIds: ["a"], savedAt: 1 };
  writeClipboard(payload);
  const got = readClipboard();
  assert.ok(got, "read must return the payload");
  assert.equal(got!.nodes.length, 1);
  assert.equal(got!.selectedIds[0], "a");
  assert.equal(got!.id, "id-a", "payload v2 carries id");

  // missing key -> null
  installFakeLocalStorage();
  assert.equal(readClipboard(), null, "without KEY must be null");

  // invalid JSON -> null
  const m = installFakeLocalStorage();
  m.set(__test__.KEY, "{not json");
  assert.equal(readClipboard(), null, "invalid JSON must be null");

  // payload with empty nodes -> invalid -> null
  const m2 = installFakeLocalStorage();
  m2.set(__test__.KEY, JSON.stringify({ id: "x", nodes: [], selectedIds: [], savedAt: 1 }));
  assert.equal(readClipboard(), null, "empty nodes must be null");

  // readClipboardMatching: only returns when the payload id matches the marker id
  installFakeLocalStorage();
  writeClipboard({ id: "id-1", nodes: [node("a")], selectedIds: ["a"], savedAt: 1 });
  assert.ok(readClipboardMatching("id-1"), "same id -> returns payload");
  assert.equal(readClipboardMatching("id-other"), null, "different id -> null (a stale copy must not paste)");
  assert.equal(readClipboardMatching(""), null, "empty id -> null");

  // above MAX_BYTES -> not persisted, but does not throw
  const big = installFakeLocalStorage();
  const huge = "x".repeat(__test__.MAX_BYTES + 10);
  writeClipboard({ nodes: [node("b")], selectedIds: ["b"], savedAt: 1, sourceProject: huge });
  assert.equal(big.has(__test__.KEY), false, "huge payload must not persist");

  // clear remove
  installFakeLocalStorage();
  writeClipboard(payload);
  clearClipboard();
  assert.equal(readClipboard(), null, "clear must empty it");

  // no localStorage -> silent no-op
  delete (globalThis as { localStorage?: Storage }).localStorage;
  writeClipboard(payload);
  assert.equal(readClipboard(), null, "without storage must be null and not throw");

  // --- OS clipboard marker (Canva-style round-trip) ---
  // build: generates the invisible div carrying the id
  const markerHtml = buildClipboardMarkerHtml("abc-123");
  assert.ok(markerHtml.includes('data-pinsela-clip="abc-123"'), "marker embeds the id");

  // parse: round-trip of build's own output
  assert.equal(parseClipboardMarkerId(markerHtml), "abc-123", "parse extracts the id from build");

  // parse: tolerates the <html><body> wrapper + quotes Chrome injects in the OS round-trip
  const chromeWrapped =
    "<meta charset='utf-8'><html><head></head><body><div data-pinsela-clip=\"x9-uuid\"></div></body></html>";
  assert.equal(parseClipboardMarkerId(chromeWrapped), "x9-uuid", "parse tolerates the Chrome wrapper");

  // parse: html without a marker (image/text pasted from outside) -> null
  assert.equal(parseClipboardMarkerId("<p>hello world</p>"), null, "html without marker -> null");
  assert.equal(parseClipboardMarkerId(""), null, "empty html -> null");
  assert.equal(parseClipboardMarkerId('<img src="x.png">'), null, "OS image -> null");
}
