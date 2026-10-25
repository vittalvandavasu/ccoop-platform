import {Worker,Queue} from 'bullmq';
import IORedis from 'ioredis';
import {database} from '../../../packages/db/index.js';
const redis=new IORedis(process.env.REDIS_URL||'redis://localhost:6379',{maxRetriesPerRequest:null});
const db=await database();
const queue=new Queue('ccoop-outbox',{connection:redis as any});
await queue.upsertJobScheduler('outbox-poll',{every:10000},{name:'poll',data:{},opts:{attempts:5,backoff:{type:'exponential',delay:2000},removeOnComplete:100,removeOnFail:500}});
// In-app inbox is authoritative. External delivery intentionally requires a configured provider.
new Worker('ccoop-outbox',async()=>{const pending=await db.q('SELECT count(*)::int n FROM outbox WHERE delivered_at IS NULL');console.log(JSON.stringify({event:'outbox_pending',count:pending[0].n,externalDelivery:'not_configured'}));},{connection:redis as any});
