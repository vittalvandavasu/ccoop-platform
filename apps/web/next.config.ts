// Hosted requests use the server route handler and runtime API_ORIGIN.
export default {env:{CCOOP_NETLIFY_DEMO:process.env.NETLIFY==='true'?'true':'false',CCOOP_RELEASE_COMMIT:process.env.COMMIT_REF||process.env.RELEASE_COMMIT||'local-unverified'},async rewrites(){return process.env.NODE_ENV==='development'?[{source:'/v1/:path*',destination:'http://127.0.0.1:4000/v1/:path*'}]:[]}};
