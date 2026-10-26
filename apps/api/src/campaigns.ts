import {z} from 'zod';
import type {Database,Query} from '../../../packages/db/index.js';
import {one,ensure,role,audit,notify,uid,hash} from './domain.js';

const date=z.string().datetime({offset:true});
export const catalogInput=z.object({title:z.string().trim().min(3).max(100),description:z.string().trim().min(10).max(2000),kind:z.enum(['hoodie','jersey','tote']),price:z.number().int().min(1).max(10000000),moq:z.number().int().min(1).max(100000),mediaRef:z.enum(['','/hoodie.png']),publishesAt:date,closesAt:date,resolutionEndsAt:date,paymentEndsAt:date,variants:z.array(z.object({color:z.string().trim().min(1).max(40),size:z.string().trim().min(1).max(20),colorMoq:z.number().int().min(1).max(100000)})).min(1).max(80)});
export const commandInput=z.object({key:z.string().min(8).max(100),revision:z.number().int().min(0),reason:z.string().trim().min(3).max(500)});
const time=(v:any)=>new Date(v).getTime();
function windows(b:z.infer<typeof catalogInput>){ensure(time(b.publishesAt)<time(b.closesAt)&&time(b.closesAt)<time(b.resolutionEndsAt)&&time(b.resolutionEndsAt)<time(b.paymentEndsAt),'Windows must be publication < pledge close < resolution end < payment end',400);ensure(time(b.closesAt)>Date.now(),'Pledge close must be in the future',400);const keys=new Set(),colors=new Map();for(const v of b.variants){const k=v.color.toLowerCase()+'\0'+v.size.toLowerCase();ensure(!keys.has(k),'Duplicate color/size SKU',400);keys.add(k);const c=v.color.toLowerCase();ensure(!colors.has(c)||(colors.get(c).moq===v.colorMoq&&colors.get(c).name===v.color),'Use one threshold and spelling per color',400);colors.set(c,{moq:v.colorMoq,name:v.color});}}
async function replay(q:Query,user:string,key:string,payload:unknown,fn:()=>Promise<any>){const fingerprint=hash(JSON.stringify(payload));const old=await q.q('SELECT * FROM campaign_requests WHERE user_id=$1 AND request_key=$2',[user,key]);if(old.length){ensure(old[0].payload_hash===fingerprint,'Idempotency key reused with different request');return old[0].result;}const result=await fn();await q.q('INSERT INTO campaign_requests VALUES($1,$2,$3,$4)',[user,key,fingerprint,JSON.stringify(result)]);return result;}
export async function saveDraft(db:Database,user:string,campus:string,id:string|null,input:unknown,command:{key:string,revision:number,reason:string}){const b=catalogInput.parse(input);commandInput.parse(command);return db.tx(async q=>{
 await role(q,user,campus,['curator']);if(id)await one(q,'SELECT id FROM drops WHERE id=$1 FOR UPDATE',[id]);else await one(q,'SELECT id FROM users WHERE id=$1 FOR UPDATE',[user]);
 return replay(q,user,command.key,{op:'save',campus,id,b,command},async()=>{
  windows(b);let before:any=null;if(id){before=await one(q,'SELECT * FROM drops WHERE id=$1 FOR UPDATE',[id]);ensure(before.campus_id===campus,'Wrong campus',403);ensure(before.state==='DRAFT'&&before.revision===command.revision,'Only the latest draft can be edited');ensure(!(await q.q('SELECT id FROM pledges WHERE drop_id=$1 UNION ALL SELECT id FROM orders WHERE drop_id=$1',[id])).length,'Commercial records prevent catalog edits');}else{id=uid();}
  if(before)await q.q('DELETE FROM variants WHERE drop_id=$1',[id]);
  await q.q(`INSERT INTO drops(id,campus_id,title,description,kind,price,moq,state,closes_at,publishes_at,resolution_ends_at,payment_ends_at,media_ref) VALUES($1,$2,$3,$4,$5,$6,$7,'DRAFT',$8,$9,$10,$11,$12) ON CONFLICT(id) DO UPDATE SET title=$3,description=$4,kind=$5,price=$6,moq=$7,closes_at=$8,publishes_at=$9,resolution_ends_at=$10,payment_ends_at=$11,media_ref=$12,revision=drops.revision+1`,[id,campus,b.title,b.description,b.kind,b.price,b.moq,b.closesAt,b.publishesAt,b.resolutionEndsAt,b.paymentEndsAt,b.mediaRef]);
  for(const v of b.variants)await q.q('INSERT INTO variants(id,drop_id,color,size,color_moq) VALUES($1,$2,$3,$4,$5)',[uid(),id,v.color,v.size,v.colorMoq]);
  const after=await one(q,'SELECT * FROM drops WHERE id=$1',[id]);await audit(q,user,campus,'DRAFT_SAVED',id!,{reason:command.reason,before,after,variants:b.variants});return after;
 });
 });}
async function inform(q:Query,id:string,message:string){const users=await q.q('SELECT DISTINCT user_id FROM pledges WHERE drop_id=$1',[id]);for(const u of users)await notify(q,u.user_id,message);}
async function event(q:Query,d:any,actor:string|null,action:string,after:any,reason:string){
 // Worker actor is a persisted, non-login service identity. No session or role is granted.
 if(!actor){await q.q("INSERT INTO users(id,email,name) VALUES('campaign-worker','campaign-worker@ccoop.internal','Campaign worker') ON CONFLICT DO NOTHING");actor='campaign-worker';}
 await audit(q,actor,d.campus_id,action,d.id,{reason,before:{state:d.state,revision:d.revision},after});
}
export async function publish(db:Database,user:string,id:string,command:{key:string,revision:number,reason:string},scheduled:boolean){commandInput.parse(command);return db.tx(async q=>{const d=await one(q,'SELECT * FROM drops WHERE id=$1 FOR UPDATE',[id]);await role(q,user,d.campus_id,['curator']);return replay(q,user,command.key,{op:'publish',id,command,scheduled},async()=>{
 ensure(d.state==='DRAFT'&&d.revision===command.revision,'Only the latest draft can be published');ensure(time(d.closes_at)>Date.now(),'Pledge window has expired');if(scheduled)ensure(time(d.publishes_at)>Date.now(),'Scheduled publication must be in the future');
 const state=scheduled?'SCHEDULED':'PLEDGING';await q.q('UPDATE drops SET state=$2,publishes_at=$3,revision=revision+1 WHERE id=$1',[id,state,scheduled?d.publishes_at:new Date()]);await event(q,d,user,'CAMPAIGN_PUBLISHED',{state},command.reason);return one(q,'SELECT * FROM drops WHERE id=$1',[id]);});});}
async function finishResolution(q:Query,d:any,actor:string|null,expire:boolean){
 if(expire){const expired=await q.q("UPDATE pledges SET status='EXPIRED',revision=revision+1 WHERE drop_id=$1 AND status='SWITCH_REQUIRED' RETURNING user_id",[d.id]);for(const p of expired)await notify(q,p.user_id,'Color resolution expired. Your free pledge has expired; no payment or refund is due.');}
 const unresolved=await q.q("SELECT id FROM pledges WHERE drop_id=$1 AND status='SWITCH_REQUIRED'",[d.id]);if(unresolved.length)return;
 const [count]=await q.q("SELECT COALESCE(SUM(quantity),0)::int units FROM pledges WHERE drop_id=$1 AND status='PENDING_RESOLUTION'",[d.id]);const state=count.units>=d.moq?'PAYMENT_OPEN':'FAILED';
 await q.q('UPDATE drops SET state=$2,revision=revision+1,snapshot=snapshot || $3::jsonb WHERE id=$1',[d.id,state,JSON.stringify({finalEligibleUnits:count.units,resolvedAt:new Date(),categoryBasis:'eligible-color units'})]);
 await q.q("UPDATE pledges SET status=$2,revision=revision+1 WHERE drop_id=$1 AND status='PENDING_RESOLUTION'",[d.id,state==='PAYMENT_OPEN'?'ELIGIBLE':'FAILED']);
 await inform(q,d.id,state==='PAYMENT_OPEN'?'Campaign qualified. Confirm your purchase before the payment deadline.':'Campaign failed final eligible-color MOQ. Free pledges create no payment, refund or credit.');await event(q,d,actor,'RESOLUTION_FINISHED',{state,eligibleUnits:count.units},'All decisions received or resolution deadline elapsed');
}
async function closeLocked(q:Query,d:any,actor:string|null,reason:string){
 const counts=await q.q("SELECT v.color,MAX(v.color_moq)::int moq,COALESCE(SUM(p.quantity),0)::int units FROM variants v LEFT JOIN pledges p ON p.variant_id=v.id AND p.status='ACTIVE' WHERE v.drop_id=$1 GROUP BY v.color ORDER BY v.color",[d.id]);
 const total=counts.reduce((n,c)=>n+c.units,0),winning=counts.filter(c=>c.units>=c.moq).map(c=>c.color);const failed=total<d.moq||!winning.length;
 // Legacy published records had no configured resolution/payment windows.
 const closeAt=Math.min(time(d.closes_at),Date.now()),resolution=d.resolution_ends_at||new Date(closeAt+86400000),payment=d.payment_ends_at||new Date(closeAt+7*86400000);
 const snapshot={total,colors:counts,winning,price:d.price,categoryMoq:d.moq,categoryBasis:'eligible-color units',lockedBy:actor||'campaign-worker',lockedAt:new Date()};
 await q.q('UPDATE drops SET state=$2,closes_at=$3,resolution_ends_at=$4,payment_ends_at=$5,snapshot=$6,revision=revision+1 WHERE id=$1',[d.id,failed?'FAILED':'RESOLVING',new Date(closeAt),resolution,payment,JSON.stringify(snapshot)]);
 await q.q("UPDATE pledges p SET status=CASE WHEN $3::boolean THEN 'FAILED' WHEN v.color=ANY($2::text[]) THEN 'PENDING_RESOLUTION' ELSE 'SWITCH_REQUIRED' END,revision=p.revision+1 FROM variants v WHERE p.variant_id=v.id AND p.drop_id=$1 AND p.status='ACTIVE'",[d.id,winning,failed]);
 await event(q,d,actor,'CAMPAIGN_LOCKED',snapshot,reason);
 await inform(q,d.id,failed?'Campaign failed MOQ. Your pledge was free; no refund or credit is due.':'Pledges closed. Eligible colors are fixed; check activity for any required color decision.');
 if(!failed)await finishResolution(q,{...d,state:'RESOLVING'},actor,false);
 return {total,winning};
}
export async function closeCampaign(db:Database,user:string,id:string,command?:{key:string,revision:number,reason:string}){if(command)commandInput.parse(command);return db.tx(async q=>{const d=await one(q,'SELECT * FROM drops WHERE id=$1 FOR UPDATE',[id]);await role(q,user,d.campus_id,['curator']);const perform=async()=>{if(command)ensure(d.revision===command.revision,'Campaign changed; reload before closing');if(d.snapshot)return {total:d.snapshot.total,winning:d.snapshot.winning};ensure(d.state==='PLEDGING','Campaign is not open for pledges');return closeLocked(q,d,user,command?.reason||'Curator explicitly closed pledges');};return command?replay(q,user,command.key,{op:'close',id,command},perform):perform();});}
export async function extend(db:Database,user:string,id:string,command:{key:string,revision:number,reason:string},dates:{closesAt:string,resolutionEndsAt:string,paymentEndsAt:string}){commandInput.parse(command);return db.tx(async q=>{const d=await one(q,'SELECT * FROM drops WHERE id=$1 FOR UPDATE',[id]);await role(q,user,d.campus_id,['curator']);return replay(q,user,command.key,{op:'extend',id,command,dates},async()=>{
 ensure(d.revision===command.revision,'Campaign changed; reload before extending');ensure(['PLEDGING','RESOLVING','PAYMENT_OPEN'].includes(d.state),'This campaign phase cannot be extended');
 const old=[time(d.closes_at),time(d.resolution_ends_at||new Date(time(d.closes_at)+86400000)),time(d.payment_ends_at||new Date(time(d.closes_at)+7*86400000))],next=[time(dates.closesAt),time(dates.resolutionEndsAt),time(dates.paymentEndsAt)],phase=d.state==='PLEDGING'?0:d.state==='RESOLVING'?1:2;
 ensure(old[phase]>Date.now(),'An elapsed phase cannot be reopened');ensure(next.every(Number.isFinite)&&next[0]<next[1]&&next[1]<next[2],'Invalid deadline order',400);ensure(next.every((n,i)=>i<phase?n===old[i]:n>=old[i])&&next[phase]>old[phase],'Extend the active deadline without changing completed phases');
 await q.q('UPDATE drops SET closes_at=$2,resolution_ends_at=$3,payment_ends_at=$4,revision=revision+1 WHERE id=$1',[id,...next.map(n=>new Date(n))]);await audit(q,user,d.campus_id,'DEADLINES_EXTENDED',id,{reason:command.reason,before:old,after:next});await inform(q,id,'Campaign deadline extended. See activity for updated dates.');return one(q,'SELECT * FROM drops WHERE id=$1',[id]);});});}
export async function changePledge(db:Database,user:string,id:string,b:{key:string,revision:number,action:'edit'|'cancel'|'switch',variantId?:string,quantity?:number,price?:number}){return db.tx(async q=>{
 const ref=await one(q,'SELECT drop_id FROM pledges WHERE id=$1',[id]);const d=await one(q,'SELECT * FROM drops WHERE id=$1 FOR UPDATE',[ref.drop_id]);const p=await one(q,'SELECT * FROM pledges WHERE id=$1 FOR UPDATE',[id]);ensure(p.user_id===user,'Not your pledge',403);
 return replay(q,user,b.key,{op:'pledge',id,b},async()=>{
 ensure(p.revision===b.revision,'Pledge changed; reload before editing');const open=d.state==='PLEDGING'&&time(d.closes_at)>Date.now()&&p.status==='ACTIVE';const resolving=d.state==='RESOLVING'&&time(d.resolution_ends_at)>Date.now()&&p.status==='SWITCH_REQUIRED';ensure(open||resolving,'Pledge decision window is closed');
 if(b.action==='cancel'){await q.q("UPDATE pledges SET status='CANCELED',revision=revision+1 WHERE id=$1",[id]);await notify(q,user,'Free pledge canceled. No payment, refund or credit is due.');}
 else{
  ensure(open?b.action==='edit':b.action==='switch','Invalid pledge action');const v=await one(q,'SELECT * FROM variants WHERE id=$1 AND drop_id=$2',[b.variantId,d.id]);const quantity=resolving?p.quantity:b.quantity;ensure(Number.isInteger(quantity)&&quantity!>=1&&quantity!<=10,'Choose 1–10 units',400);
  if(resolving){ensure(d.snapshot.winning.includes(v.color),'Choose an eligible color');ensure(b.price===d.snapshot.price,'Price changed; review the switch quote');}
  const [sum]=await q.q("SELECT COALESCE(SUM(quantity),0)::int n FROM pledges WHERE drop_id=$1 AND user_id=$2 AND id<>$3 AND status NOT IN ('CANCELED','EXPIRED','FAILED')",[d.id,user,id]);ensure(sum.n+quantity!<=10,'Maximum 10 units per person per drop');
  await q.q('UPDATE pledges SET variant_id=$2,quantity=$3,status=$4,revision=revision+1 WHERE id=$1',[id,v.id,quantity,resolving?'PENDING_RESOLUTION':'ACTIVE']);await notify(q,user,resolving?`Color switched to ${v.color} / ${v.size}, ${quantity} units at ${d.snapshot.price} paise each. Await final eligibility.`:'Free pledge updated.');
 }
 if(resolving)await finishResolution(q,d,user,false);return one(q,'SELECT * FROM pledges WHERE id=$1',[id]);});
 });}
export async function recoverCampaigns(db:Database){
 const due=await db.q("SELECT id FROM drops WHERE (state='SCHEDULED' AND publishes_at<=now()) OR (state='PLEDGING' AND closes_at<=now()) OR (state='RESOLVING' AND resolution_ends_at<=now()) OR (state='PAYMENT_OPEN' AND payment_ends_at<=now()) ORDER BY COALESCE(publishes_at,closes_at),id LIMIT 100");
 for(const {id} of due)await db.tx(async q=>{
  let d=await one(q,'SELECT * FROM drops WHERE id=$1 FOR UPDATE',[id]);
  if(d.state==='SCHEDULED'&&time(d.publishes_at)<=Date.now()){await q.q("UPDATE drops SET state='PLEDGING',revision=revision+1 WHERE id=$1",[id]);await event(q,d,null,'SCHEDULE_PUBLISHED',{state:'PLEDGING'},'Scheduled publication deadline');d=await one(q,'SELECT * FROM drops WHERE id=$1',[id]);}
  if(d.state==='PLEDGING'&&time(d.closes_at)<=Date.now()){await closeLocked(q,d,null,'Pledge deadline elapsed');d=await one(q,'SELECT * FROM drops WHERE id=$1',[id]);}
  if(d.state==='RESOLVING'&&time(d.resolution_ends_at)<=Date.now()){await finishResolution(q,d,null,true);d=await one(q,'SELECT * FROM drops WHERE id=$1',[id]);}
  if(d.state==='PAYMENT_OPEN'&&time(d.payment_ends_at)<=Date.now()){
   await q.q("UPDATE drops SET state='PAYMENT_CLOSED',revision=revision+1 WHERE id=$1",[id]);
   await q.q("UPDATE pledges SET status='EXPIRED',revision=revision+1 WHERE drop_id=$1 AND status='ELIGIBLE'",[id]);
   await q.q("UPDATE pledges p SET status='PAYMENT_EXPIRED',revision=p.revision+1 FROM orders o WHERE o.pledge_id=p.id AND p.drop_id=$1 AND o.paid=0 AND p.status='CONVERTED'",[id]);
   await inform(q,id,'Payment window closed. Existing orders and payment attempts remain available for reconciliation; do not pay again after expiry.');await event(q,d,null,'PAYMENT_WINDOW_EXPIRED',{state:'PAYMENT_CLOSED'},'Payment deadline elapsed');
  }
 });return {examined:due.length};
}
