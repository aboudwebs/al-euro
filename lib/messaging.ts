/**
 * Outgoing verification messages. The channel is unchanged: WhatsApp through Green API (same environment variables as
 * before). Nothing else is enabled here: no SMS provider is wired in, and none is switched on automatically.
 * Callers only see sendWhatsAppText(); a different provider would be added behind it without touching the routes.
 */

const SEND_TIMEOUT_MS = 10_000;

/** Convert Syrian local mobile numbers to Green API's international WhatsApp chat ID format. */
export function whatsappChatId(phone: string): string {
  let digits = String(phone).replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (/^0?9\d{8}$/.test(digits)) digits = `963${digits.replace(/^0/, "")}`;
  return `${digits}@c.us`;
}

export function whatsappConfigured(): boolean {
  return Boolean(process.env.GREEN_API_URL && process.env.GREEN_API_INSTANCE_ID && process.env.GREEN_API_TOKEN);
}

/** Sends a WhatsApp text through Green API. Never throws; returns false when it was not delivered to the provider. */
export async function sendWhatsAppText(phone: string, message: string): Promise<boolean> {
  const apiUrl = process.env.GREEN_API_URL;
  const instanceId = process.env.GREEN_API_INSTANCE_ID;
  const token = process.env.GREEN_API_TOKEN;
  if (!apiUrl || !instanceId || !token) {
    console.error("[Green-API] Missing environment variables");
    return false;
  }
  try {
    const res = await fetch(`${apiUrl.replace(/\/+$/, "")}/waInstance${instanceId}/sendMessage/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId: whatsappChatId(phone), message }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    const data = await res.json().catch(() => null);
    return res.ok && Boolean(data?.idMessage);
  } catch (err) {
    // The URL contains the instance token, so only the error name is logged.
    console.error("[Green-API] Error sending message:", err instanceof Error ? err.name : "unknown");
    return false;
  }
}

export function registrationOtpMessage(code: string): string {
  return `رمز التحقق الخاص بك في تطبيق EURO CARS هو: *${code}*.\nصالح لمدة 5 دقائق. لا تشاركه مع أحد.`;
}
