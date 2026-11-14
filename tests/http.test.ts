import test from "node:test";
import assert from "node:assert/strict";
import { BodyTooLargeError, readFormDataLimited } from "../lib/http.ts";

function multipart(size: number, headers: Record<string, string> = {}): Request {
  const form = new FormData();
  form.set("pay", "cod");
  form.set("receipt", new Blob([new Uint8Array(size)], { type: "image/png" }), "r.png");
  return new Request("https://example.test/api/orders", { method: "POST", body: form, headers });
}

test("a small multipart body is parsed", async () => {
  const form = await readFormDataLimited(multipart(1024), 64 * 1024);
  assert.equal(form.get("pay"), "cod");
  assert.equal((form.get("receipt") as File).size, 1024);
});

test("an over-size body is refused from the Content-Length header before anything is read", async () => {
  const req = new Request("https://example.test", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=x", "content-length": "99999999" }, body: "x" });
  let touched = false;
  const spy = new Proxy(req, { get(target, prop) { if (prop === "body") touched = true; const v = Reflect.get(target, prop, target); return typeof v === "function" ? v.bind(target) : v; } });
  await assert.rejects(readFormDataLimited(spy, 1024), BodyTooLargeError);
  assert.equal(touched, false, "the stream was not touched");
});

test("a body that is larger than it declares is cut off while streaming", async () => {
  await assert.rejects(readFormDataLimited(multipart(200 * 1024), 64 * 1024), BodyTooLargeError);
});

test("a non-multipart body is rejected", async () => {
  const req = new Request("https://example.test", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  await assert.rejects(readFormDataLimited(req, 1024), TypeError);
});
