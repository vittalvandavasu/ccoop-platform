import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFile,mkdir} from 'node:fs/promises';
import {database,type Database} from '../packages/db/index.js';
import {seed} from '../packages/db/seed.js';
import {uid} from '../apps/api/src/domain.js';
it('upgrades existing simulator and Razorpay records without reassigning ambiguous obligations, and repeats safely',async()=>{
 const path='.data/migration-test-'+uid();await mkdir('.data',{recursive:true});let old=new PGlite(path);
 await old.exec(await readFile(new URL('../packages/db/migrations/001_initial.sql',import.meta.url),'utf8'));
 const wrap=(p:any):Database=>({q:async(s,v)=>(await p.query(s,v)).rows,tx:fn=>p.transaction((t:any)=>fn(wrap(t))),close:()=>p.close()});await seed(wrap(old));
 await old.exec(`INSERT INTO orders(id,user_id,campus_id,drop_id,variant_id,quantity,total,paid) VALUES('legacy-order','student','north','north-hoodie','north-hoodie-Forest-M',2,259800,129900);
 INSERT INTO obligations(id,order_id,amount,expires_at,provider_order_id,captured) VALUES('legacy-rzp','legacy-order',64950,now(),'order_legacy',true),('legacy-sim','legacy-order',64950,now(),NULL,true),('legacy-unknown','legacy-order',64950,now(),NULL,false);
 INSERT INTO payment_events(id,provider_payment_id,obligation_id,amount) VALUES('old-rzp-event','pay_legacy','legacy-rzp',64950),('old-sim-event','sim-payment-old','legacy-sim',64950);`);
 await old.close();const previous=process.env.PGLITE_PATH;process.env.PGLITE_PATH=path;
 let db:Database|undefined;
 try{db=await database('');expect(await db.q('SELECT id,provider FROM obligations ORDER BY id')).toEqual([{id:'legacy-rzp',provider:'razorpay'},{id:'legacy-sim',provider:'simulator'},{id:'legacy-unknown',provider:'legacy_unknown'}]);expect((await db.q('SELECT SUM(credited_amount)::int n FROM payment_events'))[0].n).toBe(129900);expect((await db.q('SELECT paid FROM orders'))[0].paid).toBe(129900);await db.close();db=await database('');expect(await db.q('SELECT * FROM schema_migrations')).toHaveLength(3);expect(await db.q('SELECT * FROM payment_events')).toHaveLength(2);}
 finally{await db?.close();if(previous===undefined)delete process.env.PGLITE_PATH;else process.env.PGLITE_PATH=previous;}
},30000);
