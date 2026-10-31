import { optText } from "@/lib/account-api";

/** Shapes and validation of the customer address / vehicle records (shared by the /api/account/* routes). */

export type AddressRow = {
  id: string; label: string; governorate: string | null; area: string | null; street: string | null;
  details: string | null; phone: string | null; is_default: boolean;
};

export function addressJson(r: AddressRow) {
  return {
    id: String(r.id), label: r.label, governorate: r.governorate, area: r.area, street: r.street,
    details: r.details, phone: r.phone, isDefault: r.is_default === true,
  };
}

/** Reads and validates an address body. `partial` = update (only the fields present). */
export function parseAddress(body: Record<string, unknown>, partial: boolean): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const value: Record<string, unknown> = {};
  const fields: [string, string, number][] = [
    ["governorate", "المحافظة", 80], ["area", "المنطقة", 120], ["street", "الشارع", 200], ["details", "تفاصيل إضافية", 300], ["phone", "رقم التواصل", 32],
  ];
  if ("label" in body || !partial) {
    const label = optText(body, "label", "اسم العنوان", 60);
    if (label.error) return { ok: false, error: label.error };
    if (!label.value) return { ok: false, error: "اكتب اسماً للعنوان (مثال: الورشة)" };
    value.label = label.value;
  }
  for (const [key, title, max] of fields) {
    const t = optText(body, key, title, max);
    if (t.error) return { ok: false, error: t.error };
    if ("value" in t) value[key] = t.value ?? null;
  }
  if (!partial && !value.governorate && !value.area && !value.street && !value.details) {
    return { ok: false, error: "أدخل تفاصيل العنوان (المحافظة أو المنطقة أو الشارع)" };
  }
  return { ok: true, value };
}


// ---------------------------------------------------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------------------------------------------------

export type VehicleRow = {
  id: string; name: string | null; vin: string; make: string | null; model: string | null; year: number | null; notes: string | null;
};

export function vehicleJson(r: VehicleRow) {
  return { id: String(r.id), name: r.name, vin: r.vin, make: r.make, model: r.model, year: r.year, notes: r.notes };
}

/** Upper-case, no spaces. Does NOT judge the length: older cars and some makes have shorter numbers. */
export function normalizeVin(raw: string): string {
  return raw.toUpperCase().replace(/\s+/g, "");
}

export const VIN_SHAPE = /^[A-Z0-9-]{5,32}$/;

export function parseVehicle(body: Record<string, unknown>, partial: boolean): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const value: Record<string, unknown> = {};
  if ("vin" in body || !partial) {
    if (typeof body.vin !== "string") return { ok: false, error: "رقم الشاصي (VIN) مطلوب" };
    const vin = normalizeVin(body.vin);
    if (!VIN_SHAPE.test(vin)) return { ok: false, error: "رقم الشاصي غير صالح: أحرف وأرقام إنجليزية فقط (من 5 إلى 32 خانة)" };
    value.vin = vin;
  }
  const texts: [string, string, number][] = [["name", "اسم المركبة", 80], ["make", "الماركة", 60], ["model", "الموديل", 80], ["notes", "الملاحظات", 300]];
  for (const [key, title, max] of texts) {
    const t = optText(body, key, title, max);
    if (t.error) return { ok: false, error: t.error };
    if ("value" in t) value[key] = t.value ?? null;
  }
  if ("year" in body) {
    if (body.year === null || body.year === "") value.year = null;
    else {
      const year = typeof body.year === "number" ? body.year : Number(body.year);
      if (!Number.isInteger(year) || year < 1900 || year > 2100) return { ok: false, error: "سنة الصنع غير صالحة" };
      value.year = year;
    }
  }
  return { ok: true, value };
}
