// 自動產生：由 assets/store.js 包成伺服器模組（node scripts/sync-store.cjs），請勿直接修改。
export function loadStore(window, localStorage, CustomEvent) {
(() => {
 'use strict';
 const KEY='pure-select-store-v1';
 const copy=x=>JSON.parse(JSON.stringify(x));
 const error=message=>{throw new Error(message)};
 const number=(x,name,min=0,max=1000000)=>{const n=x;if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max)error(`${name}超出允許範圍`);return n};
 const integer=(x,name,min=0,max=1000000)=>{const n=number(x,name,min,max);if(!Number.isInteger(n))error(`${name}必須是整數`);return n};
 const text=(x,name,max=200)=>{if(typeof x!=='string'||!x.trim()||x.length>max)error(`${name}必須填寫，且不能超過 ${max} 字`);return x.trim()};
 const today=()=>{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const get=t=>parts.find(p=>p.type===t).value;return `${get('year')}-${get('month')}-${get('day')}`};
 const addMonths=(ymd,n)=>{const [y,m,d]=ymd.split('-').map(Number),last=new Date(Date.UTC(y,m-1+n+1,0)).getUTCDate();return new Date(Date.UTC(y,m-1+n,Math.min(d,last))).toISOString().slice(0,10)};
 const imageURL=x=>typeof x==='string'&&((/^assets\/[a-zA-Z0-9_./-]+$/.test(x)&&!x.includes('..'))||/^https:\/\//.test(x)||/^data:image\/(?:jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/.test(x));
 // 規格：第一個固定為 200g 咖啡豆；濾掛、濾泡為選配，每款各最多一個。
 const formats=['bean','drip','steep'];
 const extraFormats=['drip','steep'];
 const packKeys=['200','drip','steep','250','500']; // 250／500 僅保留於版本 3 之前已完成的批次紀錄
 const grinds=['whole','pour','espresso'];
 const formatOf=v=>v.format||'bean';
 const packKey=v=>v.format||String(v.grams);
 const variantLabel=v=>({drip:`濾掛包 ${v.count} 入`,steep:`濾泡包 ${v.count} 入`}[formatOf(v)]||`${v.grams}g 咖啡豆`);
 const grindLabels={whole:'原豆（不研磨）',pour:'手沖研磨',espresso:'義式研磨'};
 // 所有型態都可選焙度（接單後依所選焙度烘焙，同一 SKU 不同焙度共用庫存）；商品本身的 roast 為烘豆師推薦焙度，即預設值。
 const roasts=['light-medium','medium','medium-dark'];
 const roastLabels={'light-medium':'淺中焙',medium:'中焙','medium-dark':'中深焙'};
 const defaultRoast=p=>({'淺焙':'light-medium','中焙':'medium','中深焙':'medium-dark'}[p.roast]||'medium');
 const roastPrefs=['any',...roasts];
 const legacyRoastPrefs=['淺焙','中焙','中深焙'];
 const plans=()=>window.COFFEE_PLANS||[];
 // 配送方式：7-11、全家為超商取貨（地址欄填門市），宅配為地址；未滿免運門檻時依方式收運費。
 const deliveries=['711','family','home'];
 const deliveryLabels={'711':'7-ELEVEN 取貨',family:'全家取貨',home:'宅配到府'};
 const defaultRates={'711':60,family:60,home:80};
 const lineKey=i=>i.kind==='treat'?'treat:'+i.treatId:i.sku+(i.grind?'|'+i.grind:'')+(i.roast?'@'+i.roast:'');
 // 英文版（選填）：英文頁面使用這些欄位，空白的欄位維持翻譯對照表的英文。
 const enProductKeys=['name','country','region','variety','process','harvest','altitude','description'],enTreatKeys=['name','spec','shelf','description'];
 function validateEn(en,keys,label){if(en===undefined)return;if(!en||typeof en!=='object'||Array.isArray(en))error(label+'英文版格式不正確');Object.entries(en).forEach(([k,v])=>{if(k==='flavors'&&keys===enProductKeys){if(!Array.isArray(v)||!v.length||v.length>10||v.some(x=>typeof x!=='string'||!x.trim()||x.length>40))error('英文風味標籤需為 1–10 個，每個 40 字以內');return}if(!keys.includes(k)||typeof v!=='string'||!v.trim()||v.length>1200)error(label+'英文版欄位不正確')})}
 function localize(s,lang){if(lang!=='en')return s;const pick=(o,keys)=>{if(!o.en)return o;const x={...o};keys.forEach(k=>{if(o.en[k])x[k]=o.en[k]});if(o.en.flavors?.length)x.flavors=o.en.flavors;return x};return {...s,products:s.products.map(p=>pick(p,enProductKeys)),treats:s.treats.map(t=>pick(t,enTreatKeys))}}
 function validateProduct(p){
  if(typeof p.active!=='boolean')error('上架狀態必須是布林值');if(!p.brew||!p.profile)error('缺少沖煮與風味示意設定');['ratio','temperature','grind'].forEach(k=>text(p.brew[k],'沖煮設定',150));Object.values(p.profile).forEach(v=>integer(v,'風味示意分數',1,5));text(p.id,'商品 ID',60);if(!/^[a-z0-9-]+$/.test(p.id))error('商品 ID 僅可含小寫英文字、數字與連字號');
  ['name','country','region','variety','process','roast','description'].forEach(k=>text(p[k],k,1200));
  if(!['floral','sweet','cocoa'].includes(p.flavor))error('請選擇風味分類');
  if(!Array.isArray(p.flavors)||!p.flavors.length||p.flavors.length>10||p.flavors.some(v=>typeof v!=='string'||v.length>40))error('請填寫 1–10 個風味描述');
  if(!Array.isArray(p.gallery)||p.gallery.length<5||p.gallery.length>12)error('每款商品需要 5–12 張圖片');
  if(new Set(p.gallery.map(i=>i.src)).size<5)error('每款商品至少需要 5 張不同圖片');p.gallery.forEach(i=>{if(!imageURL(i.src))error('圖片需為 assets/ 路徑、HTTPS 網址或 PNG/JPEG/WebP 圖片');text(i.alt,'圖片說明',200);text(i.label,'圖片標題',40)});
  if(!Array.isArray(p.variants)||p.variants.length<1||p.variants.length>3)error('請保留 200g 咖啡豆規格');
  p.variants.forEach((v,i)=>{if(i===0){if(v.format!==undefined||v.grams!==200||v.sku!==`${p.id}-200`)error('SKU 與克數不一致')}else{if(!extraFormats.includes(v.format)||v.sku!==`${p.id}-${v.format}`)error('濾掛／濾泡規格設定不正確');integer(v.count,'每盒入數',1,100);integer(v.grams,'每盒淨重',1,5000)}integer(v.price,'價格',1,100000);integer(v.stock,'庫存包數',0,100000)});
  if(new Set(p.variants.map(v=>v.sku)).size!==p.variants.length)error('規格重複');
  validateEn(p.en,enProductKeys,'商品');
 }
 function validateTreat(t){text(t.id,'點心 ID',60);if(!/^[a-z0-9-]+$/.test(t.id))error('點心 ID 僅可含小寫英文字、數字與連字號');['name','spec','shelf'].forEach(k=>text(t[k],k,60));text(t.description,'點心說明',300);if(!imageURL(t.image))error('圖片需為 assets/ 路徑、HTTPS 網址或 PNG/JPEG/WebP 圖片');if(typeof t.active!=='boolean')error('上架狀態必須是布林值');integer(t.price,'價格',1,100000);integer(t.stock,'庫存數量',0,100000);validateEn(t.en,enTreatKeys,'點心')}
 const timestamp=v=>{if(typeof v!=='string'||!Number.isFinite(Date.parse(v)))error('紀錄時間格式不正確')};
 const customerFields=(c,label='訂購人')=>{text(c?.name,label,80);text(c?.email,'電子信箱',150);text(c?.phone,'電話',30);text(c?.address,'地址',300)};
 function validate(s){
  if(s?.version!==3||!Array.isArray(s.products)||!Array.isArray(s.orders)||!Array.isArray(s.cart)||!Array.isArray(s.batches)||!Array.isArray(s.ledger)||!Array.isArray(s.treats)||!Array.isArray(s.subscriptions)||!s.settings)error('資料格式不相容');
  s.products.forEach(validateProduct);s.treats.forEach(validateTreat);
  if(new Set(s.products.map(p=>p.id)).size!==s.products.length)error('商品 ID 重複');if(new Set(s.treats.map(t=>t.id)).size!==s.treats.length)error('點心 ID 重複');
  text(s.settings.shopName,'商店名稱',50);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.settings.supportEmail))error('客服電子信箱格式不正確');if(!s.settings.shippingRates)error('缺少運費設定');deliveries.forEach(d=>integer(s.settings.shippingRates[d],'運費',0,10000));integer(s.settings.freeShipping,'免運門檻',0,100000);integer(s.settings.carouselSeconds,'輪播秒數',4,30);if(s.settings.theme!==undefined&&!['terra','forest','cobalt','nocturne'].includes(s.settings.theme))error('網站配色不正確');integer(s.settings.giftWrapFee,'禮盒包裝費',0,10000);
  const ids=new Set(s.products.map(p=>p.id)),treatIds=new Set(s.treats.map(t=>t.id));
  const batchIds=new Set();
  s.batches.forEach(b=>{if(typeof b.stockApplied!=='boolean'||b.stockApplied!==(b.status==='completed'))error('批次入庫旗標與狀態不一致');if(batchIds.has(b.id)||!ids.has(b.productId))error('批次商品關聯或 ID 不正確');batchIds.add(b.id);if(!['planned','roasting','completed'].includes(b.status))error('批次狀態不正確');date(b.roastDate);integer(b.durationSeconds,'烘焙秒數',60,3600);if(!b.packs||!Object.keys(b.packs).length||Object.entries(b.packs).some(([k,v])=>!packKeys.includes(k)||!Number.isInteger(v)||v<0||v>100000))error('批次包裝數量不正確')});
  s.products.forEach(p=>{if(p.batchId&&!s.batches.some(b=>b.id===p.batchId&&b.productId===p.id&&b.status==='completed'))error('商品烘焙批次關聯不正確')});
  if(new Set(s.cart.map(lineKey)).size!==s.cart.length)error('購物車 SKU 重複');s.cart.forEach(i=>{integer(i.quantity,'購買包數',1,99);if(i.kind==='treat'){if(!treatIds.has(i.treatId))error('購物車商品不存在');return}const p=s.products.find(p=>p.id===i.productId),v=p?.variants.find(v=>v.sku===i.sku);if(!v)error('購物車商品不存在');if(i.grind!==undefined&&(formatOf(v)!=='bean'||!grinds.includes(i.grind)))error('研磨方式不正確');if(i.roast!==undefined&&!roasts.includes(i.roast))error('焙度不正確')});
  const orderIds=new Set();
  s.orders.forEach(o=>{text(o.id,'訂單號碼',100);timestamp(o.createdAt);if(orderIds.has(o.id)||!Array.isArray(o.items)||!o.items.length)error('訂單格式不正確');orderIds.add(o.id);if(!statuses.includes(o.status)||!payments.includes(o.payment))error('訂單狀態不正確');['subtotal','shipping','total'].forEach(k=>integer(o[k],'訂單金額',0,10000000));const giftFee=o.giftFee===undefined?0:integer(o.giftFee,'禮盒包裝費',0,10000);if(o.delivery!==undefined&&!deliveries.includes(o.delivery))error('配送方式不正確');if(o.customerNote!==undefined&&(typeof o.customerNote!=='string'||o.customerNote.length>200))error('備註格式不正確');if(o.gift!==undefined&&(typeof o.gift.wrap!=='boolean'||typeof o.gift.card!=='string'||o.gift.card.length>200))error('禮盒資料格式不正確');if(o.total!==o.subtotal+o.shipping+giftFee)error('訂單總額不一致');let sub=0;o.items.forEach(i=>{integer(i.quantity,'訂單包數',1,99);integer(i.price,'訂單價格',1,100000);sub+=i.quantity*i.price;if(i.kind==='treat'){if(i.grams!==0||!treatIds.has(i.treatId))error('訂單對應商品不存在');return}integer(i.grams,'訂單重量',1,10000);if(!ids.has(i.productId))error('訂單對應商品不存在');if(i.grind!==undefined&&!grinds.includes(i.grind))error('研磨方式不正確');if(i.roast!==undefined&&!roasts.includes(i.roast))error('焙度不正確')});if(new Set(o.items.map(lineKey)).size!==o.items.length)error('訂單 SKU 重複');if(typeof o.reserved!=='boolean'||!Array.isArray(o.history))error('訂單庫存或歷程格式不正確');o.history.forEach(h=>{timestamp(h.at);text(h.text,'處理紀錄',1000)});if(sub!==o.subtotal)error('訂單品項總額不一致');customerFields(o.customer)});
  const subIds=new Set();
  s.subscriptions.forEach(x=>{text(x.id,'訂閱編號',100);if(subIds.has(x.id))error('訂閱編號重複');subIds.add(x.id);timestamp(x.createdAt);text(x.planId,'方案',40);text(x.name,'方案名稱',80);integer(x.price,'每期金額',1,100000);if(!['1','2'].includes(x.cycle)||!roastPrefs.includes(x.roast)&&!legacyRoastPrefs.includes(x.roast)||(x.grind!==undefined&&!grinds.includes(x.grind)))error('訂閱設定不正確');if(!subStatuses.includes(x.status))error('訂閱狀態不正確');date(x.nextDate);customerFields(x.customer,'訂閱人');if(!Array.isArray(x.history))error('訂閱歷程格式不正確');x.history.forEach(h=>{timestamp(h.at);text(h.text,'處理紀錄',1000)})});
  s.ledger.forEach(m=>{timestamp(m.at);integer(m.delta,'庫存異動包數',-100000,100000);integer(m.balance,'庫存餘額',0,100000);text(m.reason,'庫存異動原因',1000)});
  return s;
 }
 function date(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)error('日期格式不正確');return v}
 const statuses=['new','confirmed','packing','shipped','completed','cancelled'];
 const payments=['unpaid','paid','refund_pending','refunded'];
 const subStatuses=['active','paused','cancelled'];
 // 版本 1 → 2：補上濾掛／濾泡規格（以初始資料的庫存入庫並記錄）、點心、訂閱與禮盒設定；既有訂單、庫存與自訂內容不變。
 // 版本 2 → 3：咖啡豆 250g／500g 改為單一 200g，庫存依總重量換算並記錄；舊訂單保留原規格快照。
 function migrate(saved){
  if(saved?.version===1)migrate1(saved);
  if(saved?.version===2)migrate2(saved);
  if(saved?.settings&&!saved.settings.shippingRates){const fee=saved.settings.shippingFee;saved.settings.shippingRates={...defaultRates};delete saved.settings.shippingFee;void fee}
  return saved;
 }
 function migrate2(saved){
  const seed=window.COFFEE_SEED,at=new Date().toISOString(),log=m=>{if(Array.isArray(saved.ledger))saved.ledger.unshift({id:'MV-UPGRADE-'+m.sku,at,...m})};
  (saved.products||[]).forEach(p=>{if(!Array.isArray(p.variants))return;const beans=p.variants.filter(v=>!v.format);if(!beans.length||beans.every(v=>v.grams===200))return;const from=seed.products.find(x=>x.id===p.id),weight=beans.reduce((n,v)=>n+v.stock*v.grams,0);const bean={sku:p.id+'-200',grams:200,price:from?from.variants[0].price:Math.max(1,Math.round(beans[0].price*.8/10)*10),stock:Math.round(weight/200)};beans.forEach(v=>log({productId:p.id,sku:v.sku,grams:v.grams,delta:-v.stock,balance:0,reason:'版本更新：'+v.grams+'g 規格停售，庫存依重量轉入 200g'}));log({productId:p.id,sku:bean.sku,grams:200,delta:bean.stock,balance:bean.stock,reason:'版本更新：新增 200g 咖啡豆規格'});p.variants=[bean,...p.variants.filter(v=>v.format)]});
  if(Array.isArray(saved.cart))saved.cart=saved.cart.filter(i=>i.kind==='treat'||saved.products.some(p=>p.variants.some(v=>v.sku===i.sku)));
  (saved.batches||[]).forEach(b=>{if(b.status==='completed'||!b.packs||b.packs['250']===undefined)return;const{'250':a=0,'500':c=0,...rest}=b.packs;b.packs={'200':Math.round((a*250+c*500)/200),...rest}});
  saved.version=3;
 }
 function migrate1(saved){
  const seed=window.COFFEE_SEED,at=new Date().toISOString();
  saved.products.forEach(p=>{const from=seed.products.find(x=>x.id===p.id);if(!from||!Array.isArray(p.variants)||p.variants.length!==2)return;from.variants.filter(v=>v.format).forEach(v=>{p.variants.push(copy(v));if(Array.isArray(saved.ledger))saved.ledger.unshift({id:'MV-UPGRADE-'+v.sku,at,productId:p.id,sku:v.sku,grams:v.grams,delta:v.stock,balance:v.stock,reason:'版本更新：新增'+variantLabel(v)+'規格'})})});
  saved.treats=saved.treats||copy(seed.treats);saved.subscriptions=saved.subscriptions||[];if(saved.settings&&saved.settings.giftWrapFee===undefined)saved.settings.giftWrapFee=seed.settings.giftWrapFee;saved.version=2;
 }
 let memory=copy(window.COFFEE_SEED);
 function state(){let raw;try{raw=localStorage.getItem(KEY)}catch(_){return copy(memory)}if(!raw)return copy(memory);try{const saved=migrate(JSON.parse(raw));if(saved.settings?.shopName==='四選淨豆')saved.settings.shopName=window.COFFEE_SEED.settings.shopName;return copy(validate(saved))}catch(_){error('已保存的資料格式不相容，請先匯出或從設定還原預設資料')}}
 function commit(s){validate(s);s.updatedAt=new Date().toISOString();try{localStorage.setItem(KEY,JSON.stringify(s))}catch(_){error('資料無法保存：請檢查瀏覽器儲存權限或空間。此次修改未套用。')}memory=copy(s);window.dispatchEvent(new CustomEvent('coffee:change'));return copy(s)}
 const mutate=fn=>{const s=state();const result=fn(s);commit(s);return copy(result??s)};
 const getProduct=(s,id)=>s.products.find(p=>p.id===id)||error('找不到商品');
 const getVariant=(p,sku)=>p.variants.find(v=>v.sku===sku)||error('找不到規格');
 const getTreat=(s,id)=>s.treats.find(t=>t.id===id)||error('找不到點心');
 const ledger=(s,p,v,delta,reason)=>s.ledger.unshift({id:'MV-'+Date.now()+'-'+Math.random().toString(36).slice(2,6),at:new Date().toISOString(),productId:p.id,sku:v.sku,grams:v.grams,delta,balance:v.stock,reason});
 const treatLedger=(s,t,delta,reason)=>s.ledger.unshift({id:'MV-'+Date.now()+'-'+Math.random().toString(36).slice(2,6),at:new Date().toISOString(),productId:'treat:'+t.id,sku:'treat-'+t.id,grams:0,delta,balance:t.stock,reason});
 // 同一 SKU 不同研磨分開成購物車行，但共用同一份庫存。
 const skuQuantity=(s,sku,exceptKey)=>s.cart.filter(i=>i.kind!=='treat'&&i.sku===sku&&lineKey(i)!==exceptKey).reduce((n,i)=>n+i.quantity,0);
 function cartDetails(s=state(),delivery='711'){if(!deliveries.includes(delivery))error('請選擇配送方式');const lines=s.cart.map(i=>{if(i.kind==='treat'){const treat=getTreat(s,i.treatId);return {...i,key:lineKey(i),treat,name:treat.name,price:treat.price,stock:treat.stock,grams:0,lineTotal:treat.price*i.quantity}}const product=getProduct(s,i.productId),variant=getVariant(product,i.sku);return {...i,kind:'coffee',key:lineKey(i),product,variant,name:product.name,price:variant.price,stock:variant.stock,grams:variant.grams,lineTotal:variant.price*i.quantity}});const subtotal=lines.reduce((n,i)=>n+i.lineTotal,0),shipping=lines.length&&subtotal<s.settings.freeShipping?s.settings.shippingRates[delivery]:0;return {lines,subtotal,shipping,total:subtotal+shipping,count:lines.reduce((n,i)=>n+i.quantity,0),grams:lines.reduce((n,i)=>n+i.quantity*i.grams,0)}}
 function addCart(id,sku,q,grind,roast){return mutate(s=>{q=integer(q,'購買包數',1,99);const p=getProduct(s,id),v=getVariant(p,sku);if(!p.active)error('此商品已下架');roast=roast||defaultRoast(p);if(!roasts.includes(roast))error('焙度不正確');if(formatOf(v)==='bean'){grind=grind||'whole';if(!grinds.includes(grind))error('研磨方式不正確')}else grind=undefined;const key=lineKey({sku,grind,roast}),i=s.cart.find(i=>lineKey(i)===key);const line=(i?.quantity||0)+q;if(line+skuQuantity(s,sku,key)>v.stock||line>99)error('購買包數超過目前庫存');if(i)i.quantity=line;else s.cart.push(grind?{productId:id,sku,grind,roast,quantity:q}:{productId:id,sku,roast,quantity:q})})}
 function addTreat(id,q){return mutate(s=>{q=integer(q,'購買數量',1,99);const t=getTreat(s,id);if(!t.active)error('此商品已下架');const i=s.cart.find(i=>i.kind==='treat'&&i.treatId===id);const total=(i?.quantity||0)+q;if(total>t.stock||total>99)error('購買數量超過目前庫存');if(i)i.quantity=total;else s.cart.push({kind:'treat',treatId:id,quantity:q})})}
 function setCart(key,q){return mutate(s=>{q=integer(q,'購買包數',0,99);const i=s.cart.find(i=>lineKey(i)===key);if(!i)error('購物車品項不存在');if(q===0){s.cart=s.cart.filter(i=>lineKey(i)!==key);return}if(i.kind==='treat'){if(q>getTreat(s,i.treatId).stock)error('購買數量超過目前庫存')}else{const v=getVariant(getProduct(s,i.productId),i.sku);if(q+skuQuantity(s,i.sku,key)>v.stock)error('購買包數超過目前庫存')}i.quantity=q})}
 function createOrder(customer,extras={}){return mutate(s=>{['name','email','phone','address'].forEach(k=>text(customer[k],k,k==='address'?300:150));if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email))error('電子信箱格式不正確');const delivery=extras.delivery||'711';if(!deliveries.includes(delivery))error('請選擇配送方式');const wrap=extras.giftWrap===true,card=String(extras.card||'').trim(),note=String(extras.note||'').trim();if(card.length>200)error('卡片內容不能超過 200 字');if(note.length>200)error('備註不能超過 200 字');const c=cartDetails(s,delivery);if(!c.lines.length)error('購物車是空的');const need={};c.lines.forEach(i=>{const k=i.kind==='treat'?i.key:i.sku;need[k]=(need[k]||0)+i.quantity;const active=i.kind==='treat'?i.treat.active:i.product.active;if(!active||need[k]>i.stock)error(`${i.name} 庫存不足或已下架`)});let id=extras.id||'DEMO-'+today().replaceAll('-','')+'-'+String(s.orders.length+1).padStart(4,'0');while(s.orders.some(o=>o.id===id))id+='X';const giftFee=wrap?s.settings.giftWrapFee:0;const o={id,createdAt:new Date().toISOString(),status:'new',payment:'unpaid',customer:copy(customer),items:c.lines.map(i=>i.kind==='treat'?{kind:'treat',treatId:i.treatId,sku:'treat-'+i.treatId,name:i.treat.name+'（'+i.treat.spec+'）',grams:0,price:i.price,quantity:i.quantity}:{productId:i.productId,sku:i.sku,name:i.product.name,grams:i.variant.grams,...(i.variant.format?{format:i.variant.format}:{}),...(i.grind?{grind:i.grind}:{}),...(i.roast?{roast:i.roast}:{}),price:i.price,quantity:i.quantity,batchId:i.product.batchId||''}),subtotal:c.subtotal,shipping:c.shipping,giftFee,total:c.total+giftFee,delivery,...(note?{customerNote:note}:{}),gift:{wrap,card},reserved:true,tracking:'',notes:extras.notes??'',history:[{at:new Date().toISOString(),text:extras.historyText||'建立訂單並保留庫存'}]};c.lines.forEach(i=>{if(i.kind==='treat'){i.treat.stock-=i.quantity;treatLedger(s,i.treat,-i.quantity,'訂單 '+id)}else{i.variant.stock-=i.quantity;ledger(s,i.product,i.variant,-i.quantity,'訂單 '+id)}});s.orders.unshift(o);s.cart=[];return o})}
 function updateOrder(id,changes){return mutate(s=>{const o=s.orders.find(o=>o.id===id)||error('訂單不存在');if(changes.status&&changes.status!==o.status){const next=changes.status;if(!statuses.includes(next))error('訂單狀態不正確');if(o.status==='cancelled')error('已取消訂單無法重新出貨');if(next==='cancelled'){if(['shipped','completed'].includes(o.status))error('已出貨訂單需另行處理退貨，不能直接取消');if(o.reserved){o.items.forEach(i=>{if(i.kind==='treat'){const t=getTreat(s,i.treatId);t.stock+=i.quantity;treatLedger(s,t,i.quantity,'取消訂單 '+id);return}const p=getProduct(s,i.productId),v=p.variants.find(v=>v.sku===i.sku);if(!v){o.history.push({at:new Date().toISOString(),text:i.sku+' 規格已停售，不回補庫存'});return}v.stock+=i.quantity;ledger(s,p,v,i.quantity,'取消訂單 '+id)});o.reserved=false}if(o.payment==='paid')o.payment='refund_pending'}else{const transitions={new:['confirmed'],confirmed:['packing'],packing:['shipped'],shipped:['completed']};if(!transitions[o.status]?.includes(next))error('請依確認、備貨、出貨、完成的順序處理');if(next==='shipped'&&!String(changes.tracking||o.tracking).trim())error('出貨前請填寫物流單號')}o.status=next;o.history.push({at:new Date().toISOString(),text:'狀態更新為 '+next})}
 if(changes.payment&&changes.payment!==o.payment){if(!payments.includes(changes.payment))error('付款狀態不正確');if(changes.payment==='paid'&&o.status==='cancelled')error('已取消訂單不能標記收款');if(changes.payment==='refunded'&&!(o.status==='cancelled'&&o.payment==='refund_pending'))error('僅待退款的取消訂單可標記退款完成');if(changes.payment==='refund_pending')error('待退款狀態由取消已付款訂單產生');if(changes.payment==='unpaid'&&o.payment!=='unpaid')error('已收款或退款狀態不能改回未付款');o.payment=changes.payment;o.history.push({at:new Date().toISOString(),text:'付款記錄更新為 '+changes.payment})}
 if(changes.tracking!==undefined)o.tracking=String(changes.tracking).slice(0,100);if(changes.notes!==undefined)o.notes=String(changes.notes).slice(0,1000);return o})}
 // 編輯商品不能改庫存；新增的濾掛／濾泡規格從 0 包開始，移除規格需庫存為 0 且沒有訂單紀錄。
 function saveProduct(p){validateProduct(p);return mutate(s=>{const at=s.products.findIndex(v=>v.id===p.id);if(at<0)s.products.push(copy(p));else{const old=s.products[at];p.variants.forEach(v=>{const was=old.variants.find(x=>x.sku===v.sku);if(was?v.stock!==was.stock:v.stock!==0)error('請從庫存管理調整包數，商品編輯不能直接覆寫庫存')});old.variants.filter(v=>!p.variants.some(x=>x.sku===v.sku)).forEach(v=>{if(v.stock>0)error('請先把要移除的規格庫存調整為 0');if(s.orders.some(o=>o.items.some(i=>i.sku===v.sku)))error('此規格有訂單紀錄，請保留規格並把庫存調整為 0');s.cart=s.cart.filter(i=>i.sku!==v.sku)});s.products[at]=copy(p)}return p})}
 function deleteProduct(id){return mutate(s=>{if(s.orders.some(o=>o.items.some(i=>i.productId===id)))error('商品有訂單紀錄，請改為下架以保留紀錄');s.products=s.products.filter(p=>p.id!==id);s.batches=s.batches.filter(b=>b.productId!==id);s.cart=s.cart.filter(i=>i.productId!==id);s.ledger=s.ledger.filter(i=>i.productId!==id)})}
 function adjustStock(id,sku,delta,reason){return mutate(s=>{delta=integer(delta,'調整包數',-100000,100000);text(reason,'調整原因',200);const p=getProduct(s,id),v=getVariant(p,sku);if(v.stock+delta<0)error('調整後庫存不能為負數');v.stock+=delta;ledger(s,p,v,delta,reason);return v})}
 function saveTreat(t){validateTreat(t);return mutate(s=>{const at=s.treats.findIndex(x=>x.id===t.id);if(at<0){if(t.stock!==0)error('新點心請從 0 開始，再用調整庫存入庫');s.treats.push(copy(t))}else{if(t.stock!==s.treats[at].stock)error('請從庫存調整修改數量，編輯點心不能直接覆寫庫存');s.treats[at]=copy(t)}return t})}
 function adjustTreatStock(id,delta,reason){return mutate(s=>{delta=integer(delta,'調整數量',-100000,100000);text(reason,'調整原因',200);const t=getTreat(s,id);if(t.stock+delta<0)error('調整後庫存不能為負數');t.stock+=delta;treatLedger(s,t,delta,reason);return t})}
 function addBatch(b){return mutate(s=>{const p=getProduct(s,b.productId);date(b.roastDate);integer(b.durationSeconds,'烘焙秒數',60,3600);const packs={'200':integer(b.packs['200'],'200g 包數',0,100000)};p.variants.slice(1).forEach(v=>{packs[v.format]=integer(b.packs[v.format]??0,'濾掛／濾泡包數',0,100000)});if(!Object.values(packs).some(Boolean))error('請填寫至少一包的包裝量');const batch={...copy(b),packs,id:'RB-'+Date.now()+'-'+Math.random().toString(36).slice(2,5),roast:p.roast,status:'planned',stockApplied:false};s.batches.unshift(batch);return batch})}
 function updateBatch(id,status){return mutate(s=>{const b=s.batches.find(b=>b.id===id)||error('批次不存在');if(b.status==='completed')error('已完成批次不能重複入庫');if(status==='completed'&&b.status!=='roasting')error('請先將批次標記為烘焙中');if(!['roasting','completed'].includes(status))error('批次狀態不正確');if(status==='completed'){if(b.roastDate>today())error('未到烘焙日期，不能標记完成');if(b.stockApplied)error('此批次已入庫');const p=getProduct(s,b.productId);p.variants.forEach(v=>{const q=b.packs[packKey(v)]||0;if(!q)return;v.stock+=q;ledger(s,p,v,q,'批次完成 '+id)});b.stockApplied=true;const current=s.batches.find(x=>x.id===p.batchId);if(!current||b.roastDate>=current.roastDate)p.batchId=b.id}b.status=status;return b})}
 function createSubscription(f){return mutate(s=>{const plan=plans().find(p=>p.id===f.planId)||error('請選擇訂閱方案');if(!['1','2'].includes(f.cycle))error('請選擇配送週期');if(!roastPrefs.includes(f.roast))error('請選擇烘焙度偏好');const grind=plan.beans?f.grind||'whole':undefined;if(grind&&!grinds.includes(grind))error('研磨方式不正確');const customer={};['name','email','phone','address'].forEach(k=>customer[k]=text(f.customer?.[k],k,k==='address'?300:150));if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email))error('電子信箱格式不正確');let id='SUB-'+today().replaceAll('-','')+'-'+String(s.subscriptions.length+1).padStart(4,'0');while(s.subscriptions.some(x=>x.id===id))id+='X';const now=new Date().toISOString();const sub={id,createdAt:now,planId:plan.id,name:plan.name,price:plan.price,cycle:f.cycle,roast:f.roast,...(grind?{grind}:{}),status:'active',nextDate:addMonths(today(),Number(f.cycle)),customer,history:[{at:now,text:'建立訂閱紀錄，未扣款'}]};s.subscriptions.unshift(sub);return sub})}
 function updateSubscription(id,status){return mutate(s=>{const x=s.subscriptions.find(x=>x.id===id)||error('訂閱不存在');if(!subStatuses.includes(status))error('訂閱狀態不正確');if(x.status==='cancelled')error('已取消的訂閱不能再變更');const ok={active:['paused','cancelled'],paused:['active','cancelled']}[x.status];if(!ok.includes(status))error('訂閱狀態不正確');if(status==='active'&&x.nextDate<today())x.nextDate=addMonths(today(),Number(x.cycle));x.status=status;x.history.push({at:new Date().toISOString(),text:'訂閱狀態更新為 '+status});return x})}
 // 雲端訂單：後台登入後以雲端訂單取代本機訂單（依建立時間由新到舊）。
 function applyOrders(list){if(!Array.isArray(list))error('雲端訂單格式不相容');const s=state(),next=[...list].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));if(canon(s.orders)===canon(next))return false;s.orders=copy(next);commit(s);return true}
 // 清除早期版本留在商品資料裡的「示範／展示」說明文字（後台登入時執行一次，修改會自動存回雲端）。
 function cleanDemoText(){const s=state(),before=canon([s.products,s.batches,s.ledger]);s.products.forEach(p=>{if(p.brew?.note&&/示範|展示/.test(p.brew.note))p.brew.note='建議起始參數，可依口味調整。';if(typeof p.notes==='string'&&/示範|展示/.test(p.notes))p.notes=''});s.batches.forEach(b=>{if(typeof b.notes==='string')b.notes=b.notes.replace('期初示範批次','期初批次').replace(/示範|展示/g,'')});s.ledger.forEach(m=>{if(typeof m.reason==='string')m.reason=m.reason.replace('期初示範訂單','期初訂單')});if(canon([s.products,s.batches,s.ledger])===before)return false;commit(s);return true}
 function clearCart(){return mutate(s=>{s.cart=[]})}
 function saveSettings(settings){return mutate(s=>{s.settings={...s.settings,...settings};return s.settings})}
 function exportData(){return JSON.stringify(state(),null,2)}
 function importData(raw){const s=validate(migrate(JSON.parse(raw)));commit(s)}
 function reset(){return commit(copy(window.COFFEE_SEED))}
 // 雲端同步：商品、點心、批次、庫存紀錄與設定由後台存到 Supabase；購物車、訂單、訂閱仍留在本機。
 const cloudKeys=['products','treats','batches','ledger','settings'];
 // 資料庫會重排 JSON 欄位順序，比較時先排序欄位名稱。
 const canon=v=>JSON.stringify(v,(k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
 function cloudCatalog(s=state()){const c={version:s.version};cloudKeys.forEach(k=>c[k]=copy(s[k]));return c}
 function applyCloud(c){if(c?.version!==3||cloudKeys.some(k=>c[k]===undefined))error('雲端資料格式不相容');const s=state();if(cloudKeys.every(k=>canon(s[k])===canon(c[k])))return false;cloudKeys.forEach(k=>s[k]=copy(c[k]));const hasTreat=id=>s.treats.some(t=>t.id===id),hasProduct=id=>s.products.some(p=>p.id===id);s.cart=s.cart.filter(i=>i.kind==='treat'?hasTreat(i.treatId):s.products.some(p=>p.id===i.productId&&p.variants.some(v=>v.sku===i.sku)));s.orders=s.orders.filter(o=>o.items.every(i=>i.kind==='treat'?hasTreat(i.treatId):hasProduct(i.productId)));commit(s);return true}
 window.addEventListener('storage',event=>{if(event.key===KEY)window.dispatchEvent(new CustomEvent('coffee:change'))});
 window.CoffeeStore={state,localize,cloudCatalog,applyCloud,applyOrders,clearCart,cleanDemoText,cartDetails,addCart,addTreat,setCart,createOrder,updateOrder,saveProduct,deleteProduct,adjustStock,saveTreat,adjustTreatStock,addBatch,updateBatch,createSubscription,updateSubscription,saveSettings,exportData,importData,reset,today,validate,imageURL,statuses,payments,subStatuses,deliveries,deliveryLabels,formats,grinds,grindLabels,roasts,roastLabels,defaultRoast,roastPrefs,plans,formatOf,variantLabel,lineKey};
})();

return window.CoffeeStore;
}
