import {beforeAll,afterAll,afterEach,it,expect,vi} from 'vitest';
import {database,type Database} from '../packages/db/index.js';
import {seed} from '../packages/db/seed.js';
import {demoConfig,demoDatabase,apiOrigin} from '../packages/demo/config.js';
import {paymentConfig} from '../apps/api/src/cashfree.js';
import {NextRequest} from 'next/server';
import {proxy} from '../apps/web/proxy';
import {GET,POST} from '../apps/web/app/v1/[...path]/route';
import {createRequire} from 'node:module';
const origin='https://coopweb.netlify.app',password='synthetic-demo-password-for-tests-only-0001';
const config={NODE_ENV:'production',PARTNER_DEMO:'true',DEMO_DATASET:'fictional',PAYMENT_PROVIDER:'simulator',DEMO_ACCESS_USER:'partner',DEMO_ACCESS_PASSWORD:password,APP_ORIGIN:origin,DATABASE_URL:'postgres://test:test@localhost/ccoop_demo_test'};
const authorization='Basic '+Buffer.from('partner:'+password).toString('base64');
function setup(){for(const [k,v] of Object.entries(config))vi.stubEnv(k,v);for(const key of ['CASHFREE_CLIENT_ID','CASHFREE_CLIENT_SECRET','RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET','RAZORPAY_WEBHOOK_SECRET'])vi.stubEnv(key,'');}
let db:Database;
beforeAll(async()=>{process.env.PGLITE_PATH='memory://';if(process.env.DATABASE_URL&&!new URL(process.env.DATABASE_URL).pathname.includes('test'))throw Error('Dedicated test database required');db=await database();},30000);
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});afterAll(async()=>db?.close());
it('keeps production simulation forbidden except for complete access-protected fictional configuration',()=>{
 expect(()=>paymentConfig({NODE_ENV:'production',PAYMENT_PROVIDER:'simulator'})).toThrow('forbidden');expect(paymentConfig(config)).toBe('simulator');
 for(const patch of [{DEMO_ACCESS_PASSWORD:''},{DEMO_DATASET:'real'},{APP_ORIGIN:'http://coopweb.netlify.app'},{PAYMENT_PROVIDER:'cashfree'},{CASHFREE_CLIENT_SECRET:'test-key'}])expect(()=>demoConfig({...config,...patch})).toThrow();
 expect(()=>demoDatabase({...config,DATABASE_URL:'postgres://test:test@localhost/production'})).toThrow('isolated');expect(()=>demoDatabase({...config,DATABASE_URL:''})).toThrow();
});
it('protects frontend pages and API paths and fails closed when hosted access configuration is missing',()=>{
 setup();for(const path of ['/','/v1/auth/dev','/_next/static/test.js']){expect(proxy(new NextRequest(origin+path)).status).toBe(401);expect(proxy(new NextRequest(origin+path,{headers:{authorization:'Basic bad'}})).status).toBe(401);expect(proxy(new NextRequest(origin+path,{headers:{authorization}})).status).toBe(200);}
 vi.stubEnv('DEMO_ACCESS_PASSWORD','');expect(proxy(new NextRequest(origin)).status).toBe(503);vi.stubEnv('PARTNER_DEMO','');vi.stubEnv('CCOOP_NETLIFY_DEMO','true');expect(proxy(new NextRequest(origin)).status).toBe(503);
});
it('uses remote runtime API routing, preserves secure cookies and rejects unsafe destinations/origins',async()=>{
 setup();expect(apiOrigin({NODE_ENV:'development'})).toBe('http://127.0.0.1:4000');for(const value of ['', 'http://127.0.0.1:4000','https://user:password@example.test','https://coopweb.netlify.app'])expect(()=>apiOrigin({NODE_ENV:'production',APP_ORIGIN:origin,API_ORIGIN:value})).toThrow();
 vi.stubEnv('API_ORIGIN','https://api.example.test');const transport=vi.fn(async(_url:string,_options?:RequestInit)=>new Response('{"ok":true}',{headers:{'content-type':'application/json','set-cookie':'session=synthetic; Path=/; HttpOnly; Secure; SameSite=Strict'}}));vi.stubGlobal('fetch',transport);
 expect((await GET(new Request(origin+'/v1/health'))).status).toBe(401);expect(transport).not.toHaveBeenCalled();
 const result=await GET(new Request(origin+'/v1/health',{headers:{authorization}}));expect(result.status).toBe(200);expect(result.headers.get('set-cookie')).toContain('Secure');expect(transport.mock.calls[0][0]).toBe('https://api.example.test/v1/health');
 expect((await POST(new Request(origin+'/v1/auth/dev',{method:'POST',headers:{authorization,origin:'https://untrusted.test'},body:'{}'}))).status).toBe(403);expect(transport).toHaveBeenCalledTimes(1);
});
it('protects every Fastify route, permits authenticated role selection, persists simulation once and makes zero gateway calls',async()=>{
 await db.q('TRUNCATE campuses,users CASCADE');await seed(db);setup();
 const axios=createRequire(import.meta.url)('axios').default,old=axios.defaults.adapter,external=vi.fn(async()=>{throw Error('Provider transport forbidden');});axios.defaults.adapter=external;vi.stubGlobal('fetch',external);
 const {buildServer}=await import('../apps/api/src/server.js');const app=await buildServer(db);let cookie='';
 const call=async(path:string,body?:any)=>{const r=await app.inject({method:body?'POST':'GET',url:'/v1'+path,headers:{authorization,origin,cookie},payload:body});expect(r.statusCode,r.body).toBe(200);return r;};
 const login=async(id:string)=>{const r=await call('/auth/dev',{id});expect(r.headers['set-cookie']).toContain('Secure');cookie='session='+r.cookies[0].value;};
 try{
  for(const path of ['/v1/health','/v1/catalog/north','/v1/ops/north','/v1/investigations/north/payment'])expect((await app.inject({url:path})).statusCode).toBe(401);
  expect((await app.inject({method:'POST',url:'/v1/auth/dev',headers:{origin},payload:{id:'admin'}})).statusCode).toBe(401);
  await login('student');const p=(await call('/pledges',{dropId:'north-hoodie',variantId:'north-hoodie-Forest-M',quantity:2,key:'partner-demo-fixture'})).json();
  await login('curator');await call('/drops/north-hoodie/lock',{});await login('student');const o=(await call('/orders',{pledgeId:p.id})).json(),pay=(await call('/orders/'+o.id+'/payment',{choice:'full'})).json();expect(pay.obligation.provider).toBe('simulator');await call('/payments/simulate',{id:pay.obligation.id});expect((await call('/payments/simulate',{id:pay.obligation.id})).json().duplicate).toBe(true);
  expect(await db.q('SELECT provider,credited_amount FROM payment_events')).toEqual([{provider:'simulator',credited_amount:o.total}]);expect(external).not.toHaveBeenCalled();
  expect((await app.inject({method:'POST',url:'/v1/orders/'+o.id+'/reconcile',headers:{authorization,origin,cookie},payload:{}})).statusCode).toBe(404);
  await login('admin');expect((await app.inject({url:'/v1/ops/north',headers:{cookie}})).statusCode).toBe(401);await call('/ops/north');expect((await app.inject({url:'/v1/ops/west',headers:{authorization,cookie}})).statusCode).toBe(403);
  await call('/drops/north-hoodie/approve',{});await login('host');await call('/drops/north-hoodie/receive',{key:'partner-demo-receipt',lines:[{variantId:'north-hoodie-Forest-M',healthy:2,damaged:0}]});
  await login('student');const pass=(await call('/orders/'+o.id+'/pass',{})).json();await login('host');await call('/pickups/dispatch',{token:pass.token});expect((await db.q('SELECT fulfillment FROM orders'))[0].fulfillment).toBe('COLLECTED');expect(external).not.toHaveBeenCalled();
 }finally{await app.close();axios.defaults.adapter=old;}
});
