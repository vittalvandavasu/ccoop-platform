import {beforeAll,beforeEach,afterAll,it,expect} from 'vitest';
import {database,type Database} from '../packages/db/index.js';
import {seed} from '../packages/db/seed.js';
import * as D from '../apps/api/src/domain.js';
import * as C from '../apps/api/src/campaigns.js';
let db:Database,app:any;
const drop='north-hoodie',forest=drop+'-Forest-M',ink=drop+'-Ink-M';
const at=(days:number)=>new Date(Date.now()+days*86400000).toISOString();
const command=(revision=0)=>({key:D.uid(),revision,reason:'Curator fixture decision'});
const catalog=()=>({title:'Studio edition',description:'A new collective campus edition.',kind:'hoodie',price:12345,moq:2,mediaRef:'/hoodie.png',publishesAt:at(1),closesAt:at(2),resolutionEndsAt:at(3),paymentEndsAt:at(4),variants:[{color:'Forest',size:'M',colorMoq:2},{color:'Forest',size:'L',colorMoq:2},{color:'Ink',size:'M',colorMoq:3}]});
beforeAll(async()=>{process.env.PGLITE_PATH='memory://';process.env.DEV_AUTH='true';process.env.PAYMENT_PROVIDER='simulator';if(process.env.DATABASE_URL&&!new URL(process.env.DATABASE_URL).pathname.includes('test'))throw Error('Dedicated test database required');db=await database();const {buildServer}=await import('../apps/api/src/server.js');app=await buildServer(db);},30000);
beforeEach(async()=>{await db.q('TRUNCATE campuses,users CASCADE');await seed(db);});
afterAll(async()=>{await app?.close();await db?.close();});
async function headers(id:string){const r=await app.inject({method:'POST',url:'/v1/auth/dev',headers:{origin:'http://localhost:3000'},payload:{id}});return {origin:'http://localhost:3000',cookie:'session='+r.cookies[0].value};}
async function resolving(category=2){await db.q("UPDATE variants SET color_moq=3 WHERE drop_id=$1 AND color='Ink'",[drop]);await db.q('UPDATE drops SET moq=$2 WHERE id=$1',[drop,category]);await D.pledge(db,'student',drop,forest,2,D.uid());const p=await D.pledge(db,'student2',drop,ink,1,D.uid());await D.lockDrop(db,'curator',drop);return D.one(db,'SELECT * FROM pledges WHERE id=$1',[p.id]);}
it('persists draft edits idempotently and hides drafts/schedules from the public',async()=>{
 const b=catalog(),cmd=command(),d=await C.saveDraft(db,'curator','north',null,b,cmd);expect((await C.saveDraft(db,'curator','north',null,b,cmd)).id).toBe(d.id);
 expect((await app.inject('/v1/catalog/north')).json().some((r:any)=>r.id===d.id)).toBe(false);
 const h=await headers('curator');expect((await app.inject({url:'/v1/campaigns/north',headers:h})).json().some((r:any)=>r.id===d.id)).toBe(true);
 expect((await app.inject({url:'/v1/campaigns/west',headers:h})).statusCode).toBe(403);
 expect((await app.inject({method:'POST',url:'/v1/campaigns/west/save',headers:h,payload:{id:null,catalog:b,command:command()}})).statusCode).toBe(403);
 expect((await app.inject({url:'/v1/campaigns/north',headers:await headers('student')})).statusCode).toBe(403);
 const revised=await C.saveDraft(db,'curator','north',d.id,{...b,price:23456},command(d.revision));expect(revised.price).toBe(23456);
 await C.publish(db,'curator',d.id,command(revised.revision),true);expect((await app.inject('/v1/catalog/north')).json().some((r:any)=>r.id===d.id)).toBe(false);
 await expect(C.saveDraft(db,'curator','north',d.id,b,command())).rejects.toThrow('latest draft');
});
it('validates prices, windows, SKU uniqueness, color thresholds and campus authorization',async()=>{
 for(const b of [{...catalog(),price:0},{...catalog(),closesAt:at(5)},{...catalog(),variants:[catalog().variants[0],catalog().variants[0]]},{...catalog(),variants:[catalog().variants[0],{...catalog().variants[1],colorMoq:9}]}])await expect(C.saveDraft(db,'curator','north',null,b,command())).rejects.toThrow();
 await expect(C.saveDraft(db,'curator','west',null,catalog(),command())).rejects.toThrow('not permitted');await expect(C.saveDraft(db,'admin','west',null,catalog(),command())).rejects.toThrow('not permitted');
});
it('recovers overdue scheduled publication and closure after downtime without duplicate audits',async()=>{
 const d=await C.saveDraft(db,'curator','north',null,catalog(),command());await C.publish(db,'curator',d.id,command(),true);
 await db.q("UPDATE drops SET publishes_at=now()-interval '2 hours',closes_at=now()-interval '1 hour' WHERE id=$1",[d.id]);
 await C.recoverCampaigns(db);await C.recoverCampaigns(db);expect((await D.one(db,'SELECT state FROM drops WHERE id=$1',[d.id])).state).toBe('FAILED');
 expect(await db.q("SELECT id FROM audit WHERE entity=$1 AND action='SCHEDULE_PUBLISHED'",[d.id])).toHaveLength(1);expect(await db.q("SELECT id FROM audit WHERE entity=$1 AND action='CAMPAIGN_LOCKED'",[d.id])).toHaveLength(1);
});
it('records unsuccessful closure without generating orders, obligations or refunds',async()=>{
 const p=await D.pledge(db,'student',drop,forest,1,D.uid());await D.lockDrop(db,'curator',drop);await D.lockDrop(db,'curator',drop);
 expect((await D.one(db,'SELECT * FROM drops WHERE id=$1',[drop])).snapshot).toMatchObject({total:1,categoryMoq:2});expect((await D.one(db,'SELECT status FROM pledges WHERE id=$1',[p.id])).status).toBe('FAILED');expect(await db.q('SELECT * FROM orders')).toHaveLength(0);expect(await db.q('SELECT * FROM obligations')).toHaveLength(0);
});
it('requires explicit reviewed switches and counts eligible-color units before conversion',async()=>{
 const p=await resolving(3);expect((await D.one(db,'SELECT state FROM drops WHERE id=$1',[drop])).state).toBe('RESOLVING');
 await expect(D.createOrder(db,'student2',p.id)).rejects.toThrow('not eligible');
 await expect(C.changePledge(db,'student2',p.id,{key:D.uid(),revision:p.revision,action:'switch',variantId:forest,price:1})).rejects.toThrow('Price changed');
 const b={key:D.uid(),revision:p.revision,action:'switch' as const,variantId:forest,price:129900};await C.changePledge(db,'student2',p.id,b);await C.changePledge(db,'student2',p.id,b);
 const d=await D.one(db,'SELECT * FROM drops WHERE id=$1',[drop]);expect(d.state).toBe('PAYMENT_OPEN');expect(d.snapshot.finalEligibleUnits).toBe(3);
 const o=await D.createOrder(db,'student2',p.id);expect(o.commercial_snapshot).toMatchObject({unitPrice:129900,quantity:1,variantId:forest,color:'Forest'});expect(await db.q('SELECT * FROM orders')).toHaveLength(1);
});
it('fails the final category gate when failed-color pledges cancel',async()=>{const p=await resolving(3);await C.changePledge(db,'student2',p.id,{key:D.uid(),revision:p.revision,action:'cancel'});expect((await D.one(db,'SELECT state FROM drops WHERE id=$1',[drop])).state).toBe('FAILED');expect((await D.one(db,'SELECT status FROM pledges WHERE id=$1',[p.id])).status).toBe('CANCELED');});
it('expires unresolved colors once and opens payment only for surviving eligible units',async()=>{const p=await resolving();await db.q("UPDATE drops SET resolution_ends_at=now()-interval '1 minute' WHERE id=$1",[drop]);await C.recoverCampaigns(db);const count=(await db.q('SELECT * FROM outbox')).length;await C.recoverCampaigns(db);expect(await db.q('SELECT * FROM outbox')).toHaveLength(count);expect((await D.one(db,'SELECT status FROM pledges WHERE id=$1',[p.id])).status).toBe('EXPIRED');expect((await D.one(db,'SELECT state FROM drops WHERE id=$1',[drop])).state).toBe('PAYMENT_OPEN');});
it('enforces aggregate limits and stale revisions after editing and cancellation',async()=>{
 const p=await D.pledge(db,'student',drop,forest,5,D.uid());await D.pledge(db,'student',drop,ink,5,D.uid());
 await expect(C.changePledge(db,'student',p.id,{key:D.uid(),revision:0,action:'edit',variantId:forest,quantity:6})).rejects.toThrow('Maximum 10');
 const b={key:D.uid(),revision:0,action:'edit' as const,variantId:ink,quantity:4};await C.changePledge(db,'student',p.id,b);await C.changePledge(db,'student',p.id,b);await expect(C.changePledge(db,'student',p.id,{...b,key:D.uid()})).rejects.toThrow('Pledge changed');
 expect((await D.pledge(db,'student',drop,forest,5,p.request_key)).id).toBe(p.id);expect(await db.q('SELECT * FROM pledges')).toHaveLength(2);
 await C.changePledge(db,'student',p.id,{key:D.uid(),revision:1,action:'cancel'});await D.pledge(db,'student',drop,forest,5,D.uid());
 expect((await D.one(db,"SELECT SUM(quantity)::int n FROM pledges WHERE status='ACTIVE'")).n).toBe(10);
});
it('binds close requests to revision and reason, and rejects foreign pledge decisions',async()=>{
 const p=await D.pledge(db,'student',drop,forest,2,D.uid());const other=await headers('student2');expect((await app.inject({method:'POST',url:'/v1/pledges/'+p.id+'/change',headers:other,payload:{key:D.uid(),revision:0,action:'cancel'}})).statusCode).toBe(403);
 const cmd=command(),h=await headers('curator');const send=()=>app.inject({method:'POST',url:'/v1/drops/'+drop+'/lock',headers:h,payload:{command:cmd}});expect((await send()).statusCode).toBe(200);expect((await send()).statusCode).toBe(200);expect(await db.q("SELECT * FROM audit WHERE action='CAMPAIGN_LOCKED'")).toHaveLength(1);
 expect((await D.one(db,"SELECT detail FROM audit WHERE action='CAMPAIGN_LOCKED'")).detail.reason).toBe(cmd.reason);await expect(C.closeCampaign(db,'curator',drop,command())).rejects.toThrow('Campaign changed');
});
it('audits extensions, rejects elapsed-phase reopening and preserves published prices',async()=>{
 const d=await C.saveDraft(db,'curator','north',null,catalog(),command());await C.publish(db,'curator',d.id,command(),false);
 const dates={closesAt:at(3),resolutionEndsAt:at(4),paymentEndsAt:at(5)},cmd=command(1);await C.extend(db,'curator',d.id,cmd,dates);await C.extend(db,'curator',d.id,cmd,dates);
 expect(await db.q("SELECT * FROM audit WHERE action='DEADLINES_EXTENDED'")).toHaveLength(1);await expect(C.saveDraft(db,'curator','north',d.id,{...catalog(),price:900},command(2))).rejects.toThrow('latest draft');
 await db.q("UPDATE drops SET closes_at=now()-interval '1 second' WHERE id=$1",[d.id]);await expect(C.extend(db,'curator',d.id,command(2),dates)).rejects.toThrow('elapsed');
});
it('preserves paid orders, pending provider attempts and historical snapshots through expiry',async()=>{
 const p=await D.pledge(db,'student',drop,forest,2,D.uid()),p2=await D.pledge(db,'student2',drop,forest,2,D.uid());await D.lockDrop(db,'curator',drop);const o=await D.createOrder(db,'student',p.id),o2=await D.createOrder(db,'student2',p2.id);const paid=await D.obligation(db,'student',o.id,'deposit','simulator'),pending=await D.obligation(db,'student2',o2.id,'full','cashfree');await D.capture(db,'paid','paid',paid.id,paid.amount);
 await db.q("UPDATE drops SET payment_ends_at=now()-interval '1 second' WHERE id=$1",[drop]);await C.recoverCampaigns(db);
 expect(await db.q('SELECT * FROM obligations')).toHaveLength(2);expect((await D.one(db,'SELECT * FROM obligations WHERE id=$1',[pending.id])).provider).toBe('cashfree');expect((await D.one(db,'SELECT * FROM orders WHERE id=$1',[o.id]))).toMatchObject({paid:129900,commercial_snapshot:o.commercial_snapshot});
 const result=await D.capture(db,'late','late',pending.id,pending.amount,'cashfree',new Date(Date.now()-2000).toISOString());expect(result.credited).toBe(pending.amount);expect((await D.one(db,'SELECT status FROM pledges WHERE id=$1',[p2.id])).status).toBe('CONVERTED');
 await D.approve(db,'admin',drop);expect((await D.one(db,'SELECT state FROM drops WHERE id=$1',[drop])).state).toBe('IN_PRODUCTION');
});
