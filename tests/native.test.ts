import {beforeAll,beforeEach,afterAll,it,expect} from 'vitest';
import pg from 'pg';
import {QueueEvents} from 'bullmq';
import {database,type Database} from '../packages/db/index.js';
import {seed} from '../packages/db/seed.js';
import * as D from '../apps/api/src/domain.js';
import * as P from '../apps/api/src/payments.js';
import {decimal,type CashfreeAdapter} from '../apps/api/src/cashfree.js';
import {startWorker} from '../apps/api/src/worker.js';
import * as C from '../apps/api/src/campaigns.js';
let a:Database,b:Database,control:pg.Pool;
const drop='north-hoodie',variant=drop+'-Forest-M';
beforeAll(async()=>{
 const url=process.env.DATABASE_URL;if(!url||!new URL(url).pathname.includes('test'))throw Error('Native races require an isolated PostgreSQL test database; PGlite is forbidden');
 const ua=new URL(url),ub=new URL(url);ua.searchParams.set('application_name','ccoop-race-a');ub.searchParams.set('application_name','ccoop-race-b');
 a=await database(ua.toString());b=await database(ub.toString());control=new pg.Pool({connectionString:url});
 expect((await a.q('SELECT version() v'))[0].v).toContain('PostgreSQL 17');
},30000);
beforeEach(async()=>{await a.q('TRUNCATE campuses,users CASCADE');await seed(a);});
afterAll(async()=>{await a?.close();await b?.close();await control?.end();});
// Both independently connected transactions must be observed blocked on real PostgreSQL locks.
async function overlap(table:'drops'|'orders',id:string,left:()=>Promise<any>,right:()=>Promise<any>){
 const guard=await control.connect();await guard.query('BEGIN');await guard.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE`,[id]);
 const pending=Promise.allSettled([left(),right()]);let blocked=false;
 try{const until=Date.now()+5000;while(Date.now()<until){const {rows}=await control.query("SELECT count(*)::int n FROM pg_stat_activity WHERE application_name IN ('ccoop-race-a','ccoop-race-b') AND wait_event_type='Lock'");if(rows[0].n>=2){blocked=true;break;}await new Promise(r=>setTimeout(r,20));}}
 finally{await guard.query('ROLLBACK');guard.release();}
 const results=await pending;expect(blocked,'both connections overlapped while waiting for the row lock').toBe(true);return results;
}
async function eligible(){const p=await D.pledge(a,'student',drop,variant,2,'native-pledge1');await D.lockDrop(a,'curator',drop);return D.createOrder(a,'student',p.id);}
async function paid(){const o=await eligible(),ob=await D.obligation(a,'student',o.id,'full');await D.capture(a,'native-event','native-pay',ob.id,ob.amount);return o;}
async function arrived(){const o=await paid();await D.approve(a,'admin',drop);await D.receive(a,'host',drop,'native-receipt',[{variantId:variant,healthy:2,damaged:0}]);return o;}
const fulfilled=(rows:PromiseSettledResult<any>[])=>rows.filter(r=>r.status==='fulfilled');
it('overlapping pledges enforce the aggregate limit and rollback the losing request',async()=>{
 const results=await overlap('drops',drop,()=>D.pledge(a,'student',drop,variant,6,'native-limit-a'),()=>D.pledge(b,'student',drop,variant,6,'native-limit-b'));
 expect(fulfilled(results)).toHaveLength(1);expect((await D.one(a,'SELECT SUM(quantity)::int n FROM pledges')).n).toBe(6);expect(await a.q('SELECT * FROM payment_events')).toHaveLength(0);
});
it('overlapping conversions return the same single order',async()=>{
 const p=await D.pledge(a,'student',drop,variant,2,'native-convert');await D.lockDrop(a,'curator',drop);
 const results=await overlap('drops',drop,()=>D.createOrder(a,'student',p.id),()=>D.createOrder(b,'student',p.id));expect(fulfilled(results)).toHaveLength(2);expect(await a.q('SELECT * FROM orders')).toHaveLength(1);
});
it('overlapping duplicate successes apply funds and notify exactly once',async()=>{
 const o=await eligible(),ob=await D.obligation(a,'student',o.id,'deposit');
 const results=await overlap('drops',drop,()=>D.capture(a,'native-event','native-pay',ob.id,ob.amount),()=>D.capture(b,'native-event','native-pay',ob.id,ob.amount));expect(fulfilled(results)).toHaveLength(2);
 expect((await D.one(a,'SELECT paid FROM orders')).paid).toBe(ob.amount);expect(await a.q('SELECT * FROM payment_events')).toHaveLength(1);expect(await a.q("SELECT * FROM outbox WHERE message LIKE 'Payment confirmed%'")).toHaveLength(1);
});
it('verification racing with approval never includes unpaid demand and eventually approves exactly once',async()=>{
 const o=await eligible(),ob=await D.obligation(a,'student',o.id,'deposit');
 const results=await overlap('drops',drop,()=>D.capture(a,'native-event','native-pay',ob.id,ob.amount),()=>D.approve(b,'admin',drop));
 expect(results[0].status).toBe('fulfilled');if(results[1].status==='rejected')await D.approve(a,'admin',drop);
 expect((await D.one(a,'SELECT fulfillment,paid FROM orders')).fulfillment).toBe('IN_PRODUCTION');expect(await a.q("SELECT * FROM audit WHERE action='PRODUCTION_APPROVED'")).toHaveLength(1);
});
it('overlapping receipt scans increment healthy stock and create one ledger/audit record',async()=>{
 await paid();await D.approve(a,'admin',drop);const lines=[{variantId:variant,healthy:2,damaged:0}];
 const results=await overlap('drops',drop,()=>D.receive(a,'host',drop,'native-receipt',lines),()=>D.receive(b,'host',drop,'native-receipt',lines));expect(fulfilled(results)).toHaveLength(2);
 expect((await D.one(a,'SELECT on_hand,allocated FROM stock'))).toMatchObject({on_hand:2,allocated:2});expect(await a.q("SELECT * FROM movements WHERE kind='RECEIPT'")).toHaveLength(1);expect(await a.q("SELECT * FROM audit WHERE action='SHIPMENT_RECONCILED'")).toHaveLength(1);
});
it('concurrent pickup scans decrement stock and audit exactly once',async()=>{
 const o=await arrived(),pass=await D.pickupPass(a,'student',o.id);const results=await overlap('orders',o.id,()=>D.dispatch(a,'host',pass.token),()=>D.dispatch(b,'host',pass.token));expect(fulfilled(results)).toHaveLength(1);
 expect(await a.q('SELECT on_hand,allocated FROM stock')).toEqual([{on_hand:0,allocated:0}]);expect(await a.q("SELECT * FROM movements WHERE kind='DISPATCH'")).toHaveLength(1);expect(await a.q("SELECT * FROM audit WHERE action='PICKUP_COMPLETED'")).toHaveLength(1);
});
it('rotation racing with dispatch invalidates the old token or rejects rotation after collection',async()=>{
 const o=await arrived(),pass=await D.pickupPass(a,'student',o.id);const results=await overlap('orders',o.id,()=>D.pickupPass(a,'student',o.id),()=>D.dispatch(b,'host',pass.token));expect(fulfilled(results)).toHaveLength(1);
 if(results[0].status==='fulfilled'){await expect(D.dispatch(a,'host',pass.token)).rejects.toThrow();await D.dispatch(a,'host',results[0].value.token);}
 expect(await a.q('SELECT on_hand,allocated FROM stock')).toEqual([{on_hand:0,allocated:0}]);expect(await a.q('SELECT * FROM pickup_events')).toHaveLength(1);
});
it('concurrent Cashfree creates and attempts retain one obligation and preserve duplicate-success evidence',async()=>{
 const o=await eligible(),remote=new Map<string,any>();const adapter:CashfreeAdapter={async create(ob){const r=remote.get(ob.provider_order_id)||{order_id:ob.provider_order_id,order_currency:'INR',order_amount:decimal(ob.amount),customer_details:{customer_id:ob.customer_ref},order_status:'ACTIVE',payment_session_id:'fixture-session'};remote.set(r.order_id,r);return r;},async order(id){return remote.get(id);},async payments(){return [];}};
 const results=await overlap('drops',drop,()=>P.cashfreeCheckout(a,'student',o.id,'deposit',adapter),()=>P.cashfreeCheckout(b,'student',o.id,'deposit',adapter));expect(fulfilled(results)).toHaveLength(2);expect(remote.size).toBe(1);expect(await a.q('SELECT * FROM obligations')).toHaveLength(1);
 const ob=await D.one(a,'SELECT * FROM obligations'),p={order_id:ob.provider_order_id,payment_status:'SUCCESS',payment_currency:'INR',payment_amount:decimal(ob.amount),payment_time:new Date().toISOString()};
 await overlap('drops',drop,()=>P.recordAttempt(a,ob,{...p,cf_payment_id:'a'},'fixture'),()=>P.recordAttempt(b,ob,{...p,cf_payment_id:'b'},'fixture'));
 expect((await D.one(a,'SELECT paid,payment_hold FROM orders'))).toMatchObject({paid:ob.amount,payment_hold:true});expect(await a.q('SELECT * FROM payment_events')).toHaveLength(2);expect(await a.q('SELECT * FROM payment_exceptions')).toHaveLength(1);
});
it('invalid receipt rolls back without poisoning a concurrent valid receipt',async()=>{
 await paid();await D.approve(a,'admin',drop);const results=await overlap('drops',drop,()=>D.receive(a,'host',drop,'invalid-receipt',[{variantId:variant,healthy:3,damaged:0}]),()=>D.receive(b,'host',drop,'valid-receipt',[{variantId:variant,healthy:2,damaged:0}]));expect(fulfilled(results)).toHaveLength(1);expect(await a.q('SELECT * FROM receipts')).toHaveLength(1);expect((await D.one(a,'SELECT on_hand FROM stock')).on_hand).toBe(2);
});
it('runs the BullMQ worker against Redis without pretending to deliver external notifications',async()=>{
 if(!process.env.REDIS_URL)throw Error('REDIS_URL required');await D.notify(a,'student','Native worker verification');
 await a.q("UPDATE drops SET state='SCHEDULED',publishes_at=now()-interval '1 hour' WHERE id=$1",[drop]);
 const name='ccoop-test-'+D.uid(),runtime=await startWorker(a,process.env.REDIS_URL,name,60000);
 const redis=new URL(process.env.REDIS_URL),events=new QueueEvents(name,{connection:{host:redis.hostname,port:Number(redis.port)||6379}});
 try{await events.waitUntilReady();const job=await runtime.queue.add('poll',{});const result=await job.waitUntilFinished(events,10000);expect(result).toMatchObject({event:'outbox_pending',count:1,externalDelivery:'not_configured'});expect((await D.one(a,'SELECT delivered_at FROM outbox')).delivered_at).toBeNull();expect((await D.one(a,'SELECT state FROM drops WHERE id=$1',[drop])).state).toBe('PLEDGING');const again=await runtime.queue.add('poll',{});await again.waitUntilFinished(events,10000);expect(await a.q("SELECT * FROM audit WHERE action='SCHEDULE_PUBLISHED'")).toHaveLength(1);await runtime.queue.removeJobScheduler('outbox-poll');}
 finally{await events.close();await runtime.close();}
},20000);
it.each(['edit','cancel'] as const)('serializes pledge %s against campaign closure',async action=>{
 const p=await D.pledge(a,'student',drop,variant,2,D.uid());
 const results=await overlap('drops',drop,()=>C.changePledge(a,'student',p.id,{key:D.uid(),revision:0,action,variantId:variant,quantity:3}),()=>D.lockDrop(b,'curator',drop));
 expect(results[1].status).toBe('fulfilled');const d=await D.one(a,'SELECT * FROM drops WHERE id=$1',[drop]),pledge=await D.one(a,'SELECT * FROM pledges WHERE id=$1',[p.id]);
 expect(d.snapshot.total).toBe(pledge.status==='CANCELED'?0:pledge.quantity);expect(await a.q("SELECT * FROM audit WHERE action='CAMPAIGN_LOCKED'")).toHaveLength(1);
});
it('serializes a color switch against overdue resolution and rejects decisions after the deadline',async()=>{
 await a.q("UPDATE variants SET color_moq=3 WHERE drop_id=$1 AND color='Ink'",[drop]);await D.pledge(a,'student',drop,variant,2,D.uid());const p=await D.pledge(a,'student2',drop,drop+'-Ink-M',1,D.uid());await D.lockDrop(a,'curator',drop);
 const pledge=await D.one(a,'SELECT * FROM pledges WHERE id=$1',[p.id]);await a.q("UPDATE drops SET resolution_ends_at=now()-interval '1 second' WHERE id=$1",[drop]);
 const results=await overlap('drops',drop,()=>C.changePledge(a,'student2',p.id,{key:D.uid(),revision:pledge.revision,action:'switch',variantId:variant,price:129900}),()=>C.recoverCampaigns(b));
 expect(results[0].status).toBe('rejected');expect(results[1].status).toBe('fulfilled');expect((await D.one(a,'SELECT status FROM pledges WHERE id=$1',[p.id])).status).toBe('EXPIRED');expect((await D.one(a,'SELECT state FROM drops WHERE id=$1',[drop])).state).toBe('PAYMENT_OPEN');
});
it('payment expiry racing with timely verification preserves the attempt and credits exactly once',async()=>{
 const o=await eligible(),ob=await D.obligation(a,'student',o.id,'full','cashfree');const paidAt=new Date(Date.now()-2000).toISOString();await a.q("UPDATE drops SET payment_ends_at=now()-interval '1 second' WHERE id=$1",[drop]);
 const results=await overlap('drops',drop,()=>D.capture(a,'expiry-race','expiry-pay',ob.id,ob.amount,'cashfree',paidAt),()=>C.recoverCampaigns(b));expect(fulfilled(results)).toHaveLength(2);
 expect((await D.one(a,'SELECT paid FROM orders WHERE id=$1',[o.id])).paid).toBe(o.total);expect(await a.q('SELECT * FROM obligations')).toHaveLength(1);expect(await a.q('SELECT * FROM payment_events')).toHaveLength(1);expect((await D.one(a,'SELECT status FROM pledges WHERE id=$1',[o.pledge_id])).status).toBe('CONVERTED');
});
it('duplicate overdue jobs commit one closure and one set of notifications',async()=>{
 await D.pledge(a,'student',drop,variant,2,D.uid());await a.q("UPDATE drops SET closes_at=now()-interval '1 second' WHERE id=$1",[drop]);
 const results=await overlap('drops',drop,()=>C.recoverCampaigns(a),()=>C.recoverCampaigns(b));expect(fulfilled(results)).toHaveLength(2);expect(await a.q("SELECT * FROM audit WHERE action='CAMPAIGN_LOCKED'")).toHaveLength(1);expect(await a.q("SELECT * FROM audit WHERE action='RESOLUTION_FINISHED'")).toHaveLength(1);
});
