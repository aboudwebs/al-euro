"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowRight, Boxes, ClipboardList, Package } from "lucide-react";
import { Badge, ErrorBox, fmtDateTime, money, PageHead, Spinner, useApi } from "@/components/admin/kit";
type Activity = {
 worker:{id:string;name:string;phone:string;is_active:boolean};
 orders:{id:string;order_number:number;status:string;total_amount:number;created_at:string;claimed_at:string|null;employee_sequence:number;items:{name:string;qty:number}[]}[];
 inventory:{id:string;part_id:string;movement_type:string;quantity_before:number;quantity_after:number;quantity_delta:number;created_at:string;part:{name:string;brand:string;oem_number:string}|null}[];
 inventory_totals:{part_id:string;name:string;brand:string;total_added:number;operations:number}[];
 stats:{orders_count:number;inventory_operations:number;units_added:number};
};
const labels:Record<string,string>={pending:"قيد الانتظار",approved:"تمت الموافقة",shipped:"تم الشحن",delivered:"تم التسليم",cancelled:"ملغي"};
export default function WorkerActivityPage(){
 const params=useParams<{id:string}>();const {data,error,loading,reload}=useApi<Activity>(params?.id?"/api/admin/workers/"+params.id+"/activity":null);
 if(loading&&!data)return <Spinner/>;if(error)return <ErrorBox message={error} onRetry={reload}/>;if(!data)return <Spinner/>;
 const {worker,orders,inventory,inventory_totals,stats}=data;
 return <div className="space-y-5">
  <PageHead title={worker.name} sub={"رقم الموظف: "+worker.phone+" · "+(worker.is_active?"حساب نشط":"حساب موقوف")}><Link href="/admin/workers" className="btn2"><ArrowRight size={15}/>رجوع</Link></PageHead>
  <div className="grid gap-3 sm:grid-cols-3">
   <div className="card"><p className="text-sm text-white/55">الطلبيات المستلمة</p><b className="mt-2 block text-2xl text-white">{stats.orders_count}</b></div>
   <div className="card"><p className="text-sm text-white/55">عمليات المخزون</p><b className="mt-2 block text-2xl text-white">{stats.inventory_operations}</b></div>
   <div className="card"><p className="text-sm text-white/55">الوحدات المضافة</p><b className="mt-2 block text-2xl text-white">{stats.units_added}</b></div>
  </div>
  <section className="card space-y-3"><h2 className="flex items-center gap-2 font-semibold text-white"><ClipboardList size={17}/>سجل الطلبيات</h2>
   {!orders.length?<p className="text-sm text-white/50">لا توجد طلبيات مستلمة.</p>:orders.map(o=><article key={o.id} className="rounded-xl border border-white/10 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><b className="text-white">سجل الموظف #{o.employee_sequence} · طلب #{o.order_number}</b><Badge tone="info">{labels[o.status]??o.status}</Badge></div>
    <p className="mt-1 text-xs text-white/50">الاستلام: {fmtDateTime(o.claimed_at??o.created_at)} · إنشاء الطلب: {fmtDateTime(o.created_at)}</p>
    <p className="mt-2 text-sm text-white/80">{(o.items??[]).map(i=>i.name+" × "+i.qty).join("، ")}</p><b className="mt-1 block text-gold">{money(o.total_amount)}</b>
   </article>)}
  </section>
  <section className="card space-y-3"><h2 className="flex items-center gap-2 font-semibold text-white"><Boxes size={17}/>إجمالي المخزون المضاف حسب القطعة</h2>
   {!inventory_totals.length?<p className="text-sm text-white/50">لا توجد حركات إدخال مخزون.</p>:<div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-white/10 text-white/50"><th className="py-2 text-start">القطعة</th><th>العمليات</th><th className="text-end">الكمية المضافة</th></tr></thead><tbody>{inventory_totals.map(p=><tr key={p.part_id} className="border-b border-white/[0.06]"><td className="py-2 text-white">{p.name}<small className="block text-white/45">{p.brand}</small></td><td className="text-center text-white/70">{p.operations}</td><td className="text-end font-semibold text-white">{p.total_added}</td></tr>)}</tbody></table></div>}
  </section>
  <section className="card space-y-3"><h2 className="flex items-center gap-2 font-semibold text-white"><Package size={17}/>سجل كل حركة مخزون</h2>
   {!inventory.length?<p className="text-sm text-white/50">لا توجد حركات مسجلة.</p>:inventory.map(m=><article key={m.id} className="rounded-xl border border-white/10 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><b className="text-white">{m.part?.name??m.part_id}</b><Badge tone={m.quantity_delta>0?"ok":"warn"}>{m.movement_type==="initial_stock"?"مخزون أولي":m.movement_type==="restock"?"إضافة مخزون":"تعديل مخزون"}</Badge></div>
    <p className="mt-1 text-xs text-white/50">{m.part?.brand??""} {m.part?.oem_number??""} · {fmtDateTime(m.created_at)}</p>
    <p className="mt-2 text-sm text-white/80">قبل: {m.quantity_before} · بعد: {m.quantity_after} · الفرق: <b>{m.quantity_delta>0?"+":""}{m.quantity_delta}</b></p>
   </article>)}
  </section>
 </div>;
}