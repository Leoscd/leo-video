'use strict';
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
  const folder=path.resolve('.install-test');
  const child=spawn(process.execPath,['server.js'],{cwd:folder,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let browser,quit;
  try {
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('El servidor de prueba no inició.')),10000);child.once('error',reject);child.stdout.once('data',()=>{clearTimeout(timer);resolve();});});
    const {url}=JSON.parse(await fs.readFile(path.join(folder,'.cache/session.json'),'utf8')),u=new URL(url);
    quit=()=>fetch(u.origin+'/api/quit',{method:'POST',headers:{Authorization:'Bearer '+u.hash.slice(1),'Content-Type':'application/json'},body:'{}'});
    browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
    const page=await browser.newPage({viewport:{width:1440,height:960}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url);await page.locator('#demo').click();await page.waitForFunction(()=>document.querySelector('#project-title').textContent==='ejemplo.mp4',{},{timeout:60000});await page.locator('#job-overlay').waitFor({state:'hidden'});
    await page.locator('[data-tab=captions]').click();
    const srt=await fs.readFile('validaciones/no-trabaja-por-vos-final/subtitulos.srt');
    await page.locator('#import-srt').setInputFiles({name:'real.srt',mimeType:'text/plain',buffer:srt});
    await page.waitForFunction(()=>document.querySelectorAll('.caption-row').length===16);
    assert.equal(await page.locator('.caption-row input[type=text]').first().inputValue(),'La');
    const first=page.locator('.caption-row').first().locator('input[type=number]').first();
    await first.evaluate(el=>el.dispatchEvent(new Event('change')));
    assert.doesNotMatch(await page.locator('#status').textContent(),/inválidos|error/i);
    await page.waitForTimeout(1200);
    const draft=JSON.parse(await fs.readFile(path.join(folder,'.cache/draft.leovideo'),'utf8'));assert.equal(draft.captions[0].text,'La');assert.equal(draft.captions[0].start,.11);assert.equal(draft.captions[0].end,.15);
    assert.deepEqual(errors,[]);console.log('UI corregida: SRT real de 16 palabras, «La» de 40 ms, edición y borrador: OK.');
  } finally {if(browser)await browser.close();if(quit)await quit().catch(()=>{});else child.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
