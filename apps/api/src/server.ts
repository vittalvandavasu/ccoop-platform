import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import {createHmac,timingSafeEqual,randomInt} from 'node:crypto';
import {z} from 'zod';
import Razorpay from 'razorpay';
import {OAuth2Client} from 'google-auth-library';
import type {Database} from '../../../packages/db/index.js';
import {database} from '../../../packages/db/index.js';
import {seed} from '../../../packages/db/seed.js';
import * as D from './domain.js';
import {paymentConfig,providerJSON,verifySignature,type CashfreeAdapter} from './cashfree.js';
import * as P from './payments.js';
import * as C from './campaigns.js';
const production=process.env.NODE_ENV==='production';
const dev=process.env.DEV_AUTH==='true'&&!production;
export async function buildServer(db:Database,options:{cashfree?:CashfreeAdapter}={}){
 const mode=paymentConfig();
 const key=process.env.RAZORPAY_KEY_ID;
 const gateway=key?.startsWith('rzp_test_')&&process.env.RAZORPAY_KEY_SECRET?new Razorpay({key_id:key,key_secret:process.env.RAZORPAY_KEY_SECRET}):null;
 const cashfree=options.cashfree||P.cashfreeAdapter();
 const app=Fastify({logger:production,bodyLimit:65536});await app.register(cookie);await app.register(helmet);await app.register(rateLimit,{max:100,timeWindow:'1 minute'});
 app.removeContentTypeParser('application/json');app.addContentTypeParser('application/json',{parseAs:'string'},(_req,body,done)=>{try{done(null,{raw:body,parsed:JSON.parse(body as string)})}catch(e){done(e as Error,undefined)}});
 app.addHook('preValidation',async req=>{if(req.body){(req as any).rawBody=(req.body as any).raw;req.body=(req.body as any).parsed;}});
 app.addHook('onRequest',async(req,reply)=>{reply.header('Cache-Control','no-store');if(['POST','PUT','PATCH','DELETE'].includes(req.method)&&!['/v1/payments/webhook','/v1/payments/cashfree/webhook'].includes(req.url)){
 const origin=req.headers.origin;D.ensure(origin===(process.env.APP_ORIGIN||'http://localhost:3000'),'Request origin is not allowed',403);
 }});
 app.setErrorHandler((error,_req,reply)=>{const e=error as any;reply.code(e instanceof z.ZodError?400:e.statusCode||500).send({error:e instanceof z.ZodError?'Invalid input':e.statusCode?e.message:'The request could not be completed'});if(!e.statusCode&&!(e instanceof z.ZodError))app.log.error(e);});
 async function user(req:any){const token=req.cookies.session;D.ensure(token,'Sign in to continue',401);const [u]=await db.q('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()',[D.hash(token)]);D.ensure(u,'Sign in to continue',401);return u;}
 async function session(reply:any,u:any){const token=D.uid()+D.uid();await db.q("INSERT INTO sessions VALUES($1,$2,now()+interval '7 days')",[D.hash(token),u.id]);reply.setCookie('session',token,{httpOnly:true,secure:production,sameSite:'strict',path:'/',maxAge:604800});return {user:u};}
 app.get('/v1/health',async()=>{await db.q('SELECT 1');return {ok:true,database:process.env.DATABASE_URL?'postgresql':'pglite-development',paymentMode:mode,devAuth:dev};});
 app.get('/v1/campuses',async()=>db.q('SELECT * FROM campuses ORDER BY id'));
 app.get('/v1/catalog/:campus',async(req)=>{
 const campus=(req.params as any).campus;const drops=await db.q("SELECT d.*,COALESCE(SUM(p.quantity) FILTER(WHERE p.status NOT IN ('CANCELED','EXPIRED','FAILED','PAYMENT_EXPIRED')),0)::int pledged FROM drops d LEFT JOIN pledges p ON p.drop_id=d.id WHERE d.campus_id=$1 AND d.state NOT IN ('DRAFT','SCHEDULED') GROUP BY d.id ORDER BY d.price DESC",[campus]);
 for(const d of drops)d.variants=await db.q('SELECT * FROM variants WHERE drop_id=$1 ORDER BY color,size',[d.id]);return drops;
 });
 app.get('/v1/me',async(req)=>{const u=await user(req);return {...u,roles:await db.q('SELECT campus_id,role FROM roles WHERE user_id=$1',[u.id])}});
 app.get('/v1/campaigns/:campus',async req=>{const u=await user(req),campus=(req.params as any).campus;await D.role(db,u.id,campus,['curator']);const rows=await db.q("SELECT d.*,COALESCE(SUM(p.quantity) FILTER(WHERE p.status NOT IN ('CANCELED','FAILED','EXPIRED','PAYMENT_EXPIRED')),0)::int pledged FROM drops d LEFT JOIN pledges p ON p.drop_id=d.id WHERE d.campus_id=$1 GROUP BY d.id ORDER BY d.created_at DESC",[campus]);for(const d of rows){d.variants=await db.q('SELECT v.*,COALESCE(SUM(p.quantity) FILTER(WHERE p.status NOT IN (\'CANCELED\',\'FAILED\',\'EXPIRED\',\'PAYMENT_EXPIRED\')),0)::int pledged FROM variants v LEFT JOIN pledges p ON p.variant_id=v.id WHERE v.drop_id=$1 GROUP BY v.id ORDER BY v.color,v.size',[d.id]);}return rows;});
 app.post('/v1/campaigns/:campus/save',async req=>{const b=z.object({id:z.string().nullable(),catalog:C.catalogInput,command:C.commandInput}).parse(req.body);return C.saveDraft(db,(await user(req)).id,(req.params as any).campus,b.id,b.catalog,b.command);});
 app.post('/v1/campaigns/:id/publish',async req=>{const b=z.object({command:C.commandInput,scheduled:z.boolean()}).parse(req.body);return C.publish(db,(await user(req)).id,(req.params as any).id,b.command,b.scheduled);});
 app.post('/v1/campaigns/:id/extend',async req=>{const b=z.object({command:C.commandInput,closesAt:z.string().datetime(),resolutionEndsAt:z.string().datetime(),paymentEndsAt:z.string().datetime()}).parse(req.body);return C.extend(db,(await user(req)).id,(req.params as any).id,b.command,b);});
 app.post('/v1/pledges/:id/change',async req=>{const b=z.object({key:z.string().min(8).max(100),revision:z.number().int().min(0),action:z.enum(['edit','cancel','switch']),variantId:z.string().optional(),quantity:z.number().int().min(1).max(10).optional(),price:z.number().int().positive().optional()}).parse(req.body);return C.changePledge(db,(await user(req)).id,(req.params as any).id,b);});
 app.post('/v1/auth/dev',async(req,reply)=>{D.ensure(dev,'Development sign-in is disabled',404);const {id}=z.object({id:z.enum(['student','student2','curator','host','admin'])}).parse(req.body);return session(reply,await D.one(db,'SELECT * FROM users WHERE id=$1',[id]));});
 app.post('/v1/auth/logout',async(req,reply)=>{await db.q('DELETE FROM sessions WHERE token_hash=$1',[D.hash(req.cookies.session||'')]);reply.clearCookie('session',{path:'/'});return {ok:true}});
 app.post('/v1/auth/otp/request',{config:{rateLimit:{max:5,timeWindow:'1 hour'}}},async(req)=>{
 const {email}=z.object({email:z.email()}).parse(req.body);D.ensure(dev,'OTP delivery provider is not configured',503);
 const recent=await db.q("SELECT id FROM otp_challenges WHERE email=$1 AND expires_at>now()-interval '1 hour'",[email]);D.ensure(recent.length<5,'Too many OTP requests',429);
 const id=D.uid(),code=String(randomInt(100000,1000000));await db.q("INSERT INTO otp_challenges(id,email,code_hash,expires_at) VALUES($1,$2,$3,now()+interval '5 minutes')",[id,email,D.hash(id+code)]);return {id,developmentCode:code,notice:'Development only. No email was sent.'};
 });
 app.post('/v1/auth/otp/verify',async(req,reply)=>{
 const {id,code}=z.object({id:z.string(),code:z.string().regex(/^\d{6}$/)}).parse(req.body);
 const result=await db.tx(async q=>{const c=await D.one(q,'SELECT * FROM otp_challenges WHERE id=$1 FOR UPDATE',[id]);D.ensure(!c.used&&new Date(c.expires_at).getTime()>Date.now()&&c.attempts<3,'OTP expired or blocked',400);await q.q('UPDATE otp_challenges SET attempts=attempts+1 WHERE id=$1',[id]);if(c.code_hash!==D.hash(id+code))return null;await q.q('UPDATE otp_challenges SET used=true WHERE id=$1',[id]);await q.q('INSERT INTO users VALUES($1,$2,$3) ON CONFLICT(email) DO NOTHING',[D.uid(),c.email,c.email.split('@')[0]]);return D.one(q,'SELECT * FROM users WHERE email=$1',[c.email]);});D.ensure(result,'Incorrect OTP',400);return session(reply,result);
 });
 app.post('/v1/auth/google',async(req,reply)=>{D.ensure(process.env.GOOGLE_CLIENT_ID,'Google OAuth is not configured',503);const {idToken}=z.object({idToken:z.string()}).parse(req.body);const ticket=await new OAuth2Client(process.env.GOOGLE_CLIENT_ID).verifyIdToken({idToken,audience:process.env.GOOGLE_CLIENT_ID});const p=ticket.getPayload();D.ensure(p?.email_verified&&p.email,'Google identity is not verified',401);await db.q('INSERT INTO users VALUES($1,$2,$3) ON CONFLICT(email) DO NOTHING',[D.uid(),p.email,p.name||'Student']);return session(reply,await D.one(db,'SELECT * FROM users WHERE email=$1',[p.email]));});
 app.get('/v1/activity',async req=>{const u=await user(req);const pledges=await db.q('SELECT p.*,d.title,d.price,d.campus_id,d.state campaign_state,d.closes_at,d.resolution_ends_at,d.payment_ends_at,d.snapshot FROM pledges p JOIN drops d ON d.id=p.drop_id WHERE p.user_id=$1 ORDER BY p.created_at DESC',[u.id]);for(const p of pledges){const v=await D.one(db,'SELECT color,size FROM variants WHERE id=$1',[p.variant_id]);Object.assign(p,v);p.variants=await db.q('SELECT * FROM variants WHERE drop_id=$1 ORDER BY color,size',[p.drop_id]);}return {pledges,orders:await db.q('SELECT o.*,d.title,d.state campaign_state,d.payment_ends_at,v.color,v.size FROM orders o JOIN drops d ON d.id=o.drop_id JOIN variants v ON v.id=o.variant_id WHERE o.user_id=$1 ORDER BY o.created_at DESC',[u.id]),notifications:await db.q('SELECT id,message,created_at FROM outbox WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50',[u.id])};});
 app.post('/v1/pledges',async req=>{const u=await user(req);const b=z.object({dropId:z.string(),variantId:z.string(),quantity:z.number().int().min(1).max(10),key:z.string().min(8).max(100)}).parse(req.body);return D.pledge(db,u.id,b.dropId,b.variantId,b.quantity,b.key);});
 app.post('/v1/drops/:id/lock',async req=>D.lockDrop(db,(await user(req)).id,(req.params as any).id,z.object({command:C.commandInput.optional()}).parse(req.body||{}).command));
 app.post('/v1/orders',async req=>D.createOrder(db,(await user(req)).id,z.object({pledgeId:z.string()}).parse(req.body).pledgeId));
 app.post('/v1/orders/:id/payment',async req=>{
 const b=z.object({choice:z.enum(['deposit','full','balance'])}).parse(req.body);const u=await user(req),id=(req.params as any).id;
 if(mode==='cashfree')return P.cashfreeCheckout(db,u.id,id,b.choice,cashfree);
 D.ensure(mode!=='razorpay'||gateway,'Razorpay test credentials are not configured',503);
 const o=await D.obligation(db,u.id,id,b.choice,mode);
 if(mode==='razorpay'&&gateway&&!o.provider_order_id){
 // A stable receipt plus local lock prevents simultaneous gateway order creation.
 await db.tx(async q=>{const current=await D.one(q,'SELECT * FROM obligations WHERE id=$1 FOR UPDATE',[o.id]);if(current.provider_order_id){o.provider_order_id=current.provider_order_id;return;}const g=await gateway.orders.create({amount:o.amount,currency:'INR',receipt:o.id});await q.q('UPDATE obligations SET provider_order_id=$2 WHERE id=$1',[o.id,g.id]);o.provider_order_id=g.id;});}
 return {obligation:o,mode,keyId:key};
 });
 app.post('/v1/payments/simulate',async req=>{D.ensure(dev&&mode==='simulator','Local simulator disabled',404);const u=await user(req);const {id}=z.object({id:z.string()}).parse(req.body);const o=await D.one(db,'SELECT b.*,o.user_id FROM obligations b JOIN orders o ON o.id=b.order_id WHERE b.id=$1',[id]);D.ensure(o.user_id===u.id,'Not your payment',403);D.ensure(o.provider==='simulator','Payment provider mismatch');D.ensure(new Date(o.expires_at).getTime()>Date.now(),'Payment attempt expired');return D.capture(db,'sim-'+o.id,'sim-payment-'+o.id,o.id,o.amount);});
 app.post('/v1/payments/webhook',async req=>{
 D.ensure(gateway&&process.env.RAZORPAY_WEBHOOK_SECRET,'Gateway webhook is not configured',503);
 const actual=String(req.headers['x-razorpay-signature']||'');const expected=createHmac('sha256',process.env.RAZORPAY_WEBHOOK_SECRET!).update((req as any).rawBody||'').digest('hex');D.ensure(/^[a-f0-9]{64}$/i.test(actual)&&timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(expected,'hex')),'Invalid webhook signature',401);
 const b=req.body as any;if(b.event!=='payment.captured')return {ignored:true};const p=b.payload.payment.entity;D.ensure(p.currency==='INR'&&p.status==='captured','Unexpected payment currency/status',400);const ob=await D.one(db,"SELECT * FROM obligations WHERE provider='razorpay' AND provider_order_id=$1",[p.order_id]);return D.capture(db,String(req.headers['x-razorpay-event-id']||p.id),p.id,ob.id,p.amount,'razorpay');
 });

 app.post('/v1/payments/cashfree/webhook',async req=>{
  D.ensure(process.env.CASHFREE_CLIENT_SECRET,'Cashfree sandbox credentials are not configured',503);
  const raw=(req as any).rawBody||'';verifySignature(raw,req.headers['x-webhook-timestamp'],req.headers['x-webhook-signature'],process.env.CASHFREE_CLIENT_SECRET!);
  const body=providerJSON(raw);const types:Record<string,string>={PAYMENT_SUCCESS_WEBHOOK:'SUCCESS',PAYMENT_FAILED_WEBHOOK:'FAILED',PAYMENT_USER_DROPPED_WEBHOOK:'USER_DROPPED'};
  if(!types[body.type])return {ignored:true};
  const data=body.data;D.ensure(data?.order&&data?.payment,'Invalid webhook payload',400);
  D.ensure(data.payment.payment_status===types[body.type],'Webhook status mismatch',400);
  const ob=await D.one(db,"SELECT * FROM obligations WHERE provider='cashfree' AND provider_order_id=$1",[data.order.order_id]);
  // Verify ownership from the authenticated order API, even when a webhook omits customer_id.
  const remote=await cashfree.order(ob.provider_order_id);P.validateOrder(ob,remote);
  P.validateOrder(ob,{...data.order,customer_details:remote.customer_details});
  if(data.customer_details?.customer_id)D.ensure(data.customer_details.customer_id===ob.customer_ref,'Cashfree customer mismatch');
  return P.recordAttempt(db,ob,{...data.payment,order_id:data.order.order_id},'webhook');
 });
 app.get('/v1/orders/:id/payments',async req=>{
  const u=await user(req),o=await D.one(db,'SELECT * FROM orders WHERE id=$1',[(req.params as any).id]);D.ensure(o.user_id===u.id,'Not your payment',403);
  return {attempts:await db.q('SELECT a.payment_id,a.provider,a.status,a.amount,a.updated_at FROM payment_attempts a JOIN obligations b ON b.id=a.obligation_id WHERE b.order_id=$1 ORDER BY a.updated_at',[o.id]),obligations:await db.q("SELECT id,provider,amount,captured,checkout_state,expires_at,reconciliation_error,CASE WHEN NOT captured AND expires_at<=now() THEN 'EXPIRED_OR_ABANDONED' ELSE checkout_state END display_state FROM obligations WHERE order_id=$1 ORDER BY created_at DESC",[o.id]),events:await db.q('SELECT e.provider,e.provider_payment_id,e.amount,e.credited_amount,e.created_at FROM payment_events e JOIN obligations b ON b.id=e.obligation_id WHERE b.order_id=$1 ORDER BY e.created_at',[o.id]),exceptions:await db.q('SELECT reason,amount,created_at FROM payment_exceptions WHERE order_id=$1',[o.id])};
 });
 app.post('/v1/orders/:id/reconcile',async req=>{
  const u=await user(req),o=await D.one(db,'SELECT * FROM orders WHERE id=$1',[(req.params as any).id]);D.ensure(o.user_id===u.id,'Not your payment',403);
  const rows=await db.q("SELECT id FROM obligations WHERE order_id=$1 AND provider='cashfree' AND provider_order_id IS NOT NULL ORDER BY created_at",[o.id]);
  for(const row of rows)await P.reconcile(db,row.id,cashfree);
  return {checked:rows.length};
 });
 app.post('/v1/drops/:id/approve',async req=>D.approve(db,(await user(req)).id,(req.params as any).id));
 app.get('/v1/ops/:campus',async req=>{
 const u=await user(req),campus=(req.params as any).campus;await D.role(db,u.id,campus,['curator','host']);const admin=(await db.q("SELECT 1 FROM roles WHERE user_id=$1 AND campus_id=$2 AND role='admin'",[u.id,campus])).length;
 return {paymentExceptions:admin?await db.q('SELECT e.* FROM payment_exceptions e JOIN orders o ON o.id=e.order_id WHERE o.campus_id=$1 ORDER BY e.created_at DESC',[campus]):[],orders:await db.q('SELECT o.*,d.title,v.color,v.size FROM orders o JOIN drops d ON d.id=o.drop_id JOIN variants v ON v.id=o.variant_id WHERE o.campus_id=$1 ORDER BY o.created_at',[campus]),stock:await db.q('SELECT s.*,v.color,v.size,d.title FROM stock s JOIN variants v ON v.id=s.variant_id JOIN drops d ON d.id=v.drop_id WHERE s.campus_id=$1',[campus]),manifest:await db.q("SELECT o.drop_id,o.variant_id,v.color,v.size,SUM(o.quantity)::int expected FROM orders o JOIN variants v ON v.id=o.variant_id WHERE o.campus_id=$1 AND o.fulfillment='IN_PRODUCTION' GROUP BY o.drop_id,o.variant_id,v.color,v.size",[campus]),receipts:await db.q('SELECT l.*,r.drop_id FROM receipt_lines l JOIN receipts r ON r.id=l.receipt_id JOIN drops d ON d.id=r.drop_id WHERE d.campus_id=$1',[campus]),audit:admin?await db.q('SELECT * FROM audit WHERE campus_id=$1 ORDER BY created_at DESC LIMIT 40',[campus]):[]};
 });
 app.post('/v1/drops/:id/receive',async req=>{const b=z.object({key:z.string().min(8),lines:z.array(z.object({variantId:z.string(),healthy:z.number().int().min(0),damaged:z.number().int().min(0)})).min(1)}).parse(req.body);return D.receive(db,(await user(req)).id,(req.params as any).id,b.key,b.lines);});
 app.post('/v1/orders/:id/pass',async req=>D.pickupPass(db,(await user(req)).id,(req.params as any).id));
 app.post('/v1/pickups/dispatch',async req=>D.dispatch(db,(await user(req)).id,z.object({token:z.string().min(20)}).parse(req.body).token));
 return app;
}
if(process.argv[1]?.endsWith('server.ts')){const db=await database();if(!production)await seed(db);const app=await buildServer(db);await app.listen({host:'127.0.0.1',port:4000});for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await app.close();await db.close();process.exit(0)});}
