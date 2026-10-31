"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, MapPin, Phone, ShieldCheck, LogOut, Save, UserRound, Wallet, Headset, ExternalLink, PackageCheck, Clock3 } from "lucide-react";
import { H } from "@/components/ui";
import MyActivity from "@/components/MyActivity";

type User = {
  id: string;
  role: "workshop" | "marketer";
  name: string;
  phone: string;
  city?: string | null;
  license?: string | null;
  specs?: string[] | null;
  tier?: string | null;
  debt_limit?: number | null;
  debt_balance?: number | null;
  cashback_balance?: number | null;
  my_ref_code?: string | null;
  created_at?: string | null;
};

const CITIES = ["دمشق","ريف دمشق","حلب","حمص","حماة","اللاذقية","طرطوس","إدلب","دير الزور","الرقة","الحسكة","درعا","السويداء","القنيطرة"];

// Crop geometry. The preview frame and the exported image use the same function, so what the user
// sees in the preview is exactly what is saved (only scaled from FRAME px to OUT px).
const FRAME = 224;               // preview size in CSS px
const OUT = 400;                 // exported avatar size in px
const CROP_BG = "#171a22";       // visible when the photo does not fill the frame (same in preview and export)
const MAX_UPLOAD = 5 * 1024 * 1024;
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/i;

function cropPlacement(nw: number, nh: number, size: number, zoom: number, ox: number, oy: number) {
  const base = Math.min(size / nw, size / nh); // fit the whole photo first, then zoom
  const w = nw * base * zoom;
  const h = nh * base * zoom;
  return { x: (size - w) / 2 + ox * (size / 2), y: (size - h) / 2 + oy * (size / 2), w, h };
}

function readStorage(key: string): string {
  try { return localStorage.getItem(key) || ""; } catch { return ""; }
}

export default function AccountPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [email, setEmail] = useState("");

  // Avatar: the server copy is the source of truth; `legacyAvatar` is only a read-only fallback for
  // photos that were saved on this device by the previous version.
  const [avatarVersion, setAvatarVersion] = useState(0);
  const [avatarMissing, setAvatarMissing] = useState(false);
  const [legacyAvatar, setLegacyAvatar] = useState("");
  const [avatarLocal, setAvatarLocal] = useState("");
  const [pendingSrc, setPendingSrc] = useState("");
  const [cropNat, setCropNat] = useState<{ w: number; h: number } | null>(null);
  const [cropZoom, setCropZoom] = useState(1);
  const [cropOffsetX, setCropOffsetX] = useState(0);
  const [cropOffsetY, setCropOffsetY] = useState(0);
  const [cropError, setCropError] = useState("");
  const [avatarSaving, setAvatarSaving] = useState(false);
  const avatarSavingRef = useRef(false);
  const pendingRef = useRef("");
  const localRef = useRef("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cropImageRef = useRef<HTMLImageElement>(null);
  const dragState = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const statusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/auth", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (!d.user) { router.replace("/login"); return; }
        setUser(d.user);
        setName(d.user.name || "");
        setCity(d.user.city || "");
        setLegacyAvatar(readStorage(`euro_avatar_${d.user.id}`));
        setEmail(readStorage(`euro_email_${d.user.id}`));
        setAvatarVersion(Date.now());
      })
      .catch(() => router.replace("/login"))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [router]);

  // Release object URLs when leaving the page.
  useEffect(() => () => {
    if (pendingRef.current) URL.revokeObjectURL(pendingRef.current);
    if (localRef.current) URL.revokeObjectURL(localRef.current);
  }, []);

  // Keep the saved / error message visible without moving the page when it is already on screen.
  useEffect(() => {
    if (notice || error) statusRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [notice, error]);

  function resetFileInput() {
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function closeCrop() {
    if (pendingRef.current) URL.revokeObjectURL(pendingRef.current);
    pendingRef.current = "";
    dragState.current = null;
    setPendingSrc("");
    setCropNat(null);
    setCropError("");
    resetFileInput();
  }

  // Close the crop dialog with Escape (unless a save is in progress).
  useEffect(() => {
    if (!pendingSrc) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !avatarSavingRef.current) closeCrop(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingSrc]);

  function chooseAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    // Some Android galleries hand over files with an empty MIME type, so fall back to the extension.
    const looksLikeImage = file.type.startsWith("image/") || (!file.type && IMAGE_EXT.test(file.name));
    if (!looksLikeImage) { setError("اختر ملف صورة صالحاً."); resetFileInput(); return; }
    if (file.size > MAX_UPLOAD) { setError("حجم الصورة يجب ألا يتجاوز 5 ميغابايت."); resetFileInput(); return; }

    if (pendingRef.current) URL.revokeObjectURL(pendingRef.current);
    const url = URL.createObjectURL(file);
    pendingRef.current = url;
    setPendingSrc(url);
    setCropNat(null);
    setCropZoom(1);
    setCropOffsetX(0);
    setCropOffsetY(0);
    setCropError("");
    setError("");
    setNotice("");
  }

  async function saveCroppedAvatar() {
    const image = cropImageRef.current;
    if (!pendingSrc || !user || !image || avatarSavingRef.current) return;
    if (!cropNat || !image.complete || image.naturalWidth < 1 || image.naturalHeight < 1) {
      setCropError("انتظر حتى تكتمل معاينة الصورة ثم اضغط اعتماد الصورة.");
      return;
    }
    avatarSavingRef.current = true;
    setAvatarSaving(true);
    setCropError("");
    try {
      const canvas = document.createElement("canvas");
      canvas.width = OUT;
      canvas.height = OUT;
      const context = canvas.getContext("2d");
      if (!context) { setCropError("تعذر تجهيز الصورة."); return; }
      const k = OUT / FRAME;
      const p = cropPlacement(image.naturalWidth, image.naturalHeight, FRAME, cropZoom, cropOffsetX, cropOffsetY);
      context.fillStyle = CROP_BG;
      context.fillRect(0, 0, OUT, OUT);
      context.imageSmoothingQuality = "high";
      context.drawImage(image, p.x * k, p.y * k, p.w * k, p.h * k);

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
      if (!blob) { setCropError("تعذر تجهيز الصورة. جرّب صورة أخرى."); return; }

      const response = await fetch("/api/account/avatar", {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" },
        body: blob,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        setCropError(data?.error || "تعذر حفظ الصورة، حاول مجدداً.");
        return;
      }

      // Show the new photo immediately; it is already stored on the server for the next visit / device.
      if (localRef.current) URL.revokeObjectURL(localRef.current);
      const shown = URL.createObjectURL(blob);
      localRef.current = shown;
      setAvatarLocal(shown);
      setAvatarMissing(false);
      closeCrop();
      setError("");
      setNotice("تم تحديث صورة الحساب.");
    } catch {
      setCropError("تعذر الاتصال بالخادم. تحقق من الإنترنت وحاول مجدداً.");
    } finally {
      avatarSavingRef.current = false;
      setAvatarSaving(false);
    }
  }

  function startCropDrag(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragState.current = { x: e.clientX, y: e.clientY, offsetX: cropOffsetX, offsetY: cropOffsetY };
  }

  function moveCropDrag(e: React.PointerEvent<HTMLDivElement>) {
    const start = dragState.current;
    if (!start) return;
    // One offset unit is half the frame, so the image follows the finger 1:1.
    const rect = e.currentTarget.getBoundingClientRect();
    setCropOffsetX(Math.max(-1, Math.min(1, start.offsetX + ((e.clientX - start.x) / Math.max(rect.width, 1)) * 2)));
    setCropOffsetY(Math.max(-1, Math.min(1, start.offsetY + ((e.clientY - start.y) / Math.max(rect.height, 1)) * 2)));
  }

  function endCropDrag() {
    dragState.current = null;
  }

  async function saveProfile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (savingRef.current) return; // ignore repeated taps while a request is in flight
    setNotice("");
    setError("");

    // Validated here (the form uses noValidate) so a mistake never triggers the browser's scroll-to-field jump.
    if (name.trim().length < 2) { setError("الاسم يجب أن يكون حرفين على الأقل."); return; }
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) { setError("صيغة البريد الإلكتروني غير صحيحة."); return; }
    if (newPassword && newPassword.length < 4) { setError("كلمة المرور الجديدة يجب أن تكون 4 أحرف على الأقل."); return; }

    savingRef.current = true;
    setSaving(true);
    try {
      const response = await fetch("/api/auth", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), city, ...(newPassword ? { newPassword } : {}) }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok || !data.user) {
        // The form keeps everything the user typed so they can retry.
        setError(data?.error || "تعذر حفظ التعديلات");
        return;
      }
      // The e-mail is only stored on this device and never blocks saving the server-side profile.
      try { localStorage.setItem(`euro_email_${data.user.id}`, email.trim()); } catch { /* storage unavailable */ }
      setUser(data.user);
      setName(data.user.name || "");
      setCity(data.user.city || "");
      setNewPassword("");
      setNotice("تم حفظ بيانات حسابك بنجاح.");
    } catch {
      setError("تعذر الاتصال بالخادم. تحقق من الإنترنت وحاول مجدداً.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function logout() {
    try { await fetch("/api/auth", { method: "DELETE" }); } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  if (loading || !user) {
    return <div className="grid min-h-[55vh] place-items-center text-white/60">جارٍ تحميل ملفك الشخصي...</div>;
  }

  const isWorkshop = user.role === "workshop";
  const joined = user.created_at ? new Date(user.created_at).toLocaleDateString("ar-SY") : "—";
  const initials = user.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("");
  const avatarSrc = avatarLocal || (avatarMissing ? legacyAvatar : `/api/account/avatar?v=${avatarVersion}`);
  const placement = cropNat ? cropPlacement(cropNat.w, cropNat.h, FRAME, cropZoom, cropOffsetX, cropOffsetY) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-4">
      <H t="ملفي الشخصي" s="إدارة بيانات حسابك وإعدادات الأمان" />

      <section className="card overflow-hidden bg-gradient-to-br from-[#0A84FF]/20 via-white/[0.06] to-white/[0.02] p-5">
        <div className="flex items-center gap-4">
          <div className="relative h-20 w-20 shrink-0">
            <div className="grid h-20 w-20 place-items-center overflow-hidden rounded-[26px] border border-white/20 bg-white/10 text-2xl font-black text-white shadow-inner">
              {avatarSrc
                ? <img key={avatarSrc} src={avatarSrc} alt="صورة الحساب" onError={() => setAvatarMissing(true)} className="h-full w-full object-cover" />
                : (initials || <UserRound size={30} />)}
            </div>
            <label className="absolute -bottom-2 -end-2 grid h-8 w-8 cursor-pointer place-items-center rounded-full border-2 border-[color:var(--bg)] bg-[#0A84FF] text-snow focus-within:outline focus-within:outline-2 focus-within:outline-[#0A84FF]" title="تغيير صورة الحساب">
              <UserRound size={15} />
              <span className="sr-only">تغيير صورة الحساب</span>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={chooseAvatar} className="sr-only" />
            </label>
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h2 className="break-words text-xl font-bold text-white">{user.name}</h2>
              <span className="rounded-full border border-[#30D158]/30 bg-[#30D158]/10 px-2 py-1 text-[11px] text-[#30D158]"><BadgeCheck className="me-1 inline" size={13}/>{isWorkshop ? "حساب ورشة معتمد" : "حساب مسوّق"}</span>
            </div>
            <p className="flex items-center gap-2 text-sm text-white/60" dir="ltr"><Phone size={14}/>{user.phone}</p>
            {user.city && <p className="mt-1 flex items-center gap-2 text-sm text-white/60"><MapPin size={14}/>{user.city}</p>}
            <p className="mt-1 flex items-center gap-2 text-xs text-white/50"><Clock3 size={13}/>عضو منذ {joined}</p>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="card rounded-2xl">
          <div className="mb-2 flex items-center gap-2 text-sm text-white/60"><PackageCheck size={17}/>إحصائيات الطلبات</div>
          <strong className="text-2xl text-white">—</strong>
          <p className="mt-1 text-xs leading-5 text-white/50">سجل الطلبات غير متاح بعد؛ الحفظ الدائم للطلبات غير مفعّل في النظام الحالي.</p>
        </div>
        <div className="card rounded-2xl">
          <div className="mb-2 flex items-center gap-2 text-sm text-white/60">{isWorkshop ? <Wallet size={17}/> : <ShieldCheck size={17}/>} {isWorkshop ? "سقف دفتر الدين" : "كود المسوّق"}</div>
          <strong className="break-all text-2xl text-[#0A84FF]">{isWorkshop ? (user.debt_limit == null ? "غير محدد" : `$${Number(user.debt_limit).toLocaleString("en-US")}`) : (user.my_ref_code || "غير متوفر")}</strong>
          {isWorkshop && <p className="mt-1 text-xs text-white/50">الرصيد المستخدم: {user.debt_balance == null ? "غير متوفر" : `$${Number(user.debt_balance).toLocaleString("en-US")}`}</p>}
          {!isWorkshop && <p className="mt-1 text-xs text-white/50">يُستخدم هذا الكود عند تسجيل ورشة جديدة.</p>}
        </div>
      </section>

      <form onSubmit={saveProfile} noValidate className="card space-y-4 sm:p-5">
        <h3 className="flex items-center gap-2 font-bold text-white"><UserRound size={18} className="text-[#0A84FF]"/>تعديل البيانات</h3>
        <label className="block space-y-2 text-sm text-white/65">
          الاسم
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoComplete="name" className="inp rounded-xl py-3" />
        </label>
        <label className="block space-y-2 text-sm text-white/65">
          المحافظة
          <select value={city} onChange={(e) => setCity(e.target.value)} className="inp rounded-xl py-3">
            <option value="">اختر المحافظة</option>
            {CITIES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="block space-y-2 text-sm text-white/65">
          البريد الإلكتروني <span className="text-white/50">(محفوظ على هذا الجهاز فقط)</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="example@gmail.com" className="inp rounded-xl py-3" />
        </label>
        <label className="block space-y-2 text-sm text-white/65">
          كلمة مرور جديدة <span className="text-white/50">(اختياري)</span>
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} maxLength={128} autoComplete="new-password" placeholder="اتركها فارغة دون تغيير" className="inp rounded-xl py-3" />
        </label>
        <button disabled={saving} type="submit" className="btn w-full rounded-xl py-3 font-bold"><Save size={17}/>{saving ? "جارٍ الحفظ..." : "حفظ التعديلات"}</button>
        <div ref={statusRef} aria-live="polite">
          {notice && <p role="status" className="rounded-xl bg-[#30D158]/10 p-3 text-sm text-[#30D158]">{notice}</p>}
          {error && <p role="alert" className="rounded-xl bg-[#FF453A]/10 p-3 text-sm text-[#FF8A80]">{error}</p>}
        </div>
      </form>

      <MyActivity />

      <section className="grid gap-3 sm:grid-cols-2">
        <a href="https://wa.me/963982026134?text=%D8%A3%D8%B1%D9%8A%D8%AF%20%D8%A7%D9%84%D8%AA%D9%88%D8%A7%D8%B5%D9%84%20%D9%85%D8%B9%20%D8%AF%D8%B9%D9%85%20%D8%A7%D9%84%D9%8A%D9%88%D8%B1%D9%88" target="_blank" rel="noreferrer" className="btn2 rounded-2xl p-4 font-semibold"><Headset size={18} className="text-[#30D158]"/>التواصل مع الدعم</a>
      </section>

      <button onClick={logout} className="flex w-full items-center justify-center gap-2 rounded-2xl border border-[#FF453A]/25 bg-[#FF453A]/10 p-4 font-bold text-[#FF8A80] hover:bg-[#FF453A]/15"><LogOut size={18}/>تسجيل الخروج</button>

      <div className="flex justify-center pb-2 pt-1">
        <a href="https://aboudweb.onrender.com" target="_blank" rel="noreferrer" className="developer-credit inline-flex items-center gap-1.5 text-xs transition-colors">
          <ExternalLink size={12}/> تطوير Aboud Web
        </a>
      </div>

      {pendingSrc && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="avatar-crop-title">
          <div className="menu-surface max-h-full w-full max-w-sm overflow-y-auto rounded-3xl p-5 text-white shadow-2xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 id="avatar-crop-title" className="text-lg font-bold">معاينة صورة البروفايل</h3>
              <button type="button" disabled={avatarSaving} onClick={closeCrop} className="rounded-full px-3 py-1 text-sm disabled:opacity-50">إلغاء</button>
            </div>
            <div
              className="relative mx-auto mb-4 cursor-grab touch-none overflow-hidden rounded-[72px] ring-2 ring-[#0A84FF]/60 active:cursor-grabbing"
              style={{ width: FRAME, height: FRAME, backgroundColor: CROP_BG }}
              onPointerDown={startCropDrag}
              onPointerMove={moveCropDrag}
              onPointerUp={endCropDrag}
              onPointerCancel={endCropDrag}
              onLostPointerCapture={endCropDrag}
              aria-label="اسحب الصورة لتعديل موضعها"
            >
              <img
                ref={cropImageRef}
                src={pendingSrc}
                onLoad={(e) => {
                  const { naturalWidth, naturalHeight } = e.currentTarget;
                  if (naturalWidth < 1 || naturalHeight < 1) { setCropError("تعذر عرض الصورة المختارة."); return; }
                  setCropNat({ w: naturalWidth, h: naturalHeight });
                }}
                onError={() => { setCropNat(null); setCropError("تعذر عرض الصورة المختارة. جرّب صورة بصيغة JPG أو PNG."); }}
                alt="معاينة الصورة قبل الحفظ"
                draggable={false}
                className="pointer-events-none absolute max-w-none select-none"
                style={placement
                  ? { left: placement.x, top: placement.y, width: placement.w, height: placement.h }
                  : { visibility: "hidden", left: 0, top: 0, width: FRAME, height: FRAME }}
              />
            </div>
            <p className="mb-4 text-center text-xs text-white/60">اسحب الصورة بإصبعك لتغيير موضعها، واستخدم التكبير لتقريبها. ستبقى أطراف الصورة ظاهرة قدر الإمكان.</p>
            <label className="mb-3 block space-y-2 text-sm">
              <span className="flex justify-between"><span>تكبير الصورة</span><span>{cropZoom.toFixed(1)}×</span></span>
              <input type="range" min="1" max="3" step="0.1" value={cropZoom} onChange={(e) => setCropZoom(Number(e.target.value))} className="w-full accent-[#0A84FF]" />
            </label>
            <label className="mb-4 block space-y-2 text-sm">
              <span>تحريك أفقي</span>
              <input type="range" min="-1" max="1" step="0.05" value={cropOffsetX} onChange={(e) => setCropOffsetX(Number(e.target.value))} className="w-full accent-[#0A84FF]" />
            </label>
            <label className="mb-4 block space-y-2 text-sm">
              <span>تحريك عمودي</span>
              <input type="range" min="-1" max="1" step="0.05" value={cropOffsetY} onChange={(e) => setCropOffsetY(Number(e.target.value))} className="w-full accent-[#0A84FF]" />
            </label>
            {cropError && <p role="alert" className="mb-3 rounded-xl bg-[#FF453A]/10 p-3 text-sm text-[#FF8A80]">{cropError}</p>}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" disabled={avatarSaving} onClick={closeCrop} className="rounded-xl border border-white/15 px-4 py-3 text-sm font-semibold disabled:opacity-50">إلغاء</button>
              <button type="button" disabled={!cropNat || avatarSaving} onClick={saveCroppedAvatar} className="btn rounded-xl py-3 font-bold">{avatarSaving ? "جارٍ الحفظ..." : "اعتماد الصورة"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
