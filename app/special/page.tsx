"use client";

import {useEffect, useRef, useState} from "react";
import {Camera, CheckCircle2} from "lucide-react";
import {BRANDS} from "@/lib/data";
import {useParts} from "@/lib/useParts";
import {H} from "@/components/ui";

export default function Special(){
  const {parts} = useParts();
  const [img, setImg] = useState("");
  const [imgFile, setImgFile] = useState<File | null>(null);
  const [partNumber, setPartNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [ok, setOk] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const imgRef = useRef("");
  const [err, setErr] = useState("");
  const [selectedBrand, setSelectedBrand] = useState(BRANDS[0] || "Mercedes-Benz");
  const [otherBrand, setOtherBrand] = useState("");
  const [partName, setPartName] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Release the preview object URL when the page is left.
  useEffect(() => () => { if (imgRef.current) URL.revokeObjectURL(imgRef.current); }, []);

  function clearImage() {
    if (imgRef.current) URL.revokeObjectURL(imgRef.current);
    imgRef.current = "";
    setImg("");
    setImgFile(null);
  }

  function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const allowedMime = ["image/jpeg", "image/png", "image/webp"];
    const allowedExtension = /\.(jpe?g|png|webp)$/i.test(f.name);
    const looksLikeImage = allowedMime.includes(f.type) || (!f.type && allowedExtension);
    if (!looksLikeImage) { setErr("اختر ملف صورة صالحاً."); return; }
    if (f.size > 5 * 1024 * 1024) { setErr("حجم الصورة يجب ألا يتجاوز 5 ميغابايت."); return; }
    setErr("");
    if (imgRef.current) URL.revokeObjectURL(imgRef.current);
    imgRef.current = URL.createObjectURL(f);
    setImg(imgRef.current);
    setImgFile(f);
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submittingRef.current) return; // ignore double taps
    setShowSuggestions(false);
    setErr("");
    if (!partName.trim()) { setErr("يرجى إدخال اسم القطعة."); return; }
    if (selectedBrand === "أخرى" && !otherBrand.trim()) { setErr("يرجى كتابة نوع السيارة."); return; }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("brand", selectedBrand);
      fd.append("otherBrand", otherBrand.trim());
      fd.append("partName", partName.trim());
      fd.append("partNumber", partNumber.trim());
      fd.append("notes", notes.trim());
      if (imgFile) fd.append("image", imgFile);
      const res = await fetch("/api/special-requests", { method: "POST", body: fd });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        // Nothing the user typed is cleared, so they can retry.
        setErr(data?.error || "تعذر إرسال الطلب، حاول مجدداً.");
        return;
      }
      setOk(true);
    } catch {
      setErr("تعذر الاتصال بالخادم. تحقق من الإنترنت وحاول مجدداً.");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  // اقتراح أسماء القطع الموجودة في بيانات المخزون أثناء الكتابة
  const suggestions = Array.from(new Set(
    parts
      .map(p => p.name)
      .filter(name => partName.trim().length > 0 && name.includes(partName.trim()))
  ));

  if(ok) return <div className="mx-auto mt-16 max-w-md rounded-[24px] border border-white/[0.14] bg-gradient-to-b from-white/[0.09] to-white/[0.03] p-6 text-center backdrop-blur-2xl saturate-150 shadow-[0_10px_32px_rgba(0,0,0,0.45),inset_0_1px_0_0_rgba(255,255,255,0.25)] transition-all duration-300">
    <CheckCircle2 className="mx-auto mb-3 text-[#30D158]" size={48}/>
    <h2 className="text-xl font-semibold tracking-tight text-white">وصلنا طلبك</h2>
    <p className="mt-1 text-sm text-white/65">سنؤمّن القطعة ونرسل لك السعر.</p>
    <button className="mt-4 inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-b from-[#3A9BFD] to-[#007AFF] px-4 py-2.5 text-sm font-semibold text-snow shadow-[0_4px_20px_rgba(0,122,255,0.45),inset_0_1px_1px_rgba(255,255,255,0.45)] transition-all hover:brightness-110 active:scale-[0.97]" onClick={()=>{setOk(false); clearImage(); setPartName(""); setPartNumber(""); setNotes(""); setErr(""); setOtherBrand(""); setShowSuggestions(false); setSelectedBrand(BRANDS[0] || "Mercedes-Benz");}}>طلب جديد</button>
  </div>;

  return(<>
    <H t="الطلبات الخاصة" s="القطعة غير متوفرة؟ نؤمّنها لك ونسعّرها ونسلّمها، حتى من خارج البلد"/>

    <form onSubmit={submit} className="mx-auto grid max-w-2xl gap-5 rounded-[24px] border border-white/[0.14] bg-gradient-to-b from-white/[0.09] to-white/[0.03] p-5 backdrop-blur-2xl saturate-150 shadow-[0_10px_32px_rgba(0,0,0,0.45),inset_0_1px_0_0_rgba(255,255,255,0.25)] transition-all duration-300">
      {/* اختيار الماركة مع خيار أخرى */}
      <div className="grid grid-cols-2 gap-1.5 rounded-2xl border border-white/[0.08] bg-black/40 p-1.5 backdrop-blur-xl shadow-inner sm:grid-cols-3">
        {[...BRANDS, "أخرى"].map(b => {
          const isSelected = selectedBrand === b;
          return (
            <button
              type="button"
              key={b}
              onClick={() => setSelectedBrand(b)}
              className={`rounded-xl border p-3 text-center text-sm transition-all ${
                isSelected
                  ? "border-white/[0.22] bg-white/[0.15] font-semibold text-white backdrop-blur-md shadow-[0_4px_12px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.3)]"
                  : "border-transparent font-medium text-white/60 hover:bg-white/[0.05] hover:text-white"
              }`}
            >
              {b}
            </button>
          );
        })}
      </div>

      {selectedBrand === "أخرى" && (
        <input
          className="w-full rounded-2xl border border-white/[0.10] bg-black/35 px-3 py-2.5 text-sm text-white outline-none backdrop-blur-xl placeholder:text-white/40 shadow-[inset_0_2px_4px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.1)] transition-all focus:border-[#0A84FF] focus:ring-2 focus:ring-[#0A84FF]/25"
          placeholder="اكتب نوع السيارة (مثال: بورش، سكودا...)"
          value={otherBrand}
          onChange={e=>setOtherBrand(e.target.value)}
          required
        />
      )}

      {/* حقل اسم القطعة مع الاقتراحات الفورية */}
      <div className="relative">
        <input
          className="w-full rounded-2xl border border-white/[0.10] bg-black/35 px-3 py-2.5 text-sm text-white outline-none backdrop-blur-xl placeholder:text-white/40 shadow-[inset_0_2px_4px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.1)] transition-all focus:border-[#0A84FF] focus:ring-2 focus:ring-[#0A84FF]/25"
          placeholder="اسم القطعة (اكتب للبحث عن اقتراحات...)"
          value={partName}
          onChange={e=>{
            setPartName(e.target.value);
            setShowSuggestions(true);
          }}
          onFocus={()=>setShowSuggestions(true)}
          onBlur={()=>setTimeout(()=>setShowSuggestions(false), 150)}
          autoComplete="off"
          required
        />

        {showSuggestions && suggestions.length > 0 && (
          <div className="menu-surface absolute inset-x-0 top-full z-10 mt-1 max-h-48 overflow-y-auto rounded-2xl">
            {suggestions.map(item => (
              <button
                type="button"
                key={item}
                onMouseDown={e=>e.preventDefault()}
                onClick={()=>{
                  setPartName(item);
                  setShowSuggestions(false);
                }}
                className="block w-full cursor-pointer px-4 py-2.5 text-right text-sm text-white/80 transition-all hover:bg-white/[0.08] hover:text-white"
              >
                {item}
              </button>
            ))}
          </div>
        )}
      </div>

      <input className="w-full rounded-2xl border border-white/[0.10] bg-black/35 px-3 py-2.5 text-sm text-white outline-none backdrop-blur-xl placeholder:text-white/40 shadow-[inset_0_2px_4px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.1)] transition-all focus:border-[#0A84FF] focus:ring-2 focus:ring-[#0A84FF]/25" dir="ltr" maxLength={64} value={partNumber} onChange={e=>setPartNumber(e.target.value)} placeholder="رقم القطعة أو رقم الشاصي (VIN)"/>

      <textarea className="w-full rounded-2xl border border-white/[0.10] bg-black/35 px-3 py-2.5 text-sm text-white outline-none backdrop-blur-xl placeholder:text-white/40 shadow-[inset_0_2px_4px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.1)] transition-all focus:border-[#0A84FF] focus:ring-2 focus:ring-[#0A84FF]/25" rows={3} maxLength={1000} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="ملاحظات: الموديل، السنة، المحرك…"/>

      <label className="flex h-44 cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border-2 border-dashed border-white/[0.16] bg-black/35 text-sm text-white/65 backdrop-blur-xl shadow-[inset_0_2px_4px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.1)] transition-all hover:border-[#0A84FF] hover:text-white">
        {img
          ? <img src={img} alt="معاينة صورة القطعة" className="h-full w-full object-contain"/>
          : <><Camera className="text-[#0A84FF]"/>التقط صورة أو اختر صورة من المعرض</>
        }
        <input
          type="file"
          accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
          hidden
          onChange={pickImage}
        />
      </label>
      <p className="-mt-3 text-xs text-white/55">يمكنك اختيار صورة محفوظة على الهاتف أو التقاط صورة جديدة من واجهة اختيار الصور.</p>

      {err && <p role="alert" className="-mt-1 rounded-2xl border border-[#FF453A]/40 bg-[#FF453A]/15 p-3 text-sm text-[#FF6961]">{err}</p>}

      <button type="submit" disabled={submitting} className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-b from-[#3A9BFD] to-[#007AFF] px-4 py-2.5 text-sm font-semibold text-snow shadow-[0_4px_20px_rgba(0,122,255,0.45),inset_0_1px_1px_rgba(255,255,255,0.45)] transition-all hover:brightness-110 active:scale-[0.97] disabled:opacity-50">{submitting ? "جارٍ الإرسال..." : "إرسال الطلب"}</button>
    </form>
  </>);
}