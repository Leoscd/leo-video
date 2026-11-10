'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { probe, run, detectSilences, exportVideo, makePreview, canPlayDirect } = require('../core/media');
const { validateClips, validateProject, removeSilences, durationOf } = require('../core/project');
const dir = path.resolve('test-output');
let fixture, source, hash;
const sha = async file => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
before(async () => {
  await fs.mkdir(dir,{recursive:true});
  fixture = path.join(dir, `original-${crypto.randomUUID()}.mp4`);
  await run('ffmpeg',['-v','error','-nostdin','-n','-f','lavfi','-i','testsrc2=size=320x180:rate=30:duration=6','-f','lavfi','-i','sine=frequency=600:sample_rate=48000:duration=6','-af',"volume=0:enable='between(t,2,3)'",'-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-shortest',fixture]);
  source = await probe(fixture); hash = await sha(fixture);
});
test('reproduce directo H.264 SDR y pide copia liviana para el resto', () => {
  assert.equal(source.direct, true);
  assert.equal(canPlayDirect({ ...source, codec: 'hevc' }), false);
  assert.equal(canPlayDirect({ ...source, hdr: true }), false);
  assert.equal(canPlayDirect({ ...source, pixFmt: 'yuv420p10le' }), false);
  assert.equal(canPlayDirect({ ...source, container: 'matroska,webm' }), false);
  assert.equal(canPlayDirect({ ...source, audioCodec: 'pcm_s16le' }), false);
  assert.equal(canPlayDirect({ ...source, audio: false, audioCodec: null }), true);
});
test('valida intervalos y rechaza datos corruptos del proyecto', () => {
  assert.throws(() => validateClips([{start:-1,end:2}],6));
  assert.throws(() => validateClips([{start:0,end:Infinity}],6));
  assert.throws(() => validateClips([{start:0,end:8}],6));
  assert.throws(() => validateClips([],6));
  assert.throws(() => validateProject({version:1,format:'inventado',clips:[{start:0,end:1}]},source));
  assert.throws(() => validateProject({version:1,format:'original',source:'otra-ruta',clips:[{start:1,end:2}]},source),/otra ventana/);
  const p = validateProject({version:1,format:'original',source:source.path,clips:[{start:1,end:2}]},source);
  assert.equal(p.source,source.path);
});
test('recorta silencios preservando margen, orden y cortes existentes', () => {
  const c = removeSilences([{start:3,end:6},{start:0,end:2}], [{start:1,end:4}],6,0.12);
  assert.deepEqual(c,[{start:3.88,end:6},{start:0,end:1.12}]);
  assert.throws(() => removeSilences([{start:0,end:6}],[{start:0,end:6}],6));
});
test('FFmpeg detecta la pausa real del audio', async () => {
  const result = await detectSilences(source,-35,0.5,{});
  assert.equal(result.length,1);
  assert.ok(Math.abs(result[0].start-2)<0.15,JSON.stringify(result));
  assert.ok(Math.abs(result[0].end-3)<0.15,JSON.stringify(result));
});
test('exporta clips reordenados, verifica duración/audio e integridad del original', async () => {
  const clips = [{start:3.2,end:5},{start:0.2,end:1.4}];
  const p = {version:1,format:'original',clips};
  const dest = path.join(dir,`montaje-${crypto.randomUUID()}.mp4`), job = {};
  const result = await exportVideo(source,p,dest,job);
  assert.ok(Math.abs(result.duration-durationOf(clips))<0.15);
  assert.equal(result.width,320); assert.equal(result.height,180); assert.equal(result.audio,true);
  assert.equal(await sha(fixture),hash);
  await assert.rejects(exportVideo(source,p,fixture,{}),/original/);
  await assert.rejects(exportVideo(source,p,dest,{}),/ya existe/);
  // Compare the first decoded frame against the source at 3.2 s, so order is tested too.
  const outFrame = path.join(dir,'export-first.rgb'), srcFrame = path.join(dir,'source-first.rgb');
  await run('ffmpeg',['-v','error','-y','-i',dest,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24',outFrame]);
  await run('ffmpeg',['-v','error','-y','-ss','3.2','-i',fixture,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24',srcFrame]);
  const a = await fs.readFile(outFrame), b = await fs.readFile(srcFrame);
  assert.equal(a.length,b.length); let error=0; for(let i=0;i<a.length;i++) error+=Math.abs(a[i]-b[i]);
  assert.ok(error/a.length<6,`Diferencia media: ${error/a.length}`);
});
test('vista previa normalizada y exportación de video sin audio', async () => {
  const mute = path.join(dir,`sin-audio-${crypto.randomUUID()}.mp4`);
  await run('ffmpeg',['-v','error','-nostdin','-n','-i',fixture,'-map','0:v:0','-c','copy',mute]);
  const info = await probe(mute); assert.equal(info.audio,false);
  const preview = path.join(dir,`preview-${crypto.randomUUID()}.mp4`);
  await makePreview(info,preview,{}); assert.equal((await probe(preview)).audio,false);
  const out = path.join(dir,`vertical-${crypto.randomUUID()}.mp4`);
  const result = await exportVideo(info,{version:1,format:'vertical',clips:[{start:0,end:0.5}]},out,{});
  assert.equal(result.width,1080); assert.equal(result.height,1920); assert.equal(result.audio,false);
});
test('cancelación no publica un archivo ni deja temporales de exportación', async () => {
  const ownFolder=await fs.mkdtemp(path.join(dir,'cancel-test-'));
  const target = path.join(ownFolder,`cancelado-${crypto.randomUUID()}.mp4`);
  await assert.rejects(exportVideo(source,{version:1,format:'original',clips:[{start:0,end:2}]},target,{cancelled:true}),/cancelada/);
  await assert.rejects(fs.access(target));
  assert.equal((await fs.readdir(ownFolder)).filter(n=>n.startsWith('.leo-export-')).length,0);
});
test('normaliza orientación del teléfono y conserva resolución 4K al exportar', async () => {
  const rotated = path.join(dir,`rotado-${crypto.randomUUID()}.mov`);
  await run('ffmpeg',['-v','error','-nostdin','-n','-display_rotation','90','-i',fixture,'-c','copy',rotated]);
  const portrait = await probe(rotated); assert.equal(portrait.width,180); assert.equal(portrait.height,320);
  const portraitOut = path.join(dir,`retrato-${crypto.randomUUID()}.mp4`);
  const result = await exportVideo(portrait,{version:1,format:'original',clips:[{start:0,end:0.5}]},portraitOut,{});
  assert.equal(result.width,180); assert.equal(result.height,320);
  const fourK = path.join(dir,`4k-${crypto.randomUUID()}.mp4`);
  await run('ffmpeg',['-v','error','-nostdin','-n','-f','lavfi','-i','color=c=steelblue:size=3840x2160:rate=30:duration=0.4','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',fourK]);
  const fourKInfo = await probe(fourK), preview = path.join(dir,`4k-preview-${crypto.randomUUID()}.mp4`);
  await makePreview(fourKInfo,preview,{});
  const small = await probe(preview); assert.equal(small.width,1280); assert.equal(small.height,720);
  const fourKOut = path.join(dir,`4k-export-${crypto.randomUUID()}.mp4`);
  const big = await exportVideo(fourKInfo,{version:1,format:'original',clips:[{start:0,end:0.3}]},fourKOut,{});
  assert.equal(big.width,3840); assert.equal(big.height,2160);
});
