import type {Database} from '../../../packages/db/index.js';
import * as D from './domain.js';
import {Cashfree,type CashfreeAdapter,paise} from './cashfree.js';
export function cashfreeAdapter():CashfreeAdapter {return new Cashfree(process.env.CASHFREE_CLIENT_ID||'',process.env.CASHFREE_CLIENT_SECRET||'',process.env.APP_ORIGIN||'http://localhost:3000');}
export function validateOrder(ob:any,remote:any){
 D.ensure(remote.order_id===ob.provider_order_id&&remote.order_currency==='INR'&&paise(remote.order_amount)===ob.amount,'Cashfree order mismatch');
 D.ensure(remote.customer_details?.customer_id===ob.customer_ref,'Cashfree customer mismatch');
}
export async function cashfreeCheckout(db:Database,user:string,orderId:string,choice:'deposit'|'full'|'balance',adapter=cashfreeAdapter()){
 const owner=await D.one(db,'SELECT user_id FROM orders WHERE id=$1',[orderId]);D.ensure(owner.user_id===user,'Not your payment',403);
 // Before replacing an expired attempt, recover any remote success; an unavailable provider fails closed.
 const stale=await db.q("SELECT * FROM obligations WHERE order_id=$1 AND provider='cashfree' AND NOT captured AND expires_at<=now() AND provider_order_id IS NOT NULL",[orderId]);
 for(const previous of stale){
  try{const remote=await adapter.order(previous.provider_order_id);await reconcile(db,previous.id,adapter);
   const current=await D.one(db,'SELECT captured FROM obligations WHERE id=$1',[previous.id]);
   D.ensure(current.captured||['EXPIRED','TERMINATED'].includes(remote.order_status),'Previous checkout is not finalized. Check payment status before retrying.');
  }catch(e){if(!(e instanceof D.Problem)||e.statusCode!==404)throw e;}
 }
 const ob=await D.obligation(db,user,orderId,choice,'cashfree');
 const [bound]=await db.q("UPDATE obligations SET provider_order_id=COALESCE(provider_order_id,$2),customer_ref=COALESCE(customer_ref,$3) WHERE id=$1 AND provider='cashfree' RETURNING *",[ob.id,'ccoop_'+ob.id,'test_'+ob.id]);
 D.ensure(bound,'Payment provider mismatch');
 const remote=await adapter.create(bound);validateOrder(bound,remote);
 D.ensure(remote.order_status==='ACTIVE'&&typeof remote.payment_session_id==='string','Cashfree order is not open. Check payment status.');
 // A create response delayed beyond the local deadline must not open a new checkout.
 D.ensure(new Date(bound.expires_at).getTime()>Date.now(),'Payment attempt expired. Check payment status.');
 await db.q('UPDATE obligations SET payment_session_id=$2 WHERE id=$1',[bound.id,remote.payment_session_id]);
 return {obligation:{id:bound.id,amount:bound.amount,expires_at:bound.expires_at,provider:'cashfree'},mode:'cashfree',paymentSessionId:remote.payment_session_id};
}
export async function recordAttempt(db:Database,ob:any,p:any,source:string){
 D.ensure(String(p.order_id)===ob.provider_order_id,'Cashfree payment order mismatch');
 D.ensure(p.payment_currency==='INR'&&paise(p.payment_amount)===ob.amount,'Cashfree payment amount/currency mismatch');
 if(p.order_currency!==undefined)D.ensure(p.order_currency==='INR','Cashfree payment order currency mismatch');
 if(p.order_amount!==undefined)D.ensure(paise(p.order_amount)===ob.amount,'Cashfree payment order amount mismatch');
 D.ensure(typeof p.cf_payment_id==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(p.cf_payment_id),'Invalid provider transaction',400);
 D.ensure(['SUCCESS','FAILED','PENDING','USER_DROPPED','NOT_ATTEMPTED','CANCELLED','VOID'].includes(p.payment_status),'Unknown payment status',400);
 if(p.payment_status==='SUCCESS')D.ensure(typeof (p.payment_completion_time||p.payment_time)==='string','Missing successful payment time',400);
 const status=p.payment_status,id=p.cf_payment_id;
 return db.tx(async q=>{
  // Keep financial evidence, attempt status and exception creation in one atomic transaction.
  const nested:Database={...q,tx:fn=>fn(q),close:async()=>{}};
  if(status==='SUCCESS')await D.capture(nested,id,id,ob.id,ob.amount,'cashfree',p.payment_completion_time||p.payment_time);
  else await D.one(q,'SELECT id FROM obligations WHERE id=$1 FOR UPDATE',[ob.id]);
  const old=await q.q('SELECT * FROM payment_attempts WHERE provider=$1 AND payment_id=$2 FOR UPDATE',['cashfree',id]);
  D.ensure(!old.length||(old[0].obligation_id===ob.id&&old[0].amount===ob.amount),'Payment attempt ownership mismatch');
  await q.q('INSERT INTO payment_observations(id,provider,payment_id,obligation_id,status,amount,source) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',[D.hash('cashfree:'+id+':'+status),'cashfree',id,ob.id,status,ob.amount,source]);
  await q.q(`INSERT INTO payment_attempts(provider,payment_id,obligation_id,status,amount,currency,provider_time) VALUES('cashfree',$1,$2,$3,$4,'INR',$5)
   ON CONFLICT(provider,payment_id) DO UPDATE SET status=CASE WHEN payment_attempts.status='SUCCESS' THEN 'SUCCESS' WHEN excluded.status='SUCCESS' THEN 'SUCCESS' WHEN payment_attempts.status IN ('FAILED','USER_DROPPED','CANCELLED','VOID') THEN payment_attempts.status ELSE excluded.status END,updated_at=now()`,[id,ob.id,status,ob.amount,p.payment_time||null]);
  await q.q("UPDATE obligations SET checkout_state=CASE WHEN captured THEN 'SUCCESS' ELSE $2 END WHERE id=$1",[ob.id,status]);
  return {verified:true,status};
 });
}
export async function reconcile(db:Database,id:string,adapter=cashfreeAdapter()){
 const ob=await D.one(db,"SELECT * FROM obligations WHERE id=$1 AND provider='cashfree'",[id]);
 D.ensure(ob.provider_order_id,'No provider order exists yet');
 await db.q('UPDATE obligations SET last_reconcile_at=now() WHERE id=$1',[id]);
 try {
 const remote=await adapter.order(ob.provider_order_id);validateOrder(ob,remote);
 const payments=await adapter.payments(ob.provider_order_id);D.ensure(Array.isArray(payments),'Invalid provider payments',502);
 // Success first makes mixed/out-of-order histories deterministic.
 payments.sort((a,b)=>Number(b.payment_status==='SUCCESS')-Number(a.payment_status==='SUCCESS'));
 for(const p of payments)await recordAttempt(db,ob,p,'reconciliation');
 await db.q('UPDATE obligations SET last_checked_at=now(),reconciliation_error=NULL WHERE id=$1',[id]);
 return D.one(db,'SELECT id,provider,checkout_state,captured,expires_at FROM obligations WHERE id=$1',[id]);
 }catch(e){await db.q("UPDATE obligations SET reconciliation_error='Verification unavailable; retry or request operations review' WHERE id=$1",[id]);throw e;}
}
export async function reconcilePending(db:Database,adapter=cashfreeAdapter()){
 const rows=await db.q("SELECT id FROM obligations WHERE provider='cashfree' AND provider_order_id IS NOT NULL ORDER BY last_reconcile_at NULLS FIRST LIMIT 50");
 let verified=0,failed=0;for(const row of rows){try{await reconcile(db,row.id,adapter);verified++;}catch{failed++;}}return {verified,failed};
}
