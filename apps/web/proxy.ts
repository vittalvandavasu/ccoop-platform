import {NextRequest,NextResponse} from 'next/server';
import {demoConfig,demoAuthorized} from '../../packages/demo/config';
export function proxy(request:NextRequest){
 try{
  if(process.env.CCOOP_NETLIFY_DEMO==='true'&&process.env.PARTNER_DEMO!=='true')throw Error('Netlify partner access is not configured');
  const demo=demoConfig();
  if(demo&&!demoAuthorized(request.headers.get('authorization')||undefined,demo))return new NextResponse('Partner demo access required',{status:401,headers:{'WWW-Authenticate':'Basic realm="CCOOP partner demo", charset="UTF-8"','Cache-Control':'no-store'}});
  const response=NextResponse.next();response.headers.set('X-CCOOP-Commit',process.env.CCOOP_RELEASE_COMMIT||'local-unverified');if(demo)response.headers.set('Cache-Control','private, no-store');return response;
 }catch{return new NextResponse('Partner demo configuration unavailable',{status:503,headers:{'Cache-Control':'no-store'}});}
}
