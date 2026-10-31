import { getSupabaseAdmin } from "@/lib/supabase";

/** Days an account stays recoverable after the user asks to delete it. Keep in sync with the SQL default (30 days). */
export const DELETION_GRACE_DAYS = 30;

/**
 * Called when someone signs in: if THIS account has a deletion request whose 30 days are over, the database function
 * process_account_deletions() finishes it (anonymises the account), the profile photo file is removed, and the
 * sign-in is refused. Returns true when the account is now deleted. Never throws: if the SQL update has not been run,
 * or anything fails, sign-in simply continues as before.
 */
export async function finalizeDueDeletion(userId: string): Promise<boolean> {
  try {
    const db = getSupabaseAdmin();
    const { data: due, error } = await db
      .from("account_deletion_requests")
      .select("id")
      .eq("user_id", userId)
      .eq("status", "pending")
      .lte("due_at", new Date().toISOString())
      .limit(1)
      .maybeSingle();
    if (error || !due) return false;

    const { data: done, error: rpcError } = await db.rpc("process_account_deletions");
    if (rpcError) {
      console.error("[account-deletion] process_account_deletions:", rpcError);
      return false;
    }
    const ids = Array.isArray(done) ? (done as string[]) : [];
    if (ids.length) {
      await db.storage.from("avatars").remove(ids.map((id) => `${id}.jpg`)).catch(() => undefined);
    }
    return ids.includes(userId);
  } catch (err) {
    console.error("[account-deletion] finalize:", err);
    return false;
  }
}
