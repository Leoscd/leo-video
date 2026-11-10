'use strict';
const fs=require('node:fs/promises');
const assert=require('node:assert/strict');
(async()=>{
  const {url}=JSON.parse(await fs.readFile('.cache/session.json','utf8')),u=new URL(url),token=u.hash.slice(1),origin=u.origin;
  const call=async(route,data)=>{const r=await fetch(origin+'/api/'+route,{method:data?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});const out=await r.json();if(!r.ok)throw new Error(out.error);return out;};
  const project=JSON.parse(await fs.readFile('.cache/draft.leovideo','utf8'));
  await call('final-preview',{project});await call('cancel',{});
  let result;
  for(let i=0;i<60;i++){result=await call('job');if(result.state!=='running')break;await new Promise(r=>setTimeout(r,150));}
  assert.equal(result.state,'cancelled',JSON.stringify(result));
  assert.equal((await fs.readdir('.cache')).filter(n=>n.startsWith('.leo-export-')).length,0);
  console.log('Cancelación de operación activa y limpieza de temporales: OK.');
})().catch(e=>{console.error(e);process.exitCode=1;});
