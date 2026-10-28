import {Worker,Queue} from 'bullmq';
import IORedis from 'ioredis';
import {database,type Database} from '../../../packages/db/index.js';
import {reconcilePending,cashfreeAdapter} from './payments.js';
import {processReconciliations} from './investigations.js';
import {paymentConfig} from './cashfree.js';
import {recoverCampaigns} from './campaigns.js';
export async function startWorker(db:Database,redisUrl:string,queueName=process.env.PARTNER_DEMO==='true'?'ccoop-partner-demo-outbox':'ccoop-outbox',interval=10000){
 paymentConfig(); // Fail before starting a scheduler if demo/provider isolation is invalid.
 const redis=new IORedis(redisUrl,{maxRetriesPerRequest:null});
 const queue=new Queue(queueName,{connection:redis as any});
 const worker=new Worker(queueName,async()=>{
  const campaigns=await recoverCampaigns(db);
  const investigations=paymentConfig()==='cashfree'&&process.env.CASHFREE_CLIENT_ID&&process.env.CASHFREE_CLIENT_SECRET?await processReconciliations(db,cashfreeAdapter()):{skipped:'credentials_or_provider_not_configured'};
  const [pending]=await db.q('SELECT count(*)::int n FROM outbox WHERE delivered_at IS NULL');
  const payments=paymentConfig()==='cashfree'&&process.env.CASHFREE_CLIENT_ID&&process.env.CASHFREE_CLIENT_SECRET?await reconcilePending(db):{skipped:'credentials_or_provider_not_configured'};
  const result={event:'outbox_pending',count:pending.n,externalDelivery:'not_configured',payments,campaigns,investigations};
  console.log(JSON.stringify(result));return result;
 },{connection:redis as any});
 await worker.waitUntilReady();
 await queue.upsertJobScheduler('outbox-poll',{every:interval},{name:'poll',data:{},opts:{attempts:5,backoff:{type:'exponential',delay:2000},removeOnComplete:100,removeOnFail:500}});
 return {queue,worker,async close(){await worker.close();await queue.close();await redis.quit();}};
}
if(process.argv[1]?.endsWith('worker.ts')){
 if(!process.env.DATABASE_URL)throw Error('Worker requires native PostgreSQL DATABASE_URL');
 if(process.env.PARTNER_DEMO==='true'&&!process.env.REDIS_URL)throw Error('Partner demo worker requires an explicit isolated Redis configuration');
 const db=await database();const runtime=await startWorker(db,process.env.REDIS_URL||'redis://localhost:6379');
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await runtime.close();await db.close();process.exit(0)});
}
