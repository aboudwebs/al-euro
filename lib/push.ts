import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { getSupabaseAdmin } from "@/lib/supabase";

type NotificationInput = {
  userId: string;
  type: string;
  title: string;
  body: string;
  eventKey: string;
  orderId?: string | null;
  data?: Record<string, string>;
  excludeToken?: string;
};

function firebaseMessaging() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) return null;

  const appName = "euro-cars-push";
  const app = getApps().find((candidate) => candidate.name === appName)
    ?? initializeApp(
      { credential: cert({ projectId, clientEmail, privateKey }), projectId },
      appName,
    );
  return getMessaging(app);
}

/**
 * Persist exactly once, then deliver to every active device token.
 * A Firebase outage never rolls back the business operation or loses the in-app notification.
 */
export async function notifyUser(input: NotificationInput): Promise<void> {
  const db = getSupabaseAdmin();
  const { data: saved, error: insertError } = await db
    .from("user_notifications")
    .insert({
      user_id: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      order_id: input.orderId ?? null,
      event_key: input.eventKey,
    })
    .select("id")
    .maybeSingle();

  if (insertError) {
    // 23505 means this business event was already notified.
    if (insertError.code === "23505") return;
    console.error("[push] notification persistence failed:", insertError);
    return;
  }
  if (!saved?.id) return;

  try {
    const messaging = firebaseMessaging();
    if (!messaging) {
      console.warn("[push] Firebase Admin is not configured; notification saved in-app only.");
      return;
    }

    const { data: rows, error: tokenError } = await db
      .from("push_tokens")
      .select("token")
      .eq("user_id", input.userId);
    if (tokenError) {
      console.error("[push] token lookup failed:", tokenError);
      return;
    }

    const tokens = Array.from(new Set((rows ?? []).map((row) => String(row.token)).filter((token) => token && token !== input.excludeToken)));
    if (!tokens.length) return;

    const payload = {
      tokens,
      notification: { title: input.title, body: input.body },
      data: {
        notificationId: String(saved.id),
        type: input.type,
        ...(input.orderId ? { orderId: input.orderId } : {}),
        ...(input.data ?? {}),
      },
      android: { priority: "high" as const, notification: { channelId: "euro_cars_notifications", sound: "default" } },
      apns: { payload: { aps: { sound: "default" } } },
    };

    // FCM multicast is limited to 500 tokens per request.
    for (let offset = 0; offset < tokens.length; offset += 500) {
      const batch = tokens.slice(offset, offset + 500);
      const result = await messaging.sendEachForMulticast({ ...payload, tokens: batch });
      console.info("[push] FCM batch result:", {
        userId: input.userId,
        attempted: batch.length,
        succeeded: result.successCount,
        failed: result.failureCount,
      });
      const invalid: string[] = [];
      result.responses.forEach((response, index) => {
        if (!response.success) {
          const code = response.error?.code;
          if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") {
            invalid.push(batch[index]);
          } else {
            console.error("[push] FCM delivery failed:", code, response.error?.message);
          }
        }
      });
      if (invalid.length) {
        const { error } = await db.from("push_tokens").delete().in("token", invalid);
        if (error) console.error("[push] invalid-token cleanup failed:", error);
      }
    }
  } catch (error) {
    console.error("[push] delivery failed:", error);
  }
}
