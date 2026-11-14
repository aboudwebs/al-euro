import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Retired. This was an identical copy of /api/admin/reset-password; the admin page and both apps use only the latter
 * (checked across the server, the Flutter app and the referral site). A second public path doubled the attack surface.
 */
export async function POST() {
  return NextResponse.json({ error: "هذا المسار لم يعد متاحاً." }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
