'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {existsSync}=require('node:fs');
const { localItems }=require('./project');
const { assDocument }=require('./captions');
function zoomFilters(effects, clip, size, fps) {
  const zooms=effects.filter(e=>e.type==='zoom'&&e.end>clip.start&&e.start<clip.end);
  if(!zooms.length)return 'null';
  // Use source-relative time so cutting/reordering cannot restart or shift an effect.
  const pulse=(e,t)=>`pow(sin(PI*clip((${t}+${clip.start}-${e.start})/${e.end-e.start},0,1)),2)`;
  const z='1'+zooms.map(e=>`+${e.zoom-1}*${pulse(e,'it')}`).join('');
  const axis=key=>'0.5'+zooms.map(e=>`+${e[key]-.5}*between(it+${clip.start},${e.start},${e.end})`).join('');
  let result=`zoompan=z='${z}':x='max(0,min(iw-iw/zoom,iw*(${axis('x')})-iw/zoom/2))':y='max(0,min(ih-ih/zoom,ih*(${axis('y')})-ih/zoom/2))':d=1:s=${size[0]}x${size[1]}:fps=${fps}`;
  for(const e of zooms.filter(e=>e.tilt!==0)) {
    const a=`${Math.abs(e.tilt)}*${pulse(e,`(in/${fps})`)}`;
    const left=e.tilt>0?a:'0',right=e.tilt<0?a:'0';
    result+=`,perspective=x0=0:y0='H*(${left})':x1=W:y1='H*(${right})':x2=0:y2='H*(1-(${left}))':x3=W:y3='H*(1-(${right}))':sense=destination:eval=frame`;
  }
  return result;
}
async function compose(base,dest,p,clip,size,folder,job,run,audit = {}) {
  const front=path.join(folder,`${path.basename(dest)}-front.ass`),behind=path.join(folder,`${path.basename(dest)}-behind.ass`);
  await fs.writeFile(front,assDocument(p,clip,size,'front')); await fs.writeFile(behind,assDocument(p,clip,size,'behind'));
  const sections=localItems(p.effects.filter(e=>e.type==='text'&&e.layer==='behind'),clip);
  const args=['-hide_banner','-nostdin','-n','-i',base];
  let graph='',input='0:v';
  if(sections.length) {
    const mask=path.join(folder,`${path.basename(dest)}-mask.mkv`),cfg=mask+'.json';
    await fs.writeFile(cfg,JSON.stringify({fps:p.fps,threshold:p.matteThreshold,feather:p.matteFeather,intervals:sections.map(s=>({start:s.start,end:s.end}))}));
    job.message='Recortando tu figura. El cálculo local puede tardar…';
    const anaconda=path.join(os.homedir(),'anaconda3','python.exe');
    const python=process.env.LEO_PYTHON || (process.platform==='win32'&&existsSync(anaconda)?anaconda:'python');
    await run(python,[path.resolve(__dirname,'../scripts/matte.py'),base,mask,cfg],job,line=>{const m=line.match(/matte_frame=(\d+)/);if(m)job.message=`Recortando tu figura: ${(Number(m[1])/p.fps).toFixed(1)} s procesados…`;});
    if(audit.directory)await fs.copyFile(mask,path.join(audit.directory,`audit-clip-${audit.index}-mask.mkv`),require('node:fs').constants.COPYFILE_EXCL);
    args.push('-i',mask);
    graph=`[0:v]split=2[original][plate];[plate]ass=filename='${path.basename(behind)}'[withText];[1:v]scale=${size[0]}:${size[1]}[mask];[original][mask]alphamerge[person];[withText][person]overlay=shortest=1:format=auto[depth];`;
    input='depth';
  }
  graph+=`[${input}]${zoomFilters(p.effects,clip,size,p.fps)},ass=filename='${path.basename(front)}',format=yuv420p[out]`;
  job.message='Componiendo textos y movimiento…';
  args.push('-filter_complex',graph,'-map','[out]','-map','0:a:0?','-c:v','libx264','-preset','veryfast','-crf','20','-c:a','copy','-video_track_timescale','90000','-movflags','+faststart',dest);
  await run('ffmpeg',args,job,()=>{},{cwd:folder});
}
module.exports={compose,zoomFilters};
