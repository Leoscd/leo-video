'use strict';
const {test,before}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {run,probe,exportVideo,makePreview}=require('../core/media');
const {validateProject,localItems}=require('../core/project');
const {srt,parseWhisper}=require('../core/captions');
const dir=path.resolve('test-output');let media;
before(async()=>{
  await fs.mkdir(dir,{recursive:true});const file=path.join(dir,`fx-source-${crypto.randomUUID()}.mp4`);
  await run('ffmpeg',['-v','error','-nostdin','-n','-f','lavfi','-i','testsrc2=size=320x180:rate=30:duration=2','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',file]);media=await probe(file);
});
const project=()=>({version:2,format:'original',clips:[{start:0,end:2}],captions:[{start:.2,end:.6,text:'Hola'},{start:.7,end:1.2,text:'mundo'}],effects:[]});
const effect=extra=>({id:crypto.randomUUID(),type:'text',start:.2,end:1.5,text:'TEXTO',layer:'front',animation:'pop',...extra});
test('migra proyectos v1 y conserva efectos/subtítulos al guardar y abrir',async()=>{
  const p=validateProject({...project(),effects:[effect({layer:'behind'})]},media);
  const saved=validateProject(JSON.parse(JSON.stringify(p)),media);assert.deepEqual(saved,p);
  const v1=validateProject({version:1,format:'original',clips:[{start:0,end:2}]},media);assert.equal(v1.version,2);assert.deepEqual(v1.effects,[]);
  assert.throws(()=>validateProject({...project(),effects:[effect({type:'zoom'}),effect({type:'zoom'})]},media),/superponerse/);
});
test('SRT y efectos siguen los tiempos después de cortar y reordenar',()=>{
  const p=validateProject({...project(),clips:[{start:.8,end:1.5},{start:0,end:.6}]},media);
  const text=srt(p);assert.match(text,/00:00:00,000 --> 00:00:00,400\nmundo/);assert.match(text,/00:00:00,900 --> 00:00:01,300\nHola/);
  const mapped=localItems([effect({start:.2,end:1.5})],{start:.8,end:1.8});assert.equal(mapped[0].start,0);assert.equal(mapped[0].end,.7);
});
test('reconstruye palabras de tokens sin inventar tiempos',()=>{
  const cues=parseWhisper({transcription:[{tokens:[{text:' Hola',offsets:{from:100,to:300}},{text:',',offsets:{from:300,to:350}},{text:' mundo',offsets:{from:400,to:800}},{text:'[_EOT_]',offsets:{from:800,to:800}}]}]},2);
  assert.deepEqual(cues,[{start:.1,end:.35,text:'Hola,'},{start:.4,end:.8,text:'mundo'}]);
});
test('conserva palabra reconocida cuyo token tiene duración cero y tramo válido',()=>{
  const data={transcription:[{text:' La',offsets:{from:110,to:150},tokens:[{text:' La',offsets:{from:110,to:110}}]},
    {text:' idea',offsets:{from:150,to:330},tokens:[{text:' idea',offsets:{from:150,to:330}}]}]};
  const cues=parseWhisper(data,2);assert.deepEqual(cues,[{start:.11,end:.15,text:'La'},{start:.15,end:.33,text:'idea'}]);
  const p=validateProject({...project(),captions:cues},media);assert.equal(p.captions[0].text,'La');
});
test('exporta subtítulos y texto animado, zoom y perspectiva reales',async()=>{
  const p={...project(),captionStyle:'karaoke',effects:[effect({type:'zoom',zoom:1.4,tilt:.08,start:0,end:2}),effect({text:'UNA PRUEBA',size:.12})]};
  const dest=path.join(dir,`efectos-${crypto.randomUUID()}.mp4`);
  const result=await exportVideo(media,p,dest,{});assert.equal(result.width,320);assert.ok(Math.abs(result.duration-2)<.1);
  await fs.copyFile(dest,path.join(dir,'resultado-efectos.mp4'));
  await run('ffmpeg',['-v','error','-y','-ss','0.8','-i',dest,'-frames:v','1',path.join(dir,'resultado-efectos.png')]);
  const out=await run('ffmpeg',['-v','error','-ss','0.8','-i',dest,'-frames:v','1','-f','framemd5','-']);
  const original=await run('ffmpeg',['-v','error','-ss','0.8','-i',media.path,'-frames:v','1','-f','framemd5','-']);assert.notEqual(out.output,original.output);
});
test('reencuadre personalizado y exportación a 60 fps',async()=>{
  const p={...project(),format:'custom',width:256,height:320,fit:'cover',panX:.3,panY:.6,fps:60};
  const dest=path.join(dir,`personalizado-${crypto.randomUUID()}.mp4`);const r=await exportVideo(media,p,dest,{});
  assert.equal(r.width,256);assert.equal(r.height,320);assert.equal((await probe(dest)).fps,'60/1');
});
test('HDR PQ se convierte a SDR con metadatos BT.709',async()=>{
  const src=path.join(dir,`hdr-${crypto.randomUUID()}.mp4`);
  await run('ffmpeg',['-v','error','-n','-f','lavfi','-i','color=gray:size=320x180:duration=0.5:rate=30','-vf','setparams=color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc','-c:v','libx264','-pix_fmt','yuv420p10le','-x264-params','colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc',src]);
  const hdr=await probe(src);assert.equal(hdr.hdr,true);
  const dest=path.join(dir,`sdr-${crypto.randomUUID()}.mp4`);await exportVideo(hdr,{version:2,format:'original',clips:[{start:0,end:.4}]},dest,{});assert.equal((await probe(dest)).hdr,false);
});
test('compone efectos cuando la carpeta de salida tiene apóstrofes',async()=>{
  const folder=path.join(dir,"salida con ' comilla");await fs.mkdir(folder,{recursive:true});
  const dest=path.join(folder,`prueba-${crypto.randomUUID()}.mp4`);
  await exportVideo(media,{...project(),clips:[{start:0,end:.5}],effects:[effect({end:.4})]},dest,{});
  assert.ok((await probe(dest)).duration>.4);
});
test('importa HEVC y normaliza video de velocidad variable',async()=>{
  const src=path.join(dir,`hevc-vfr-${crypto.randomUUID()}.mp4`);
  await run('ffmpeg',['-v','error','-n','-i',media.path,'-vf',"select='not(eq(mod(n,5),0))'",'-fps_mode','vfr','-c:v','libx265','-preset','ultrafast','-x265-params','pools=1:frame-threads=1:log-level=error','-tag:v','hvc1',src]);
  const info=await probe(src);assert.equal(info.codec,'hevc');assert.notEqual(info.fps,'30/1');
  const preview=path.join(dir,`hevc-preview-${crypto.randomUUID()}.mp4`);await makePreview(info,preview,{});
  assert.equal((await probe(preview)).fps,'30/1');
  const dest=path.join(dir,`hevc-export-${crypto.randomUUID()}.mp4`);const r=await exportVideo(info,{version:2,format:'original',clips:[{start:.1,end:1.2}]},dest,{});assert.ok(Math.abs(r.duration-1.1)<.1);
});
