'use strict';
const {chromium}=require('playwright');
const fs=require('node:fs/promises');
const assert=require('node:assert/strict');
(async()=>{
  const {url}=JSON.parse(await fs.readFile('.cache/session.json','utf8'));
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:960}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try {
    await page.goto(url);await page.locator('#demo').click();await page.waitForFunction(()=>document.querySelector('#project-title').textContent==='ejemplo.mp4',{},{timeout:60000});await page.locator('#job-overlay').waitFor({state:'hidden'});
    await page.locator('[data-tab=captions]').click();
    await page.locator('#import-srt').setInputFiles({name:'prueba.srt',mimeType:'text/plain',buffer:Buffer.from('1\n00:00:00,200 --> 00:00:00,700\nHola\n\n2\n00:00:00,800 --> 00:00:01,500\nmundo\n')});
    await page.waitForFunction(()=>document.querySelectorAll('.caption-row').length===2);
    await page.locator('.caption-row input[type=text]').first().fill('Hola corregido');await page.locator('#caption-style').selectOption('karaoke');
    await page.locator('[data-tab=effects]').click();
    await page.locator('#effect-text').fill('PRUEBA REAL');await page.locator('#effect-start').fill('0.5');await page.locator('#effect-end').fill('2');await page.locator('#effect-animation').selectOption('pop');await page.locator('#effect-save').click();
    await page.waitForFunction(()=>document.querySelector('#effect-count').textContent.startsWith('1 '));
    await page.locator('#effect-select').selectOption('');await page.locator('#effect-type').selectOption('zoom');await page.locator('#effect-start').fill('0');await page.locator('#effect-end').fill('3');await page.locator('#effect-zoom').fill('1.3');
    await page.locator('#effect-tilt').evaluate(el=>{el.value='.08';el.dispatchEvent(new Event('change'));});await page.locator('#effect-save').click();
    await page.waitForFunction(()=>document.querySelector('#effect-count').textContent.startsWith('2 '));
    await page.screenshot({path:'test-output/interfaz-efectos-v02.png'});
    await page.locator('#final-preview').click();await page.locator('#final-dialog').waitFor({state:'visible',timeout:60000});await page.locator('#job-overlay').waitFor({state:'hidden'});
    await page.waitForFunction(()=>document.querySelector('#final-video').readyState>=2);assert.ok(await page.locator('#final-video').evaluate(el=>el.duration>7.9));
    await page.locator('#final-video').evaluate(el=>el.currentTime=1);await page.waitForTimeout(200);await page.screenshot({path:'test-output/interfaz-resultado-v02.png'});await page.locator('#close-final').click();
    await page.waitForTimeout(1300);const draft=JSON.parse(await fs.readFile('.cache/draft.leovideo','utf8'));assert.equal(draft.version,2);assert.equal(draft.effects.length,2);assert.equal(draft.captions[0].text,'Hola corregido');
    await page.locator('#format').selectOption('custom');await page.locator('#output-width').fill('480');await page.locator('#output-height').fill('640');await page.locator('#fit').selectOption('cover');
    await page.locator('#fps').selectOption('60');await page.screenshot({path:'test-output/interfaz-personalizada-v02.png'});
    assert.deepEqual(errors,[]);console.log('UI creativa OK: SRT, corrección, karaoke, texto, zoom, perspectiva, resultado real, recuperación y tamaño personalizado.');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
