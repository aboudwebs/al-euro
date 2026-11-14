import { requireStaffAccess } from "@/lib/admin-guard";
import { fail, ok } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { storeImage } from "@/lib/uploads";
import { BodyTooLargeError, readFormDataLimited } from "@/lib/http";

export const dynamic = "force-dynamic";

const BUCKET = "parts-images"; // public bucket: the customer catalogue shows these photos by URL

/** multipart/form-data { image } -> { url } (public URL to save in parts.image_url) */
export async function POST(req: Request) {
  const guard = await requireStaffAccess("parts");
  if (!guard.ok) return guard.response;

  let form: FormData;
  try {
    form = await readFormDataLimited(req);
  } catch (err) {
    if (err instanceof BodyTooLargeError) return fail("حجم الملف كبير جداً", 413);
    return fail("بيانات الرفع غير صالحة");
  }
  const stored = await storeImage(BUCKET, guard.admin.id, form.get("image"), { public: true });
  if (!stored.ok) return fail(stored.error, stored.status);

  const { data } = getSupabaseAdmin().storage.from(BUCKET).getPublicUrl(stored.path);
  return ok({ url: data.publicUrl });
}
