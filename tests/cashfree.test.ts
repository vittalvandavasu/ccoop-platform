import {beforeAll,beforeEach,afterAll,it,expect,vi} from 'vitest';
import {createHmac} from 'node:crypto';
import {database,type Database} from '../packages/db/index.js';
import {seed} from '../packages/db/seed.js';
import * as D from '../apps/api/src/domain.js';
import * as P from '../apps/api/src/payments.js';
import {Cashfree,decimal,paise,paymentConfig,providerJSON,verifySignature,type CashfreeAdapter} from '../apps/api/src/cashfree.js';
let db:Database,app:any;
const origin='http://localhost:3000',secret='cashfree-fixture-not-a-provider-secret';
const orders=new Map<string,any>(),payments=new Map<string,any[]>();
const adapter:CashfreeAdapter={async create(ob){const r=orders.get(ob.provider_order_id)||{order_id:ob.provider_order_id,order_currency:'INR',order_amount:decimal(ob.amount),customer_details:{customer_id:ob.customer_ref},order_status:'ACTIVE',payment_session_id:'fixture-session'};orders.set(r.order_id,r);return r;},async order(id){const r=orders.get(id);if(!r)throw new D.Problem(404,'not found');return r;},async payments(id){return payments.get(id)||[];}};
beforeAll(async()=>{process.env.PGLITE_PATH='memory://';process.env.DEV_AUTH='true';process.env.PAYMENT_PROVIDER='cashfree';process.env.CASHFREE_ENV='sandbox';process.env.CASHFREE_CLIENT_SECRET=secret;if(process.env.DATABASE_URL&&!new URL(process.env.DATABASE_URL).pathname.includes('test'))throw Error('Dedicated test database required');db=await database();const {buildServer}=await import('../apps/api/src/server.js');app=await buildServer(db,{cashfree:adapter});},30000);
beforeEach(async()=>{await db.q('TRUNCATE campuses,users CASCADE');await seed(db);orders.clear();payments.clear();});
afterAll(async()=>{await app?.close();await db?.close();});
async function eligible(){const p=await D.pledge(db,'student','north-hoodie','north-hoodie-Forest-M',2,'cashfree-pledge1');await D.lockDrop(db,'curator','north-hoodie');return D.createOrder(db,'student',p.id);}
async function checkout(){const order=await eligible();const result=await P.cashfreeCheckout(db,'student',order.id,'deposit',adapter);const ob=await D.one(db,'SELECT * FROM obligations WHERE id=$1',[result.obligation.id]);return {order,ob};}
function payment(ob:any,id='payment-1',status='SUCCESS'){return {cf_payment_id:id,order_id:ob.provider_order_id,payment_status:status,payment_amount:decimal(ob.amount),payment_currency:'INR',payment_time:new Date().toISOString()};}
async function login(id='student'){const r=await app.inject({method:'POST',url:'/v1/auth/dev',headers:{origin},payload:{id}});return 'session='+r.cookies[0].value;}
function webhook(ob:any,p:any){return {type:p.payment_status==='SUCCESS'?'PAYMENT_SUCCESS_WEBHOOK':p.payment_status==='FAILED'?'PAYMENT_FAILED_WEBHOOK':'PAYMENT_USER_DROPPED_WEBHOOK',data:{order:orders.get(ob.provider_order_id),payment:p,customer_details:{customer_id:ob.customer_ref}}};}
async function send(body:any,signature?:string,timestamp='1617695238078',rawOverride?:string){const raw=rawOverride||JSON.stringify(body);return app.inject({method:'POST',url:'/v1/payments/cashfree/webhook',headers:{'content-type':'application/json','x-webhook-timestamp':timestamp,'x-webhook-signature':signature??createHmac('sha256',secret).update(timestamp+raw).digest('base64')},payload:raw});}
it('uses exact decimal lexemes and rejects excess precision, unsafe amounts and production configuration',()=>{
 expect(paise(providerJSON('{"payment_amount":1299.01}').payment_amount)).toBe(129901);expect(decimal(129901)).toBe('1299.01');expect(providerJSON('{"cf_payment_id":99999999999999999}').cf_payment_id).toBe('99999999999999999');
 for(const n of ['1.001','NaN','1e3','-1','21474836.48'])expect(()=>paise(n)).toThrow();expect(()=>paymentConfig({CASHFREE_ENV:'production'})).toThrow('sandbox');expect(()=>paymentConfig({PAYMENT_PROVIDER:'simulator',NODE_ENV:'production'})).toThrow('forbidden');expect(paymentConfig({})).toBe('cashfree');
});
it('creates no gateway order for a free pledge and binds retry requests to one obligation/provider',async()=>{
 await D.pledge(db,'student','north-tote','north-tote-Natural-One size',1,'free-pledge-key');expect(orders.size).toBe(0);
 const {order,ob}=await checkout();const retry=await P.cashfreeCheckout(db,'student',order.id,'deposit',adapter);expect(retry.obligation.id).toBe(ob.id);expect(orders.size).toBe(1);await expect(D.obligation(db,'student',order.id,'deposit','razorpay')).rejects.toThrow('another provider');
});
it('recovers create after a provider timeout using the same persisted idempotency key and exact body',async()=>{
 let created:any;const calls:any[]=[];
 const transport=vi.fn(async(url:any,init:any)=>{calls.push({url,init});if(init.method==='POST'){created=JSON.parse(init.body);throw Error('connection lost after provider commit');}if(!created)return new Response('{}',{status:404});return new Response(JSON.stringify({...created,order_status:'ACTIVE',payment_session_id:'recovered'}));}) as any;
 const cf=new Cashfree('fixture-id',secret,origin,transport);const ob={id:D.uid(),provider_order_id:'ccoop_retry',customer_ref:'test_customer',amount:123401,expires_at:new Date(Date.now()+600000)};
 expect((await cf.create(ob)).payment_session_id).toBe('recovered');await cf.create(ob);expect(calls.filter(c=>c.init.method==='POST')).toHaveLength(1);expect(calls[1].init.body).toContain('"order_amount":1234.01');expect(calls[1].init.headers['x-idempotency-key']).toBe(ob.id);expect(calls.every(c=>c.url.startsWith('https://sandbox.cashfree.com/pg/'))).toBe(true);
});
it('rejects missing, malformed and tampered signatures, and accepts a legitimate old signed retry',async()=>{
 const {ob}=await checkout();const body=webhook(ob,payment(ob));for(const bad of ['','bad','é'.repeat(44),'A'.repeat(43)+'='])expect((await send(body,bad)).statusCode).toBe(401);
 expect((await send(body,undefined,'not-a-timestamp')).statusCode).toBe(401);
 const raw=JSON.stringify(body),sig=createHmac('sha256',secret).update('1617695238078'+raw).digest('base64');expect((await send(body,sig,undefined,raw+' ')).statusCode).toBe(401);
 const missing=await app.inject({method:'POST',url:'/v1/payments/cashfree/webhook',payload:body});expect(missing.statusCode).toBe(401);
 expect((await send(body)).statusCode).toBe(200);expect((await send(body)).statusCode).toBe(200);expect(await db.q('SELECT * FROM payment_events')).toHaveLength(1);
});
it('retains failed/dropped/pending attempts and success cannot be downgraded by later failure',async()=>{
 const {order,ob}=await checkout();for(const status of ['PENDING','USER_DROPPED','FAILED'])await P.recordAttempt(db,ob,payment(ob,'attempt-a',status),'fixture');
 const retry=await P.cashfreeCheckout(db,'student',order.id,'deposit',adapter);expect(retry.obligation.id).toBe(ob.id);
 await P.recordAttempt(db,ob,payment(ob,'attempt-b'),'fixture');await P.recordAttempt(db,ob,payment(ob,'attempt-b','FAILED'),'fixture');
 expect((await D.one(db,'SELECT paid FROM orders WHERE id=$1',[order.id])).paid).toBe(ob.amount);expect((await D.one(db,"SELECT status FROM payment_attempts WHERE payment_id='attempt-b'")).status).toBe('SUCCESS');expect(await db.q('SELECT * FROM payment_observations')).toHaveLength(5);
});
it('keeps both successes as evidence and raises an overpayment hold without double-crediting',async()=>{
 const {order,ob}=await checkout();await Promise.all([P.recordAttempt(db,ob,payment(ob,'paid-a'),'fixture'),P.recordAttempt(db,ob,payment(ob,'paid-b'),'fixture')]);
 const o=await D.one(db,'SELECT * FROM orders WHERE id=$1',[order.id]);expect(o.paid).toBe(ob.amount);expect(o.payment_hold).toBe(true);expect(await db.q('SELECT * FROM payment_events')).toHaveLength(2);expect((await D.one(db,'SELECT reason FROM payment_exceptions')).reason).toBe('OVERPAYMENT');await expect(D.approve(db,'admin','north-hoodie')).rejects.toThrow('Paid demand');
});
it('keeps obligation checkout state consistent with a terminal attempt after an out-of-order pending observation',async()=>{
 const {ob}=await checkout();await P.recordAttempt(db,ob,payment(ob,'terminal-attempt','FAILED'),'fixture');await P.recordAttempt(db,ob,payment(ob,'terminal-attempt','PENDING'),'fixture');
 expect((await D.one(db,'SELECT status FROM payment_attempts')).status).toBe('FAILED');expect((await D.one(db,'SELECT checkout_state FROM obligations')).checkout_state).toBe('FAILED');expect(await db.q('SELECT * FROM payment_observations')).toHaveLength(2);expect(await db.q('SELECT * FROM payment_events')).toHaveLength(0);
});
it('rejects wrong amount, currency, provider order, customer and cross-obligation transaction replay atomically',async()=>{
 const {ob}=await checkout();for(const patch of [{payment_amount:'1.00'},{payment_currency:'USD'},{order_id:'wrong-order'},{order_currency:'USD'},{order_amount:'1.00'}])await expect(P.recordAttempt(db,ob,{...payment(ob),...patch},'fixture')).rejects.toThrow();
 const body=webhook(ob,payment(ob));body.data.customer_details.customer_id='wrong';expect((await send(body)).statusCode).toBe(409);expect(await db.q('SELECT * FROM payment_events')).toHaveLength(0);
 const remote=orders.get(ob.provider_order_id);remote.customer_details.customer_id='other';await expect(P.reconcile(db,ob.id,adapter)).rejects.toThrow('customer');
});
it('reconciles a missing webhook and completes deposit, receipt, balance and verified pickup',async()=>{
 const {order,ob}=await checkout();payments.set(ob.provider_order_id,[payment(ob)]);await P.reconcile(db,ob.id,adapter);await D.approve(db,'admin','north-hoodie');await D.receive(db,'host','north-hoodie','cashfree-receipt',[{variantId:'north-hoodie-Forest-M',healthy:2,damaged:0}]);
 await expect(D.pickupPass(db,'student',order.id)).rejects.toThrow('Full payment');
 const balance=await P.cashfreeCheckout(db,'student',order.id,'balance',adapter),b=await D.one(db,'SELECT * FROM obligations WHERE id=$1',[balance.obligation.id]);payments.set(b.provider_order_id,[payment(b,'balance-success')]);await P.reconcile(db,b.id,adapter);
 const pass=await D.pickupPass(db,'student',order.id);await D.dispatch(db,'host',pass.token);expect((await D.one(db,'SELECT on_hand FROM stock')).on_hand).toBe(0);expect((await D.one(db,'SELECT SUM(credited_amount)::int n FROM payment_events')).n).toBe(order.total);
});
it('holds successes after expiry or production and does not let a retry bypass campaign deadlines',async()=>{
 const {order,ob}=await checkout();await db.q("UPDATE obligations SET expires_at=now()-interval '1 minute' WHERE id=$1",[ob.id]);await P.recordAttempt(db,ob,payment(ob),'fixture');expect((await D.one(db,'SELECT paid FROM orders WHERE id=$1',[order.id])).paid).toBe(0);expect((await D.one(db,'SELECT reason FROM payment_exceptions')).reason).toBe('OBLIGATION_EXPIRED');await expect(P.cashfreeCheckout(db,'student',order.id,'deposit',adapter)).rejects.toThrow('review');
});
it('preserves timely success from a delayed webhook but quarantines an initial capture after approval',async()=>{
 const {order,ob}=await checkout();await db.q("UPDATE drops SET state='IN_PRODUCTION' WHERE id='north-hoodie'");await P.recordAttempt(db,ob,payment(ob),'fixture');expect((await D.one(db,'SELECT reason FROM payment_exceptions')).reason).toBe('CAMPAIGN_INELIGIBLE');expect((await D.one(db,'SELECT fulfillment FROM orders WHERE id=$1',[order.id])).fulfillment).toBe('AWAITING_PAYMENT');
});
it('enforces cross-user and campus access for history, checkout, reconciliation and operations',async()=>{
 const {order}=await checkout();const cookie=await login('student2');for(const path of ['payment','reconcile'])expect((await app.inject({method:'POST',url:'/v1/orders/'+order.id+'/'+path,headers:{origin,cookie},payload:{choice:'deposit'}})).statusCode).toBe(403);
 expect((await app.inject({url:'/v1/orders/'+order.id+'/payments',headers:{cookie}})).statusCode).toBe(403);const host=await login('host');expect((await app.inject({url:'/v1/ops/west',headers:{cookie:host}})).statusCode).toBe(403);
});
it('applies a timely success delivered after obligation expiry while the campaign remains eligible',async()=>{
 const {order,ob}=await checkout();await db.q("UPDATE obligations SET created_at=now()-interval '2 minutes',expires_at=now()-interval '1 minute' WHERE id=$1",[ob.id]);
 await P.recordAttempt(db,ob,{...payment(ob),payment_time:new Date(Date.now()-90000).toISOString()},'delayed-webhook');
 expect((await D.one(db,'SELECT paid,payment_hold FROM orders WHERE id=$1',[order.id]))).toMatchObject({paid:ob.amount,payment_hold:false});
});
it('rejects a successful provider transaction reused for another obligation',async()=>{
 const {order,ob}=await checkout();await P.recordAttempt(db,ob,payment(ob),'fixture');
 const [other]=await db.q("INSERT INTO obligations(id,order_id,amount,expires_at,provider,provider_order_id,customer_ref) VALUES($1,$2,$3,now()+interval '10 minutes','cashfree','other-provider-order','other-customer') RETURNING *",[D.uid(),order.id,ob.amount]);
 await expect(P.recordAttempt(db,other,payment(other),'fixture')).rejects.toThrow('replay mismatch');expect(await db.q('SELECT * FROM payment_events')).toHaveLength(1);expect((await D.one(db,'SELECT captured FROM obligations WHERE id=$1',[other.id])).captured).toBe(false);
});
it('preserves recoverable creation intent after a crash and refuses expired retries during provider uncertainty',async()=>{
 const o=await eligible();let calls=0;const interrupted:CashfreeAdapter={...adapter,async create(ob){const remote=await adapter.create(ob);if(calls++===0)throw new D.Problem(503,'timeout after creation');return remote;}};
 await expect(P.cashfreeCheckout(db,'student',o.id,'deposit',interrupted)).rejects.toThrow('timeout');const retry=await P.cashfreeCheckout(db,'student',o.id,'deposit',interrupted);expect(orders.size).toBe(1);expect(await db.q('SELECT * FROM obligations')).toHaveLength(1);
 await db.q("UPDATE obligations SET expires_at=now()-interval '1 minute' WHERE id=$1",[retry.obligation.id]);
 await expect(P.cashfreeCheckout(db,'student',o.id,'deposit',adapter)).rejects.toThrow('not finalized');expect(await db.q('SELECT * FROM obligations')).toHaveLength(1);
});
it('reconciles without a browser callback and reports failures for retry rather than inventing settlement',async()=>{
 const {ob}=await checkout();const bad:CashfreeAdapter={...adapter,async payments(){throw new D.Problem(503,'offline');}};await expect(P.reconcile(db,ob.id,bad)).rejects.toThrow('offline');expect((await D.one(db,'SELECT reconciliation_error FROM obligations')).reconciliation_error).toContain('unavailable');expect(await db.q('SELECT * FROM payment_events')).toHaveLength(0);
 payments.set(ob.provider_order_id,[payment(ob)]);await P.reconcilePending(db,adapter);expect((await D.one(db,'SELECT reconciliation_error,captured FROM obligations'))).toMatchObject({reconciliation_error:null,captured:true});
});
it('rounds an odd-paise deposit upward without losing the exact remaining balance',async()=>{
 const order=await eligible();await db.q('UPDATE orders SET total=259801 WHERE id=$1',[order.id]);
 const ob=await D.obligation(db,'student',order.id,'deposit','cashfree');expect(ob.amount).toBe(129901);expect(decimal(ob.amount)).toBe('1299.01');
 await db.q('UPDATE obligations SET provider_order_id=$2,customer_ref=$3 WHERE id=$1',[ob.id,'odd-paise-order','odd-paise-customer']);await D.capture(db,'odd-event','odd-payment',ob.id,ob.amount,'cashfree',new Date().toISOString());
 await D.approve(db,'admin','north-hoodie');await D.receive(db,'host','north-hoodie','odd-receipt',[{variantId:'north-hoodie-Forest-M',healthy:2,damaged:0}]);const balance=await D.obligation(db,'student',order.id,'balance','cashfree');expect(balance.amount).toBe(129900);
});
