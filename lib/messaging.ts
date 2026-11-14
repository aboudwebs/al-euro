/**
 * Outgoing verification codes: SMS through MsgPlus only. WhatsApp / Green API and Firebase phone auth are NOT used to
 * deliver codes any more.
 *
 * The MsgPlus HTTP contract (endpoint, authentication, field names, response format) was not available when this was
 * written, so none of it is hard-coded or guessed. The request is built from server environment settings, which are
 * filled in from MsgPlus's official API documentation and account page:
 *
 *   MSGPLUS_API_URL            https endpoint that sends one SMS (required, https only)
 *   MSGPLUS_BODY_TEMPLATE      JSON object with the field names MsgPlus expects; the strings {{to}}, {{message}} and
 *                              {{sender}} inside its values are replaced (required), e.g. {"to":"{{to}}","text":"{{message}}"}
 *   MSGPLUS_CONTENT_TYPE       "json" (default) or "form" (a flat template is then sent as a urlencoded form)
 *   MSGPLUS_AUTH_HEADER        optional header name, e.g. Authorization
 *   MSGPLUS_AUTH_VALUE         optional header value, e.g. the key / "Bearer ..." (secret: environment only)
 *   MSGPLUS_SENDER             optional sender id, used for {{sender}}
 *   MSGPLUS_PHONE_FORMAT       "international" (default, digits like 9639XXXXXXXX), "plus" (+963...) or "local" (09...)
 *   MSGPLUS_SUCCESS_FIELD      optional dotted path in the JSON reply that must equal MSGPLUS_SUCCESS_VALUE;
 *   MSGPLUS_SUCCESS_VALUE      without them any 2xx reply counts as accepted
 *
 * Nothing is sent, and no code is stored as "sent", unless these are set; routes answer "service unavailable".
 * Secrets live in the server environment only (never in the repository or the apps) and are never logged.
 */

const SEND_TIMEOUT_MS = 10_000;

export type SmsSettings = {
  url: string;
  headerName: string;
  headerValue: string;
  contentType: "json" | "form";
  template: Record<string, unknown>;
  sender: string;
  phoneFormat: "international" | "plus" | "local";
  successField: string;
  successValue: string;
};

type Env = Record<string, string | undefined>;

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
  const successField = (env.MSGPLUS_SUCCESS_FIELD ?? "").trim();
  const successValue = env.MSGPLUS_SUCCESS_VALUE ?? "";
  if (successField && !successValue) return null;

  return {
    url,
    headerName,
    headerValue,
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
    return value.replace(/\{\{(to|message|sender)\}\}/g, (_, name: string) => values[name] ?? "");
  }
  if (Array.isArray(value)) return value.map((item) => fill(item, values));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fill(item, values)]));
  }
  return value;
}

/** Builds the HTTP request. The values are put into parsed JSON, never spliced into text, so a message cannot break the body. */
export function buildSmsRequest(settings: SmsSettings, phone: string, message: string): { headers: Record<string, string>; body: string } {
  const filled = fill(settings.template, {
    to: smsRecipient(phone, settings.phoneFormat),
    message,
    sender: settings.sender,
  }) as Record<string, unknown>;
  const headers: Record<string, string> = {};
  if (settings.headerName) headers[settings.headerName] = settings.headerValue;
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

/**
 * Sends one SMS through MsgPlus. Never throws; false means the provider did not accept it (or the integration is not
 * configured). Only the HTTP status is logged: the URL, the key and the phone number are not.
 */
export async function sendOtpSms(phone: string, message: string, deps: { env?: Env; fetchImpl?: typeof fetch } = {}): Promise<boolean> {
  const settings = readSmsSettings(deps.env ?? process.env);
  if (!settings) {
    console.error("[sms] MsgPlus is not configured (MSGPLUS_API_URL / MSGPLUS_BODY_TEMPLATE)");
    return false;
  }
  try {
    const { headers, body } = buildSmsRequest(settings, phone, message);
    const res = await (deps.fetchImpl ?? fetch)(settings.url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error("[sms] MsgPlus rejected the request, status", res.status);
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
