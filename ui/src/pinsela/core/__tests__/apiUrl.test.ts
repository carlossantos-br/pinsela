import assert from "node:assert/strict";
import { apiPrefixFromBase, resolveApiUrlWithPrefix } from "../apiUrl";
import { resolveCanvasImageRequestSrc, setAssetApiPrefix } from "../imageAssets";

export function runApiUrlTests() {
  assert.equal(apiPrefixFromBase("/api"), "");
  assert.equal(apiPrefixFromBase("/v2/api"), "/v2");
  assert.equal(apiPrefixFromBase("http://localhost:8000/api/"), "http://localhost:8000");

  assert.equal(resolveApiUrlWithPrefix("/api/assets/abc", ""), "/api/assets/abc");
  assert.equal(resolveApiUrlWithPrefix("/v2/api/assets/abc", ""), "/api/assets/abc");
  assert.equal(
    resolveApiUrlWithPrefix("/api/assets/abc", "http://localhost:8000"),
    "http://localhost:8000/api/assets/abc",
  );
  assert.equal(resolveApiUrlWithPrefix("data:image/png;base64,AA", "http://x"), "data:image/png;base64,AA");
  assert.equal(resolveApiUrlWithPrefix("https://cdn.example.com/a.png", "http://x"), "https://cdn.example.com/a.png");
  assert.equal(resolveApiUrlWithPrefix("/other/path", "http://x"), "/other/path");
  // never "/api/api/..."
  assert.equal(resolveApiUrlWithPrefix("/api/assets/abc", "/v2"), "/v2/api/assets/abc");

  setAssetApiPrefix("http://localhost:8000");
  assert.equal(resolveCanvasImageRequestSrc("/api/assets/abc"), "http://localhost:8000/api/assets/abc");
  assert.equal(resolveCanvasImageRequestSrc("asset://abc"), "http://localhost:8000/api/assets/abc");
  setAssetApiPrefix("");
  assert.equal(resolveCanvasImageRequestSrc("/api/assets/abc"), "/api/assets/abc");
  console.log("apiUrl: ok");
}
