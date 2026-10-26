import { randomUUID, createHash } from 'node:crypto';
import type {Database,Query} from '../../../packages/db/index.js';
export const uid=()=>randomUUID();
export const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export class Problem extends Error {constructor(public statusCode:number,message:string){super(message)}}
export function ensure(ok:unknown,message:string,code=409):asserts ok {if(!ok)throw new Problem(code,message)}
export async function one(q:Query,s:string,v:unknown[]=[]){const [row]=await q.q(s,v);ensure(row,'Record not found',404);return row;}
export async function role(q:Query,user:string,campus:string,roles:string[]){const r=await q.q("SELECT * FROM roles WHERE user_id=$1 AND (role='admin' OR (campus_id=$2 AND role=ANY($3::text[])))",[user,campus,roles]);ensure(r.length,'This campus operation is not permitted',403)}
export async function audit(q:Query,user:string,campus:string,action:string,entity:string,detail:unknown={}){await q.q('INSERT INTO audit(id,campus_id,actor,action,entity,detail) VALUES($1,$2,$3,$4,$5,$6)',[uid(),campus,user,action,entity,JSON.stringify(detail)]);}
export async function notify(q:Query,user:string,message:string){await q.q('INSERT INTO outbox(id,user_id,message) VALUES($1,$2,$3)',[uid(),user,message]);}
export async function pledge(db:Database,user:string,dropId:string,variantId:string,quantity:number,key:string){return db.tx(async q=>{
 const d=await one(q,'SELECT * FROM drops WHERE id=$1 FOR UPDATE',[dropId]);
 const old=await q.q('SELECT * FROM pledges WHERE user_id=$1 AND request_key=$2',[user,key]);if(old.length){ensure(old[0].drop_id===dropId&&old[0].variant_id===variantId&&old[0].quantity===quantity,'Idempotency key reused with different pledge');return old[0];}
 ensure(d.state==='PLEDGING'&&new Date(d.closes_at).getTime()>Date.now(),'This pledge window is closed');
 ensure(Number.isInteger(quantity)&&quantity>=1&&quantity<=10,'Choose 1–10 units',400);
 await one(q,'SELECT id FROM variants WHERE id=$1 AND drop_id=$2',[variantId,dropId]);
 const [total]=await q.q("SELECT COALESCE(SUM(quantity),0)::int AS n FROM pledges WHERE user_id=$1 AND drop_id=$2 AND status<>'CANCELED'",[user,dropId]);ensure(total.n+quantity<=10,'Maximum 10 units per person per drop');
 return one(q,'INSERT INTO pledges(id,user_id,drop_id,variant_id,quantity,request_key) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[uid(),user,dropId,variantId,quantity,key]);
 });}
export async function lockDrop(db:Database,user:string,id:string){return db.tx(async q=>{
 const d=await one(q,'SELECT * FROM drops WHERE id=$1 FOR UPDATE',[id]);await role(q,user,d.campus_id,['curator']);ensure(d.state==='PLEDGING','Campaign already evaluated');
 const counts=await q.q("SELECT v.color,MAX(v.color_moq)::int moq,COALESCE(SUM(p.quantity),0)::int units FROM variants v LEFT JOIN pledges p ON p.variant_id=v.id AND p.status='ACTIVE' WHERE v.drop_id=$1 GROUP BY v.color",[id]);
 const total=counts.reduce((a,c)=>a+c.units,0);const winning=counts.filter(c=>c.units>=c.moq).map(c=>c.color);ensure(total>=d.moq&&winning.length,'Pledged demand does not meet MOQ');
 await q.q("UPDATE drops SET state='PAYMENT_OPEN',closes_at=LEAST(closes_at,now()),payment_ends_at=now()+interval '7 days',snapshot=$2 WHERE id=$1",[id,JSON.stringify({total,colors:counts,winning,lockedBy:user,lockedAt:new Date()})]);
 await q.q("UPDATE pledges p SET status=CASE WHEN v.color=ANY($2::text[]) THEN 'ELIGIBLE' ELSE 'SWITCH_REQUIRED' END FROM variants v WHERE p.variant_id=v.id AND p.drop_id=$1 AND p.status='ACTIVE'",[id,winning]);
 const ps=await q.q('SELECT * FROM pledges WHERE drop_id=$1',[id]);for(const p of ps)await notify(q,p.user_id,p.status==='ELIGIBLE'?"It's happening. Confirm your order.":'Your colour needs a switch before payment.');
 await audit(q,user,d.campus_id,'CAMPAIGN_LOCKED',id,{total,counts});return {total,winning};
 });}
export async function createOrder(db:Database,user:string,pledgeId:string){return db.tx(async q=>{
 const ref=await one(q,'SELECT drop_id FROM pledges WHERE id=$1',[pledgeId]);
 const d=await one(q,'SELECT * FROM drops WHERE id=$1 FOR UPDATE',[ref.drop_id]);
 const p=await one(q,'SELECT * FROM pledges WHERE id=$1 FOR UPDATE',[pledgeId]);ensure(p.user_id===user,'Order belongs to another student',403);
 const existing=await q.q('SELECT * FROM orders WHERE pledge_id=$1',[pledgeId]);if(existing.length)return existing[0];
 ensure(d.state==='PAYMENT_OPEN'&&new Date(d.payment_ends_at).getTime()>Date.now()&&p.status==='ELIGIBLE','Pledge is not eligible for payment');
 const o=await one(q,'INSERT INTO orders(id,user_id,campus_id,drop_id,pledge_id,variant_id,quantity,total) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[uid(),user,d.campus_id,d.id,p.id,p.variant_id,p.quantity,d.price*p.quantity]);await q.q("UPDATE pledges SET status='CONVERTED' WHERE id=$1",[p.id]);return o;
 });}
export async function obligation(db:Database,user:string,id:string,choice:'deposit'|'full'|'balance',provider='simulator'){return db.tx(async q=>{
 const ref=await one(q,'SELECT drop_id FROM orders WHERE id=$1',[id]);
 const d=await one(q,'SELECT * FROM drops WHERE id=$1 FOR UPDATE',[ref.drop_id]);
 const o=await one(q,'SELECT * FROM orders WHERE id=$1 FOR UPDATE',[id]);ensure(o.user_id===user,'Order belongs to another student',403);ensure(!o.payment_hold,'Payment needs operations review');ensure(o.paid<o.total,'Order already paid');
 if(o.paid===0)ensure(d.state==='PAYMENT_OPEN'&&new Date(d.payment_ends_at).getTime()>Date.now(),'Payment window closed');
 else ensure(o.fulfillment==='ARRIVED','Balance is due after stock arrival');
 const amount=o.paid===0&&choice==='deposit'?Math.ceil(o.total/2):o.total-o.paid;
 const active=await q.q('SELECT * FROM obligations WHERE order_id=$1 AND captured=false AND expires_at>now() ORDER BY created_at DESC',[id]);if(active.length){ensure(active[0].amount===amount,'An existing payment is pending; finish it first');ensure(active[0].provider===provider,'Existing obligation belongs to another provider; reconcile it first');return active[0];}
 return one(q,"INSERT INTO obligations(id,order_id,amount,expires_at,provider) VALUES($1,$2,$3,LEAST(now()+interval '15 minutes',$5::timestamptz),$4) RETURNING *",[uid(),id,amount,provider,o.paid===0?d.payment_ends_at:new Date(Date.now()+15*60*1000)]);
 });}
export async function capture(db:Database,eventId:string,paymentId:string,obligationId:string,amount:number,provider?:string,paidAt?:string){return db.tx(async q=>{
 const ref=await one(q,'SELECT o.drop_id,o.id FROM obligations b JOIN orders o ON o.id=b.order_id WHERE b.id=$1',[obligationId]);
 const campaign=await one(q,'SELECT * FROM drops WHERE id=$1 FOR UPDATE',[ref.drop_id]);
 const o=await one(q,'SELECT * FROM orders WHERE id=$1 FOR UPDATE',[ref.id]);const b=await one(q,'SELECT * FROM obligations WHERE id=$1 FOR UPDATE',[obligationId]);
 const gateway=provider||b.provider;ensure(gateway===b.provider,'Payment provider mismatch');
 const prior=await q.q('SELECT * FROM payment_events WHERE id=$1 OR (provider=$2 AND provider_payment_id=$3)',[gateway+':'+eventId,gateway,paymentId]);
 if(prior.length){ensure(prior.every(p=>p.obligation_id===b.id&&p.amount===amount&&p.provider_payment_id===paymentId),'Payment replay mismatch');return {duplicate:true};}
 ensure(Number.isSafeInteger(amount)&&amount===b.amount,'Payment obligation mismatch');
 const completed=paidAt?new Date(paidAt).getTime():Date.now();ensure(Number.isFinite(completed)&&completed<=Date.now()+300000,'Invalid payment time',400);
 const reason=b.captured||o.paid+amount>o.total?'OVERPAYMENT':
  completed>new Date(b.expires_at).getTime()?'OBLIGATION_EXPIRED':
  o.paid===0&&(campaign.state!=='PAYMENT_OPEN'||completed>new Date(campaign.payment_ends_at).getTime())?'CAMPAIGN_INELIGIBLE':
  o.payment_hold?'EXISTING_PAYMENT_HOLD':null;
 const credited=reason?0:amount;
 await q.q('INSERT INTO payment_events(id,provider_payment_id,obligation_id,amount,provider,credited_amount) VALUES($1,$2,$3,$4,$5,$6)',[gateway+':'+eventId,paymentId,b.id,amount,gateway,credited]);
 await q.q("UPDATE obligations SET captured=true,checkout_state='SUCCESS' WHERE id=$1",[b.id]);
 if(reason){
  await q.q('INSERT INTO payment_exceptions(id,order_id,obligation_id,provider,payment_id,reason,amount) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),o.id,b.id,gateway,paymentId,reason,amount]);
  await q.q('UPDATE orders SET payment_hold=true WHERE id=$1',[o.id]);
  await audit(q,o.user_id,o.campus_id,'PAYMENT_EXCEPTION',o.id,{provider:gateway,paymentId,reason,amount});
  await notify(q,o.user_id,'Payment received but held for operations/refund review. Do not pay again.');
 }else{
  await q.q("UPDATE orders SET paid=paid+$2,fulfillment=CASE WHEN fulfillment='AWAITING_PAYMENT' THEN 'CONFIRMED' ELSE fulfillment END WHERE id=$1",[o.id,credited]);
  await notify(q,o.user_id,'Payment confirmed. Your campus order is saved.');
 }
 return {captured:true,credited,exception:reason};
 });}
export async function approve(db:Database,user:string,id:string){return db.tx(async q=>{
 const d=await one(q,'SELECT * FROM drops WHERE id=$1 FOR UPDATE',[id]);await role(q,user,d.campus_id,['admin']);ensure(d.state==='PAYMENT_OPEN','Campaign is not awaiting production approval');
 await q.q('SELECT id FROM orders WHERE drop_id=$1 ORDER BY id FOR UPDATE',[id]);
 const pending=await q.q('SELECT b.id FROM obligations b JOIN orders o ON o.id=b.order_id WHERE o.drop_id=$1 AND b.captured=false AND b.expires_at>now()',[id]);ensure(!pending.length,'Wait for active payment attempts to settle or expire');
 const rows=await q.q('SELECT o.*,v.color,v.color_moq FROM orders o JOIN variants v ON v.id=o.variant_id WHERE o.drop_id=$1 AND o.paid*2>=o.total AND NOT o.payment_hold',[id]);const total=rows.reduce((n,r)=>n+r.quantity,0);ensure(total>=d.moq,'Paid demand is below the supplier MOQ');
 const colors=new Map<string,{units:number,moq:number}>();for(const r of rows){const c=colors.get(r.color)||{units:0,moq:r.color_moq};c.units+=r.quantity;colors.set(r.color,c);}ensure([...colors.values()].every(c=>c.units>=c.moq),'Paid colour demand is below supplier MOQ');
 await q.q("UPDATE drops SET state='IN_PRODUCTION' WHERE id=$1",[id]);await q.q("UPDATE orders SET fulfillment='IN_PRODUCTION' WHERE drop_id=$1 AND paid>=total*0.5 AND NOT payment_hold",[id]);await audit(q,user,d.campus_id,'PRODUCTION_APPROVED',id,{paidUnits:total});return {paidUnits:total};
 });}
export async function receive(db:Database,user:string,id:string,key:string,lines:{variantId:string,healthy:number,damaged:number}[]){return db.tx(async q=>{
 const d=await one(q,'SELECT * FROM drops WHERE id=$1 FOR UPDATE',[id]);await role(q,user,d.campus_id,['host']);const payloadHash=hash(JSON.stringify({id,lines}));const prior=await q.q('SELECT * FROM receipts WHERE id=$1',[key]);if(prior.length){ensure(prior[0].drop_id===id&&prior[0].payload_hash===payloadHash,'Receipt idempotency mismatch');return {duplicate:true};}
 ensure(d.state==='IN_PRODUCTION','Drop is not ready for receiving');ensure(new Set(lines.map(l=>l.variantId)).size===lines.length,'Duplicate SKU lines',400);
 const orders=await q.q("SELECT * FROM orders WHERE drop_id=$1 AND fulfillment='IN_PRODUCTION' ORDER BY created_at,id FOR UPDATE",[id]);const expected=new Map<string,number>();for(const o of orders)expected.set(o.variant_id,(expected.get(o.variant_id)||0)+o.quantity);
 ensure(lines.length===expected.size&&lines.every(l=>expected.has(l.variantId)),'Reconcile every expected SKU exactly once');
 await q.q('INSERT INTO receipts(id,drop_id,actor,payload_hash) VALUES($1,$2,$3,$4)',[key,id,user,payloadHash]);
 for(const l of lines){ensure(Number.isInteger(l.healthy)&&Number.isInteger(l.damaged)&&l.healthy>=0&&l.damaged>=0&&l.healthy+l.damaged<=(expected.get(l.variantId)||0),'Invalid receipt count',400);
 await q.q('INSERT INTO receipt_lines VALUES($1,$2,$3,$4,$5)',[key,l.variantId,expected.get(l.variantId),l.healthy,l.damaged]);
 await q.q('INSERT INTO stock(variant_id,campus_id,on_hand) VALUES($1,$2,$3) ON CONFLICT(variant_id) DO UPDATE SET on_hand=stock.on_hand+excluded.on_hand',[l.variantId,d.campus_id,l.healthy]);await q.q('INSERT INTO movements(id,campus_id,variant_id,kind,quantity,reference) VALUES($1,$2,$3,$4,$5,$6)',[uid(),d.campus_id,l.variantId,'RECEIPT',l.healthy,key]);}
 for(const o of orders){const s=await one(q,'SELECT * FROM stock WHERE variant_id=$1 FOR UPDATE',[o.variant_id]);if(s.on_hand-s.allocated>=o.quantity){await q.q('UPDATE stock SET allocated=allocated+$2 WHERE variant_id=$1',[o.variant_id,o.quantity]);await q.q("UPDATE orders SET allocated=quantity,fulfillment='ARRIVED' WHERE id=$1",[o.id]);await notify(q,o.user_id,'Your order has arrived. Complete any balance to collect.');}else await q.q("UPDATE orders SET fulfillment='STOCK_EXCEPTION' WHERE id=$1",[o.id]);}
 await q.q("UPDATE drops SET state='ARRIVED' WHERE id=$1",[id]);await audit(q,user,d.campus_id,'SHIPMENT_RECONCILED',id,{key,lines});return {received:true};
 });}
export async function pickupPass(db:Database,user:string,id:string){return db.tx(async q=>{
 const o=await one(q,'SELECT * FROM orders WHERE id=$1 FOR UPDATE',[id]);ensure(o.user_id===user,'Order belongs to another student',403);ensure(!o.payment_hold&&o.paid===o.total&&o.allocated===o.quantity&&o.fulfillment==='ARRIVED','Full payment and healthy stock allocation are required');
 const token=uid()+uid();await q.q("INSERT INTO pickup_passes(order_id,token_hash,expires_at) VALUES($1,$2,now()+interval '10 minutes') ON CONFLICT(order_id) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at,used_at=NULL",[id,hash(token)]);return {token,expiresIn:600};
 });}
export async function dispatch(db:Database,user:string,token:string){return db.tx(async q=>{
 const ref=await one(q,'SELECT order_id FROM pickup_passes WHERE token_hash=$1',[hash(token)]);const o=await one(q,'SELECT * FROM orders WHERE id=$1 FOR UPDATE',[ref.order_id]);await role(q,user,o.campus_id,['host']);const p=await one(q,'SELECT * FROM pickup_passes WHERE order_id=$1 FOR UPDATE',[o.id]);ensure(p.token_hash===hash(token)&&!p.used_at&&new Date(p.expires_at).getTime()>Date.now(),'Pickup pass expired or already used');ensure(!o.payment_hold&&o.paid===o.total&&o.allocated===o.quantity&&o.fulfillment==='ARRIVED','Order is not eligible for pickup');
 await one(q,'UPDATE stock SET on_hand=on_hand-$2,allocated=allocated-$2 WHERE variant_id=$1 AND allocated>=$2 RETURNING *',[o.variant_id,o.quantity]);await q.q("UPDATE orders SET fulfillment='COLLECTED',allocated=0 WHERE id=$1",[o.id]);await q.q('UPDATE pickup_passes SET used_at=now() WHERE order_id=$1',[o.id]);await q.q('INSERT INTO pickup_events(order_id,host_id) VALUES($1,$2)',[o.id,user]);await q.q('INSERT INTO movements(id,campus_id,variant_id,kind,quantity,reference) VALUES($1,$2,$3,$4,$5,$6)',[uid(),o.campus_id,o.variant_id,'DISPATCH',-o.quantity,o.id]);await audit(q,user,o.campus_id,'PICKUP_COMPLETED',o.id);return {collected:true,orderId:o.id};
 });}
