import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Called by the Supabase pg_cron job. The bearer token is stored in Supabase Vault;
 * it is checked inside Postgres and is never exposed to clients or source control.
 */
export async function POST(req: Request) {
  try {
    const authorization = req.headers.get("authorization") ?? "";
    const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
    if (token.length < 32 || token.length > 256) return reply({ error: "Unauthorized" }, 401);

    const db = getSupabaseAdmin();
    const { data: valid, error: verifyError } = await db.rpc("is_euro_deletion_cron_token", { p_token: token });
    if (verifyError) {
      console.error("[cron/account-deletions] token verification:", verifyError);
      return reply({ error: "Cron authentication unavailable" }, 503);
    }
    if (valid !== true) return reply({ error: "Unauthorized" }, 401);

    const { error: processError } = await db.rpc("process_account_deletions");
    if (processError) {
      console.error("[cron/account-deletions] process:", processError);
      return reply({ error: "Account deletion processing failed" }, 500);
    }

    const { data: pending, error: queueError } = await db
      .from("account_deletion_cleanup_queue")
      .select("user_id")
      .is("processed_at", null)
      .order("created_at", { ascending: true })
      .limit(100);

    if (queueError) {
      console.error("[cron/account-deletions] queue read:", queueError);
      return reply({ error: "Avatar cleanup queue unavailable" }, 500);
    }

    const ids = (pending ?? []).map((row) => String(row.user_id));
    if (!ids.length) return reply({ ok: true, accountsProcessed: 0, avatarsRemoved: 0 });

    const { error: storageError } = await db.storage.from("avatars").remove(ids.map((id) => `${id}.jpg`));
    if (storageError) {
      console.error("[cron/account-deletions] avatar cleanup:", storageError);
      return reply({ error: "Avatar cleanup failed; items will be retried" }, 500);
    }

    const { error: markError } = await db
      .from("account_deletion_cleanup_queue")
      .update({ processed_at: new Date().toISOString() })
      .in("user_id", ids)
      .is("processed_at", null);

    if (markError) {
      console.error("[cron/account-deletions] queue update:", markError);
      return reply({ error: "Avatar cleanup could not be confirmed" }, 500);
    }

    return reply({ ok: true, accountsProcessed: 0, avatarsRemoved: ids.length });
  } catch (err) {
    console.error("[cron/account-deletions] POST:", err);
    return reply({ error: "Unexpected cron failure" }, 500);
  }
}
