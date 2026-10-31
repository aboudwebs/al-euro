"use client";
import {useEffect, useMemo, useState} from "react";
import {Wallet,Clock} from "lucide-react";
import {TIERS,usd} from "@/lib/data";
import {H,Row} from "@/components/ui";

type Order = {id:string;order_number:number|string|null;total_amount:number|string;pay_method:string;status:string;created_at:string;items:unknown};
type Ledger = {id:string;order_id:string|null;tx_type:string;amount:number|string;balance_after:number|string;note:string|null;created_at:string};
type Dashboard = {
  user:{name:string;tier:string|null;debt_limit:number|string|null;debt_balance:number|string|null;cashback_balance:number|string|null};
  orders:Order[];
  ledger:Ledger[];
};

const money = (n: unknown) => usd(Number(n) || 0);
const date = (s: string) => new Date(s).toLocaleDateString("ar-SY",{day:"2-digit",month:"2-digit",year:"numeric"});
const statusLabel: Record<string,string> = {pending:"قيد المراجعة",approved:"تمت الموافقة",shipped:"جاهز للاستلام",delivered:"مسلّم",cancelled:"ملغى"};

function Tbl({t,rows,c}:{t:string;rows:Order[];c:string}) {
  return <div className="rounded-[24px] border border-white/[0.14] bg-gradient-to-b from-white/[0.09] to-white/[0.03] p-4 backdrop-blur-2xl saturate-150 shadow-[0_10px_32px_rgba(0,0,0,0.45),inset_0_1px_0_0_rgba(255,255,255,0.25)]">
    <h3 className={`mb-2 font-semibold tracking-tight ${c}`}>{t}</h3>
    {!rows.length ? <p className="py-3 text-sm text-white/45">لا توجد طلبات ضمن هذه الفئة حتى الآن.</p> : rows.map(o=>
      <Row key={o.id}>
        <span>
          طلب #{o.order_number ?? o.id.slice(0,8)}
          <small className="block text-white/45">{date(o.created_at)} · {statusLabel[o.status] ?? o.status}</small>
        </span>
        <b className="font-semibold text-white">{money(o.total_amount)}</b>
      </Row>
    )}
    <p className="mt-2 text-end text-sm text-white/65">إجمالي الطلبات المعروضة: {money(rows.reduce((s,o)=>s+Number(o.total_amount||0),0))}</p>
  </div>;
}

export default function W(){
  const [data,setData] = useState<Dashboard|null>(null);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState("");
  useEffect(()=>{
    let alive=true;
    fetch("/api/workshop/dashboard",{cache:"no-store"})
      .then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error||"تعذر تحميل لوحة الورشة");return d as Dashboard;})
      .then(d=>{if(alive)setData(d);})
      .catch(e=>{if(alive)setError(e instanceof Error?e.message:"تعذر تحميل البيانات");})
      .finally(()=>{if(alive)setLoading(false);});
    return()=>{alive=false;};
  },[]);

  const orders=data?.orders??[];
  const cash=useMemo(()=>orders.filter(o=>o.pay_method!=="debt"&&o.status!=="cancelled").slice(0,5),[orders]);
  const debt=useMemo(()=>orders.filter(o=>o.pay_method==="debt"&&o.status!=="cancelled").slice(0,5),[orders]);
  const spend=orders.filter(o=>["approved","shipped","delivered"].includes(o.status)).reduce((s,o)=>s+Number(o.total_amount||0),0);
  const tierIndex=TIERS.reduce((a,t,k)=>spend>=t.min?k:a,0);
  const tier=TIERS[tierIndex], next=TIERS[tierIndex+1];
  const pct=next?Math.min(100,Math.round(((spend-tier.min)/(next.min-tier.min))*100)):100;
  const balance=Number(data?.user.debt_balance)||0;
  const lastDebt=data?.ledger.find(l=>l.tx_type==="debit"&&Number(l.balance_after)>0);
  const daysLeft=lastDebt?Math.max(0,30-Math.floor((Date.now()-new Date(lastDebt.created_at).getTime())/86400000)):null;

  return <>
    <H t="لوحة الورشة" s={data?.user.name ?? "ملخص حساب الورشة وطلباتها"}/>
    {error&&<div role="alert" className="mb-4 rounded-2xl border border-[#FF453A]/40 bg-[#FF453A]/10 p-3 text-sm text-[#FF9F0A]">{error}</div>}
    {loading&&<p className="mb-4 text-sm text-white/60">جارٍ تحميل بيانات حسابك الفعلية...</p>}
    {!loading&&!error&&data&&<>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-[24px] border border-white/[0.14] bg-gradient-to-b from-white/[0.09] to-white/[0.03] p-4 backdrop-blur-2xl saturate-150 shadow-[0_10px_32px_rgba(0,0,0,0.45),inset_0_1px_0_0_rgba(255,255,255,0.25)]">
          <Wallet className="mb-2 text-[#0A84FF]"/>
          <p className="text-sm text-white/65">رصيد الكاش باك</p>
          <b className="text-3xl font-semibold tracking-tight text-white">{money(data.user.cashback_balance)}</b>
          <p className="mt-1 text-xs text-white/45">الرصيد المسجّل على حسابك لدى الإدارة.</p>
        </div>
        <div className={`rounded-[24px] border bg-gradient-to-b from-white/[0.09] to-white/[0.03] p-4 backdrop-blur-2xl saturate-150 shadow-[0_10px_32px_rgba(0,0,0,0.45),inset_0_1px_0_0_rgba(255,255,255,0.25)] ${balance>0&&daysLeft!==null&&daysLeft<=7?"border-[#FF453A]/60":"border-white/[0.14]"}`}>
          <Clock className={`mb-2 ${balance>0&&daysLeft!==null&&daysLeft<=7?"text-[#FF453A]":"text-[#0A84FF]"}`}/>
          <p className="text-sm text-white/65">الدين المستحق</p>
          <b className="text-3xl font-semibold tracking-tight text-white">{money(balance)}</b>
          <p className="mt-1 text-xs text-white/45">{balance<=0?"لا يوجد دين مسجّل عليك":daysLeft===null?"موعد التسديد غير متاح حالياً":`الوقت المتبقي من آخر قيد دين: ${daysLeft} يومًا`}</p>
          {balance>0&&daysLeft!==null&&<div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/40"><div className={`h-full rounded-full ${daysLeft<=7?"bg-[#FF453A]":"bg-gradient-to-r from-[#3A9BFD] to-[#007AFF]"}`} style={{width:`${((30-daysLeft)/30)*100}%`}}/></div>}
        </div>
      </div>
      <div className="my-4 rounded-[24px] border border-white/[0.14] bg-gradient-to-b from-white/[0.09] to-white/[0.03] p-4 backdrop-blur-2xl saturate-150 shadow-[0_10px_32px_rgba(0,0,0,0.45),inset_0_1px_0_0_rgba(255,255,255,0.25)]">
        <div className="mb-2 flex flex-wrap justify-between gap-1 text-sm text-white">
          <span>مرتبتك التقديرية حسب المشتريات المعتمدة: <b className="font-semibold text-[#0A84FF]">{tier.n}</b> · كاش باك {tier.cb}</span>
          {next&&<span className="text-white/65">باقي {money(next.min-spend)} للوصول إلى {next.n}</span>}
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-black/40 shadow-inner"><div className="h-full rounded-full bg-gradient-to-l from-[#007AFF] to-[#3A9BFD] transition-all" style={{width:`${pct}%`}}/></div>
        <div className="mt-3 grid grid-cols-5 text-center text-[11px]">{TIERS.map((t,k)=><span key={t.n} className={k<=tierIndex?"font-semibold text-[#0A84FF]":"text-white/45"}>{t.n}</span>)}</div>
        <p className="mt-2 text-xs text-white/40">المرتبة محسوبة من الطلبات المعتمدة الظاهرة في آخر 100 طلب، وقد تختلف عن المرتبة المعتمدة في حساب الإدارة.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2"><Tbl t="طلبات الدفع النقدي / شام كاش" rows={cash} c="text-[#30D158]"/><Tbl t="طلبات دفتر الدين" rows={debt} c="text-[#FF9F0A]"/></div>
      <div className="mt-4 rounded-[24px] border border-white/[0.14] bg-gradient-to-b from-white/[0.09] to-white/[0.03] p-4">
        <h3 className="mb-2 font-semibold text-white">آخر حركات دفتر الدين</h3>
        {!(data.ledger?.length)&&<p className="text-sm text-white/45">لا توجد حركات دين مسجّلة.</p>}
        {(data.ledger??[]).slice(0,5).map(l=><Row key={l.id}><span>{l.note|| (l.tx_type==="payment"?"تسديد دين":"قيد دين")}<small className="block text-white/45">{date(l.created_at)} · {l.tx_type==="payment"?"تسديد":"إضافة دين"}</small></span><b className="text-white">{money(l.amount)}</b></Row>)}
      </div>
    </>}
  </>;
}
