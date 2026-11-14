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

// ---------------------------------------------------------------------------------------------------------------
// MsgPlus API v1 contract (from the official Postman collection). The fake server below enforces it, so a request the
// real service would reject (no X-Timestamp, no Bearer key, text instead of template variables) fails here too.
// ---------------------------------------------------------------------------------------------------------------

const MSGPLUS = {
  MSGPLUS_API_URL: "https://sms.msgplus.tech/api/v1/send",
  MSGPLUS_AUTH_HEADER: "Authorization",
  MSGPLUS_AUTH_VALUE: "Bearer TEST-ONLY-NOT-A-REAL-KEY",
  MSGPLUS_BODY_TEMPLATE: JSON.stringify({ sender_id: 7, template_id: 12, numbers: ["{{to}}"], vars: { P1: "{{code}}" } }),
  MSGPLUS_SUCCESS_FIELD: "success",
  MSGPLUS_SUCCESS_VALUE: "true",
};
const NOW = Date.parse("2026-11-15T10:00:00Z");

type Seen = { url: string; headers: Record<string, string>; body: any; redirect?: string };

function msgplusServer(seen: Seen[], opts: { balance?: boolean; reply?: () => Response } = {}): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = JSON.parse(String(init?.body));
    seen.push({ url: String(url), headers, body, redirect: init?.redirect });
    const json = (data: unknown, status: number) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    if (!/^Bearer \S+$/.test(headers["Authorization"] ?? "")) return json({ success: false, code: "UNAUTHENTICATED" }, 401);
    if (!/^\d{10}$/.test(headers["X-Timestamp"] ?? "")) return json({ success: false, error: "Missing or invalid X-Timestamp header (unix seconds).", code: "TIMESTAMP_REQUIRED" }, 400);
    if (headers["Accept"] !== "application/json" || headers["Content-Type"] !== "application/json") return json({ message: "unsupported" }, 415);
    if (!Number.isInteger(body.sender_id) || !Number.isInteger(body.template_id)) return json({ success: false }, 422);
    if (!Array.isArray(body.numbers) || !body.numbers.every((n: unknown) => typeof n === "string" && /^963\d{9}$/.test(n))) return json({ success: false }, 422);
    if (!body.vars || typeof body.vars.P1 !== "string" || !body.vars.P1) return json({ success: false }, 422);
    if (opts.balance === false) return json({ success: false, code: "INSUFFICIENT_BALANCE" }, 400);
    if (opts.reply) return opts.reply();
    return json({ success: true, sms_log_id: 42, queued: true, encoding: "unicode", sms_parts: 1, balance_remaining: 498 }, 202);
  }) as typeof fetch;
}

test("MsgPlus: a documented request is accepted: bearer key, fresh X-Timestamp, Accept, ids as numbers, only the code in vars", async () => {
  const seen: Seen[] = [];
  const ok = await sendOtpSms("0933123456", { code: "123456", message: registrationOtpMessage("123456") }, { env: MSGPLUS, fetchImpl: msgplusServer(seen), now: () => NOW });
  assert.equal(ok, true);
  assert.equal(seen.length, 1);
  const { headers, body, url, redirect } = seen[0];
  assert.equal(url, "https://sms.msgplus.tech/api/v1/send");
  assert.equal(headers["X-Timestamp"], String(NOW / 1000), "unix seconds");
  assert.equal(headers["Accept"], "application/json");
  assert.equal(headers["Authorization"], "Bearer TEST-ONLY-NOT-A-REAL-KEY");
  assert.deepEqual(body, { sender_id: 7, template_id: 12, numbers: ["963933123456"], vars: { P1: "123456" } });
  assert.equal(typeof body.sender_id, "number");
  assert.equal(redirect, "manual");
});

test("MsgPlus: the full sentence never goes into the template variable, and the SMS carries no other text", async () => {
  const seen: Seen[] = [];
  await sendOtpSms("0933123456", { code: "654321", message: "EURO CARS: رمز التحقق 654321 صالح 10 دقائق. لا تشاركه." }, { env: MSGPLUS, fetchImpl: msgplusServer(seen), now: () => NOW });
  assert.equal(seen[0].body.vars.P1, "654321");
  assert.ok(!JSON.stringify(seen[0].body).includes("EURO CARS"));
});

test("MsgPlus: X-Timestamp is recomputed for every request", async () => {
  const seen: Seen[] = [];
  const server = msgplusServer(seen);
  await sendOtpSms("0933123456", { code: "111111", message: "m" }, { env: MSGPLUS, fetchImpl: server, now: () => NOW });
  await sendOtpSms("0933123456", { code: "222222", message: "m" }, { env: MSGPLUS, fetchImpl: server, now: () => NOW + 90_000 });
  assert.equal(seen[0].headers["X-Timestamp"], String(NOW / 1000));
  assert.equal(seen[1].headers["X-Timestamp"], String(NOW / 1000 + 90));
});

test("MsgPlus: without the timestamp header the service answers 400 TIMESTAMP_REQUIRED and the send fails (as before the fix)", async () => {
  const seen: Seen[] = [];
  const silenced = console.error;
  const logged: string[] = [];
  console.error = (...a: unknown[]) => { logged.push(a.join(" ")); };
  try {
    const ok = await sendOtpSms("0933123456", { code: "123456", message: "m" }, { env: { ...MSGPLUS, MSGPLUS_TIMESTAMP_HEADER: "none" }, fetchImpl: msgplusServer(seen), now: () => NOW });
    assert.equal(ok, false);
  } finally {
    console.error = silenced;
  }
  assert.equal(seen[0].headers["X-Timestamp"], undefined);
  assert.ok(logged.some((l) => l.includes("400") && l.includes("TIMESTAMP_REQUIRED")), "the provider's error code is logged");
});

test("MsgPlus: insufficient balance is a failed send and is logged by code only", async () => {
  const logged: string[] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => { logged.push(a.join(" ")); };
  let ok: boolean;
  try {
    ok = await sendOtpSms("0933123456", { code: "123456", message: "m" }, { env: MSGPLUS, fetchImpl: msgplusServer([], { balance: false }), now: () => NOW });
  } finally {
    console.error = original;
  }
  assert.equal(ok, false);
  const text = logged.join("\n");
  assert.ok(text.includes("INSUFFICIENT_BALANCE"));
  for (const secret of ["TEST-ONLY-NOT-A-REAL-KEY", "sms.msgplus.tech", "933123456", "123456"]) assert.ok(!text.includes(secret), `log leaks ${secret}`);
});

test("MsgPlus: 202 with success:false, a redirect or an HTML page are not 'sent'", async () => {
  const silenced = console.error;
  console.error = () => {};
  try {
    const cases: Array<() => Response> = [
      () => new Response(JSON.stringify({ success: false }), { status: 202, headers: { "Content-Type": "application/json" } }),
      () => new Response(null, { status: 302, headers: { Location: "https://sms.msgplus.tech/login" } }),
      () => new Response("<html>ok</html>", { status: 200, headers: { "Content-Type": "text/html" } }),
    ];
    for (const reply of cases) {
      assert.equal(await sendOtpSms("0933123456", { code: "123456", message: "m" }, { env: MSGPLUS, fetchImpl: msgplusServer([], { reply }), now: () => NOW }), false);
    }
  } finally {
    console.error = silenced;
  }
});

test("MsgPlus: a template that needs {{code}} refuses to send without a numeric code, and sends nothing", async () => {
  const seen: Seen[] = [];
  const silenced = console.error;
  console.error = () => {};
  try {
    const server = msgplusServer(seen);
    assert.equal(await sendOtpSms("0933123456", "plain text only", { env: MSGPLUS, fetchImpl: server }), false);
    assert.equal(await sendOtpSms("0933123456", { code: "", message: "m" }, { env: MSGPLUS, fetchImpl: server }), false);
    assert.equal(await sendOtpSms("0933123456", { code: "12ab56", message: "m" }, { env: MSGPLUS, fetchImpl: server }), false);
    assert.equal(await sendOtpSms("0933123456", { code: "123456 ", message: "m" }, { env: MSGPLUS, fetchImpl: server }), false);
  } finally {
    console.error = silenced;
  }
  assert.equal(seen.length, 0);
});

test("MsgPlus settings: the timestamp header is validated, can be renamed, and must not clash with the auth header", () => {
  assert.equal(readSmsSettings(MSGPLUS)!.timestampHeader, "X-Timestamp", "default");
  assert.equal(readSmsSettings({ ...MSGPLUS, MSGPLUS_TIMESTAMP_HEADER: "X-Time" })!.timestampHeader, "X-Time");
  assert.equal(readSmsSettings({ ...MSGPLUS, MSGPLUS_TIMESTAMP_HEADER: "OFF" })!.timestampHeader, "");
  assert.equal(readSmsSettings({ ...MSGPLUS, MSGPLUS_TIMESTAMP_HEADER: "bad header" }), null);
  assert.equal(readSmsSettings({ ...MSGPLUS, MSGPLUS_TIMESTAMP_HEADER: "authorization" }), null);
});

test("legacy free-text templates ({{message}}) still work next to the code placeholder", () => {
  const settings = readSmsSettings(BASE)!;
  const { body } = buildSmsRequest(settings, "0933123456", { code: "123456", message: "code 123456" }, NOW);
  assert.equal(JSON.parse(body).text, "code 123456");
  const asString = buildSmsRequest(settings, "0933123456", "just text", NOW);
  assert.equal(JSON.parse(asString.body).text, "just text");
});
