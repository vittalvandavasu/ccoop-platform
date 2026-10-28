import {apiOrigin,demoConfig,demoAuthorized} from '../../../../../packages/demo/config';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function forward(request:Request){
 try{
  if(process.env.CCOOP_NETLIFY_DEMO==='true'&&process.env.PARTNER_DEMO!=='true')throw Error('Hosted access is not configured');
  const demo=demoConfig();
  if(demo&&!demoAuthorized(request.headers.get('authorization')||undefined,demo))return Response.json({error:'Partner access required'},{status:401});
  const url=new URL(request.url),origin=apiOrigin();
  if(!url.pathname.startsWith('/v1/'))return new Response(null,{status:404});
  if(!['GET','HEAD'].includes(request.method)&&request.headers.get('origin')!==process.env.APP_ORIGIN)return Response.json({error:'Request origin is not allowed'},{status:403});
  const headers=new Headers();for(const key of ['authorization','cookie','content-type','origin']){const value=request.headers.get(key);if(value)headers.set(key,value);}
  const body=['GET','HEAD'].includes(request.method)?undefined:await request.arrayBuffer();
  if(body&&body.byteLength>65536)return Response.json({error:'Request too large'},{status:413});
  const upstream=await fetch(origin+url.pathname+url.search,{method:request.method,headers,body,redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(20000)});
  // Do not forward redirects or arbitrary backend headers to the public browser.
  if(upstream.status>=300&&upstream.status<400)return Response.json({error:'Backend redirect rejected'},{status:502});
  const out=new Headers({'Cache-Control':'private, no-store'});for(const key of ['content-type','www-authenticate','x-ratelimit-remaining','x-ratelimit-reset']){const value=upstream.headers.get(key);if(value)out.set(key,value);}
  for(const cookie of upstream.headers.getSetCookie())out.append('set-cookie',cookie);
  return new Response(upstream.body,{status:upstream.status,headers:out});
 }catch{return Response.json({error:'Demo backend unavailable or not configured'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
export {forward as GET,forward as POST,forward as PUT,forward as PATCH,forward as DELETE,forward as HEAD,forward as OPTIONS};
