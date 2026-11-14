import test from "node:test";
import assert from "node:assert/strict";
import { buildSmsRequest, readSmsSettings, registrationOtpMessage, sendOtpSms, smsConfigured, smsRecipient } from "../lib/messaging.ts";

const BASE = {
  MSGPLUS_API_URL: "https://sms.example.test/send",
  MSGPLUS_BODY_TEMPLATE: '{"to":"{{to}}","text":"{{message}}","from":"{{sender}}"}',
  MSGPLUS_SENDER: "EURO",
};

function okFetch(calls: Array<{ url: string; init: RequestInit }>, reply: unknown = {}, status = 200): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(reply), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}

test("sms is not configured without an https endpoint and a JSON template, and nothing is sent", async () => {
  assert.equal(smsConfigured({}), false);
  assert.equal(smsConfigured({ ...BASE, MSGPLUS_API_URL: "http://sms.example.test" }), false);
  assert.equal(smsConfigured({ ...BASE, MSGPLUS_BODY_TEMPLATE: "not json" }), false);
  assert.equal(smsConfigured({ ...BASE, MSGPLUS_BODY_TEMPLATE: "[1]" }), false);
  assert.equal(smsConfigured({ ...BASE, MSGPLUS_AUTH_HEADER: "Authorization" }), false, "header name without a value");
  assert.equal(smsConfigured({ ...BASE, MSGPLUS_SUCCESS_FIELD: "status" }), false, "success field without a value");
  assert.equal(smsConfigured(BASE), true);
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const original = console.error;
  console.error = () => {};
  try {
    assert.equal(await sendOtpSms("0933123456", "x", { env: {}, fetchImpl: okFetch(calls) }), false);
  } finally {
    console.error = original;
  }
  assert.equal(calls.length, 0);
});

test("recipient formats: Syrian local numbers get 963; plus and local formats", () => {
  assert.equal(smsRecipient("0933123456"), "963933123456");
  assert.equal(smsRecipient("933123456"), "963933123456");
  assert.equal(smsRecipient("00963933123456"), "963933123456");
  assert.equal(smsRecipient("+963 933 123 456", "plus"), "+963933123456");
  assert.equal(smsRecipient("963933123456", "local"), "0933123456");
});

test("template values are placed into parsed JSON, so quotes and newlines cannot break the body", () => {
  const settings = readSmsSettings(BASE)!;
  const message = 'EURO "كود" \n 123456 {{to}}';
  const { body, headers } = buildSmsRequest(settings, "0933123456", message);
  const parsed = JSON.parse(body);
  assert.equal(parsed.to, "963933123456");
  assert.equal(parsed.text, message, "a placeholder inside the message is not expanded a second time");
  assert.equal(parsed.from, "EURO");
  assert.equal(headers["Content-Type"], "application/json");
});

test("form content type sends a urlencoded body and the auth header is added", () => {
  const settings = readSmsSettings({ ...BASE, MSGPLUS_CONTENT_TYPE: "form", MSGPLUS_AUTH_HEADER: "X-Api-Key", MSGPLUS_AUTH_VALUE: "k-123" })!;
  const { body, headers } = buildSmsRequest(settings, "0933123456", "hello");
  const form = new URLSearchParams(body);
  assert.equal(form.get("to"), "963933123456");
  assert.equal(form.get("text"), "hello");
  assert.equal(headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.equal(headers["X-Api-Key"], "k-123");
});

test("a 2xx reply counts as sent; a provider error status or a missing confirmation does not", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  assert.equal(await sendOtpSms("0933123456", "m", { env: BASE, fetchImpl: okFetch(calls) }), true);
  assert.equal(calls[0].url, BASE.MSGPLUS_API_URL);
  assert.equal(calls[0].init.method, "POST");

  const silenced = console.error;
  console.error = () => {};
  try {
    assert.equal(await sendOtpSms("0933123456", "m", { env: BASE, fetchImpl: okFetch([], {}, 500) }), false);
    const strict = { ...BASE, MSGPLUS_SUCCESS_FIELD: "result.status", MSGPLUS_SUCCESS_VALUE: "ok" };
    assert.equal(await sendOtpSms("0933123456", "m", { env: strict, fetchImpl: okFetch([], { result: { status: "ok" } }) }), true);
    assert.equal(await sendOtpSms("0933123456", "m", { env: strict, fetchImpl: okFetch([], { result: { status: "failed" } }) }), false);
    assert.equal(await sendOtpSms("0933123456", "m", { env: strict, fetchImpl: okFetch([], "oops") }), false);
    const broken = (async () => { throw new TypeError("network down"); }) as unknown as typeof fetch;
    assert.equal(await sendOtpSms("0933123456", "m", { env: BASE, fetchImpl: broken }), false);
  } finally {
    console.error = silenced;
  }
});

test("failures never log the endpoint, the key or the phone number", async () => {
  const logged: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
  try {
    const env = { ...BASE, MSGPLUS_AUTH_HEADER: "Authorization", MSGPLUS_AUTH_VALUE: "Bearer SECRET-KEY-VALUE" };
    await sendOtpSms("0933123456", "code 123456", { env, fetchImpl: okFetch([], {}, 401) });
    await sendOtpSms("0933123456", "code 123456", { env, fetchImpl: (async () => { throw new Error("https://sms.example.test/send SECRET-KEY-VALUE"); }) as unknown as typeof fetch });
  } finally {
    console.error = original;
  }
  assert.ok(logged.length >= 2);
  for (const line of logged) {
    assert.ok(!line.includes("SECRET-KEY-VALUE"));
    assert.ok(!line.includes("sms.example.test"));
    assert.ok(!line.includes("933123456"));
  }
});

test("the code message is short and states the 10 minute validity", () => {
  const text = registrationOtpMessage("123456");
  assert.ok(text.includes("123456") && text.includes("10"));
  assert.ok(text.length <= 70, `one Arabic SMS part is 70 characters, got ${text.length}`);
});
