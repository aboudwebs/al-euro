"use client";
import { useState } from "react";
import { Check, RefreshCw, X } from "lucide-react";
import { api, Badge, Empty, ErrorBox, fmtDateTime, money, PageHead, Spinner, toast, useApi } from "@/components/admin/kit";

type PayoutRequest = { id:string; marketer_id:string; amount:number; payout_details:string; status:"pending"|"paid"|"rejected"; admin_note:string|null; created_at:string; processed_at:string|null; commission_count:number; marketer:{id:string;name:string;phone:string}|null };
export default function MarketerPayoutsPage(){
 const {data,error,loading,reload}=useApi<{requests:PayoutRequest[]}>("/api/admin/commissions/payout-requests");
 const [busy,setBusy]=useState<string|null>(null);
 async function process(r:PayoutRequest,action:"paid"|"rejected"){
  if(busy)return;
  const prompt=action==="rejected"?"سبب رفض الطلب (اختياري)":"ملاحظة التحويل (اختياري)";
  const note=window.prompt(prompt)??"";
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
  <PageHead title="طلبات سحب العمولات" sub="راجع بيانات التحويل، ثم سجّل الدفع بعد تنفيذه فعلياً أو ارفض الطلب.">
   <button type="button" className="btn2" onClick={reload}><RefreshCw size={15}/>تحديث</button>
  </PageHead>
  {error&&<ErrorBox message={error} onRetry={reload}/>}
  {loading&&!data&&<Spinner/>}
  {data&&!requests.length&&<Empty>لا توجد طلبات سحب حتى الآن.</Empty>}
  <div className="grid gap-3 xl:grid-cols-2">
   {requests.map(r=><article key={r.id} className="card space-y-3">
    <header className="flex items-start justify-between gap-3">
     <div><h3 className="font-semibold text-white">{r.marketer?.name??"مسوّق غير معروف"}</h3><p className="text-xs text-white/50" dir="ltr">{r.marketer?.phone??"—"}</p></div>
     <div className="text-end"><b className="text-xl text-gold">{money(r.amount)}</b><div><Badge tone={r.status==="pending"?"warn":r.status==="paid"?"ok":"err"}>{r.status==="pending"?"بانتظار المعالجة":r.status==="paid"?"مدفوع":"مرفوض"}</Badge></div></div>
    </header>
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
     <p className="mb-1 text-xs text-white/45">بيانات استلام التحويل</p>
     <p className="whitespace-pre-wrap break-words text-sm text-white">{r.payout_details}</p>
    </div>
    <p className="text-xs text-white/45">{fmtDateTime(r.created_at)} · {r.commission_count} عمولة مرتبطة</p>
    {r.admin_note&&<p className="text-xs text-white/65">ملاحظة الإدارة: {r.admin_note}</p>}
    {r.status==="pending"&&<div className="flex flex-wrap gap-2">
     <button type="button" className="btn" disabled={busy===r.id} onClick={()=>process(r,"paid")}><Check size={15}/>تم التحويل فعلياً</button>
     <button type="button" className="btn2 !text-[#FF6961]" disabled={busy===r.id} onClick={()=>process(r,"rejected")}><X size={15}/>رفض الطلب</button>
    </div>}
   </article>)}
  </div>
 </>;
}
