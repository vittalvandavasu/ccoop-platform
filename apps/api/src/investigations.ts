import {z} from 'zod';
import type {Database,Query} from '../../../packages/db/index.js';
import * as D from './domain.js';
import * as P from './payments.js';
import type {CashfreeAdapter} from './cashfree.js';

export const sourceSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('payment'),id:z.string().min(1)}),
 z.object({kind:z.literal('receipt'),id:z.string().min(1),variantId:z.string().min(1),category:z.enum(['MISSING','DAMAGED','INCORRECT','EXCESS']),quantity:z.number().int().min(1).max(100000).optional()})
]);
export const actionSchema=z.object({source:sourceSchema,key:z.string().min(8).max(100),revision:z.number().int().min(0),action:z.enum(['ASSIGN','NOTE','REVIEW_HELD','REOPEN','RECONCILE']),reason:z.string().trim().min(3).max(1000),reference:z.string().trim().max(300).default(''),assignee:z.string().optional(),evidenceVersion:z.string().optional()});
type Source=z.infer<typeof sourceSchema>;
export const caseId=(s:Source)=>D.hash(JSON.stringify(s.kind==='payment'?['payment',s.id]:['receipt',s.id,s.variantId,s.category]));
async function sourceRecord(q:Query,s:Source){
 if(s.kind==='payment')return D.one(q,'SELECT b.*,o.campus_id,o.drop_id,o.user_id,o.payment_hold FROM obligations b JOIN orders o ON o.id=b.order_id WHERE b.id=$1',[s.id]);
 return D.one(q,'SELECT l.*,r.drop_id,d.campus_id FROM receipt_lines l JOIN receipts r ON r.id=l.receipt_id JOIN drops d ON d.id=r.drop_id WHERE l.receipt_id=$1 AND l.variant_id=$2',[s.id,s.variantId]);
}
async function permitted(q:Query,user:string,campus:string,payment:boolean){await D.role(q,user,campus,payment?['admin']:['host']);}
async function evidenceVersion(q:Query,id:string){return D.hash(JSON.stringify({obligation:await D.one(q,'SELECT b.captured,b.checkout_state,b.last_checked_at,b.reconciliation_error,o.paid,o.payment_hold FROM obligations b JOIN orders o ON o.id=b.order_id WHERE b.id=$1',[id]),events:await q.q('SELECT id,amount,credited_amount FROM payment_events WHERE obligation_id=$1 ORDER BY id',[id]),attempts:await q.q('SELECT payment_id,status,updated_at FROM payment_attempts WHERE obligation_id=$1 ORDER BY payment_id',[id])}));}
export async function action(db:Database,user:string,input:unknown){const b=actionSchema.parse(input),id=caseId(b.source),fingerprint=D.hash(JSON.stringify(b));return db.tx(async q=>{
 const ref=await sourceRecord(q,b.source);await permitted(q,user,ref.campus_id,b.source.kind==='payment');
 await D.one(q,'SELECT id FROM drops WHERE id=$1 FOR UPDATE',[ref.drop_id]);
 const old=await q.q('SELECT * FROM investigation_actions WHERE actor=$1 AND request_key=$2',[user,b.key]);if(old.length){D.ensure(old[0].payload_hash===fingerprint,'Idempotency request mismatch');return {...old[0].result,actionId:old[0].id,jobState:old[0].state};}
 const s=b.source,payment=s.kind==='payment';
 if(!payment&&!['INCORRECT','EXCESS'].includes(s.category))D.ensure(s.quantity===undefined,'Receipt shortage and damage quantities come from the saved receipt',400);
 if(payment){await D.one(q,'SELECT id FROM orders WHERE id=$1 FOR UPDATE',[ref.order_id]);await D.one(q,'SELECT id FROM obligations WHERE id=$1 FOR UPDATE',[s.id]);if(b.action==='REVIEW_HELD')D.ensure(b.evidenceVersion===await evidenceVersion(q,s.id),'Provider evidence changed or was not reviewed; reload before reviewing');}
 if(!payment){if(s.category==='MISSING')D.ensure(ref.expected-ref.healthy-ref.damaged>0,'No missing receipt units');if(s.category==='DAMAGED')D.ensure(ref.damaged>0,'No damaged receipt units');if(['INCORRECT','EXCESS'].includes(s.category))D.ensure(s.quantity,'Report the physical quantity',400);}
 await q.q('INSERT INTO investigations(id,campus_id,drop_id,obligation_id,receipt_id,variant_id,category,reported_quantity) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',[id,ref.campus_id,ref.drop_id,payment?s.id:null,payment?null:s.id,payment?null:s.variantId,payment?'PAYMENT_REVIEW':s.category,payment?null:s.quantity??null]);
 const c=await D.one(q,'SELECT * FROM investigations WHERE id=$1 FOR UPDATE',[id]);D.ensure(c.revision===b.revision,'Investigation changed; reload before acting');
 if(!payment&&['INCORRECT','EXCESS'].includes(s.category))D.ensure(c.reported_quantity===s.quantity,'Reported quantity is immutable; record additional context in a note');
 if(b.action==='ASSIGN'){D.ensure(b.assignee,'Choose an operator',400);await permitted(q,b.assignee!,ref.campus_id,payment);}
 if(b.action==='RECONCILE'){D.ensure(payment&&ref.provider==='cashfree'&&ref.provider_order_id&&ref.customer_ref,'Authenticated Cashfree references are required');D.ensure(!(await q.q("SELECT id FROM investigation_actions WHERE investigation_id=$1 AND state IN ('QUEUED','PROCESSING')",[id])).length,'Verification is already queued or running');}
 const status=b.action==='REVIEW_HELD'?'REVIEWED_HELD':b.action==='REOPEN'?'OPEN':b.action==='ASSIGN'?'INVESTIGATING':c.status;
 const updated=await D.one(q,'UPDATE investigations SET status=$2,assigned_to=$3,revision=revision+1 WHERE id=$1 RETURNING *',[id,status,b.action==='ASSIGN'?b.assignee:c.assigned_to]);
 const actionId=D.uid(),state=b.action==='RECONCILE'?'QUEUED':'DONE';const result={investigation:updated,actionId,jobState:state};
 await q.q('INSERT INTO investigation_actions(id,investigation_id,actor,request_key,payload_hash,action,reason,reference,result,state,completed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[actionId,id,user,b.key,fingerprint,b.action,b.reason,b.reference,JSON.stringify(result),state,state==='DONE'?new Date():null]);
 await D.audit(q,user,ref.campus_id,'INVESTIGATION_'+b.action,id,{reason:b.reason,reference:b.reference,before:{status:c.status,assignedTo:c.assigned_to,revision:c.revision},after:{status,assignedTo:updated.assigned_to,revision:updated.revision},financialAndStockHoldsRetained:true});return result;
 });}

export async function queue(db:Database,user:string,campus:string,kind:'payment'|'fulfillment'){return db.tx(async q=>{await q.q('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');return queueView(q,user,campus,kind);});}
async function queueView(db:Query,user:string,campus:string,kind:'payment'|'fulfillment'){
 await permitted(db,user,campus,kind==='payment');
 const cases=await db.q('SELECT * FROM investigations WHERE campus_id=$1 ORDER BY created_at DESC',[campus]);const byId=new Map(cases.map(c=>[c.id,c]));
 const operators=await db.q("SELECT DISTINCT u.id,u.name FROM users u JOIN roles r ON r.user_id=u.id WHERE r.campus_id=$1 AND r.role=ANY($2::text[]) ORDER BY u.name",[campus,kind==='payment'?['admin']:['admin','host']]);
 const items:any[]=[];
 if(kind==='payment'){
  const rows=await db.q(`SELECT b.id,b.order_id,b.provider,b.provider_order_id,b.amount,b.captured,b.checkout_state,b.expires_at,b.last_checked_at,b.last_reconcile_at,b.reconciliation_error,b.created_at,o.drop_id,o.user_id,o.payment_hold,d.title FROM obligations b JOIN orders o ON o.id=b.order_id JOIN drops d ON d.id=o.drop_id WHERE o.campus_id=$1 AND (EXISTS(SELECT 1 FROM payment_exceptions e WHERE e.obligation_id=b.id) OR b.reconciliation_error IS NOT NULL OR (NOT b.captured AND b.expires_at<=now()) OR b.provider='legacy_unknown' OR EXISTS(SELECT 1 FROM investigations i WHERE i.obligation_id=b.id)) ORDER BY b.created_at DESC`,[campus]);
  for(const r of rows){const source:Source={kind:'payment',id:r.id};const exceptions=await db.q('SELECT * FROM payment_exceptions WHERE obligation_id=$1 ORDER BY created_at',[r.id]);items.push({...r,source,investigation:byId.get(caseId(source)),categories:[...exceptions.map(e=>e.reason),...(r.reconciliation_error?['VERIFICATION_UNAVAILABLE']:[]),...(r.provider==='legacy_unknown'?['INCOMPLETE_PROVIDER_REFERENCE']:[]),...(!r.captured&&new Date(r.expires_at).getTime()<=Date.now()?['EXPIRED_UNVERIFIED']:[])],exceptions,events:await db.q('SELECT provider,provider_payment_id,amount,credited_amount,created_at FROM payment_events WHERE obligation_id=$1 ORDER BY created_at',[r.id]),attempts:await db.q('SELECT payment_id,status,amount,currency,provider_time,updated_at FROM payment_attempts WHERE obligation_id=$1 ORDER BY updated_at',[r.id]),canReconcile:r.provider==='cashfree'&&!!r.provider_order_id,blocking:'No manual credit, refund or hold release. Verification uses authenticated provider evidence.'});}
 }else{
  const rows=await db.q('SELECT l.*,r.drop_id,r.id receipt_id,r.actor,r.created_at,d.title,v.color,v.size FROM receipt_lines l JOIN receipts r ON r.id=l.receipt_id JOIN drops d ON d.id=r.drop_id JOIN variants v ON v.id=l.variant_id WHERE d.campus_id=$1 ORDER BY r.created_at DESC',[campus]);
  for(const r of rows)for(const category of ['MISSING','DAMAGED','INCORRECT','EXCESS'] as const){const base:Source={kind:'receipt',id:r.receipt_id,variantId:r.variant_id,category};const c=byId.get(caseId(base));const quantity=category==='MISSING'?r.expected-r.healthy-r.damaged:category==='DAMAGED'?r.damaged:c?.reported_quantity;
   if(quantity>0)items.push({...r,source:{...base,...(['INCORRECT','EXCESS'].includes(category)?{quantity}:{})},investigation:c,categories:[category],reportedQuantity:quantity,blocking:'Reported items do not change available stock. Review retains all financial and stock holds.'});
  }
  const manifest=await db.q(`SELECT o.drop_id,d.title,o.variant_id,v.color,v.size,SUM(o.quantity)::int expected,SUM(o.allocated)::int allocated,COALESCE(SUM(o.quantity) FILTER(WHERE o.fulfillment='COLLECTED'),0)::int handed_over FROM orders o JOIN drops d ON d.id=o.drop_id JOIN variants v ON v.id=o.variant_id WHERE o.campus_id=$1 AND o.fulfillment IN ('IN_PRODUCTION','ARRIVED','STOCK_EXCEPTION','COLLECTED') GROUP BY o.drop_id,d.title,o.variant_id,v.color,v.size ORDER BY d.title,v.color,v.size`,[campus]);
  for(const m of manifest){const matching=rows.filter(r=>r.drop_id===m.drop_id&&r.variant_id===m.variant_id);m.received_healthy=matching.reduce((n,r)=>n+r.healthy,0);m.received_damaged=matching.reduce((n,r)=>n+r.damaged,0);m.outstanding=m.expected-m.handed_over;m.packed=null;}
  for(const item of items)item.history=await db.q('SELECT id,actor,action,reason,reference,state,result,created_at,completed_at FROM investigation_actions WHERE investigation_id=$1 ORDER BY created_at',[caseId(item.source)]);
  return {items,operators,manifest,receipts:rows};
 }
 for(const item of items){item.evidenceVersion=await evidenceVersion(db,item.source.id);item.history=await db.q('SELECT id,actor,action,reason,reference,state,result,created_at,completed_at FROM investigation_actions WHERE investigation_id=$1 ORDER BY created_at',[caseId(item.source)]);}
 return {items,operators,manifest:[],receipts:[]};
}

// Leased, persisted work: network calls happen outside row locks. Provider settlement
// keeps its existing idempotency and eligibility rules; this never releases holds.
export async function processReconciliations(db:Database,adapter:CashfreeAdapter,limit=10){let completed=0,failed=0;for(let n=0;n<limit;n++){
 const job=await db.tx(async q=>{const [j]=await q.q("SELECT * FROM investigation_actions WHERE action='RECONCILE' AND ((state='QUEUED' AND available_at<=now()) OR (state='PROCESSING' AND lease_until<=now())) ORDER BY available_at,id FOR UPDATE SKIP LOCKED LIMIT 1");if(!j)return null;if(j.attempts>=3){await q.q("UPDATE investigation_actions SET state='FAILED',lease_until=NULL,lease_token=NULL,completed_at=now(),result=result || '{\"outcome\":\"RETRY_BUDGET_EXHAUSTED\",\"jobState\":\"FAILED\"}'::jsonb WHERE id=$1",[j.id]);const c=await D.one(q,'SELECT campus_id FROM investigations WHERE id=$1',[j.investigation_id]);await D.audit(q,j.actor,c.campus_id,'INVESTIGATION_VERIFICATION',j.investigation_id,{actionId:j.id,outcome:'RETRY_BUDGET_EXHAUSTED',financialHoldsRetained:true});return {exhausted:true};}const token=D.uid();return D.one(q,"UPDATE investigation_actions SET state='PROCESSING',attempts=attempts+1,lease_until=now()+interval '2 minutes',lease_token=$2 WHERE id=$1 RETURNING *",[j.id,token]);});if(!job)break;if(job.exhausted){failed++;continue;}
 let outcome='VERIFIED',success=true;
 try{const c=await D.one(db,'SELECT * FROM investigations WHERE id=$1',[job.investigation_id]);await permitted(db,job.actor,c.campus_id,true);await P.reconcile(db,c.obligation_id,adapter);}catch{success=false;outcome='VERIFICATION_UNAVAILABLE_OR_REJECTED';}
 await db.tx(async q=>{const j=await D.one(q,'SELECT * FROM investigation_actions WHERE id=$1 FOR UPDATE',[job.id]);if(j.lease_token!==job.lease_token||j.state!=='PROCESSING')return;
  const c=await D.one(q,'SELECT * FROM investigations WHERE id=$1',[j.investigation_id]);const state=success?'DONE':j.attempts>=3?'FAILED':'QUEUED';
  await q.q("UPDATE investigation_actions SET state=$2,lease_until=NULL,lease_token=NULL,available_at=now()+interval '30 seconds',completed_at=$3,result=result || $4::jsonb WHERE id=$1",[j.id,state,state==='QUEUED'?null:new Date(),JSON.stringify({outcome,jobState:state})]);
  await D.audit(q,j.actor,c.campus_id,'INVESTIGATION_VERIFICATION',c.id,{actionId:j.id,attempt:j.attempts,outcome,financialHoldsRetained:true});
 });if(success)completed++;else failed++;
 }return {completed,failed};}
