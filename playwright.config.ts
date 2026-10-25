import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'tests/browser',timeout:180000,use:{baseURL:'http://localhost:3000',viewport:{width:1440,height:1000},trace:'retain-on-failure'},workers:1,reporter:'list',webServer:[
 {command:'npm run dev:api',url:'http://127.0.0.1:4000/v1/health',timeout:120000,reuseExistingServer:false,env:{DATABASE_URL:'',PGLITE_PATH:'.data/browser-test-'+Date.now(),DEV_AUTH:'true',PAYMENT_MODE:'simulator',APP_ORIGIN:'http://localhost:3000'}},
 {command:'npm run dev:web',url:'http://localhost:3000',timeout:120000,reuseExistingServer:false}
]});
