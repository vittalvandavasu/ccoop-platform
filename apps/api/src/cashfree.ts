import {createHmac,timingSafeEqual} from 'node:crypto';
import {ensure,Problem} from './domain.js';
export const CASHFREE_API_VERSION='2025-01-01'; // Explicit, documented web integration version.
export const CASHFREE_BASE='https://sandbox.cashfree.com/pg';
export function paise(value:unknown):number {
 const text=String(value);ensure(/^\d+(\.\d{1,2})?$/.test(text),'Invalid provider amount',400);
 const [whole,fraction='']=text.split('.');const result=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
 ensure(result>0n&&result<=2147483647n,'Invalid provider amount',400);return Number(result);
}
export function decimal(amount:number):string {
 ensure(Number.isSafeInteger(amount)&&amount>0,'Invalid internal amount',400);
 const n=BigInt(amount);return `${n/100n}.${String(n%100n).padStart(2,'0')}`;
}
// Preserve provider numeric lexemes before conversion, including large transaction identifiers.
export function providerJSON(raw:string):any {
 return (JSON.parse as any)(raw,(key:string,value:unknown,context?:{source?:string})=>{
  if(['order_amount','payment_amount','cf_payment_id'].includes(key)&&typeof value==='number'){
   ensure(context?.source,'Lossless JSON support is required',500);return context.source;
  }return value;
 });
}
export function verifySignature(raw:string,timestamp:unknown,signature:unknown,secret:string){
 ensure(typeof timestamp==='string'&&/^\d{13}$/.test(timestamp),'Invalid webhook timestamp',401);
 // Cashfree retries can be delayed; no wall-clock freshness cutoff. Signed event IDs are deduplicated durably.
 ensure(typeof signature==='string'&&/^[A-Za-z0-9+/]{43}=$/.test(signature),'Invalid webhook signature',401);
 const expected=createHmac('sha256',secret).update(timestamp+raw).digest();
 ensure(timingSafeEqual(Buffer.from(signature,'base64'),expected),'Invalid webhook signature',401);
}
export function paymentConfig(env:Record<string,string|undefined>=process.env){
 const provider=env.PAYMENT_PROVIDER||env.PAYMENT_MODE||'cashfree';
 ensure(['cashfree','razorpay','simulator'].includes(provider),'Unknown payment provider',500);
 ensure(!(env.NODE_ENV==='production'&&provider==='simulator'),'Payment simulator is forbidden in production',500);
 ensure(!env.CASHFREE_ENV||env.CASHFREE_ENV==='sandbox','Only Cashfree sandbox is allowed',500);
 if(env.RAZORPAY_KEY_ID)ensure(env.RAZORPAY_KEY_ID.startsWith('rzp_test_'),'Only Razorpay test keys are supported',500);
 return provider;
}
export interface CashfreeAdapter {
 create(ob:any):Promise<any>; order(id:string):Promise<any>; payments(id:string):Promise<any[]>;
}
export class Cashfree implements CashfreeAdapter {
 constructor(private clientId:string,private secret:string,private origin:string,private transport:typeof fetch=fetch){}
 private async request(path:string,method='GET',body?:string,key?:string){
  ensure(this.clientId&&this.secret,'Cashfree sandbox credentials are not configured',503);
  let response:Response;
  try{response=await this.transport(CASHFREE_BASE+path,{method,headers:{'x-client-id':this.clientId,'x-client-secret':this.secret,'x-api-version':CASHFREE_API_VERSION,'Content-Type':'application/json',...(key?{'x-idempotency-key':key}:{})},body,signal:AbortSignal.timeout(10000),redirect:'error'});}catch{throw new Problem(503,'Cashfree connection interrupted. Check payment status before retrying.');}
  if(!response.ok)throw new Problem(response.status===404?404:response.status===409?409:503,'Cashfree request unavailable. Check payment status before retrying.');
  return providerJSON(await response.text());
 }
 order(id:string){return this.request('/orders/'+encodeURIComponent(id));}
 payments(id:string){return this.request('/orders/'+encodeURIComponent(id)+'/payments');}
 async create(ob:any){
  // Recover a remotely created order after a timeout/crash using the persisted deterministic ID.
  try{return await this.order(ob.provider_order_id);}catch(e){if(!(e instanceof Problem)||e.statusCode!==404)throw e;}
  const data={order_id:ob.provider_order_id,order_amount:'__EXACT_AMOUNT__',order_currency:'INR',
   customer_details:{customer_id:ob.customer_ref,customer_phone:'9999999999'},
   order_expiry_time:new Date(ob.expires_at).toISOString(),order_meta:{return_url:this.origin+'/?payment_return=1'}};
  const body=JSON.stringify(data).replace('"__EXACT_AMOUNT__"',decimal(ob.amount));
  try{return await this.request('/orders','POST',body,ob.id);}catch(e){
   // A duplicate or ambiguous create can be recovered; never generate a new provider order ID.
   try{return await this.order(ob.provider_order_id);}catch{throw e;}
  }
 }
}
