/* Distributor Web Portal: 5 step order, review, delivery par payment, ledger.
   Data server ke usi database mein: diststores, distorders, distledger */
const DP={tab:"stores",open:"",stores:[],orders:[],ledger:[],draft:null,done:null,filter:""};
const dpNum=v=>{const n=Number(v);return Number.isFinite(n)?Math.round(n*100)/100:0};
const dpCur=()=>(app.settings&&app.settings.currency)||"Rs.";
const dpRs=n=>dpCur()+" "+(dpNum(n)===0?"00":dpNum(n).toLocaleString("en-US",{maximumFractionDigits:2}));
const dpPos=n=>Math.max(0,dpNum(n));
const dpWhen=iso=>iso?new Date(iso).toLocaleString("en-GB",{dateStyle:"medium",timeStyle:"short"}):"";
const dpBooker=()=>(app.user&&(app.user.fullName||app.user.username))||"";
const dpTotal=items=>dpNum(items.reduce((a,i)=>a+dpNum(dpNum(i.qty)*dpNum(i.rate)),0));
const dpBlank=()=>({name:"",qty:"",rate:""});
const dpNewDraft=sid=>({id:id("dord"),step:sid?2:1,storeId:sid||"",orderBy:"",orderByPhone:"",booker:dpBooker(),items:[dpBlank()],payNow:false,received:"",note:""});
/* Ledger = opening/manual dues + delivered orders - payments. Pending order baqaya mein nahi ginta. */
function dpEntries(storeId){
const a=DP.ledger.filter(l=>l.storeId===storeId).map(l=>({date:l.createdAt,label:l.note||(l.kind==="payment"?"Payment":"Baqaya"),debit:l.kind==="payment"?0:dpNum(l.amount),credit:l.kind==="payment"?dpNum(l.amount):0}));
DP.orders.filter(o=>o.storeId===storeId&&o.status==="Delivered").forEach(o=>a.push({orderId:o.id,date:o.deliveredAt,label:"Order "+o.orderNo+" delivered",debit:dpNum(o.total),credit:0}));
return a.sort((x,y)=>(x.date||"")<(y.date||"")?-1:1)}
const dpDue=storeId=>dpNum(dpEntries(storeId).reduce((a,e)=>a+e.debit-e.credit,0));

async function dpLoad(){
const [s,o,l]=await Promise.all([qGetAll("diststores"),qGetAll("distorders"),qGetAll("distledger")]);
DP.stores=s.sort((a,b)=>String(a.storeName).localeCompare(String(b.storeName)));
DP.orders=o.sort((a,b)=>(b.createdAt||"").localeCompare(a.createdAt||""));DP.ledger=l}

const dpPaidOn=oid=>dpNum(DP.ledger.filter(l=>l.kind==="payment"&&l.orderId===oid||l.id==="pay_"+oid).reduce((a,l)=>a+dpNum(l.amount),0));
/* Wasooli pehle sab se purane baqaya mein lagti hai. Is se har delivered order ka baqi nikalta hai. */
function dpLeft(o){let credit=dpEntries(o.storeId).reduce((a,e)=>a+e.credit,0);
for(const e of dpEntries(o.storeId).filter(e=>e.debit>0)){const used=Math.min(credit,e.debit);credit=dpNum(credit-used);if(e.orderId===o.id)return dpNum(e.debit-used)}return dpNum(o.total)}
function dpBadge(o){if(o.status==="Pending")return ["⏳ Pending","#fef3c7","#92400e"];if(o.status==="Cancelled")return ["✖ Cancelled","#e2e8f0","#334155"];
const left=dpLeft(o);return left<=0?["✔ Delivered · PAID","#dcfce7","#166534"]:left<o.total?["Delivered · Baqi "+dpRs(left),"#ffedd5","#9a3412"]:["Delivered · UNPAID","#fee2e2","#991b1b"]}
async function dpLoad(){
const [s,o,l]=await Promise.all([qGetAll("diststores"),qGetAll("distorders"),qGetAll("distledger")]);
DP.stores=s.sort((a,b)=>String(a.storeName).localeCompare(String(b.storeName)));
DP.orders=o.sort((a,b)=>(b.createdAt||"").localeCompare(a.createdAt||""));DP.ledger=l}

async function pageDistributor(){
$("#page").innerHTML='<div class="card" style="padding:14px">Distributor data load ho raha hai…</div>';
try{await dpLoad()}catch(e){if(app.route!=="distributor")return;$("#page").innerHTML='<div class="card" style="padding:14px">Data load nahi hua: '+esc(e.message)+'<br>Naya server.js lagayein aur server restart karein.</div>';return}
if(app.route==="distributor")dpRender()}


function dpCSS(){if(document.getElementById("dp-css"))return;const st=document.createElement("style");st.id="dp-css";st.textContent=`
.dp-pad{padding:16px;margin-bottom:12px}.dp h3{margin:0 0 4px;font-size:19px}.dp-sub{font-size:13px;opacity:.8;margin-bottom:14px}
.dp label{display:block;font-size:13px;font-weight:700;margin:10px 0 4px}
.dp .btn.on{outline:3px solid #2563eb;outline-offset:1px}
.dp-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.dp-row>.grow{flex:1;min-width:120px}
.dp-steps{display:flex;gap:4px;margin-bottom:12px}
.dp-steps div{flex:1;text-align:center;font-size:12px;font-weight:700;background:#fff;color:#64748b;border-radius:10px;padding:7px 2px;border-bottom:4px solid #cbd5e1}
.dp-steps b{display:block;font-size:15px}.dp-steps .now{border-color:#2563eb;color:#1d4ed8}.dp-steps .ok{border-color:#16a34a;color:#166534}
.dp-pick{display:block;width:100%;text-align:left;border:1.5px solid #94a3b8;background:transparent;color:inherit;border-radius:12px;padding:12px;margin-top:8px;cursor:pointer}
.dp-line{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px dashed #94a3b8;font-size:14px}.dp-line b{text-align:right}
.dp-big{background:#1e3a8a;color:#fff;border-radius:12px;padding:12px 14px;display:flex;justify-content:space-between;gap:10px;font-weight:800;font-size:17px;margin-top:10px}
.dp-item{border:1.5px solid #94a3b8;border-radius:12px;padding:10px;margin-bottom:8px}
.dp-nav{display:flex;justify-content:space-between;gap:8px;margin-top:16px}
.dp-badge{display:inline-block;border-radius:99px;padding:3px 10px;font-size:12px;font-weight:800}`;document.head.appendChild(st)}
const dpLine=(a,b)=>'<div class="dp-line"><span>'+a+'</span><b>'+b+'</b></div>';

const dpCanDel=()=>can("delete");
function dpRender(){dpCSS();
const tabs=[["stores","🏪 Medical Stores"],["book","🛒 Naya Order"]];
if(DP.tab!=="book")DP.tab="stores";
const sum=DP.stores.reduce((a,x)=>a+dpPos(dpDue(x.id)),0);
const stat=(ico,c,l,v)=>'<div class="stat"><div class="ico '+c+'">'+ico+'</div><div><div class="lbl">'+l+'</div><div class="val">'+v+'</div></div></div>';
$("#page").innerHTML='<div class="medical-store-ui dp"><div class="ms-hero"><div><div class="ms-hero-t">🚚 Distributor Portal</div><div class="ms-hero-s">Orders · Delivery · Ledger · '+fmtDate(today())+'</div></div></div>'+
(DP.tab==="stores"&&!DP.open?'<div class="grid g4 mb">'+stat("🏪","blue-g","Medical Stores",DP.stores.length)+stat("⏳","amber-g","Pending Orders",DP.orders.filter(o=>o.status==="Pending").length)+stat("🚚","green-g","Delivered Orders",DP.orders.filter(o=>o.status==="Delivered").length)+stat("💰","violet-g","Kul Baqaya",dpRs(sum))+'</div>':"")+
'<div class="dp-row" style="margin-bottom:12px">'+tabs.map(t=>'<button type="button" class="btn '+(DP.tab===t[0]?"btn-primary":"btn-neutral")+'" data-dptab="'+t[0]+'">'+t[1]+'</button>').join("")+'</div>'+(netOK()?"":'<div class="card dp-pad">📴 Offline: data abhi is device par hai. Internet / server aane par sync hoga.</div>')+'<div id="dp-body"></div></div>';
$$("[data-dptab]").forEach(b=>b.onclick=()=>{DP.tab=b.dataset.dptab;DP.open="";dpRender()});
if(DP.tab==="book")dpBook();else if(DP.open&&DP.stores.some(x=>x.id===DP.open))dpPanel(DP.open);else dpStores()}

/* Naya order hamesha khali shuru hota hai */
function dpPick(sid){DP.draft=dpNewDraft(sid);DP.done=null;DP.tab="book";dpRender()}

function dpCheck(step){const d=DP.draft;
if(step>=1&&!DP.stores.some(s=>s.id===d.storeId))return "Pehle dukan select karein";
if(step>=2){if(!d.orderBy.trim())return "Order dene wale ka naam likhein";if(!d.booker.trim())return "Order Booker ka naam likhein"}
if(step>=3){const u=dpUsed();if(!u.length)return "Kam az kam ek item likhein";if(u.some(i=>!String(i.name).trim()||!Number.isInteger(Number(i.qty))||Number(i.qty)<=0||i.rate===""||!(Number(i.rate)>=0)))return "Har item ka naam, sahi Qty aur Rate likhein"}
if(step>=4&&d.payNow){const m=dpPos(dpDue(d.storeId)+dpTotal(dpUsed()));if(!(dpNum(d.received)>0)||dpNum(d.received)>m)return "Mili hui raqam likhein (zyada se zyada "+dpRs(m)+")"}
return ""}
const dpUsed=()=>DP.draft.items.filter(i=>String(i.name).trim()||i.qty!==""||i.rate!=="");

function dpBook(){
if(DP.done)return dpSuccess();
if(!DP.draft)DP.draft=dpNewDraft();
const d=DP.draft,s=DP.stores.find(x=>x.id===d.storeId),body=$("#dp-body");
if(!s)d.step=1;
const names=["Dukan","Order dene wala","Items","Pasay","Review"];
let h="";
if(d.step===1)h='<h3>Dukan select karein</h3><div class="dp-sub">Jis dukan ka order hai, us par click karein.</div><div class="dp-row"><input class="inp grow" id="dp-find" placeholder="🔍 Dukan ya area ka naam"><button type="button" class="btn btn-primary" id="dp-newstore">＋ Nayi Dukan</button></div><div id="dp-picks"></div>';
else{const due=dpDue(s.id),total=dpTotal(dpUsed()),pend=DP.orders.filter(o=>o.storeId===s.id&&o.status==="Pending").reduce((a,o)=>a+o.total,0);
const store='<div class="dp-sub"><b>'+esc(s.storeName)+'</b> · '+esc(s.clinicName)+' · '+esc(s.area)+'</div>';
if(d.step===2)h='<h3>Order kis ne diya?</h3>'+store+'<label for="dp-by">Order dene wale ka naam *</label><input class="inp" id="dp-by" data-f="orderBy" value="'+esc(d.orderBy)+'" placeholder="Dukan par jis ne order diya"><label>Us ka mobile (optional)</label><input class="inp" data-f="orderByPhone" inputmode="tel" value="'+esc(d.orderByPhone)+'"><label>Order lene wala (Order Booker) *</label><input class="inp" data-f="booker" value="'+esc(d.booker)+'">'+dpLine("Pichla baqaya",dpRs(dpPos(due)));
if(d.step===3){const products=Array.from(new Set(DP.orders.flatMap(o=>(o.items||[]).map(i=>i.name))));
h='<h3>Kya kya chahiye?</h3>'+store+'<datalist id="dp-products">'+products.map(p=>'<option value="'+esc(p)+'">').join("")+'</datalist><div id="dp-items"></div><button type="button" class="btn btn-neutral" id="dp-additem">＋ Aur Item</button><div class="dp-big"><span>Order Total</span><span id="dp-total"></span></div>'}
if(d.step===4)h='<h3>Pasay ka hisaab</h3>'+store+dpLine("Pichla baqaya",dpRs(dpPos(due)))+(due<0?dpLine("Advance jama",dpRs(-due)):"")+dpLine("Ye order",dpRs(total))+'<div class="dp-big"><span>Delivery par lene hain</span><span>'+dpRs(dpPos(due+total))+'</span></div>'+(pend?'<div class="dp-sub" style="margin-top:6px">Is dukan ke pehle pending orders ('+dpRs(pend)+') is mein shamil nahi.</div>':"")+
'<label>Abhi pasay mile?</label><div class="dp-row"><button type="button" class="btn btn-neutral grow '+(d.payNow?"":"on")+'" id="dp-later">🕒 Nahi, delivery par / baad mein</button><button type="button" class="btn btn-neutral grow '+(d.payNow?"on":"")+'" id="dp-now">💵 Haan, abhi mile</button></div>'+(d.payNow?'<label>Kitne pasay mile?</label><input class="inp" data-f="received" type="number" min="0" step="any" value="'+esc(d.received)+'">':"")+'<label>Note (optional)</label><input class="inp" data-f="note" value="'+esc(d.note)+'">';
if(d.step===5){const got=d.payNow?dpNum(d.received):0,edit=n=>' <button type="button" class="btn btn-neutral" data-go="'+n+'" style="padding:5px 10px;font-size:12px">✏️ Badlein</button>';
h='<h3>Review: bhejne se pehle check karein</h3><div class="dp-sub">Ghalti ho to “Badlein” dabayein.</div><div><b>Dukan</b>'+edit(1)+'</div>'+dpLine("Store Name",esc(s.storeName))+dpLine("Medical Store / Clinic",esc(s.clinicName))+dpLine("Area",esc(s.area))+
'<div style="margin-top:14px"><b>Order kis ne diya aur liya</b>'+edit(2)+'</div>'+dpLine("Order dene wala",esc(d.orderBy+(d.orderByPhone?" · "+d.orderByPhone:"")))+dpLine("Order Booker",esc(d.booker))+
'<div style="margin-top:14px"><b>Items</b>'+edit(3)+'</div>'+dpUsed().map(i=>dpLine(esc(i.name)+' <small>('+esc(i.qty)+' × '+esc(i.rate)+')</small>',dpRs(i.qty*i.rate))).join("")+
'<div style="margin-top:14px"><b>Pasay</b>'+edit(4)+'</div>'+dpLine("Pichla baqaya",dpRs(dpPos(due)))+(due<0?dpLine("Advance jama",dpRs(-due)):"")+dpLine("Ye order",dpRs(total))+dpLine("Abhi mile",dpRs(got))+(d.note?dpLine("Note",esc(d.note)):"")+'<div class="dp-big"><span>Baqi lene hain</span><span>'+dpRs(dpPos(due+total-got))+'</span></div>'}}
body.innerHTML='<div class="dp-steps">'+names.map((n,i)=>'<div class="'+(i+1===d.step?"now":i+1<d.step?"ok":"")+'"><b>'+(i+1<d.step?"✓":i+1)+'</b>'+n+'</div>').join("")+'</div><div class="card dp-pad">'+h+(d.step>1?'<div class="dp-nav"><button type="button" class="btn btn-neutral" id="dp-back">← Wapas</button><button type="button" class="btn btn-primary" id="dp-next">'+(d.step===5?"✅ Order Confirm karein":"Aagay →")+'</button></div>':"")+'</div>';
const go=n=>{d.step=n;dpRender()};
if(d.step===1){const picks=()=>{const q=$("#dp-find").value.trim().toLowerCase();const L=DP.stores.filter(x=>[x.storeName,x.clinicName,x.area].join(" ").toLowerCase().includes(q));
$("#dp-picks").innerHTML=L.map(x=>'<button type="button" class="dp-pick" data-sid="'+esc(x.id)+'"><b>'+esc(x.storeName)+'</b><br><small>'+esc(x.clinicName+" · "+x.area)+'</small><br><small><b>Baqaya: '+dpRs(dpPos(dpDue(x.id)))+'</b></small></button>').join("")||'<div class="dp-sub" style="margin-top:12px">Koi dukan nahi mili. “Nayi Dukan” se add karein.</div>';
$$("[data-sid]").forEach(b=>b.onclick=()=>{if(d.storeId&&d.storeId!==b.dataset.sid)return dpPick(b.dataset.sid);d.storeId=b.dataset.sid;go(2)})};
$("#dp-find").oninput=picks;picks();$("#dp-newstore").onclick=()=>dpStoreForm(null,dpPick);return}
$$("#dp-body [data-f]").forEach(x=>x.oninput=()=>d[x.dataset.f]=x.value);
$$("[data-go]").forEach(b=>b.onclick=()=>go(+b.dataset.go));
if(d.step===3){const total=()=>$("#dp-total").textContent=dpRs(dpTotal(d.items));
const items=()=>{$("#dp-items").innerHTML=d.items.map((it,i)=>'<div class="dp-item"><div class="dp-row"><input class="inp grow" list="dp-products" placeholder="Item '+(i+1)+' ka naam" data-i="'+i+'" data-k="name" value="'+esc(it.name)+'"><button type="button" class="btn btn-neutral" data-dprm="'+i+'" aria-label="Item hatayein">✕</button></div><div class="dp-row" style="margin-top:6px"><input class="inp grow" style="width:30%" type="number" min="1" step="1" placeholder="Qty" data-i="'+i+'" data-k="qty" value="'+esc(it.qty)+'"><input class="inp grow" style="width:30%" type="number" min="0" step="any" placeholder="Rate" data-i="'+i+'" data-k="rate" value="'+esc(it.rate)+'"><b data-amt="'+i+'">'+dpRs(it.qty*it.rate)+'</b></div></div>').join("");
$$("#dp-items [data-k]").forEach(x=>x.oninput=()=>{const it=d.items[+x.dataset.i];it[x.dataset.k]=x.value;$('[data-amt="'+x.dataset.i+'"]').textContent=dpRs(it.qty*it.rate);total()});
$$("[data-dprm]").forEach(b=>b.onclick=()=>{d.items.splice(+b.dataset.dprm,1);if(!d.items.length)d.items.push(dpBlank());items()});total()};
items();$("#dp-additem").onclick=()=>{d.items.push(dpBlank());items()}}
if(d.step===4){$("#dp-later").onclick=()=>{d.payNow=false;d.received="";dpRender()};$("#dp-now").onclick=()=>{d.payNow=true;dpRender()}}
$("#dp-back").onclick=()=>go(d.step-1);
$("#dp-next").onclick=e=>{const err=dpCheck(d.step);if(err)return toast(err,"error");if(d.step<5)go(d.step+1);else dpSubmit(s,e.currentTarget)}}

async function dpSubmit(st,btn){
const d=DP.draft;btn.disabled=true;
try{
await dpLoad(); /* confirm se pehle ledger dobara check */
const err=dpCheck(5);if(err){btn.disabled=false;return toast(err,"error")}
const due=dpDue(st.id),recv=d.payNow?dpNum(d.received):0;
const old=DP.orders.find(o=>o.id===d.id);
const n=old?null:await nextSeq("distOrderSeq",1),now=old?old.createdAt:new Date().toISOString();
const items=dpUsed().map(i=>({name:String(i.name).trim(),qty:Number(i.qty),rate:dpNum(i.rate)}));
const order=old||{id:d.id,orderNo:"DO-"+String(n).padStart(5,"0"),storeId:st.id,storeName:st.storeName,clinicName:st.clinicName,area:st.area,phone:st.phone||"",orderBy:d.orderBy.trim(),orderByPhone:d.orderByPhone.trim(),booker:d.booker.trim(),items:items,total:dpTotal(items),previousDue:dpPos(due),received:recv,note:d.note.trim(),status:"Pending",createdAt:now};
if(!old)await qPut("distorders",order);
if(order.received>0)await qPut("distledger",{id:"pay_"+order.id,orderId:order.id,storeId:st.id,kind:"payment",amount:order.received,note:"Wasooli, order "+order.orderNo,createdAt:now,by:order.booker});
audit(app.user.username,"CREATE","distributor",order.id,order.orderNo+" "+st.storeName);
await dpLoad();DP.draft=null;DP.done=order.id;dpRender();
}catch(e){btn.disabled=false;toast("Order save mukammal nahi hua: "+e.message+" — dobara Confirm karein","error")}}

const dpSlipBtns=oid=>[["view","👁 Slip Dekhein"],["a4","🖨 A4"],["th","🧾 Thermal"],["wa","💬 WhatsApp"]].map(x=>'<button type="button" class="btn btn-neutral" data-dpa="'+x[0]+'" data-oid="'+esc(oid)+'">'+x[1]+'</button>').join("");
function dpBind(){$$("[data-dpa]").forEach(x=>x.onclick=()=>{const o=DP.orders.find(y=>y.id===x.dataset.oid),a=x.dataset.dpa;if(!o)return;
if(a==="view")openModal("Slip "+o.orderNo,'<div style="background:#fff;padding:12px;overflow:auto">'+dpSlip(o,"A4")+'</div>',"",true);
else if(a==="a4")printHTML(dpSlip(o,"A4"),"A4");
else if(a==="th"){const z=usThermalSize();printHTML(dpSlip(o,z),z)}
else if(a==="wa"){const p=o.orderByPhone||o.phone;if(waNum(p).length<10)return toast("Order dene wale ya dukan ka sahi mobile number nahi hai","error");openWA(p,"Order "+o.orderNo+" ("+o.status+")\n"+o.storeName+"\n"+o.items.map(i=>i.name+" x "+i.qty+" @ "+i.rate).join("\n")+"\nOrder Total: "+dpRs(o.total)+"\nIs order par wasool: "+dpRs(dpPaidOn(o.id))+"\n"+(o.status==="Pending"?"Delivery par lene hain: "+dpRs(dpPos(dpDue(o.storeId)+o.total)):"Dukan ka kul baqaya: "+dpRs(dpPos(dpDue(o.storeId)))))}
else if(a==="new")dpPick(o.storeId);
else if(a==="deliver"||a==="pay")dpMoney(o.id,a);
else if(a==="cancel")dpCancel(o.id);
else if(a==="del")dpDelOrder(o.id)})}

function dpSuccess(){const o=DP.orders.find(x=>x.id===DP.done);if(!o){DP.done=null;return dpBook()}
$("#dp-body").innerHTML='<div class="card dp-pad" style="text-align:center"><div style="font-size:44px">✅</div><h3>Order save ho gaya: '+esc(o.orderNo)+'</h3><div class="dp-sub">'+esc(o.storeName)+' · Pending · store ke panel mein mojood hai</div><div class="dp-row" style="justify-content:center">'+dpSlipBtns(o.id)+'</div><div class="dp-row" style="justify-content:center;margin-top:14px"><button type="button" class="btn btn-primary" id="dp-again">🛒 Naya Order</button><button type="button" class="btn btn-neutral" id="dp-hist">📂 Is Store ka Panel</button></div></div>';
dpBind();$("#dp-again").onclick=()=>dpPick("");$("#dp-hist").onclick=()=>{DP.done=null;DP.open=o.storeId;DP.tab="stores";dpRender()}}

/* Delivery par ya us ke baad pasay */
function dpMoney(oid,mode){
const o=DP.orders.find(x=>x.id===oid);if(!o)return;
const del=mode==="deliver",due=dpDue(o.storeId),total=dpPos(due+(del?o.total:0));
const ov=openModal((del?"Delivery — ":"Pasay wasool — ")+o.orderNo,'<div class="dp"><div class="card dp-pad" style="box-shadow:none;margin:0">'+(del?dpLine("Pichla baqaya",dpRs(dpPos(due)))+(due<0?dpLine("Advance jama",dpRs(-due)):"")+dpLine("Ye order",dpRs(o.total)):"")+'<div class="dp-big"><span>Kul lene hain</span><span>'+dpRs(total)+'</span></div><label>Dukandar ne kitne pasay diye?</label><input class="inp" id="dpm-amt" type="number" min="0" step="any" placeholder="00"><div class="dp-row" style="margin-top:8px"><button type="button" class="btn btn-neutral grow" id="dpm-full">✔ Poore diye</button><button type="button" class="btn btn-neutral grow" id="dpm-zero">🕒 Baad mein dega</button></div>'+dpLine("Baqi rahenge",'<span id="dpm-left">'+dpRs(total)+'</span>')+'<div class="dp-sub" style="margin:8px 0 0">Pasay pehle sab se purane baqaya mein lagte hain.</div></div></div>','<button class="btn btn-outline" data-close>Band karein</button><button class="btn btn-primary" id="dpm-save">'+(del?"🚚 Delivered Save karein":"💵 Pasay Save karein")+'</button>');
const q=x=>ov.querySelector(x),amt=q("#dpm-amt"),upd=()=>q("#dpm-left").textContent=dpRs(dpPos(total-dpNum(amt.value)));
amt.oninput=upd;q("#dpm-full").onclick=()=>{amt.value=total;upd()};q("#dpm-zero").onclick=()=>{amt.value=0;upd()};
q("[data-close]").onclick=()=>ov.remove();
const payId=del?"dpay_"+oid:id("dled");
q("#dpm-save").onclick=async e=>{const btn=e.currentTarget,v=dpNum(amt.value);
if(del&&amt.value==="")return toast("Raqam likhein, ya “Baad mein dega” dabayein","error");
if(v<0||(!del&&!(v>0)))return toast("Sahi raqam likhein","error");
btn.disabled=true;
try{await dpLoad();const cur=DP.orders.find(x=>x.id===oid),max=dpPos(dpDue(o.storeId)+(del&&cur&&cur.status==="Pending"?cur.total:0));
if(!cur||cur.status!==(del?"Pending":"Delivered")){ov.remove();toast("Is order ka status pehle hi badal chuka hai","info");return dpRender()}
if(v>max){btn.disabled=false;return toast("Raqam "+dpRs(max)+" se zyada nahi ho sakti. Dobara check karein.","error")}
const now=new Date().toISOString();
if(del)await qPut("distorders",Object.assign({},cur,{status:"Delivered",deliveredAt:now}));
if(v>0)await qPut("distledger",{id:payId,orderId:oid,storeId:o.storeId,kind:"payment",amount:v,note:"Wasooli, order "+o.orderNo,createdAt:now,by:dpBooker()});
audit(app.user.username,del?"UPDATE":"CREATE","distributor",oid,o.orderNo+(del?" Delivered, ":" payment, ")+v);
await dpLoad();ov.remove();dpRender();toast("Save ho gaya. Dukan ka baqaya: "+dpRs(dpPos(dpDue(o.storeId))),"success")}
catch(err){try{await dpLoad();dpRender()}catch(x){}ov.remove();toast("Save mukammal nahi hua: "+err.message+" — Store panel aur Ledger check karein","error")}}}

async function dpCancel(oid){const o=DP.orders.find(x=>x.id===oid);
if(!await confirmBox({title:o.orderNo,message:"Ye order cancel karein?"+(dpPaidOn(oid)>0?" Mili hui raqam dukan ke ledger mein jama rahegi.":""),confirmText:"Cancel Order",danger:true}))return;
try{await dpLoad();const cur=DP.orders.find(x=>x.id===oid);if(!cur||cur.status!=="Pending")return dpRender();
await qPut("distorders",Object.assign({},cur,{status:"Cancelled",cancelledAt:new Date().toISOString()}));audit(app.user.username,"UPDATE","distributor",oid,o.orderNo+" Cancelled");await dpLoad();dpRender()}
catch(e){toast("Status save nahi hua: "+e.message,"error")}}

/* ---- Delete ---- */
const dpPayRows=oid=>DP.ledger.filter(l=>l.kind==="payment"&&(l.orderId===oid||l.id==="pay_"+oid));
async function dpDelOrder(oid){if(!dpCanDel())return toast("Delete ki ijazat nahi hai","error");
const o=DP.orders.find(x=>x.id===oid);if(!o)return;
const after=dpNum(dpDue(o.storeId)+dpPaidOn(oid)-(o.status==="Delivered"?o.total:0));
if(!await confirmBox({title:"Delete "+o.orderNo,message:"Ye order"+(dpPaidOn(oid)>0?" aur is par likhi wasooli "+dpRs(dpPaidOn(oid)):"")+" hamesha ke liye delete hogi. Delete ke baad dukan ka baqaya "+dpRs(dpPos(after))+(after<0?" (advance "+dpRs(-after)+")":"")+" hoga.",confirmText:"Delete",danger:true}))return;
try{await dpLoad();for(const l of dpPayRows(oid))await qDel("distledger",l.id);await qDel("distorders",oid);
audit(app.user.username,"DELETE","distributor",oid,o.orderNo+" "+o.storeName+" total "+o.total);toast("Order delete ho gaya","success")}
catch(e){toast("Delete mukammal nahi hua: "+e.message+" — dobara try karein","error")}
await dpLoad();dpRender()}
async function dpDelStore(sid){if(!dpCanDel())return toast("Delete ki ijazat nahi hai","error");
const st=DP.stores.find(x=>x.id===sid);if(!st)return;
const n=DP.orders.filter(o=>o.storeId===sid).length;
if(!await confirmBox({title:"Delete "+st.storeName,message:"Is store ke "+n+" orders aur poora ledger bhi delete hoga. Mojooda baqaya: "+dpRs(dpPos(dpDue(sid)))+". Ye wapas nahi aayega.",confirmText:"Sab Delete karein",danger:true}))return;
try{await dpLoad();for(const l of DP.ledger.filter(l=>l.storeId===sid))await qDel("distledger",l.id);
for(const o of DP.orders.filter(o=>o.storeId===sid))await qDel("distorders",o.id);
await qDel("diststores",sid);audit(app.user.username,"DELETE","distributor",sid,st.storeName+", orders "+n);DP.open="";DP.draft=null;toast("Store delete ho gaya","success")}
catch(e){toast("Delete mukammal nahi hua: "+e.message+" — dobara try karein","error")}
await dpLoad();dpRender()}

/* ---- Ek medical store ka ek hi panel: sab orders aur hisaab ---- */
function dpPanel(sid){
const s=DP.stores.find(x=>x.id===sid),mine=DP.orders.filter(o=>o.storeId===sid),due=dpDue(sid);
const stat=(ico,c,l,v)=>'<div class="stat"><div class="ico '+c+'">'+ico+'</div><div><div class="lbl">'+l+'</div><div class="val">'+v+'</div></div></div>';
const got=dpEntries(sid).reduce((a,e)=>a+e.credit,0);
const rows=mine.map(o=>{const bg=dpBadge(o),b=(a,t,c)=>'<button type="button" class="btn sm '+(c||"btn-neutral")+'" data-dpa="'+a+'" data-oid="'+esc(o.id)+'">'+t+'</button>';
return '<tr><td><b>'+esc(o.orderNo)+'</b><div class="hint">'+dpWhen(o.createdAt)+'</div></td><td>'+esc(o.orderBy||"-")+'<div class="hint">Booker: '+esc(o.booker)+'</div></td><td><b>'+dpRs(o.total)+'</b><div class="hint">'+o.items.length+' item</div></td><td>'+dpRs(dpPaidOn(o.id))+'</td><td><span class="dp-badge" style="background:'+bg[1]+';color:'+bg[2]+'">'+bg[0]+'</span></td><td><div class="dp-row" style="min-width:230px;gap:5px">'+(o.status==="Pending"?b("deliver","🚚 Delivered + Pasay","btn-success")+b("cancel","Cancel"):"")+(o.status==="Delivered"&&due>0?b("pay","💵 Pasay Wasool","btn-success"):"")+b("view","👁 Slip","btn-outline")+b("a4","🖨 A4","btn-outline")+b("th","🧾 Thermal","btn-outline")+b("wa","💬 WhatsApp","btn-outline")+(dpCanDel()?b("del","Delete","btn-danger"):"")+'</div></td></tr>'}).join("");
$("#dp-body").innerHTML='<button type="button" class="btn btn-neutral sm" id="dp-allstores" style="margin-bottom:10px">← Sab Medical Stores</button><div class="card"><div class="card-h"><div><h2>🏪 '+esc(s.storeName)+'</h2><div class="sub">'+esc(s.clinicName+" · "+s.area+(s.phone?" · "+s.phone:""))+'</div></div><div class="dp-row"><button type="button" class="btn btn-success sm" id="dp-pnew">＋ Naya Order</button><button type="button" class="btn btn-outline sm" id="dp-pled">📒 Ledger</button><button type="button" class="btn btn-neutral sm" id="dp-pedit">✏️ Edit</button>'+(dpCanDel()?'<button type="button" class="btn btn-danger sm" id="dp-pdel">Delete Store</button>':"")+'</div></div><div class="card-b"><div class="grid g4 mb">'+stat("🧾","blue-g","Total Orders",mine.length)+stat("💵","green-g","Kul Wasool",dpRs(got))+stat("💰","amber-g","Baqaya",dpRs(dpPos(due)))+stat("🏦","violet-g","Advance",dpRs(dpPos(-due)))+'</div><div style="overflow:auto"><table class="tbl"><thead><tr><th>Order</th><th>Order dene wala</th><th>Total</th><th>Wasool</th><th>Status</th><th>Action</th></tr></thead><tbody>'+(rows||'<tr><td colspan="6">Is store ka abhi koi order nahi.</td></tr>')+'</tbody></table></div></div></div>';
$("#dp-allstores").onclick=()=>{DP.open="";dpRender()};
$("#dp-pnew").onclick=()=>dpPick(sid);$("#dp-pled").onclick=()=>dpLedger(sid);
$("#dp-pedit").onclick=()=>dpStoreForm(s,()=>dpRender());
if($("#dp-pdel"))$("#dp-pdel").onclick=()=>dpDelStore(sid);
dpBind()}

/* Slip: logo aur text Settings > "Har Slip ka Alag Logo & Text" > Distributor Order Slip */
function dpSlip(o,size){
const A4=size==="A4",small=size==="58",s=slipS(app.settings,"dist"),E=esc,ex="-webkit-print-color-adjust:exact;print-color-adjust:exact;";
const title=((app.settings.slipLogos||{}).dist||{}).title||"ORDER SLIP";
const ink=A4?"#0f3d4c":"#000",fs=A4?12.5:small?10:11.5,paid=dpPaidOn(o.id),due=dpDue(o.storeId);
const stamp=o.status==="Delivered"&&dpLeft(o)<=0?"PAID":o.status.toUpperCase();
const logo=s.logoDataUrl?'<img src="'+s.logoDataUrl+'" style="height:'+Math.max(20,Number(s.logoSize)||56)+'px;max-width:100%;object-fit:contain">':"";
const company='<div style="font-size:'+(A4?22:small?14:17)+'px;font-weight:900;color:'+ink+'">'+E(s.clinicName||"")+'</div>'+(s.tagline?'<div>'+E(s.tagline)+'</div>':"")+'<div>'+E(s.address||"")+'</div><div><b>'+E([s.phone,s.phone2].filter(Boolean).join(" / "))+'</b></div>';
const row=(a,b)=>'<div style="display:flex;justify-content:space-between;gap:8px;padding:2px 0"><span>'+a+'</span><b style="text-align:right;word-break:break-word">'+b+'</b></div>';
const store=row("Store",E(o.storeName))+row("Medical Store / Clinic",E(o.clinicName))+row("Area",E(o.area))+row("Order dene wala",E(o.orderBy||"-"))+(o.orderByPhone?row("Mobile",E(o.orderByPhone)):"");
const meta=row("Order No",E(o.orderNo))+row("Date",E(dpWhen(o.createdAt)))+(o.deliveredAt?row("Delivered",E(dpWhen(o.deliveredAt))):"")+row("Order Booker",E(o.booker));
const bd=A4?"1px solid #b6c6cc":"0",cell="padding:"+(A4?"7px 8px":"3px 1px")+";border-bottom:"+(A4?bd:"1px dashed #000")+";";
const th=(t,al)=>'<th style="'+ex+cell+'text-align:'+al+';'+(A4?'background:'+ink+';color:#fff':'border-top:1px solid #000;border-bottom:1px solid #000')+'">'+t+'</th>';
const table='<table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:'+fs+'px"><thead><tr>'+(A4?th("#","left"):"")+th("Item","left")+th("Qty","right")+(small?"":th("Rate","right"))+th("Amount","right")+'</tr></thead><tbody>'+o.items.map((i,k)=>'<tr style="break-inside:avoid;'+ex+(A4&&k%2?'background:#eef5f6':'')+'">'+(A4?'<td style="'+cell+'">'+(k+1)+'</td>':"")+'<td style="'+cell+'word-break:break-word">'+E(i.name)+(small?'<br><small>@ '+i.rate+'</small>':"")+'</td><td style="'+cell+'text-align:right">'+i.qty+'</td>'+(small?"":'<td style="'+cell+'text-align:right">'+i.rate+'</td>')+'<td style="'+cell+'text-align:right;font-weight:700">'+dpNum(i.qty*i.rate)+'</td></tr>').join("")+'</tbody></table>';
const money=row("Order Total",dpRs(o.total))+row("Pichla baqaya (booking par)",dpRs(o.previousDue||0))+row("Is order par wasool",dpRs(paid));
const finalLabel=o.status==="Pending"?"Delivery par lene hain":"Dukan ka kul baqaya",finalAmt=dpRs(dpPos(due+(o.status==="Pending"?o.total:0)));
const final='<div style="'+ex+'display:flex;justify-content:space-between;gap:6px;margin-top:5px;padding:'+(A4?"10px 12px":"4px")+';font-weight:900;font-size:'+(fs+2)+'px;'+(A4?'background:'+ink+';color:#fff;border-radius:6px':'border:2px solid #000')+'"><span>'+finalLabel+'</span><span style="white-space:nowrap">'+finalAmt+'</span></div><div style="font-size:'+(fs-2)+'px;text-align:right">Hisaab: '+E(dpWhen(new Date().toISOString()))+'</div>';
const sign=t=>'<div style="flex:1;border-top:1px solid #000;text-align:center;padding-top:3px">'+t+'</div>';
const foot=(o.note?'<div style="margin-top:6px"><b>Note:</b> '+E(o.note)+'</div>':"")+'<div style="display:flex;gap:'+(A4?80:12)+'px;margin-top:'+(A4?48:28)+'px">'+sign("Dukandar")+sign("Order Booker")+'</div>'+(s.footerText?'<div style="text-align:center;margin-top:8px">'+E(s.footerText)+'</div>':"");
const badge='<span style="display:inline-block;border:2px solid '+ink+';border-radius:6px;padding:2px 12px;font-weight:900;letter-spacing:1px">'+stamp+'</span>';
const wrap='<!--zmref:'+E(o.orderNo)+' | '+stamp+'--><div style="width:'+(A4?"100%":small?"54mm":"74mm")+';margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#000;font-size:'+fs+'px;line-height:1.35">';
if(!A4)return wrap+'<div style="text-align:center">'+logo+company+'<div style="border-top:2px solid #000;border-bottom:2px solid #000;margin:5px 0;padding:3px;font-weight:900">'+E(title)+'</div>'+badge+'</div><div style="margin-top:5px">'+meta+'</div><div style="border-top:1px dashed #000;margin-top:4px;padding-top:4px">'+store+'</div>'+table+'<div style="margin-top:5px">'+money+final+'</div>'+foot+'</div>';
const box=(t,h)=>'<div style="flex:1;min-width:0;border:'+bd+';border-radius:8px;padding:8px 10px"><div style="font-weight:900;color:'+ink+';border-bottom:'+bd+';margin-bottom:4px">'+t+'</div>'+h+'</div>';
return wrap+'<div style="display:flex;justify-content:space-between;align-items:center;gap:14px;border-bottom:4px solid '+ink+';padding-bottom:10px"><div style="display:flex;gap:12px;align-items:center">'+logo+'<div>'+company+'</div></div><div style="text-align:right"><div style="font-size:20px;font-weight:900;color:'+ink+';margin-bottom:6px">'+E(title)+'</div>'+badge+'</div></div><div style="display:flex;gap:10px;margin-top:12px">'+box("Dukan",store)+box("Order",meta)+'</div>'+table+'<div style="break-inside:avoid;margin:10px 0 0 auto;width:60%">'+money+final+'</div>'+foot+'</div>'}
function dpStoreForm(s,done){
const f=[["storeName","Store Name *"],["clinicName","Medical Store / Clinic Name *"],["area","Area / Location *"],["phone","Mobile (optional)"]];
const ov=openModal(s?"Store Profile Edit":"Naya Store",f.map(x=>'<div class="field"><label>'+x[1]+'</label><input class="inp" id="dps-'+x[0]+'" value="'+esc(s?s[x[0]]||"":"")+'"></div>').join("")+(s?"":'<div class="field"><label>Purana baqaya (agar hai)</label><input class="inp" id="dps-open" type="number" min="0" step="any"></div>'),'<button class="btn btn-outline" data-close>Cancel</button><button class="btn btn-primary" id="dps-save">Save Store</button>');
ov.querySelector("[data-close]").onclick=()=>ov.remove();
const sid=s?s.id:id("dst");
ov.querySelector("#dps-save").onclick=async e=>{
const btn=e.currentTarget,rec=Object.assign({},s||{id:sid,createdAt:new Date().toISOString()});
f.forEach(x=>rec[x[0]]=ov.querySelector("#dps-"+x[0]).value.trim());
if(!rec.storeName||!rec.clinicName||!rec.area)return toast("Store Name, Clinic Name aur Area zaroori hain","error");
const key=r=>[r.storeName,r.clinicName,r.area].join("|").toLowerCase().replace(/\s+/g," ");
if(DP.stores.some(x=>x.id!==sid&&key(x)===key(rec)))return toast("Ye store pehle se maujood hai","error");
const open=s?0:dpNum(ov.querySelector("#dps-open").value);
if(open<0)return toast("Baqaya minus mein nahi ho sakta","error");
btn.disabled=true;
try{await qPut("diststores",rec);
if(open>0)await qPut("distledger",{id:"open_"+sid,storeId:sid,kind:"due",amount:open,note:"Purana baqaya",createdAt:new Date().toISOString(),by:dpBooker()});
await dpLoad();audit(app.user.username,s?"UPDATE":"CREATE","distributor",sid,rec.storeName);ov.remove();done(sid)}
catch(err){btn.disabled=false;toast("Save nahi hua: "+err.message,"error")}}}

function dpLedger(sid){
const s=DP.stores.find(x=>x.id===sid);let bal=0;
const rows=dpEntries(sid).map(e=>{bal=dpNum(bal+e.debit-e.credit);return '<tr><td>'+esc(dpWhen(e.date))+'</td><td>'+esc(e.label)+'</td><td>'+(e.debit||"")+'</td><td>'+(e.credit||"")+'</td><td>'+bal+'</td></tr>'}).join("");
const ov=openModal("Ledger — "+s.storeName,'<div style="overflow:auto"><table class="tbl"><thead><tr><th>Date</th><th>Detail</th><th>Baqaya +</th><th>Wasool</th><th>Balance</th></tr></thead><tbody>'+rows+'</tbody></table></div><div class="grid g2" style="margin-top:10px"><div class="field"><label>Raqam</label><input class="inp" id="dpl-amt" type="number" min="0" step="any"></div><div class="field"><label>Qisam</label><select class="inp" id="dpl-kind"><option value="payment">Payment wasool hui</option><option value="due">Baqaya add karein</option></select></div></div><div class="field"><label>Note</label><input class="inp" id="dpl-note"></div>','<button class="btn btn-outline" data-close>Close</button><button class="btn btn-primary" id="dpl-save">Save Entry</button>',true);
ov.querySelector("[data-close]").onclick=()=>ov.remove();
const eid=id("dled");
ov.querySelector("#dpl-save").onclick=async e=>{const btn=e.currentTarget,amt=dpNum(ov.querySelector("#dpl-amt").value),kind=ov.querySelector("#dpl-kind").value;
if(!(amt>0))return toast("Sahi raqam likhein","error");
btn.disabled=true;
try{await dpLoad();if(kind==="payment"&&amt>dpDue(sid)){btn.disabled=false;return toast("Payment baqaya se zyada nahi ho sakti","error")}
await qPut("distledger",{id:eid,storeId:sid,kind:kind,amount:amt,note:ov.querySelector("#dpl-note").value.trim(),createdAt:new Date().toISOString(),by:dpBooker()});
audit(app.user.username,"CREATE","distributor",eid,s.storeName+" "+kind+" "+amt);await dpLoad();ov.remove();dpRender();dpLedger(sid)}
catch(err){btn.disabled=false;toast("Save nahi hua: "+err.message,"error")}}}

function dpStores(){
$("#dp-body").innerHTML='<div class="card"><div class="card-h"><div><h2>🏪 Medical Stores</h2><div class="sub">Har store ka ek hi panel: orders, delivery aur ledger</div></div><button type="button" class="btn btn-success sm" id="dp-newstore">＋ Naya Store</button></div><div class="card-b"><input class="inp" id="dp-q" placeholder="🔍 Store, area, order dene wala ya order no" style="margin-bottom:10px"><div style="overflow:auto"><table class="tbl"><thead><tr><th>Medical Store</th><th>Area</th><th>Orders</th><th>Baqaya</th><th>Action</th></tr></thead><tbody id="dp-rows"></tbody></table></div></div></div>';
const draw=()=>{const q=$("#dp-q").value.trim().toLowerCase();
const L=DP.stores.filter(s=>[s.storeName,s.clinicName,s.area].concat(DP.orders.filter(o=>o.storeId===s.id).flatMap(o=>[o.orderNo,o.orderBy])).join(" ").toLowerCase().includes(q));
$("#dp-rows").innerHTML=L.map(s=>{const mine=DP.orders.filter(o=>o.storeId===s.id),p=mine.filter(o=>o.status==="Pending").length,due=dpPos(dpDue(s.id)),b=(a,t,c)=>'<button type="button" class="btn sm '+c+'" data-dps="'+a+'" data-sid="'+esc(s.id)+'">'+t+'</button>';
return '<tr><td><b>'+esc(s.storeName)+'</b><div class="hint">'+esc(s.clinicName)+'</div></td><td>'+esc(s.area)+'</td><td>'+mine.length+(p?'<div class="hint">'+p+' pending</div>':"")+'</td><td><span class="badge '+(due>0?"amber":"green")+'">'+dpRs(due)+'</span></td><td><div class="dp-row" style="gap:5px;min-width:190px">'+b("open","📂 Kholein","btn-primary")+b("order","＋ Order","btn-success")+(dpCanDel()?b("del","Delete","btn-danger"):"")+'</div></td></tr>'}).join("")||'<tr><td colspan="5">Koi store nahi mila.</td></tr>';
$$("[data-dps]").forEach(x=>x.onclick=()=>{const sid=x.dataset.sid,a=x.dataset.dps;if(a==="order")dpPick(sid);else if(a==="del")dpDelStore(sid);else{DP.open=sid;dpRender()}})};
$("#dp-q").oninput=draw;draw();$("#dp-newstore").onclick=()=>dpStoreForm(null,sid=>{DP.open=sid;dpRender()})}
