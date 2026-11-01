"use client";
import { useState } from "react";
import { Check, PackageCheck, Truck, XCircle, Hand } from "lucide-react";
import { api, ConfirmModal, toast } from "./kit";
import { ORDER_STATUS_LABEL, ORDER_TRANSITIONS, type OrderStatus, type PayMethod } from "@/lib/status";
type Props = {
 order:{id:string;order_number:number|null;status:OrderStatus;pay_method:PayMethod;claimed_by?:string|null;claimed_at?:string|null;can_claim?:boolean;can_update?:boolean;claimed_worker?:{id:string;name:string;phone:string}|null};
 onDone:()=>void;cancelLabel?:string;approveLabel?:string;compact?:boolean;allowCancel?:boolean;
};
const NEXT_LABEL:Partial<Record<OrderStatus,string>>={approved:"موافقة على الطلب",shipped:"تأكيد الشحن",delivered:"تأكيد التسليم"};
const NEXT_ICON:Partial<Record<OrderStatus,typeof Check>>={approved:Check,shipped:Truck,delivered:PackageCheck};
export default function OrderActions({order,onDone,cancelLabel="إلغاء الطلب",approveLabel,compact,allowCancel=true}:Props){
 const [target,setTarget]=useState<OrderStatus|null>(null),[busy,setBusy]=useState(false);
 async function claim(){
  if(busy)return;setBusy(true);
  const r=await api(`/api/admin/orders/${order.id}/claim`,{method:"POST"});
  setBusy(false);if(!r.ok){toast(r.error,"err");return;}
  toast(`تم استلام الطلب #${order.order_number??""} بنجاح`);onDone();
 }
 async function run(status:OrderStatus,reason:string){
  setBusy(true);const r=await api(`/api/admin/orders/${order.id}/status`,{method:"POST",body:{status,note:reason||undefined}});
  setBusy(false);if(!r.ok){toast(r.error,"err");return;}
  toast(`طلب #${order.order_number??""}: ${ORDER_STATUS_LABEL[status]}`);setTarget(null);onDone();
 }
 const isClaimable=order.can_claim===true;
 const canUpdate=order.can_update!==false;
 if(isClaimable)return <button type="button" disabled={busy} onClick={claim} className="btn"><Hand size={16}/>{busy?"جارٍ الاستلام...":"تأكيد استلام الطلبية"}</button>;
 if(!canUpdate){
  const worker=order.claimed_worker;
  return <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/65">
   {worker?<>استلمها الموظف <b>{worker.name}</b> · رقم الموظف {worker.phone}</>:"هذه الطلبية محجوزة لموظف آخر"}
  </div>;
 }
 const options=(ORDER_TRANSITIONS[order.status]??[]).filter(s=>allowCancel||s!=="cancelled");
 if(!options.length)return null;
 const message=(s:OrderStatus)=>{
  if(s==="approved")return <ul className="list-disc space-y-1 ps-5"><li>سيتم خصم كميات القطع من المخزون.</li>{order.pay_method==="debt"&&<li>سيُضاف المبلغ إلى دين الورشة ويُسجَّل في دفتر الدين.</li>}{order.pay_method==="sham"&&<li>تأكد أولاً من مطابقة إيصال شام كاش للمبلغ.</li>}</ul>;
  if(s==="delivered")return "سيُغلق الطلب نهائياً، وتُحتسب عمولة المسوّق 2% إن كانت الورشة مُحالة عبر مسوّق.";
  if(s==="cancelled")return order.status==="pending"?"سيُلغى الطلب ويظهر السبب الذي تكتبه للعميل.":"سيُلغى الطلب، وتُعاد الكميات إلى المخزون، ويُعكس قيد الدين إن كان الدفع بالدين. يظهر السبب للعميل.";
  return "سيتم تحديث حالة الطلب.";
 };
 return <>
  <div className="flex flex-wrap gap-2">{options.map(s=>s==="cancelled"
   ?<button key={s} type="button" onClick={()=>setTarget(s)} className={`inline-flex items-center justify-center gap-1.5 rounded-full border border-[#FF453A]/40 bg-[#FF453A]/10 px-4 text-sm font-semibold text-[#FF6961] transition hover:bg-[#FF453A]/20 ${compact?"py-1.5":"py-2.5"}`}><XCircle size={16}/>{cancelLabel}</button>
   :(()=>{const Icon=NEXT_ICON[s]??Check;return <button key={s} type="button" onClick={()=>setTarget(s)} className={`btn ${compact?"!py-1.5":""}`}><Icon size={16}/>{s==="approved"&&approveLabel?approveLabel:NEXT_LABEL[s]??ORDER_STATUS_LABEL[s]}</button>})()
  )}</div>
  <ConfirmModal open={!!target} busy={busy} danger={target==="cancelled"} title={target==="cancelled"?`${cancelLabel} #${order.order_number??""}`:`${target?NEXT_LABEL[target]??"":""} #${order.order_number??""}`} message={target?message(target):undefined} reasonLabel={target==="cancelled"?"سبب الإلغاء / الرفض (يظهر للعميل)":undefined} reasonRequired confirmLabel={target==="cancelled"?"تأكيد":"تأكيد التنفيذ"} onClose={()=>setTarget(null)} onConfirm={reason=>target&&run(target,reason)}/>
 </>;
}