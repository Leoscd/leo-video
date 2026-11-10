'use strict';
// Non-destructive acceptance harness. Source is always read-only; output must be a new folder.
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {probe,run,makePreview,detectSilences,exportVideo}=require('../core/media');
const {transcribe,srt}=require('../core/captions');
const {validateProject}=require('../core/project');
const hash=async file=>crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
(async()=>{
  const source=process.argv[2],folder=path.resolve(process.argv[3]||'validaciones/prueba-real');
  if(!source)throw new Error('Uso: node tests/real-video.cjs <video> <carpeta-nueva>');
  await fs.mkdir(folder,{recursive:true});
  const checkpoint=path.join(folder,'analisis.json');
  if(process.argv.includes('--analyze')) {
    const before=await hash(source),media=await probe(source),job={};
    console.log(`Origen: ${media.width}x${media.height}, ${media.duration}s, ${media.fps}, ${media.codec}, HDR=${media.hdr}`);
    const start=performance.now();const captions=await transcribe(media,folder,job,run,'es');
    const transcribeSeconds=(performance.now()-start)/1000;
    const silences=await detectSilences(media,-35,.3,{});
    const analysis={media,sourceHash:before,captions,silences,transcribeSeconds};
    await fs.writeFile(checkpoint,JSON.stringify(analysis,null,2),{flag:'wx'});
    await fs.writeFile(path.join(folder,'transcripcion-automatica.txt'),captions.map(c=>`${c.start.toFixed(2)}–${c.end.toFixed(2)} ${c.text}`).join('\n'),{flag:'wx'});
    console.log(JSON.stringify(analysis));return;
  }
  const analysis=JSON.parse(await fs.readFile(checkpoint,'utf8')),media=await probe(source);
  if(await hash(source)!==analysis.sourceHash)throw new Error('El original cambió desde el análisis.');
  const duration=Math.min(3.8,media.duration);
  const p=validateProject({version:2,format:'original',fps:30,clips:[{start:0,end:duration}],captions:analysis.captions,captionStyle:'karaoke',captionSize:.055,captionY:.81,
    effects:[{id:'real-behind',type:'text',start:2.7,end:duration-.02,text:'NO TRABAJA',layer:'behind',animation:'fade',x:.5,y:.265,size:.125,color:'#E9B96B'},
      {id:'real-zoom',type:'zoom',start:.3,end:duration-.1,zoom:1.06,tilt:.015,x:.49,y:.40}],matteThreshold:.45,matteFeather:.8},media);
  await fs.writeFile(path.join(folder,'prueba-real.leovideo'),JSON.stringify(p,null,2),{flag:'wx'});
  await fs.writeFile(path.join(folder,'subtitulos.srt'),srt(p),{flag:'wx'});
  const start=performance.now(),job={};let message='';
  const timer=setInterval(()=>{if(job.message!==message){message=job.message;console.log(message);}},1500);
  let result;
  try {result=await exportVideo(media,p,path.join(folder,'prueba-real-1080x1920.mp4'),job,{auditDir:folder});}finally{clearInterval(timer);}
  const elapsed=(performance.now()-start)/1000;
  const output=await probe(result.path);
  await run('ffmpeg',['-v','error','-n','-i',result.path,'-vf','fps=2,scale=270:-1,tile=4x2','-frames:v','1',path.join(folder,'resultado-contacto.png')]);
  const endHash=await hash(source);if(endHash!==analysis.sourceHash)throw new Error('El original cambió.');
  const report={sourceHashBefore:analysis.sourceHash,sourceHashAfter:endHash,unchanged:true,result:output,exportSeconds:elapsed,transcribeSeconds:analysis.transcribeSeconds};
  await fs.writeFile(path.join(folder,'verificacion.json'),JSON.stringify(report,null,2),{flag:'wx'});
  console.log(JSON.stringify(report));
})().catch(e=>{console.error(e);process.exitCode=1;});
