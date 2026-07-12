import { useMemo, useRef, useState } from "react";
import { Search, Phone, Check, Loader2, ShieldCheck, Star } from "lucide-react";
import PageLayout from "@/components/PageLayout";
import { Breadcrumbs, SEOHead, trackEvent, trackPhoneClick } from "@/components/SEO";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import FAQPageSchema, { TIRE_BUYING_FAQ } from "@/components/FAQPageSchema";
import { trpc } from "@/lib/trpc";
import { BUSINESS } from "@shared/business";
import { OrderModal } from "./TireFinderLegacy";

const POPULAR = ["205/55R16","215/60R16","225/65R17","235/65R18","215/55R17","225/60R18"];
const normalize = (v:string) => v.trim().toUpperCase().replace(/[^0-9R]/g,"");

export default function TireFinderV2(){
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const [input,setInput] = useState(params.get("size") || "");
  const [size,setSize] = useState(params.get("size") || "");
  const [qty,setQty] = useState(4);
  const [selected,setSelected] = useState<any>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const query = trpc.gatewayTire.publicSearch.useQuery(
    { size: normalize(size), category: "all", sortBy: "price-low" },
    { enabled: normalize(size).length >= 7 }
  );
  const tires = query.data?.tires || [];
  const submit = (value=input) => {
    const clean=value.trim();
    if(normalize(clean).length < 7) return;
    setInput(clean); setSize(clean);
    const p=new URLSearchParams(window.location.search); p.set("size",clean);
    window.history.replaceState({},"",`${window.location.pathname}?${p}`);
    trackEvent("tire_search_submitted",{size:clean,source:"tires_v2"});
    setTimeout(()=>resultsRef.current?.scrollIntoView({behavior:"smooth",block:"start"}),100);
  };
  return <PageLayout showChat={true}>
    <SEOHead title="Tires in Cleveland & Euclid | New & Used, Installed | Nick's" description="Shop new and used tires by size. See estimated installed pricing, choose your tire, and request it online. Nick's Tire & Auto is open 7 days on Euclid Ave." canonicalPath="/tires" />
    <Breadcrumbs items={[{label:"Tires"}]} />
    <LocalBusinessSchema includeServices />
    <FAQPageSchema qa={TIRE_BUYING_FAQ} />
    <main>
      <section className="border-b border-border/30 bg-gradient-to-b from-primary/10 to-background py-12 sm:py-16">
        <div className="container max-w-5xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary"><Star className="h-3.5 w-3.5 fill-current" /> {BUSINESS.reviews.rating} stars · {BUSINESS.reviews.countDisplay} reviews</div>
          <h1 className="mt-5 text-4xl sm:text-6xl font-black tracking-tight">Find your tires. See the price. Request them now.</h1>
          <p className="mx-auto mt-4 max-w-2xl text-base sm:text-lg text-muted-foreground">Enter the size from your tire sidewall. We show practical choices, estimated installed pricing, and a no-card-required request.</p>
          <div className="mx-auto mt-8 max-w-3xl rounded-2xl border border-primary/30 bg-card p-3 shadow-2xl">
            <div className="flex gap-2"><Search className="ml-3 mt-3.5 h-5 w-5 text-muted-foreground"/><input aria-label="Search tire size" value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} placeholder="Enter tire size — e.g. 215/60R16" className="min-w-0 flex-1 bg-transparent px-2 py-3 text-lg outline-none"/><button onClick={()=>submit()} className="rounded-xl bg-primary px-5 font-bold text-primary-foreground">Search tires</button></div>
            <div className="mt-3 flex flex-wrap justify-center gap-2">{POPULAR.map(s=><button key={s} onClick={()=>submit(s)} className="rounded-full border border-border/50 px-3 py-1 text-xs text-muted-foreground hover:border-primary hover:text-primary">{s}</button>)}</div>
          </div>
          <div className="mt-5 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground"><span className="flex items-center gap-1"><Check className="h-4 w-4 text-green-400"/>No card required</span><span className="flex items-center gap-1"><Check className="h-4 w-4 text-green-400"/>Staff confirms fitment</span><span className="flex items-center gap-1"><Check className="h-4 w-4 text-green-400"/>Open 7 days</span></div>
        </div>
      </section>
      <section ref={resultsRef} className="container max-w-5xl mx-auto py-10">
        {query.isLoading && <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary"/></div>}
        {query.data && <>
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-semibold text-primary">{query.data.sizeFormatted}</p><h2 className="text-2xl font-bold">Choose the best fit for your budget</h2><p className="text-sm text-muted-foreground">Availability and fitment are confirmed before final payment.</p></div><div className="flex gap-2">{[1,2,4].map(n=><button key={n} onClick={()=>setQty(n)} className={`rounded-lg border px-4 py-2 text-sm ${qty===n?"border-primary bg-primary text-primary-foreground":"border-border"}`}>{n} tire{n>1?"s":""}</button>)}</div></div>
          {query.data.source==="catalog" && <div className="mb-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">These are estimated options. Staff will confirm live stock and exact size pricing before payment.</div>}
          <div className="grid gap-4 md:grid-cols-2">{tires.slice(0,8).map((t:any,i:number)=><article key={t.id} className="rounded-2xl border border-border/50 bg-card p-5"><div className="flex items-start justify-between gap-3"><div><span className="text-xs font-semibold uppercase tracking-wide text-primary">{i===0?"Best price":i===1?"Best value":"Available option"}</span><h3 className="mt-1 text-xl font-bold">{t.brand} {t.model}</h3><p className="text-sm text-muted-foreground">{t.size} · {t.warranty||"Warranty varies"}</p></div><ShieldCheck className="h-6 w-6 text-primary"/></div><div className="mt-5 flex items-end justify-between"><div><p className="text-3xl font-black">${t.shopPrice.toFixed(2)}<span className="text-sm font-normal text-muted-foreground"> / tire</span></p><p className="text-sm font-semibold text-primary">${(t.shopPrice*qty).toFixed(2)} for {qty}</p></div><button onClick={()=>{setSelected(t);trackEvent("tire_option_selected",{id:t.id,size:t.size,quantity:qty,position:i+1})}} className="rounded-xl bg-primary px-5 py-3 font-bold text-primary-foreground">Request these</button></div></article>)}</div>
          {!tires.length && <div className="rounded-2xl border border-border bg-card p-8 text-center"><h2 className="text-xl font-bold">We can still find this size</h2><p className="mt-2 text-muted-foreground">Call or text the shop and we will check local and warehouse inventory.</p></div>}
        </>}
        {!size && <div className="grid gap-4 md:grid-cols-3"><div className="rounded-2xl border p-5"><h2 className="font-bold">1. Search your size</h2><p className="mt-2 text-sm text-muted-foreground">Use the code on the tire sidewall, such as 215/60R16.</p></div><div className="rounded-2xl border p-5"><h2 className="font-bold">2. Pick an option</h2><p className="mt-2 text-sm text-muted-foreground">Compare clear per-tire and set pricing without a wall of distractions.</p></div><div className="rounded-2xl border p-5"><h2 className="font-bold">3. We confirm it</h2><p className="mt-2 text-sm text-muted-foreground">Our team checks fitment and stock, then contacts you before payment.</p></div></div>}
      </section>
      <section className="border-y border-border/30 bg-card/40 py-10"><div className="container max-w-4xl mx-auto text-center"><h2 className="text-2xl font-bold">Not sure of your size?</h2><p className="mt-2 text-muted-foreground">Call the shop and we will identify it from your vehicle.</p><a href={BUSINESS.phone.href} onClick={()=>trackPhoneClick("tires-v2-help")} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 font-bold text-primary-foreground"><Phone className="h-4 w-4"/>Call {BUSINESS.phone.display}</a></div></section>
    </main>
    {selected && <OrderModal tire={selected} quantity={qty} packageValue={0} onClose={()=>setSelected(null)} />}
  </PageLayout>;
}
