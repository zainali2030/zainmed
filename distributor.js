/* Distributor Web Portal: store profile, order booking, history, ledger.
   Data alag stores mein: diststores, distorders, distledger */
const DP={tab:"book",storeId:"",stores:[],orders:[],ledger:[],draft:null};
const dpNum=v=>{const n=Number(v);return Number.isFinite(n)?Math.round(n*100)/100:0};
const dpRs=n=>((app.settings&&app.settings.currency)||"Rs")+" "+dpNum(n).toLocaleString("en-US",{maximumFractionDigits:2});
const dpWhen=iso=>iso?new Date(iso).toLocaleString("en-GB",{dateStyle:"medium",timeStyle:"short"}):"";
const dpBooker=()=>(app.user&&(app.user.fullName||app.user.username))||"";
const dpTotal=items=>dpNum(items.reduce((a,i)=>a+dpNum(dpNum(i.qty)*dpNum(i.rate)),0));
const dpNewDraft=()=>({id:id("dord"),items:[{name:"",qty:"",rate:""}],booker:dpBooker(),received:"",note:""});

/* Ledger = opening/manual dues + delivered orders - payments. Pending order baqaya mein nahi ginta. */
function dpEntries(storeId){
const a=DP.ledger.filter(l=>l.storeId===storeId).map(l=>({date:l.createdAt,label:l.note||(l.kind==="payment"?"Payment":"Baqaya"),debit:l.kind==="payment"?0:dpNum(l.amount),credit:l.kind==="payment"?dpNum(l.amount):0}));
DP.orders.filter(o=>o.storeId===storeId&&o.status==="Delivered").forEach(o=>a.push({date:o.deliveredAt,label:"Order "+o.orderNo+" delivered",debit:dpNum(o.total),credit:0}));
return a.sort((x,y)=>(x.date||"")<(y.date||"")?-1:1)}
const dpDue=storeId=>dpNum(dpEntries(storeId).reduce((a,e)=>a+e.debit-e.credit,0));

async function dpLoad(){
const [s,o,l]=await Promise.all([qGetAll("diststores"),qGetAll("distorders"),qGetAll("distledger")]);
DP.stores=s.sort((a,b)=>String(a.storeName).localeCompare(String(b.storeName)));
DP.orders=o.sort((a,b)=>(b.createdAt||"").localeCompare(a.createdAt||""));DP.ledger=l}

async function pageDistributor(){
$("#page").innerHTML='<div class="card" style="padding:14px">Distributor data load ho raha hai…</div>';
try{await dpLoad()}catch(e){if(app.route!=="distributor")return;$("#page").innerHTML='<div class="card" style="padding:14px">Data load nahi hua: '+esc(e.message)+'<br>Naya server.js lagayein aur server restart karein.</div>';return}
if(app.route==="distributor")dpRender()}

function dpRender(){
const tabs=[["book","🛒 New Order"],["history","📜 Order History"],["stores","🏪 Stores & Ledger"]];
$("#page").innerHTML='<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">'+tabs.map(t=>'<button type="button" class="btn '+(DP.tab===t[0]?"btn-primary":"btn-neutral")+'" data-dptab="'+t[0]+'">'+t[1]+'</button>').join("")+'</div>'+(netOK()?"":'<div class="card" style="padding:10px;margin-bottom:10px">📴 Offline: baqaya is device ke aakhri data ke mutabiq hai.</div>')+'<div id="dp-body"></div>';
$$("[data-dptab]").forEach(b=>b.onclick=()=>{DP.tab=b.dataset.dptab;dpRender()});
({book:dpBook,history:dpHistory,stores:dpStores})[DP.tab]()}

function dpStoreForm(s,done){
const f=[["storeName","Store Name *"],["clinicName","Medical Store / Clinic Name *"],["area","Area / Location *"],["phone","Mobile (optional)"]];
const ov=openModal(s?"Store Profile Edit":"Naya Store",f.map(x=>'<div class="field"><label>'+x[1]+'</label><input class="inp" id="dps-'+x[0]+'" value="'+esc(s?s[x[0]]||"":"")+'"></div>').join("")+(s?"":'<div class="field"><label>Purana baqaya (agar hai)</label><input class="inp" id="dps-open" type="number" min="0" step="any"></div>'),'<button class="btn btn-outline" data-close>Cancel</button><button class="btn btn-primary" id="dps-save">Save Store</button>');
ov.querySelector("[data-close]").onclick=()=>ov.remove();
const sid=s?s.id:id("dst");
ov.querySelector("#dps-save").onclick=async e=>{
const btn=e.currentTarget,rec=Object.assign({},s||{id:sid,createdAt:new Date().toISOString()});
f.forEach(x=>rec[x[0]]=ov.querySelector("#dps-"+x[0]).value.trim());
if(!rec.storeName||!rec.clinicName||!rec.area)return toast("Store Name, Clinic Name aur Area zaroori hain","error");
const key=r=>[r.storeName,r.clinicName,r.area].join("|").toLowerCase();
if(DP.stores.some(x=>x.id!==sid&&key(x)===key(rec)))return toast("Ye store pehle se maujood hai","error");
const open=s?0:dpNum(ov.querySelector("#dps-open").value);
if(open<0)return toast("Baqaya minus mein nahi ho sakta","error");
btn.disabled=true;
try{await qPut("diststores",rec);
if(open>0)await qPut("distledger",{id:"open_"+sid,storeId:sid,kind:"due",amount:open,note:"Purana baqaya",createdAt:new Date().toISOString(),by:dpBooker()});
await dpLoad();audit(app.user.username,s?"UPDATE":"CREATE","distributor",sid,rec.storeName);ov.remove();done(sid)}
catch(err){btn.disabled=false;toast("Save nahi hua: "+err.message,"error")}}}

/* ---- 1 & 3: profile + conditional baqaya, 2: hamesha fresh order ---- */
function dpPick(sid){DP.storeId=sid;DP.draft=dpNewDraft();DP.tab="book";dpRender()}
function dpBook(){
const st=DP.stores.find(s=>s.id===DP.storeId);
const products=Array.from(new Set(DP.orders.flatMap(o=>(o.items||[]).map(i=>i.name))));
$("#dp-body").innerHTML='<div class="card" style="padding:14px"><div style="display:flex;gap:8px;flex-wrap:wrap"><select class="inp" id="dp-store" style="flex:1;min-width:180px"><option value="">Store select karein</option>'+DP.stores.map(s=>'<option value="'+esc(s.id)+'"'+(s.id===DP.storeId?" selected":"")+'>'+esc(s.storeName+" — "+s.clinicName+" ("+s.area+")")+'</option>').join("")+'</select><button type="button" class="btn btn-outline" id="dp-newstore">＋ Naya Store</button></div><div id="dp-form"></div></div>';
$("#dp-store").onchange=e=>dpPick(e.target.value);
$("#dp-newstore").onclick=()=>dpStoreForm(null,dpPick);
if(!st)return;
if(!DP.draft)DP.draft=dpNewDraft();
const d=DP.draft,due=dpDue(st.id);
$("#dp-form").innerHTML='<div class="grid g2" style="margin-top:12px">'+[["Store Name",st.storeName],["Medical Store / Clinic Name",st.clinicName],["Area / Location",st.area]].map(x=>'<div class="field"><label>'+x[0]+'</label><input class="inp" readonly value="'+esc(x[1])+'"></div>').join("")+'<div class="field"><label>Order Booker *</label><input class="inp" id="dp-booker" value="'+esc(d.booker)+'"></div></div>'+
'<div class="field"><label>Outstanding Dues (Ledger)</label><div id="dp-due" style="min-height:42px;border:1px solid '+(due>0?"#f59e0b":"#cbd5e1")+';border-radius:10px;padding:10px;font-weight:800;'+(due>0?"background:#fef3c7;color:#92400e":"")+'">'+(due>0?dpRs(due):"")+'</div></div>'+
(due>0?'<div class="field"><label>Aaj wasool hui raqam (optional)</label><input class="inp" id="dp-recv" type="number" min="0" step="any" value="'+esc(d.received)+'"></div>':"")+
'<h3 style="margin:10px 0 6px">Order Items</h3><datalist id="dp-products">'+products.map(p=>'<option value="'+esc(p)+'">').join("")+'</datalist><div id="dp-items"></div><button type="button" class="btn btn-outline sm" id="dp-additem">＋ Add Item</button><div id="dp-total" style="font-size:18px;font-weight:800;text-align:right;margin:8px 0"></div><div class="field"><label>Note</label><input class="inp" id="dp-note" value="'+esc(d.note)+'"></div><button type="button" class="btn btn-primary" id="dp-submit" style="width:100%">Submit Order</button>';
const total=()=>$("#dp-total").textContent="Order Total: "+dpRs(dpTotal(d.items));
const items=()=>{$("#dp-items").innerHTML=d.items.map((it,i)=>'<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px"><input class="inp" list="dp-products" placeholder="Product" data-i="'+i+'" data-k="name" value="'+esc(it.name)+'" style="flex:3;min-width:150px"><input class="inp" type="number" min="1" step="1" placeholder="Qty" data-i="'+i+'" data-k="qty" value="'+esc(it.qty)+'" style="flex:1;min-width:70px"><input class="inp" type="number" min="0" step="any" placeholder="Rate" data-i="'+i+'" data-k="rate" value="'+esc(it.rate)+'" style="flex:1;min-width:80px"><button type="button" class="btn btn-neutral sm" data-dprm="'+i+'" aria-label="Item hatayein">✕</button></div>').join("");
$$("#dp-items [data-k]").forEach(x=>x.oninput=()=>{d.items[+x.dataset.i][x.dataset.k]=x.value;total()});
$$("[data-dprm]").forEach(b=>b.onclick=()=>{d.items.splice(+b.dataset.dprm,1);if(!d.items.length)d.items.push({name:"",qty:"",rate:""});items()});total()};
items();
$("#dp-additem").onclick=()=>{d.items.push({name:"",qty:"",rate:""});items()};
$("#dp-booker").oninput=e=>d.booker=e.target.value;
$("#dp-note").oninput=e=>d.note=e.target.value;
if($("#dp-recv"))$("#dp-recv").oninput=e=>d.received=e.target.value;
$("#dp-submit").onclick=e=>dpSubmit(st,e.currentTarget)}

async function dpSubmit(st,btn){
const d=DP.draft;
const used=d.items.filter(i=>String(i.name).trim()||i.qty!==""||i.rate!=="");
if(!d.booker.trim())return toast("Order Booker ka naam likhein","error");
if(!used.length)return toast("Kam az kam ek item likhein","error");
if(used.some(i=>!String(i.name).trim()||!Number.isInteger(Number(i.qty))||Number(i.qty)<=0||i.rate===""||!(Number(i.rate)>=0)))return toast("Har item ka naam, sahi Qty aur Rate likhein","error");
btn.disabled=true;
try{
await dpLoad(); /* submit se pehle ledger dobara check */
const due=dpDue(st.id),recv=dpNum(d.received);
if(recv<0||recv>Math.max(due,0)){btn.disabled=false;return toast("Wasooli 0 aur baqaya "+dpRs(Math.max(due,0))+" ke darmiyan honi chahiye","error")}
const n=await nextSeq("distOrderSeq",1),now=new Date().toISOString();
const items=used.map(i=>({name:String(i.name).trim(),qty:Number(i.qty),rate:dpNum(i.rate)}));
const order={id:d.id,orderNo:"DO-"+String(n).padStart(5,"0"),storeId:st.id,storeName:st.storeName,clinicName:st.clinicName,area:st.area,phone:st.phone||"",booker:d.booker.trim(),items:items,total:dpTotal(items),previousDue:due>0?due:null,received:recv,note:d.note.trim(),status:"Pending",createdAt:now};
await qPut("distorders",order);
if(recv>0)await qPut("distledger",{id:"pay_"+order.id,storeId:st.id,kind:"payment",amount:recv,note:"Wasooli, order "+order.orderNo,createdAt:now,by:order.booker});
audit(app.user.username,"CREATE","distributor",order.id,order.orderNo+" "+st.storeName);
/* active screen khali, order sirf History mein */
DP.storeId="";DP.draft=null;DP.tab="history";await dpLoad();dpRender();toast(order.orderNo+" Pending — History mein save ho gaya","success");
}catch(e){btn.disabled=false;toast("Order save mukammal nahi hua: "+e.message+" — dobara Submit karein","error")}}

function dpSlip(o,size){
const T=size!=="A4",s=app.settings||{},cell='style="border:1px solid #000;padding:3px;'+(T?"font-size:10px":"font-size:12px")+'"';
const info=[["Order No",o.orderNo],["Date",dpWhen(o.createdAt)],["Status",o.status],["Store Name",o.storeName],["Medical Store / Clinic",o.clinicName],["Area",o.area],["Order Booker",o.booker]];
return '<!--zmref:'+esc(o.orderNo)+'--><div style="width:'+(size==="58"?"54mm":size==="80"?"74mm":"100%")+';margin:0 auto;font-family:Arial;color:#000;font-size:'+(T?11:13)+'px"><div style="text-align:center;font-weight:900;font-size:'+(T?15:20)+'px">'+esc(s.clinicName||"")+'</div><div style="text-align:center;font-weight:700;border-bottom:2px solid #000;padding-bottom:4px;margin-bottom:6px">Distributor Order</div>'+info.map(x=>'<div><b>'+x[0]+':</b> '+esc(x[1])+'</div>').join("")+
'<table style="width:100%;border-collapse:collapse;margin-top:6px"><tr><th '+cell+'>Product</th><th '+cell+'>Qty</th><th '+cell+'>Rate</th><th '+cell+'>Amount</th></tr>'+o.items.map(i=>'<tr><td '+cell+'>'+esc(i.name)+'</td><td '+cell+'>'+i.qty+'</td><td '+cell+'>'+i.rate+'</td><td '+cell+'>'+dpNum(i.qty*i.rate)+'</td></tr>').join("")+'</table><div style="text-align:right;font-weight:900;margin-top:4px">Order Total: '+dpRs(o.total)+'</div>'+
(o.previousDue>0?'<div>Booking ke waqt purana baqaya: <b>'+dpRs(o.previousDue)+'</b></div>':"")+(o.received>0?'<div>Wasool: <b>'+dpRs(o.received)+'</b></div>':"")+(o.note?'<div>Note: '+esc(o.note)+'</div>':"")+'</div>'}

async function dpSetStatus(oid,status){
const o=DP.orders.find(x=>x.id===oid);if(!o)return;
if(!await confirmBox({title:o.orderNo,message:status==="Delivered"?"Delivered mark karein? "+dpRs(o.total)+" store ke ledger mein jama ho jayega.":"Ye order cancel karein?",confirmText:status==="Delivered"?"Mark Delivered":"Cancel Order",danger:status!=="Delivered"}))return;
try{await dpLoad();const cur=DP.orders.find(x=>x.id===oid);
if(!cur||cur.status!=="Pending"){toast("Is order ka status pehle hi badal chuka hai","info");return dpRender()}
const rec=Object.assign({},cur,{status:status});rec[status==="Delivered"?"deliveredAt":"cancelledAt"]=new Date().toISOString();
await qPut("distorders",rec);audit(app.user.username,"UPDATE","distributor",oid,rec.orderNo+" "+status);await dpLoad();dpRender()}
catch(e){toast("Status save nahi hua: "+e.message,"error")}}

function dpHistory(){
$("#dp-body").innerHTML='<div class="card" style="padding:12px"><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px"><input class="inp" id="dp-q" placeholder="Store, area, booker ya order no" style="flex:1;min-width:170px"><select class="inp" id="dp-st" style="width:auto"><option value="">All Status</option><option>Pending</option><option>Delivered</option><option>Cancelled</option></select></div><div id="dp-list"></div></div>';
const draw=()=>{const q=$("#dp-q").value.trim().toLowerCase(),f=$("#dp-st").value;
const L=DP.orders.filter(o=>(!f||o.status===f)&&[o.orderNo,o.storeName,o.clinicName,o.area,o.booker].join(" ").toLowerCase().includes(q));
$("#dp-list").innerHTML=L.map(o=>{const b=(a,t,c)=>'<button type="button" class="btn sm '+(c||"btn-neutral")+'" data-dpa="'+a+'" data-oid="'+esc(o.id)+'">'+t+'</button>';return '<div style="border-bottom:1px solid #cbd5e1;padding:10px 0"><b>'+esc(o.orderNo)+' — '+esc(o.storeName)+'</b> <span style="font-weight:800">['+esc(o.status)+']</span><div style="font-size:12px">'+esc(o.clinicName+" | "+o.area+" | Booker: "+o.booker)+'<br>'+dpWhen(o.createdAt)+' | '+o.items.length+' item | <b>'+dpRs(o.total)+'</b></div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">'+b("view","👁 View")+b("a4","🖨 A4")+b("th","🧾 Thermal")+b("wa","💬 WhatsApp")+(o.status==="Pending"?b("Delivered","✔ Delivered","btn-success")+b("Cancelled","Cancel Order"):"")+b("new","🛒 New Order","btn-primary")+'</div></div>'}).join("")||'<div>Koi order nahi mila.</div>';
$$("[data-dpa]").forEach(x=>x.onclick=()=>{const o=DP.orders.find(y=>y.id===x.dataset.oid),a=x.dataset.dpa;
if(a==="view")openModal(o.orderNo,'<div style="background:#fff;padding:10px;overflow:auto">'+dpSlip(o,"A4")+'</div>',"",true);
else if(a==="a4")printHTML(dpSlip(o,"A4"),"A4");
else if(a==="th"){const z=usThermalSize();printHTML(dpSlip(o,z),z)}
else if(a==="wa"){if(waNum(o.phone).length<10)return toast("Store profile mein sahi mobile number likhein","error");openWA(o.phone,"Order "+o.orderNo+" ("+o.status+")\n"+o.storeName+"\n"+o.items.map(i=>i.name+" x "+i.qty+" @ "+i.rate).join("\n")+"\nTotal: "+dpRs(o.total))}
else if(a==="new"){if(DP.stores.some(s=>s.id===o.storeId))dpPick(o.storeId)}
else dpSetStatus(o.id,a)})};
$("#dp-q").oninput=draw;$("#dp-st").onchange=draw;draw()}

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
$("#dp-body").innerHTML='<div class="card" style="padding:12px"><button type="button" class="btn btn-primary" id="dp-newstore">＋ Naya Store</button>'+(DP.stores.map(s=>{const due=dpDue(s.id),b=(a,t)=>'<button type="button" class="btn btn-neutral sm" data-dps="'+a+'" data-sid="'+esc(s.id)+'">'+t+'</button>';return '<div style="border-bottom:1px solid #cbd5e1;padding:10px 0"><b>'+esc(s.storeName)+'</b><div style="font-size:12px">'+esc(s.clinicName+" | "+s.area+(s.phone?" | "+s.phone:""))+'</div>'+(due>0?'<div style="color:#b45309;font-weight:800">Baqaya: '+dpRs(due)+'</div>':"")+'<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">'+b("order","🛒 New Order")+b("ledger","📒 Ledger")+b("edit","✏️ Edit")+'</div></div>'}).join("")||'<p>Abhi koi store nahi. Pehla store add karein.</p>')+'</div>';
$("#dp-newstore").onclick=()=>dpStoreForm(null,()=>dpRender());
$$("[data-dps]").forEach(x=>x.onclick=()=>{const sid=x.dataset.sid,a=x.dataset.dps;if(a==="order")dpPick(sid);else if(a==="ledger")dpLedger(sid);else dpStoreForm(DP.stores.find(s=>s.id===sid),()=>dpRender())})}
