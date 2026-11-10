// Optional UI integration check. Requires Playwright through NODE_PATH and a running server.
'use strict';
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const {url} = JSON.parse(await fs.readFile(path.resolve('.cache/session.json'),'utf8'));
  const browser = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:960}});
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  try {
    await page.goto(url);
    await page.screenshot({path:'test-output/interfaz-inicial.png'});
    assert.equal(await page.locator('#export').isDisabled(),true);
    await page.locator('#demo').click();
    await page.waitForFunction(()=>document.querySelector('#project-title').textContent==='ejemplo.mp4',{},{timeout:60000});
    await page.locator('#job-overlay').waitFor({state:'hidden'});
    await page.waitForFunction(()=>document.querySelector('#video').readyState>=2);
    assert.equal(await page.locator('#export').isEnabled(),true);
    assert.match(await page.locator('#media-info').textContent(),/1280 × 720/);
    await page.locator('#scrub').evaluate(el=>{el.value='1.5';el.dispatchEvent(new Event('input'));});
    await page.waitForTimeout(200);
    await page.locator('#split').click();
    await page.waitForFunction(()=>document.querySelectorAll('.clip').length===2);
    await page.locator('#remove').click();
    await page.waitForFunction(()=>document.querySelectorAll('.clip').length===1);
    await page.locator('#undo').click();
    await page.waitForFunction(()=>document.querySelectorAll('.clip').length===2);
    await page.locator('#detect').click();
    await page.locator('#apply-silences').waitFor({state:'visible'});
    await page.locator('#job-overlay').waitFor({state:'hidden'});
    assert.equal(await page.locator('#silences input').count(),2);
    await page.locator('#apply-silences').click();
    await page.waitForFunction(()=>document.querySelectorAll('.clip').length===4);
    const length = await page.locator('#scrub').getAttribute('max'); assert.ok(Number(length)>6 && Number(length)<7);
    await page.locator('#format').selectOption('vertical');
    const frame = await page.locator('#video-frame').boundingBox(); assert.ok(Math.abs(frame.width/frame.height-9/16)<0.005);
    await page.locator('#play').click();
    await page.waitForTimeout(500);
    await page.locator('#play').click();
    assert.notEqual(await page.locator('#play-time').textContent(),'00:00.00');
    await page.screenshot({path:'test-output/interfaz-montaje.png'});
    await page.setViewportSize({width:1100,height:740});
    await page.screenshot({path:'test-output/interfaz-compacta.png'});
    assert.deepEqual(errors,[]);
    console.log('UI OK: importación de ejemplo, reproducción, cortes, borrado, deshacer, silencios, formato vertical y dos tamaños de ventana.');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
