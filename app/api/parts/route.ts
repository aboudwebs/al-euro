import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** Live catalog for signed-in customers: active rows of the `parts` table. */
export async function GET() {
  try {
    if (!getSession()) return NextResponse.json({ error: "يرجى تسجيل الدخول" }, { status: 401, headers: NO_STORE });

    const db = getSupabaseAdmin();
    const FIELDS = "id, name, brand, model, years, oem_number, alt_grade, price, stock, branch, image_url";
    const list = (fields: string) => db.from("parts").select(fields).eq("is_active", true).order("name", { ascending: true });
    // `category` comes from supabase/updates_2026_10.sql; without it the catalogue still loads (no sections).
    let { data, error } = await list(`${FIELDS}, category`);
    if (error?.code === "42703") ({ data, error } = await list(FIELDS));

    if (error) {
      console.error("[api/parts] select:", error);
      return NextResponse.json({ error: "تعذر تحميل الكتالوج" }, { status: 500, headers: NO_STORE });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parts = ((data ?? []) as any[]).map((p) => ({
      id: String(p.id),
      name: p.name,
      brand: p.brand,
      pn: p.oem_number,
      price: Number(p.price),
      stock: Number(p.stock),
      model: p.model || "",
      years: p.years || "",
      altGrade: p.alt_grade ?? null,
      branch: p.branch || "",
      category: typeof p.category === "string" && p.category.trim() ? p.category.trim() : null,
      // image_url may hold a public URL; private storage paths are not exposed to customers here.
      image: typeof p.image_url === "string" && /^https?:\/\//.test(p.image_url) ? p.image_url : null,
    }));

    return NextResponse.json({ parts }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/parts] GET:", err);
    return NextResponse.json({ error: "تعذر تحميل الكتالوج" }, { status: 500, headers: NO_STORE });
  }
}
