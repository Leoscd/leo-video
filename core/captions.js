'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { localItems } = require('./project');
function stamp(n) { const h=Math.floor(n/3600),m=Math.floor(n/60)%60,s=(n%60).toFixed(2).padStart(5,'0'); return `${h}:${String(m).padStart(2,'0')}:${s}`; }
function escapeASS(s) { return s.replace(/\\/g,'＼').replace(/[{}]/g,'').replace(/\r?\n/g,'\\N'); }
function color(hex) { return `&H${hex.slice(5,7)}${hex.slice(3,5)}${hex.slice(1,3)}&`; }
function assDocument(p, clip, size, layer='front') {
  const [w,h]=size, lines=[];
  const add=(start,end,tags,text)=>{ if(end-start>=0.025) lines.push(`Dialogue: 0,${stamp(start)},${stamp(end)},Default,,0,0,0,,{${tags}}${text}`); };
  if (layer==='front' && p.captionStyle!=='off') {
    const cues=localItems(p.captions,clip), font=Math.round(Math.min(w,h)*p.captionSize), x=Math.round(w/2),y=Math.round(h*p.captionY);
    // Word cues retain recognizer timestamps. Phrase mode only groups adjacent words.
    let groups=[];
    if (['phrase','karaoke'].includes(p.captionStyle)) {
      for(const c of cues) {
        const last=groups.at(-1);
        if(last && last.words.length<5 && c.start-last.end<0.5 && !/[.!?]$/.test(last.words.at(-1).text)) {last.words.push(c);last.end=c.end;}
        else groups.push({start:c.start,end:c.end,words:[c]});
      }
    } else groups=cues.map(c=>({...c,words:[c]}));
    for(const g of groups) {
      const tags=`\\an5\\pos(${x},${y})\\fs${font}\\bord${Math.max(1,font*.06)}\\shad1\\c&HFFFFFF&\\2c&HFFFFFF&`;
      if(p.captionStyle==='karaoke') {
        for(const c of g.words) {
          const next=g.words[g.words.indexOf(c)+1],end=next?next.start:g.end;
          const text=g.words.map(word=>`{\\c${color(word===c?'#E9B96B':'#FFFFFF')}}${escapeASS(word.text)}`).join(' ');
          add(c.start,end,tags,text);
        }
      } else add(g.start,g.end,tags,escapeASS(g.words.map(c=>c.text).join(' ')));
    }
  }
  for(const e of localItems(p.effects.filter(e=>e.type==='text'&&e.layer===layer),clip)) {
    const x=Math.round(w*e.x),y=Math.round(h*e.y),font=Math.round(Math.min(w,h)*e.size),ms=Math.round((e.end-e.start)*1000);
    let tags=`\\an5\\pos(${x},${y})\\fs${font}\\c${color(e.color)}\\bord${Math.max(1,font*.025)}\\shad1`;
    if(e.animation==='fade') tags+='\\fad(180,180)';
    if(e.animation==='pop') tags+='\\fscx65\\fscy65\\t(0,180,\\fscx105\\fscy105)\\t(180,280,\\fscx100\\fscy100)';
    if(e.animation==='slide') tags=tags.replace(/\\pos\([^)]*\)/,`\\move(${x},${y+Math.round(h*.08)},${x},${y},0,${Math.min(280,ms)})`)+`\\fad(120,120)`;
    add(e.start,e.end,tags,escapeASS(e.text));
  }
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${w}\nPlayResY: ${h}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,40,&H00FFFFFF,&H00FFFFFF,&H00202020,&H80000000,-1,0,0,0,100,100,0,0,1,2,1,5,20,20,20,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${lines.join('\n')}\n`;
}
function srt(project) {
  let offset=0, cues=[];
  for(const c of project.clips) { cues.push(...localItems(project.captions,c).map(s=>({...s,start:s.start+offset,end:s.end+offset})));offset+=c.end-c.start; }
  const time=n=>{const ms=Math.round(n*1000);return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`;};
  return cues.map((c,i)=>`${i+1}\n${time(c.start)} --> ${time(c.end)}\n${c.text}\n`).join('\n');
}
function parseWhisper(data,duration) {
  const words=[];
  for(const segment of data.transcription || []) {
    // --max-len 1 produces word-sized segments. Whisper sometimes gives their
    // lexical token zero duration while the segment has valid bounds (e.g. "La").
    // Preserve the recognizer's segment timing instead of discarding that word.
    const text=segment.text?.trim();
    const segmentStart=(segment.offsets?.from ?? -1)/1000,segmentEnd=(segment.offsets?.to ?? -1)/1000;
    if(text&&!/^\[.*\]$/.test(text)&&!text.includes(' ')&&segmentStart>=0&&segmentEnd>segmentStart) {
      words.push({start:segmentStart,end:segmentEnd,text});continue;
    }
    const tokens=(segment.tokens || []).filter(t=>t.text&&!t.text.startsWith('[_')&&!t.text.startsWith('[BEG')&&!t.text.startsWith('[_TT'));
    let current=null;
    for(const t of tokens) {
      if(/^\[.*\]$/.test(t.text)) continue;
      const start=(t.offsets?.from ?? -1)/1000,end=(t.offsets?.to ?? -1)/1000;
      if(start<0||end<=start) continue;
      if(/^\s/.test(t.text)||!current) { if(current) words.push(current);current={start,end,text:t.text.trim()}; }
      else {current.text+=t.text;current.end=end;}
    }
    if(current) words.push(current);
    if(!tokens.length && segment.text?.trim()) words.push({start:segment.offsets.from/1000,end:segment.offsets.to/1000,text:segment.text.trim()});
  }
  return words.filter(c=>c.text&&c.end>c.start&&c.start<duration).map(c=>({...c,end:Math.min(duration,c.end)}));
}
async function transcribe(media,folder,job,run,language='es') {
  if(!media.audio) throw new Error('Este video no tiene audio.');
  const base=path.join(os.homedir(),'.cache','hyperframes','whisper');
  const exe=process.env.LEO_WHISPER_EXE || path.join(base,'whisper.cpp','build','bin','whisper-cli.exe');
  const model=process.env.LEO_WHISPER_MODEL || path.join(base,'models','ggml-small.bin');
  await fs.access(exe).catch(()=>{throw new Error('Falta whisper-cli. Configurá LEO_WHISPER_EXE.');});
  await fs.access(model).catch(()=>{throw new Error('Falta el modelo multilingüe. Configurá LEO_WHISPER_MODEL.');});
  const dir=await fs.mkdtemp(path.join(folder,'transcript-'));
  try {
    const wav=path.join(dir,'audio.wav'),out=path.join(dir,'words'); job.message='Extrayendo audio para transcripción local…';
    await run('ffmpeg',['-v','error','-nostdin','-n','-i',media.path,'-vn','-ar','16000','-ac','1','-c:a','pcm_s16le',wav],job);
    job.message='Transcribiendo en español. Puede tardar varios minutos…';
    if(!['es','en','auto'].includes(language))throw new Error('Idioma inválido.');
    await run(exe,['-m',model,'-f',wav,'-l',language,'-ojf','-of',out,'-pp','-sow','-ml','1','-t','4'],job,line=>{const m=line.match(/progress\s*=\s*(\d+)%/);if(m)job.progress=Number(m[1])/100;});
    const data=JSON.parse(await fs.readFile(`${out}.json`,'utf8'));
    return parseWhisper(data,media.duration);
  } finally {await fs.rm(dir,{recursive:true,force:true});}
}
module.exports={assDocument,srt,parseWhisper,transcribe};
