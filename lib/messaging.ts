/**
 * Outgoing verification codes: SMS through MsgPlus only. WhatsApp / Green API and Firebase phone auth are NOT used to
 * deliver codes any more.
 *
 * MsgPlus API v1 (from the official Postman collection): POST https://sms.msgplus.tech/api/v1/send with
 *   Authorization: Bearer <API key>, X-Timestamp: <unix seconds, fresh on every request>, Accept + Content-Type: application/json
 *   body { sender_id: <int>, template_id: <int>, numbers: ["963XXXXXXXXX"], vars: { P1: "<value>" } }
 * The text of the SMS comes from an approved TEMPLATE; only its variables are sent. Success is HTTP 202 with
 * { success: true, sms_log_id, queued: true }; errors are 400 (TIMESTAMP_REQUIRED, INSUFFICIENT_BALANCE) and 422.
 *
 * Everything provider specific is configured by server environment variables (secrets never live in the repository or
 * the apps, and are never logged):
 *
 *   MSGPLUS_API_URL            https endpoint that sends one SMS (required, https only)
 *   MSGPLUS_BODY_TEMPLATE      JSON object (required). The strings {{to}}, {{code}}, {{message}} and {{sender}} inside its
 *                              values are replaced; numbers and arrays are kept as they are, e.g.
 *                              {"sender_id":7,"template_id":12,"numbers":["{{to}}"],"vars":{"P1":"{{code}}"}}
 *                              {{code}} is the bare verification code (digits), {{message}} the full Arabic sentence.
 *   MSGPLUS_AUTH_HEADER        optional header name, e.g. Authorization
 *   MSGPLUS_AUTH_VALUE         optional header value, e.g. "Bearer <key>" (secret: environment only)
 *   MSGPLUS_TIMESTAMP_HEADER   header that carries the current unix time in seconds, recomputed for every request.
 *                              Default X-Timestamp (required by MsgPlus /send); "none" switches it off
 *   MSGPLUS_CONTENT_TYPE       "json" (default) or "form" (a flat template is then sent as a urlencoded form)
 *   MSGPLUS_SENDER             optional sender text, used for {{sender}}
 *   MSGPLUS_PHONE_FORMAT       "international" (default, digits like 9639XXXXXXXX), "plus" (+963...) or "local" (09...)
 *   MSGPLUS_SUCCESS_FIELD      optional dotted path in the JSON reply that must equal MSGPLUS_SUCCESS_VALUE
 *   MSGPLUS_SUCCESS_VALUE      (for MsgPlus: success / true); without them any 2xx reply counts as accepted
 *
 * Nothing is sent, and no code is stored as "sent", unless these are set correctly; the routes then answer "service
 * unavailable". "queued" means accepted by MsgPlus, not delivered to the handset.
 */

const SEND_TIMEOUT_MS = 10_000;

export type SmsSettings = {
  url: string;
  headerName: string;
  headerValue: string;
  timestampHeader: string;
  contentType: "json" | "form";
  template: Record<string, unknown>;
  sender: string;
  phoneFormat: "international" | "plus" | "local";
  successField: string;
  successValue: string;
};

type Env = Record<string, string | undefined>;

/** What a verification SMS carries: the bare code (template variable) and the full sentence (free-text providers). */
export type OtpPayload = { code: string; message: string };

const CODE_RE = /^[0-9]{4,10}$/;

/** Reads and validates the MsgPlus settings; null when the integration is not (correctly) configured. */
export function readSmsSettings(env: Env = process.env): SmsSettings | null {
  const url = (env.MSGPLUS_API_URL ?? "").trim();
  if (!/^https:\/\//i.test(url)) return null;
  let template: unknown;
  try {
    template = JSON.parse(env.MSGPLUS_BODY_TEMPLATE ?? "");
  } catch {
    return null;
  }
  if (!template || typeof template !== "object" || Array.isArray(template)) return null;

  const contentType = (env.MSGPLUS_CONTENT_TYPE ?? "json").trim().toLowerCase();
  if (contentType !== "json" && contentType !== "form") return null;
  const phoneFormat = (env.MSGPLUS_PHONE_FORMAT ?? "international").trim().toLowerCase();
  if (phoneFormat !== "international" && phoneFormat !== "plus" && phoneFormat !== "local") return null;

  const headerName = (env.MSGPLUS_AUTH_HEADER ?? "").trim();
  const headerValue = env.MSGPLUS_AUTH_VALUE ?? "";
  if (headerName && (!/^[A-Za-z0-9-]+$/.test(headerName) || !headerValue)) return null;

  const rawTimestamp = (env.MSGPLUS_TIMESTAMP_HEADER ?? "X-Timestamp").trim();
  const timestampHeader = /^(none|off)$/i.test(rawTimestamp) ? "" : rawTimestamp;
  if (timestampHeader && !/^[A-Za-z0-9-]+$/.test(timestampHeader)) return null;
  if (timestampHeader && timestampHeader.toLowerCase() === headerName.toLowerCase()) return null;

  const successField = (env.MSGPLUS_SUCCESS_FIELD ?? "").trim();
  const successValue = env.MSGPLUS_SUCCESS_VALUE ?? "";
  if (successField && !successValue) return null;

  return {
    url,
    headerName,
    headerValue,
    timestampHeader,
    contentType,
    template: template as Record<string, unknown>,
    sender: (env.MSGPLUS_SENDER ?? "").trim(),
    phoneFormat,
    successField,
    successValue,
  };
}

export function smsConfigured(env: Env = process.env): boolean {
  return readSmsSettings(env) !== null;
}

/** True when the body template expects the bare code ({{code}}), so a send without a valid code must be refused. */
export function templateNeedsCode(settings: SmsSettings): boolean {
  return JSON.stringify(settings.template).includes("{{code}}");
}

/** Recipient number in the format the provider expects. Syrian local mobiles (09XXXXXXXX) get the 963 country code. */
export function smsRecipient(phone: string, format: SmsSettings["phoneFormat"] = "international"): string {
  let digits = String(phone).replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (/^0?9\d{8}$/.test(digits)) digits = `963${digits.replace(/^0/, "")}`;
  if (format === "plus") return `+${digits}`;
  if (format === "local" && /^9639\d{8}$/.test(digits)) return `0${digits.slice(3)}`;
  return digits;
}

function fill(value: unknown, values: Record<string, string>): unknown {
  if (typeof value === "string") {
    return value.replace(/\{\{(to|code|message|sender)\}\}/g, (_, name: string) => values[name] ?? "");
  }
  if (Array.isArray(value)) return value.map((item) => fill(item, values));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fill(item, values)]));
  }
  return value;
}

/**
 * Builds the HTTP request. The values are put into parsed JSON, never spliced into text, so a message cannot break
 * the body. The timestamp is taken at call time (unix seconds) because MsgPlus rejects a missing or stale one.
 */
export function buildSmsRequest(
  settings: SmsSettings,
  phone: string,
  otp: OtpPayload | string,
  nowMs: number = Date.now(),
): { headers: Record<string, string>; body: string } {
  const payload: OtpPayload = typeof otp === "string" ? { code: "", message: otp } : otp;
  const filled = fill(settings.template, {
    to: smsRecipient(phone, settings.phoneFormat),
    code: payload.code,
    message: payload.message,
    sender: settings.sender,
  }) as Record<string, unknown>;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (settings.headerName) headers[settings.headerName] = settings.headerValue;
  if (settings.timestampHeader) headers[settings.timestampHeader] = String(Math.floor(nowMs / 1000));
  if (settings.contentType === "form") {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(filled)) form.set(key, typeof value === "string" ? value : JSON.stringify(value));
    return { headers, body: form.toString() };
  }
  headers["Content-Type"] = "application/json";
  return { headers, body: JSON.stringify(filled) };
}

function readPath(data: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => (value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined), data);
}

/** The provider's machine error code (e.g. INSUFFICIENT_BALANCE) is safe to log: it carries no number, key or text. */
function providerErrorCode(data: unknown): string {
  const code = data && typeof data === "object" ? (data as Record<string, unknown>).code : undefined;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{2,39}$/.test(code) ? code : "";
}

/**
 * Sends one verification SMS through MsgPlus. Never throws; false means the provider did not accept it (or the
 * integration is not configured, or the code is missing while the template needs it). Only the HTTP status and the
 * provider's error code are logged: the URL, the key, the code and the phone number are not.
 */
export async function sendOtpSms(
  phone: string,
  otp: OtpPayload | string,
  deps: { env?: Env; fetchImpl?: typeof fetch; now?: () => number } = {},
): Promise<boolean> {
  const settings = readSmsSettings(deps.env ?? process.env);
  if (!settings) {
    console.error("[sms] MsgPlus is not configured (MSGPLUS_API_URL / MSGPLUS_BODY_TEMPLATE)");
    return false;
  }
  const payload: OtpPayload = typeof otp === "string" ? { code: "", message: otp } : otp;
  if (templateNeedsCode(settings) && !CODE_RE.test(payload.code)) {
    console.error("[sms] refused: the template needs a numeric code and none was given");
    return false;
  }
  try {
    const { headers, body } = buildSmsRequest(settings, phone, payload, (deps.now ?? Date.now)());
    const res = await (deps.fetchImpl ?? fetch)(settings.url, {
      method: "POST",
      headers,
      body,
      redirect: "manual", // a redirect (e.g. an HTML error page) must never be mistaken for an accepted send
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      const code = providerErrorCode(data);
      console.error("[sms] MsgPlus rejected the request, status", res.status, code ? `code ${code}` : "");
      return false;
    }
    if (settings.successField) {
      const data = await res.json().catch(() => null);
      const actual = readPath(data, settings.successField);
      if (String(actual) !== settings.successValue) {
        console.error("[sms] MsgPlus reply did not confirm the send");
        return false;
      }
    }
    return true;
  } catch (err) {
    console.error("[sms] Error sending message:", err instanceof Error ? err.name : "unknown");
    return false;
  }
}

export const OTP_VALID_MINUTES = 10;

/** Short on purpose: an Arabic SMS is split into 70-character parts and every part is billed. */
export function registrationOtpMessage(code: string): string {
  return `EURO CARS: رمز التحقق ${code} صالح ${OTP_VALID_MINUTES} دقائق. لا تشاركه.`;
}
