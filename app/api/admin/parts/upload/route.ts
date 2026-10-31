import { requireAdmin } from "@/lib/admin-guard";
import { fail, ok } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { storeImage } from "@/lib/uploads";

export const dynamic = "force-dynamic";

const BUCKET = "parts-images"; // public bucket: the customer catalogue shows these photos by URL

/** multipart/form-data { image } -> { url } (public URL to save in parts.image_url) */
export async function POST(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("بيانات الرفع غير صالحة");
  }
  const stored = await storeImage(BUCKET, guard.admin.id, form.get("image"), { public: true });
  if (!stored.ok) return fail(stored.error, stored.status);

  const { data } = getSupabaseAdmin().storage.from(BUCKET).getPublicUrl(stored.path);
  return ok({ url: data.publicUrl });
}
