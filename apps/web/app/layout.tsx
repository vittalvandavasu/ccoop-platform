import './globals.css';
export const metadata={title:'ccoop. — The Campus Issue',description:'Made for your campus. Made possible together.',manifest:'/manifest.webmanifest'};
export const viewport={themeColor:'#192d25',width:'device-width',initialScale:1};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
