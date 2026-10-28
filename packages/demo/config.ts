import {createHash,timingSafeEqual} from 'node:crypto';
type Env=Record<string,string|undefined>;
export function demoConfig(env:Env=process.env){
 if(env.PARTNER_DEMO!=='true')return null;
 const user=env.DEMO_ACCESS_USER||'',password=env.DEMO_ACCESS_PASSWORD||'';
 if(!user||user.includes(':')||password.length<32)throw Error('Partner demo requires protected access credentials');
 if(env.DEMO_DATASET!=='fictional'||env.PAYMENT_PROVIDER!=='simulator')throw Error('Partner demo requires fictional data and simulator');
 if(['CASHFREE_CLIENT_ID','CASHFREE_CLIENT_SECRET','RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET','RAZORPAY_WEBHOOK_SECRET'].some(k=>env[k]))throw Error('Provider credentials are forbidden in partner demo');
 const origin=new URL(env.APP_ORIGIN||'');
 if(origin.protocol!=='https:'||origin.username||origin.password||origin.origin!==env.APP_ORIGIN)throw Error('Partner demo requires an exact HTTPS application origin');
 return {user,password,origin:origin.origin};
}
export function demoAuthorized(header:string|undefined,config:NonNullable<ReturnType<typeof demoConfig>>){
 if(!header?.startsWith('Basic ')||header.length>4096)return false;
 const received=Buffer.from(header.slice(6),'base64').toString('utf8');
 const digest=(s:string)=>createHash('sha256').update(s).digest();
 return timingSafeEqual(digest(received),digest(config.user+':'+config.password));
}
export function demoDatabase(env:Env=process.env){
 if(!demoConfig(env))return;
 const url=new URL(env.DATABASE_URL||'');
 if(!['postgres:','postgresql:'].includes(url.protocol)||!/^\/ccoop_demo(?:_[a-z0-9_]+)?$/.test(url.pathname))throw Error('Partner demo requires an isolated ccoop_demo PostgreSQL database');
}
export function apiOrigin(env:Env=process.env){
 const raw=env.API_ORIGIN||(env.NODE_ENV==='development'?'http://127.0.0.1:4000':'');
 if(!raw)throw Error('Hosted API_ORIGIN is not configured');
 const url=new URL(raw);
 if(url.username||url.password||url.origin!==raw||!['http:','https:'].includes(url.protocol))throw Error('API_ORIGIN must be an origin without credentials or path');
 if(env.NODE_ENV!=='development'&&(url.protocol!=='https:'||['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw Error('Hosted API_ORIGIN must use remote HTTPS');
 if(raw===env.APP_ORIGIN)throw Error('API_ORIGIN must not loop to the frontend');
 return raw;
}
