import './globals.css';
export const dynamic='force-dynamic';
export const metadata={title:'ccoop. — The Campus Issue',description:'Made for your campus. Made possible together.',manifest:'/manifest.webmanifest'};
export const viewport={themeColor:'#192d25',width:'device-width',initialScale:1};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body>{process.env.PARTNER_DEMO==='true'&&<aside style={{position:'sticky',top:0,zIndex:1000,background:'#192d25',color:'#fff',padding:'12px',textAlign:'center',fontSize:'14px'}} aria-label="Partner demo disclosure">Partner demo · Fictional data · Simulated payments</aside>}{children}</body></html>}
