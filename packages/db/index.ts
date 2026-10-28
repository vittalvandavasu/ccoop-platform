import { PGlite } from '@electric-sql/pglite';
import { drizzle as embeddedDrizzle } from 'drizzle-orm/pglite';
import { drizzle as serverDrizzle } from 'drizzle-orm/node-postgres';
import { sql, SQL } from 'drizzle-orm';
import pg from 'pg';
import { readFile, mkdir, readdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import {demoDatabase} from '../demo/config.js';
export interface Query { q<T = any>(text:string, values?:unknown[]):Promise<T[]> }
export interface Database extends Query { tx<T>(fn:(q:Query)=>Promise<T>):Promise<T>; close():Promise<void> }
function statement(text:string, values:unknown[]=[]):SQL {
 const parts=text.split(/(\$\d+)/g); return sql.join(parts.map(p=>/^\$\d+$/.test(p)?sql`${sql.param(values[Number(p.slice(1))-1])}`:sql.raw(p)),sql.raw(''));
}
function wrap(orm:any):Query {return {async q<T>(text:string,values:unknown[]=[]){const r=await orm.execute(statement(text,values));return (r.rows??r) as T[];}}}
export async function database(url=process.env.DATABASE_URL):Promise<Database>{
 demoDatabase({...process.env,DATABASE_URL:url});
 if(!url && process.env.NODE_ENV==='production') throw Error('Production requires DATABASE_URL');
 if(!url && (process.env.PGLITE_PATH||'.data/postgres')!=='memory://')await mkdir(dirname(process.env.PGLITE_PATH||'.data/postgres'),{recursive:true});
 const native=url?new pg.Pool({connectionString:url}):new PGlite(process.env.PGLITE_PATH||'.data/postgres');
 const orm:any=url?serverDrizzle(native as pg.Pool):embeddedDrizzle(native as PGlite);
 const db:Database={...wrap(orm),tx:fn=>orm.transaction((tx:any)=>fn(wrap(tx))),close:()=>url?(native as pg.Pool).end():(native as PGlite).close()};
 // One transaction and one connection for the entire versioned migration chain.
 // 001 is idempotent, so existing installations without a ledger are safely adopted.
 const files=(await readdir(new URL('./migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort();
 async function migrate(run:(s:string,v?:unknown[])=>Promise<any>){
  await run('CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  for(const name of files){const result=await run('SELECT name FROM schema_migrations WHERE name=$1',[name]);if(result.rows.length)continue;
   await run(await readFile(new URL('./migrations/'+name,import.meta.url),'utf8'));
   await run('INSERT INTO schema_migrations(name) VALUES($1)',[name]);}
 }
 try {
  if(url){const c=await (native as pg.Pool).connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(768145)');await migrate((s,v)=>c.query(s,v));await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
  else await (native as PGlite).transaction(async tx=>{await migrate(async(s,v)=>v?tx.query(s,v):(await tx.exec(s))[0]);});
 } catch(e){await db.close();throw e;}
 return db;
}
