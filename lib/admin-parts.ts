type PartInput = {
  name: string; brand: string; model: string; years: string; oem_number: string;
  alt_grade: string | null; price: number; stock: number; branch: string; image_url: string | null; is_active: boolean;
  category: string | null;
};

/** Shared validation for create (all required fields) and update (only the fields present). */
export function parsePart(body: Record<string, unknown>, partial: boolean): { ok: true; value: Partial<PartInput> } | { ok: false; error: string } {
  const v: Partial<PartInput> = {};
  const str = (key: keyof PartInput, label: string, max: number, required: boolean): string | null => {
    if (!(key in body)) return required && !partial ? `${label} مطلوب` : null;
    const raw = body[key];
    if (typeof raw !== "string") return `${label} غير صالح`;
    const t = raw.trim().slice(0, max);
    if (required && !t) return `${label} مطلوب`;
    (v as Record<string, unknown>)[key] = t;
    return null;
  };
  const errs = [
    str("name", "اسم القطعة", 120, true),
    str("brand", "الماركة", 60, true),
    str("model", "الموديل", 120, false),
    str("years", "سنوات الصنع", 60, false),
    str("oem_number", "رقم القطعة (OEM)", 64, true),
    str("branch", "الفرع", 80, true),
  ].filter(Boolean);
  if (errs.length) return { ok: false, error: errs[0] as string };

  if ("alt_grade" in body) {
    if (body.alt_grade !== null && typeof body.alt_grade !== "string") return { ok: false, error: "درجة البديل غير صالحة" };
    v.alt_grade = body.alt_grade ? String(body.alt_grade).trim().slice(0, 60) || null : null;
  }
  if ("category" in body) {
    // Catalogue section (column added by supabase/updates_2026_10.sql). Empty = no section.
    if (body.category !== null && typeof body.category !== "string") return { ok: false, error: "القسم غير صالح" };
    v.category = body.category ? String(body.category).trim().replace(/\s+/g, " ").slice(0, 60) || null : null;
  }
  if ("price" in body || !partial) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0 || price > 100_000_000) return { ok: false, error: "السعر غير صالح" };
    v.price = Math.round(price * 100) / 100;
  }
  if ("stock" in body || !partial) {
    const stock = Number(body.stock);
    if (!Number.isInteger(stock) || stock < 0 || stock > 10_000_000) return { ok: false, error: "الكمية يجب أن تكون عدداً صحيحاً غير سالب" };
    v.stock = stock;
  }
  if ("image_url" in body) {
    if (body.image_url === null || body.image_url === "") v.image_url = null;
    else if (typeof body.image_url === "string" && /^https?:\/\/\S+$/i.test(body.image_url.trim()) && body.image_url.length <= 1000) v.image_url = body.image_url.trim();
    else return { ok: false, error: "رابط الصورة غير صالح" };
  }
  if ("is_active" in body) {
    if (typeof body.is_active !== "boolean") return { ok: false, error: "قيمة التفعيل غير صالحة" };
    v.is_active = body.is_active;
  }
  return { ok: true, value: v };
}

