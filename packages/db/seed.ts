import {database, type Database} from './index.js';
export async function seed(db:Database){await db.tx(async tx=>{
 for(const [id,name,accent,location] of [['north','Northfield University','#c9dc74','Hyderabad · Fictional pilot campus'],['west','Westbridge Institute','#e7a28c','Pune · Fictional pilot campus']]){
 await tx.q('INSERT INTO campuses VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[id,name,accent,location]);
 for(const [kind,title,description,price,moq] of [['hoodie','The Collective Hoodie','420 GSM cotton fleece. A relaxed fit. Made for the people who make this place.',129900,2],['jersey','College Club Jersey','An everyday classic, cut for a new generation.',89900,3],['tote','The Daily Campus Tote','Heavy canvas. Big ideas. Carry your campus with you.',54900,2]] as const){
 const drop=id+'-'+kind;
 await tx.q("INSERT INTO drops(id,campus_id,title,description,kind,price,moq,closes_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '7 days') ON CONFLICT DO NOTHING",[drop,id,title,description,kind,price,moq]);
 for(const size of kind==='tote'?['One size']:['S','M','L','XL']) for(const color of kind==='tote'?['Natural']:['Forest','Ink']) await tx.q('INSERT INTO variants(id,drop_id,color,size) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[drop+'-'+color+'-'+size,drop,color,size]);
 }
 }
 for(const [id,email,name] of [['student','student@ccoop.test','Aarav · Student'],['student2','student2@ccoop.test','Mira · Student'],['curator','curator@ccoop.test','Campus Curator'],['host','host@ccoop.test','Drop Host'],['admin','admin@ccoop.test','Global Operations']]) await tx.q('INSERT INTO users VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[id,email,name]);
 for(const role of ['curator','host','admin']) await tx.q('INSERT INTO roles VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[role,'north',role]);
 });}
if(process.argv[1]?.endsWith('seed.ts')){const db=await database();await seed(db);await db.close();console.log('Seeded two fictional campuses; existing commerce preserved.');}
