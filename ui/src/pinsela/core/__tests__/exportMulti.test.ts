import assert from "node:assert/strict";
import { buildPdfBlob, zipFilesBlob } from "../export";
import { unzipSync } from "fflate";

export async function runExportMultiTests() {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const pdf = buildPdfBlob([
    { jpegBytes: jpeg, imageWidth: 10, imageHeight: 10, pageWidth: 100, pageHeight: 100 },
    { jpegBytes: jpeg, imageWidth: 10, imageHeight: 20, pageWidth: 200, pageHeight: 300 },
    { jpegBytes: jpeg, imageWidth: 10, imageHeight: 10, pageWidth: 50, pageHeight: 50 },
  ]);
  const bytes = new Uint8Array(await pdf.arrayBuffer());
  const text = Buffer.from(bytes).toString("latin1");
  assert.ok(text.includes("/Count 3"), "PDF with 3 pages");
  assert.equal((text.match(/\/Type \/Page /g) || []).length, 3);
  assert.ok(text.includes("/Kids [3 0 R 6 0 R 9 0 R]"));
  assert.ok(text.includes("/MediaBox [0 0 200 300]"));
  // every xref offset must point at "<id> 0 obj"
  const xrefStart = Number(text.match(/startxref\n(\d+)/)![1]);
  const rows = text.slice(xrefStart).split("\n").slice(2).filter((r) => /^\d{10} 00000 n/.test(r));
  assert.equal(rows.length, 11);
  rows.forEach((row, i) => {
    const off = Number(row.slice(0, 10));
    assert.ok(text.slice(off).startsWith(`${i + 1} 0 obj`), `xref of object ${i + 1}`);
  });

  const zip = await zipFilesBlob([
    { name: "01-a.png", blob: new Blob([new Uint8Array([1, 2, 3])]) },
    { name: "01-a.png", blob: new Blob([new Uint8Array([4, 5])]) },
  ]);
  const files = unzipSync(new Uint8Array(await zip.arrayBuffer()));
  assert.deepEqual(Object.keys(files).sort(), ["01-a-2.png", "01-a.png"]);
  assert.deepEqual(Array.from(files["01-a.png"]), [1, 2, 3]);
  console.log("exportMulti: ok");
}
