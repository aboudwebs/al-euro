import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const BUCKET = "avatars";
const MAX_BYTES = 1.5 * 1024 * 1024;
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function currentUserId(): string | null {
  const session = getSession();
  return session && SAFE_ID.test(session.id) ? session.id : null;
}

function isJpeg(bytes: Uint8Array) {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/** Streams the signed-in user's own avatar. The bucket is private; only this route can read it. */
export async function GET() {
  try {
    const id = currentUserId();
    if (!id) return reply({ error: "يرجى تسجيل الدخول أولاً" }, 401);

    const { data, error } = await getSupabaseAdmin().storage.from(BUCKET).download(`${id}.jpg`);
    if (error || !data) return reply({ error: "لا توجد صورة محفوظة" }, 404);

    return new NextResponse(await data.arrayBuffer(), {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error("[api/account/avatar] GET:", err);
    return reply({ error: "تعذر تحميل الصورة" }, 500);
  }
}

/** Body: the cropped JPEG as raw bytes (Content-Type: image/jpeg). */
export async function PUT(req: Request) {
  try {
    const id = currentUserId();
    if (!id) return reply({ error: "يرجى تسجيل الدخول أولاً" }, 401);

    const bytes = new Uint8Array(await req.arrayBuffer());
    if (!bytes.length) return reply({ error: "لم يتم استلام صورة" }, 400);
    if (bytes.length > MAX_BYTES) return reply({ error: "حجم الصورة كبير جداً" }, 413);
    if (!isJpeg(bytes)) return reply({ error: "صيغة الصورة غير مدعومة" }, 415);

    const db = getSupabaseAdmin();
    const upload = () =>
      db.storage.from(BUCKET).upload(`${id}.jpg`, bytes, { contentType: "image/jpeg", upsert: true });

    let { error } = await upload();
    if (error && /bucket not found/i.test(error.message)) {
      // First use: create the private bucket with the service-role key, then retry once.
      const created = await db.storage.createBucket(BUCKET, {
        public: false,
        fileSizeLimit: 2 * 1024 * 1024,
        allowedMimeTypes: ["image/jpeg"],
      });
      if (created.error && !/already exists/i.test(created.error.message)) {
        console.error("[api/account/avatar] createBucket:", created.error);
        return reply({ error: "تعذر تجهيز مساحة تخزين الصور على الخادم" }, 500);
      }
      ({ error } = await upload());
    }
    if (error) {
      console.error("[api/account/avatar] upload:", error);
      return reply({ error: "تعذر حفظ الصورة على الخادم" }, 500);
    }

    return reply({ ok: true, version: Date.now() });
  } catch (err) {
    console.error("[api/account/avatar] PUT:", err);
    return reply({ error: "تعذر حفظ الصورة" }, 500);
  }
}
