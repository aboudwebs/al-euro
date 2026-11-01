import { randomUUID } from "node:crypto";
import { requireAdmin } from "@/lib/admin-guard";
import { fail, ok, readJson, dbFail } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { notifyUser } from "@/lib/push";

export const dynamic = "force-dynamic";

/**
 * Admin-only operational broadcast.
 * Body: { title, body, type: "announcement" | "maintenance" | "update" | "admin_message", eventId? }
 * This is deliberately not a marketing channel; it is limited to active workshops and marketers.
 */
export async function POST(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = await readJson(req);
  if (!body || typeof body.title !== "string" || typeof body.body !== "string") {
    return fail("عنوان الرسالة ونصها مطلوبان");
  }
  const title = body.title.trim().slice(0, 120);
  const message = body.body.trim().slice(0, 1000);
  const allowed = ["announcement", "maintenance", "update", "admin_message"];
  const type = typeof body.type === "string" && allowed.includes(body.type) ? body.type : "admin_message";
  if (!title || !message) return fail("عنوان الرسالة ونصها مطلوبان");
  const eventId = typeof body.eventId === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(body.eventId)
    ? body.eventId
    : randomUUID();

  const { data: users, error } = await getSupabaseAdmin().from("users")
    .select("id").in("role", ["workshop", "marketer"]).eq("is_active", true);
  if (error) return dbFail("notification broadcast recipients", error, "تعذر تحميل المستلمين");

  const recipients = users ?? [];
  for (let offset = 0; offset < recipients.length; offset += 25) {
    await Promise.all(recipients.slice(offset, offset + 25).map((user) => notifyUser({
      userId: String(user.id),
      type,
      title,
      body: message,
      eventKey: `admin-broadcast:${eventId}:${user.id}`,
      data: { screen: "account", broadcastType: type },
    })));
  }
  return ok({ sentTo: recipients.length, eventId });
}
