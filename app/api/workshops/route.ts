import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Public workshop directory.
 * Only admin-activated workshop accounts are visible; private account fields are never selected.
 */
export async function GET() {
  try {
    const db = getSupabaseAdmin();
    const { data, error } = await db
      .from("users")
      .select("id, name, phone, city, specs")
      .eq("role", "workshop")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) {
      console.error("[api/workshops] select:", error);
      return NextResponse.json(
        { error: "تعذر تحميل دليل الورشات" },
        { status: 500, headers: NO_STORE },
      );
    }

    const workshops = (data ?? []).map((row) => {
      const phone = typeof row.phone === "string" ? row.phone.trim() : "";
      return {
        id: String(row.id),
        name: typeof row.name === "string" ? row.name.trim() : "",
        city: typeof row.city === "string" ? row.city.trim() : "",
        specs: Array.isArray(row.specs)
          ? row.specs.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
          : [],
        phone,
      };
    }).filter((row) => row.name && row.phone);

    return NextResponse.json({ workshops }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/workshops] GET:", err);
    return NextResponse.json(
      { error: "تعذر تحميل دليل الورشات" },
      { status: 500, headers: NO_STORE },
    );
  }
}
