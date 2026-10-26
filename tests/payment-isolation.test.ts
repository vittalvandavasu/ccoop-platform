import {beforeAll,beforeEach,afterAll,it,expect,vi} from 'vitest';
import {createRequire} from 'node:module';
import {database,type Database} from '../packages/db/index.js';
import {seed} from '../packages/db/seed.js';
import * as D from '../apps/api/src/domain.js';

// Intercept the actual Razorpay SDK's Axios transport, including any accidental
// request from simulator checkout. Cashfree's fetch transport is blocked too.
const axios=createRequire(import.meta.url)('axios').default;
const originalAdapter=axios.defaults.adapter;
const razorpayTransport=vi.fn(async(config:any)=>({data:{id:'order_mock'},status:200,statusText:'OK',headers:{},config}));
const cashfreeTransport=vi.fn(async()=>{throw Error('Unexpected external fetch');});
let db:Database,app:any,headers:Record<string,string>,order:any;
beforeAll(async()=>{
 for(const [key,value] of Object.entries({PGLITE_PATH:'memory://',DEV_AUTH:'true',PAYMENT_PROVIDER:'simulator',PAYMENT_MODE:'razorpay',RAZORPAY_KEY_ID:'rzp_test_isolation',RAZORPAY_KEY_SECRET:'dummy-razorpay-secret',CASHFREE_CLIENT_ID:'dummy-cashfree-id',CASHFREE_CLIENT_SECRET:'dummy-cashfree-secret',CASHFREE_ENV:'sandbox'}))vi.stubEnv(key,value);
 axios.defaults.adapter=razorpayTransport;vi.stubGlobal('fetch',cashfreeTransport);
 if(process.env.DATABASE_URL&&!new URL(process.env.DATABASE_URL).pathname.includes('test'))throw Error('Tests require a dedicated test database');
 db=await database();
 const {buildServer}=await import('../apps/api/src/server.js');app=await buildServer(db);
},30000);
beforeEach(async()=>{
 await db.q('TRUNCATE campuses,users CASCADE');await seed(db);vi.clearAllMocks();
 const login=await app.inject({method:'POST',url:'/v1/auth/dev',headers:{origin:'http://localhost:3000'},payload:{id:'student'}});
 expect(login.statusCode).toBe(200);headers={origin:'http://localhost:3000',cookie:'session='+login.cookies[0].value};
 const pledge=await D.pledge(db,'student','north-hoodie','north-hoodie-Forest-M',2,'isolation-pledge');
 await D.lockDrop(db,'curator','north-hoodie');order=await D.createOrder(db,'student',pledge.id);
});
afterAll(async()=>{await app?.close();await db?.close();axios.defaults.adapter=originalAdapter;vi.unstubAllGlobals();vi.unstubAllEnvs();});
const checkout=(choice:string)=>app.inject({method:'POST',url:`/v1/orders/${order.id}/payment`,headers,payload:{choice}});
const settle=(id:string)=>app.inject({method:'POST',url:'/v1/payments/simulate',headers,payload:{id}});
it.each(['full','deposit'] as const)('isolates simulator %s checkout, retries and settlement with both gateways configured',async choice=>{
 const response=await checkout(choice);expect(response.statusCode).toBe(200);
 const {obligation,mode}=response.json();expect(mode).toBe('simulator');
 expect(obligation.provider).toBe('simulator');expect(obligation.provider_order_id).toBeNull();
 expect((await checkout(choice)).json().obligation.id).toBe(obligation.id);
 expect((await settle(obligation.id)).statusCode).toBe(200);
 expect((await settle(obligation.id)).json().duplicate).toBe(true);
 const expected=choice==='full'?259800:129900;
 expect((await D.one(db,'SELECT paid FROM orders WHERE id=$1',[order.id])).paid).toBe(expected);
 const events=await db.q('SELECT provider,amount,credited_amount FROM payment_events WHERE obligation_id=$1',[obligation.id]);
 expect(events).toEqual([{provider:'simulator',amount:expected,credited_amount:expected}]);
 if(choice==='deposit'){
  await D.approve(db,'admin','north-hoodie');
  await D.receive(db,'host','north-hoodie','isolation-receipt',[{variantId:'north-hoodie-Forest-M',healthy:2,damaged:0}]);
  const balanceResponse=await checkout('balance');expect(balanceResponse.statusCode).toBe(200);
  const balance=balanceResponse.json().obligation;
  expect(balance.provider).toBe('simulator');expect(balance.provider_order_id).toBeNull();expect(balance.amount).toBe(129900);
  expect((await checkout('balance')).json().obligation.id).toBe(balance.id);
  expect((await settle(balance.id)).statusCode).toBe(200);expect((await settle(balance.id)).json().duplicate).toBe(true);
  expect((await D.one(db,'SELECT paid FROM orders WHERE id=$1',[order.id])).paid).toBe(259800);
  expect(await db.q('SELECT provider,amount,credited_amount FROM payment_events')).toEqual([
   {provider:'simulator',amount:129900,credited_amount:129900},{provider:'simulator',amount:129900,credited_amount:129900}
  ]);
 }
 expect(razorpayTransport).not.toHaveBeenCalled();expect(cashfreeTransport).not.toHaveBeenCalled();
});
it('still creates and reuses a Razorpay order when Razorpay is selected',async()=>{
 vi.stubEnv('PAYMENT_PROVIDER','razorpay');
 const {buildServer}=await import('../apps/api/src/server.js');const razorpayApp=await buildServer(db);
 try{
  const send=()=>razorpayApp.inject({method:'POST',url:`/v1/orders/${order.id}/payment`,headers,payload:{choice:'full'}});
  const response=await send();expect(response.statusCode).toBe(200);
  expect(response.json().obligation.provider).toBe('razorpay');expect(response.json().obligation.provider_order_id).toBe('order_mock');
  expect((await send()).json().obligation.id).toBe(response.json().obligation.id);
  expect(razorpayTransport).toHaveBeenCalledTimes(1);expect(cashfreeTransport).not.toHaveBeenCalled();
 }finally{await razorpayApp.close();vi.stubEnv('PAYMENT_PROVIDER','simulator');}
});
it.each(['cashfree','razorpay'])('preserves an existing %s obligation instead of switching it to simulator',async provider=>{
 const existing=await D.obligation(db,'student',order.id,'full',provider);
 await db.q('UPDATE obligations SET provider_order_id=$2 WHERE id=$1',[existing.id,'existing_gateway_order']);
 expect((await checkout('full')).statusCode).toBe(409);
 expect((await settle(existing.id)).statusCode).toBe(409);
 const rows=await db.q('SELECT id,provider,provider_order_id,captured FROM obligations WHERE order_id=$1',[order.id]);
 expect(rows).toEqual([{id:existing.id,provider,provider_order_id:'existing_gateway_order',captured:false}]);
 expect((await db.q('SELECT * FROM payment_events'))).toHaveLength(0);
 expect(razorpayTransport).not.toHaveBeenCalled();expect(cashfreeTransport).not.toHaveBeenCalled();
});
