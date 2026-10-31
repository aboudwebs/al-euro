import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Clients are created lazily so that importing this module (e.g. during `next build`)
// never throws when the environment variables are not present at build time.
let admin: SupabaseClient | null = null;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not defined in environment variables`);
  return value;
}

/** Server-only client with the service-role key (bypasses RLS). Never import from client components. */
export function getSupabaseAdmin(): SupabaseClient {
  if (!admin) {
    admin = createClient(required("NEXT_PUBLIC_SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return admin;
}
