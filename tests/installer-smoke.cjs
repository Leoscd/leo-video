'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
(async()=>{
  const folder=path.resolve('.install-test');
  const child=spawn(process.execPath,['server.js'],{cwd:folder,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let call;
  try {
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('El paquete no inició.')),10000);child.once('error',reject);child.stdout.once('data',()=>{clearTimeout(timer);resolve();});child.once('exit',code=>{if(code)reject(new Error('Error de inicio: '+code));});});
    const {url}=JSON.parse(await fs.readFile(path.join(folder,'.cache/session.json'),'utf8')),u=new URL(url),token=u.hash.slice(1);
    call=async(route,body)=>{const res=await fetch(u.origin+'/api/'+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const out=await res.json();if(!res.ok)throw new Error(out.error);return out;};
    assert.equal((await call('health')).version,require('../package.json').version);
    const wait=async()=>{for(let i=0;i<300;i++){const job=await call('job');if(job.state==='done')return job.result;if(job.state!=='running')throw new Error(job.error);await new Promise(r=>setTimeout(r,200));}throw new Error('El trabajo no terminó.');};
    await call('demo',{});const imported=await wait();assert.equal(imported.project.version,2);
    imported.project.captions=[{start:.2,end:1,text:'Paquete instalado'}];
    await call('final-preview',{project:imported.project});const result=await wait();assert.ok(result.finalUrl);
    const response=await fetch(u.origin+result.finalUrl,{headers:{Range:'bytes=0-31'}});assert.equal(response.status,206);assert.match(response.headers.get('content-type'),/video\/mp4/);
    console.log('Instalador OK: servidor instalado, importación, subtítulos, exportación verificada y reproducción por rangos.');
  } finally {if(call)await call('quit',{}).catch(()=>{});else child.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
