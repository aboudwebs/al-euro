"use client";
import { useState } from "react";
import { Check, Copy, RefreshCw, X } from "lucide-react";
import { api, Badge, Empty, ErrorBox, fmtDateTime, money, PageHead, Spinner, toast, useApi } from "@/components/admin/kit";

type PayoutRequest = { id:string; marketer_id:string; amount:number; payout_details:string|null; status:"pending"|"paid"|"rejected"; admin_note:string|null; created_at:string; processed_at:string|null; processed_by:string|null; processed_by_name:string|null; commission_count:number; marketer:{id:string;name:string;phone:string}|null };
function payoutFields(details:string|null){
 const normalized=(details??"").replace(/\\n/g,"\n");
 const lines=normalized.split(/\r?\n/);
 const read=(labels:string[])=>{
  const line=lines.find(value=>labels.some(label=>value.trim().toLowerCase().startsWith(label)));
  return line ? line.trim().replace(/^[^:：]+[:：]\s*/,"").trim() : "";
 };
 return {name:read(["الاسم الكامل:","الاسم:"]),wallet:read(["عنوان المحفظة:","المحفظة:","عنوان المحفظة الرقمية:"])};
}
function CopyField({label,value}:{label:string;value:string}){
 return <div className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/10 px-3 py-2.5">
  <div className="min-w-0 flex-1"><p className="mb-1 text-xs text-white/45">{label}</p><p dir="auto" className="break-all text-sm font-medium text-white">{value||"—"}</p></div>
  <button type="button" className="btn2 !shrink-0 !px-2.5 !py-2 text-xs" disabled={!value} title={`نسخ ${label}`} aria-label={`نسخ ${label}`} onClick={async()=>{try{await navigator.clipboard.writeText(value);toast(`تم نسخ ${label}`);}catch{toast("تعذّر النسخ من المتصفح","err");}}}><Copy size={14}/>نسخ</button>
 </div>;
}
export default function MarketerPayoutsPage(){
 const {data,error,loading,reload}=useApi<{requests:PayoutRequest[]}>("/api/admin/commissions/payout-requests");
 const [busy,setBusy]=useState<string|null>(null);
 async function process(r:PayoutRequest,action:"paid"|"rejected"){
  if(busy)return;
  const prompt=action==="rejected"?"سبب رفض الطلب (اختياري)":"ملاحظة التحويل (اختياري)";
  const entered=window.prompt(prompt);
  if(entered===null)return;
  const note=entered;
  if(action==="rejected"&&!window.confirm("تأكيد رفض طلب السحب وإعادة العمولات إلى الرصيد المتاح؟"))return;
  if(action==="paid"&&!window.confirm("هل تم تحويل المبلغ فعلياً إلى المسوّق؟ سيتم تسجيل العمولات كمدفوعة."))return;
  setBusy(r.id);
  const result=await api("/api/admin/commissions/payout-requests",{method:"POST",body:{id:r.id,action,note}});
  setBusy(null);
  if(!result.ok)return toast(result.error,"err");
  toast(action==="paid"?"تم تسجيل طلب التحويل كمدفوع":"تم رفض الطلب وإعادة العمولات للرصيد المتاح");
  reload();
 }
 const requests=data?.requests??[];
 return <>
  <PageHead title="طلبات سحب العمولات" sub="راجع بيانات السحب قبل المعالجة. أكّد الدفع بعد تنفيذه فعلياً.">
   <button type="button" className="btn2" onClick={reload}><RefreshCw size={15}/>تحديث</button>
  </PageHead>
  {error&&<ErrorBox message={error} onRetry={reload}/>}
  {loading&&!data&&<Spinner/>}
  {data&&!requests.length&&<Empty>لا توجد طلبات سحب حتى الآن.</Empty>}
  <div className="grid gap-3 xl:grid-cols-2">
   {requests.map(r=>{
    const fields=payoutFields(r.payout_details);
    return <article key={r.id} className="card space-y-3">
     <header className="flex items-start justify-between gap-3">
      <div><h3 className="font-semibold text-white">{r.marketer?.name??"مسوّق غير معروف"}</h3><p className="text-xs text-white/50" dir="ltr">{r.marketer?.phone??"—"}</p></div>
      <div className="text-end"><b className="text-xl text-gold">{money(r.amount)}</b><div><Badge tone={r.status==="pending"?"warn":r.status==="paid"?"ok":"err"}>{r.status==="pending"?"بانتظار المعالجة":r.status==="paid"?"مدفوع":"مرفوض"}</Badge></div></div>
     </header>
     <section className="space-y-2 rounded-xl border border-white/10 bg-white/[0.04] p-3">
      <p className="text-xs font-semibold text-white/55">بيانات السحب</p>
      <CopyField label="الاسم الكامل" value={fields.name}/>
      <CopyField label="عنوان المحفظة" value={fields.wallet}/>
      <CopyField label="المبلغ المطلوب" value={String(r.amount)}/>
      {!fields.name&&!fields.wallet&&r.payout_details?.trim()&&<p className="whitespace-pre-wrap break-all text-xs text-white/55">{r.payout_details}</p>}
      {!r.payout_details?.trim()&&<p className="text-xs text-white/45">استلام حضوري من مقر الشركة — لا توجد بيانات محفظة</p>}
     </section>
     <p className="text-xs text-white/45">{fmtDateTime(r.created_at)} · {r.commission_count} عمولة مرتبطة</p>
     {r.admin_note&&<p className="text-xs text-white/65">ملاحظة الإدارة: {r.admin_note}</p>}
     {r.processed_at&&<p className="text-xs text-white/45">تمت المعالجة: {fmtDateTime(r.processed_at)} · المسؤول: {r.processed_by_name??"—"}</p>}
     {r.status==="pending"&&<div className="flex flex-wrap gap-2">
      <button type="button" className="btn" disabled={busy===r.id} onClick={()=>process(r,"paid")}><Check size={15}/>تم التحويل فعلياً</button>
      <button type="button" className="btn2 !text-[#FF6961]" disabled={busy===r.id} onClick={()=>process(r,"rejected")}><X size={15}/>رفض الطلب</button>
     </div>}
    </article>;
   })}
  </div>
 </>;
}
