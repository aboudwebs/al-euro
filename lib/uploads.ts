import crypto from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type ImageKind = { ext: "jpg" | "png" | "webp"; type: string };

/** Detects the real image type from the file's first bytes (the client-supplied MIME type is not trusted). */
export function sniffImage(bytes: Uint8Array): ImageKind | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: "jpg", type: "image/jpeg" };
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { ext: "png", type: "image/png" };
  if (bytes.length > 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return { ext: "webp", type: "image/webp" };
  return null;
}

export type UploadResult = { ok: true; path: string } | { ok: false; status: number; error: string };

/**
 * Validates an uploaded file field and stores it in a PRIVATE bucket as `<userId>/<uuid>.<ext>`.
 * Returns the storage path (that is what gets saved in the *_url columns; admins read it through signed URLs).
 * The bucket is created on first use with the service-role key (private unless `opts.public` is set, used for the parts catalogue photos).
 */
export async function storeImage(bucket: string, userId: string, file: unknown, opts: { public?: boolean } = {}): Promise<UploadResult> {
  if (!file || typeof file !== "object" || !("arrayBuffer" in file)) {
    return { ok: false, status: 400, error: "ملف الصورة غير صالح" };
  }
  const blob = file as Blob;
  if (blob.size > MAX_IMAGE_BYTES) return { ok: false, status: 413, error: "حجم الصورة يجب ألا يتجاوز 5 ميغابايت" };

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const kind = sniffImage(bytes);
  if (!kind) return { ok: false, status: 415, error: "صيغة الصورة غير مدعومة (JPG أو PNG أو WebP)" };

  const db = getSupabaseAdmin();
  const path = `${userId}/${crypto.randomUUID()}.${kind.ext}`;
  const upload = () => db.storage.from(bucket).upload(path, bytes, { contentType: kind.type });

  let { error } = await upload();
  if (error && /bucket not found/i.test(error.message)) {
    const created = await db.storage.createBucket(bucket, { public: opts.public === true, fileSizeLimit: MAX_IMAGE_BYTES });
    if (created.error && !/already exists/i.test(created.error.message)) {
      console.error(`[uploads] createBucket(${bucket}):`, created.error);
      return { ok: false, status: 500, error: "تعذر تجهيز مساحة تخزين الصور على الخادم" };
    }
    ({ error } = await upload());
  }
  if (error) {
    console.error(`[uploads] upload(${bucket}):`, error);
    return { ok: false, status: 500, error: "تعذر رفع الصورة، حاول مجدداً" };
  }
  return { ok: true, path };
}

export async function removeImage(bucket: string, path: string | null) {
  if (!path) return;
  await getSupabaseAdmin().storage.from(bucket).remove([path]).catch(() => undefined);
}
