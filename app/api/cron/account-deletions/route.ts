import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { deleteFirebaseAuthUser } from "@/lib/firebase-auth-admin";

export const dynamic = "force-dynamic";

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Authenticated worker invoked by Supabase pg_cron. */
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

    const { data: processedIds, error: processError } = await db.rpc("process_account_deletions");
    if (processError) {
      console.error("[cron/account-deletions] process:", processError);
      return reply({ error: "Account deletion processing failed" }, 500);
    }

    const accountsProcessed = Array.isArray(processedIds) ? processedIds.length : 0;
    let firebaseUsersRemoved = 0;
    let avatarsRemoved = 0;
    let specialRequestImagesRemoved = 0;
    let cleanupFailures = 0;

    const { data: firebasePending, error: firebaseQueueError } = await db
      .from("account_deletion_firebase_cleanup_queue")
      .select("provider_uid")
      .is("processed_at", null)
      .order("created_at", { ascending: true })
      .limit(100);
    if (firebaseQueueError) {
      console.error("[cron/account-deletions] Firebase queue read:", firebaseQueueError);
      return reply({ error: "Firebase cleanup queue unavailable" }, 500);
    }

    for (const row of firebasePending ?? []) {
      const uid = String(row.provider_uid);
      try {
        await deleteFirebaseAuthUser(uid);
        const { error } = await db.from("account_deletion_firebase_cleanup_queue")
          .update({ processed_at: new Date().toISOString(), last_error: null })
          .eq("provider_uid", uid).is("processed_at", null);
        if (error) throw error;
        firebaseUsersRemoved++;
      } catch (error) {
        cleanupFailures++;
        console.error("[cron/account-deletions] Firebase user cleanup failed:", error);
        await db.from("account_deletion_firebase_cleanup_queue")
          .update({ last_error: "Firebase Auth deletion failed" })
          .eq("provider_uid", uid).is("processed_at", null);
      }
    }

    const { data: avatarPending, error: avatarQueueError } = await db
      .from("account_deletion_cleanup_queue")
      .select("user_id")
      .is("processed_at", null)
      .order("created_at", { ascending: true })
      .limit(100);
    if (avatarQueueError) {
      console.error("[cron/account-deletions] avatar queue read:", avatarQueueError);
      return reply({ error: "Avatar cleanup queue unavailable" }, 500);
    }

    const avatarIds = (avatarPending ?? []).map((row) => String(row.user_id));
    if (avatarIds.length) {
      const { error: storageError } = await db.storage.from("avatars").remove(avatarIds.map((id) => `${id}.jpg`));
      if (storageError) {
        cleanupFailures++;
        console.error("[cron/account-deletions] avatar cleanup:", storageError);
      } else {
        const { error: markError } = await db.from("account_deletion_cleanup_queue")
          .update({ processed_at: new Date().toISOString() })
          .in("user_id", avatarIds).is("processed_at", null);
        if (markError) {
          cleanupFailures++;
          console.error("[cron/account-deletions] avatar queue update:", markError);
        } else {
          avatarsRemoved = avatarIds.length;
        }
      }
    }

    const { data: imagePending, error: imageQueueError } = await db
      .from("account_deletion_storage_cleanup_queue")
      .select("id, bucket_id, object_path")
      .is("processed_at", null)
      .order("created_at", { ascending: true })
      .limit(100);
    if (imageQueueError) {
      cleanupFailures++;
      console.error("[cron/account-deletions] private image queue read:", imageQueueError);
    } else {
      const groups = new Map<string, Array<{ id: number; path: string }>>();
      for (const row of imagePending ?? []) {
        const bucket = String(row.bucket_id);
        const group = groups.get(bucket) ?? [];
        group.push({ id: Number(row.id), path: String(row.object_path) });
        groups.set(bucket, group);
      }
      for (const [bucket, objects] of groups) {
        const { error: removeError } = await db.storage.from(bucket).remove(objects.map((item) => item.path));
        if (removeError) {
          cleanupFailures++;
          console.error("[cron/account-deletions] private image cleanup failed:", removeError);
          await db.from("account_deletion_storage_cleanup_queue")
            .update({ last_error: "Storage object removal failed" })
            .in("id", objects.map((item) => item.id)).is("processed_at", null);
          continue;
        }
        const { error: markError } = await db.from("account_deletion_storage_cleanup_queue")
          .update({ processed_at: new Date().toISOString(), last_error: null })
          .in("id", objects.map((item) => item.id)).is("processed_at", null);
        if (markError) {
          cleanupFailures++;
          console.error("[cron/account-deletions] private image queue update failed:", markError);
        } else {
          specialRequestImagesRemoved += objects.length;
        }
      }
    }

    if (cleanupFailures) {
      return reply({
        error: "Some deletion cleanup tasks failed and will be retried",
        accountsProcessed,
        firebaseUsersRemoved,
        avatarsRemoved,
        specialRequestImagesRemoved,
        cleanupFailures,
      }, 500);
    }

    return reply({
      ok: true,
      accountsProcessed,
      firebaseUsersRemoved,
      avatarsRemoved,
      specialRequestImagesRemoved,
      cleanupFailures: 0,
    });
  } catch (err) {
    console.error("[cron/account-deletions] POST:", err);
    return reply({ error: "Unexpected cron failure" }, 500);
  }
}
