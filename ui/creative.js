'use strict';
let effectId='',captionPage=0,draftTimer;
function scheduleDraft() {
  clearTimeout(draftTimer);
  draftTimer=setTimeout(async()=>{
    if(!project)return;
    if(busy)return scheduleDraft();
    try {await api('draft',{project});}catch(e){status(`No se pudo guardar la recuperación: ${e.message}`,true);}
  },800);
}
function renderCreative() {
  if(!project)return;
  $('custom-size').hidden=project.format!=='custom';
  for(const [id,key] of [['output-width','width'],['output-height','height'],['fit','fit'],['pan-x','panX'],['pan-y','panY'],['fps','fps'],['caption-style','captionStyle'],['caption-size','captionSize'],['caption-y','captionY'],['matte-threshold','matteThreshold'],['matte-feather','matteFeather']]) $(id).value=project[key];
  video.style.objectFit=project.fit==='cover'?'cover':'contain';video.style.objectPosition=`${project.panX*100}% ${project.panY*100}%`;
  $('export-info').textContent=`MP4 · H.264 · ${project.fps} FPS · AAC`;
  $('effect-count').textContent=`${project.effects.length} efectos guardados`;
  const picker=$('effect-select');picker.replaceChildren(new Option('Nuevo efecto',''));
  for(const e of project.effects)picker.add(new Option(`${e.type==='zoom'?'Zoom':e.layer==='behind'?'Detrás':'Texto'} · ${time(e.start)}–${time(e.end)} · ${e.text.slice(0,24)}`,e.id));
  if(!project.effects.some(e=>e.id===effectId))effectId='';picker.value=effectId;
  renderCaptions();
}
function renderCaptions() {
  if(!project)return;
  const list=$('caption-editor'),cues=project.captions;list.replaceChildren();
  captionPage=Math.min(captionPage,Math.max(0,Math.ceil(cues.length/30)-1));
  $('caption-count').textContent=`${cues.length} palabras / segmentos · página ${captionPage+1}`;
  cues.slice(captionPage*30,captionPage*30+30).forEach((c,j)=>{
    const i=captionPage*30+j,row=document.createElement('div');row.className='caption-row';
    const times=document.createElement('div');times.className='times';
    for(const key of ['start','end']) {
      const input=document.createElement('input');input.type='number';input.step='.01';input.min='0';input.max=media.duration;input.value=c[key].toFixed(2);input.title=key==='start'?'Inicio en original':'Fin en original';input.setAttribute('aria-label',input.title);
      input.addEventListener('change',()=>{const n=Number(input.value),next={...project.captions[i],[key]:n};if(!Number.isFinite(n)||next.start<0||next.end>media.duration||next.end-next.start+1e-9<.001){input.value=project.captions[i][key].toFixed(2);return status('Tiempos de subtítulo inválidos.',true);}remember();project.captions[i]=next;status('Tiempo corregido. Generá de nuevo el resultado.');});times.append(input);
    }
    const remove=document.createElement('button');remove.textContent='×';remove.title='Eliminar subtítulo';remove.addEventListener('click',()=>{remember();project.captions.splice(i,1);renderCaptions();controls();});times.append(remove);
    const text=document.createElement('input');text.type='text';text.value=c.text;text.maxLength=500;text.setAttribute('aria-label','Texto del subtítulo');
    text.addEventListener('change',()=>{remember();project.captions[i]={...project.captions[i],text:text.value};status('Texto corregido. Generá de nuevo el resultado.');});row.append(times,text);list.append(row);
  });
}
for(const button of document.querySelectorAll('[data-tab]'))button.addEventListener('click',()=>{
  for(const other of document.querySelectorAll('[data-tab]'))other.classList.toggle('active',other===button);
  for(const name of ['cuts','captions','effects','ai'])$('tab-'+name).hidden=name!==button.dataset.tab;
});
for(const [id,key] of [['output-width','width'],['output-height','height'],['fit','fit'],['pan-x','panX'],['pan-y','panY'],['fps','fps'],['caption-style','captionStyle'],['caption-size','captionSize'],['caption-y','captionY'],['matte-threshold','matteThreshold'],['matte-feather','matteFeather']]) $(id).addEventListener('change',()=>{
  let value=['fit','captionStyle'].includes(key)?$(id).value:Number($(id).value);
  if(['width','height'].includes(key)&&(!Number.isInteger(value)||value%2||value<128||value>7680)) {renderCreative();return status('Usá dimensiones pares entre 128 y 7680.',true);}
  remember();project[key]=value;render();status('Ajuste guardado. Generá el resultado para revisar los efectos.');
});
listen('final-preview',()=>operation('final-preview',{project}));
listen('close-final',()=>{$('final-video').pause();$('final-dialog').close();});
$('final-dialog').addEventListener('close',()=>$('final-video').pause());
listen('restore',async()=>{if(await canReplace())await operation('restore');});
listen('transcribe',async()=>{if(project.captions.length&&!confirm('Esto reemplazará los subtítulos actuales. ¿Continuar?'))return;await operation('transcribe',{project});});
listen('srt',async()=>{const r=await api('srt',{project});if(r.path)status(`SRT exportado: ${r.path}`);});
listen('add-caption',()=>{const start=Math.min(video.currentTime,media.duration-.08),end=Math.min(media.duration,start+1);remember();project.captions.push({start,end,text:'Texto'});captionPage=Math.floor((project.captions.length-1)/30);renderCaptions();controls();});
listen('caption-prev',()=>{captionPage=Math.max(0,captionPage-1);renderCaptions();});
listen('caption-next',()=>{captionPage++;renderCaptions();});
$('import-srt').addEventListener('change',async()=>{
  try {
    const file=$('import-srt').files[0];if(!file)return;if(file.size>2_000_000)throw new Error('SRT demasiado grande.');
    const text=(await file.text()).replace(/\r/g,'');const cues=[];
    const seconds=s=>{const [h,m,sec]=s.replace(',','.').split(':').map(Number);return h*3600+m*60+sec;};
    for(const block of text.split(/\n\s*\n/)) {
      const lines=block.trim().split('\n'),index=lines.findIndex(l=>l.includes('-->'));if(index<0)continue;
      const match=lines[index].match(/(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/);if(!match)throw new Error('Tiempos SRT inválidos.');
      const start=seconds(match[1]),end=seconds(match[2]);if(start<0||end>media.duration+.02||end-start+1e-9<.001)throw new Error('El SRT debe usar tiempos dentro del video original.');
      const content=lines.slice(index+1).join('\n').replace(/<[^>]*>/g,'');if(content.length>500)throw new Error('Un subtítulo excede 500 caracteres.');
      cues.push({start,end,text:content});
    }
    if(!cues.length||cues.length>20000)throw new Error('El archivo no tiene subtítulos válidos.');
    if(project.captions.length&&!confirm('¿Reemplazar los subtítulos actuales con este SRT?'))return;
    remember();project.captions=cues;captionPage=0;renderCaptions();controls();status('SRT importado con tiempos del original.');
  }catch(e){status(e.message,true);}finally{$('import-srt').value='';}
});
function effectFields(e) {
  const c=project.clips[selected];
  const defaults={type:'text',start:c.start,end:c.end,text:'',layer:'front',animation:'fade',color:'#ffffff',size:.09,zoom:1.2,tilt:0,x:.5,y:.4};
  e=e||defaults;
  for(const key of Object.keys(defaults))$('effect-'+key).value=e[key];
  $('text-options').hidden=e.type!=='text';$('zoom-options').hidden=e.type!=='zoom';
}
$('effect-select').addEventListener('change',()=>{effectId=$('effect-select').value;effectFields(project.effects.find(e=>e.id===effectId));});
$('effect-type').addEventListener('change',()=>{$('text-options').hidden=$('effect-type').value!=='text';$('zoom-options').hidden=$('effect-type').value!=='zoom';});
listen('effect-in',()=>$('effect-start').value=video.currentTime.toFixed(2));
listen('effect-out',()=>$('effect-end').value=video.currentTime.toFixed(2));
listen('effect-clip',()=>{const c=project.clips[selected];$('effect-start').value=c.start.toFixed(2);$('effect-end').value=c.end.toFixed(2);});
listen('effect-save',()=>{
  const e={id:effectId||crypto.randomUUID()};
  for(const key of ['type','text','layer','animation','color'])e[key]=$('effect-'+key).value;
  for(const key of ['start','end','x','y','size','zoom','tilt'])e[key]=Number($('effect-'+key).value);
  if(!Number.isFinite(e.start)||!Number.isFinite(e.end)||e.start<0||e.end>media.duration||e.end-e.start<.08)throw new Error('Definí una sección válida del video original.');
  if(e.type==='text'&&!e.text.trim())throw new Error('Escribí el texto del efecto.');
  if(e.type==='zoom'&&(e.zoom<1||e.zoom>2.5||!Number.isFinite(e.zoom)))throw new Error('El zoom debe estar entre 1 y 2,5.');
  if(e.type==='zoom'&&project.effects.some(other=>other.id!==e.id&&other.type==='zoom'&&other.end>e.start&&other.start<e.end))throw new Error('Ese tramo se superpone con otro zoom.');
  if(!effectId&&project.effects.length>=200)throw new Error('Máximo de 200 efectos.');
  remember();const index=project.effects.findIndex(other=>other.id===e.id);if(index<0)project.effects.push(e);else project.effects[index]=e;
  effectId=e.id;renderCreative();controls();status('Efecto guardado. Pulsá «Ver resultado con efectos».');
});
listen('effect-delete',()=>{if(!effectId)return;remember();project.effects=project.effects.filter(e=>e.id!==effectId);effectId='';renderCreative();effectFields();controls();});
renderCreative();
