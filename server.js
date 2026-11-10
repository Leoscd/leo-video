'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createReadStream } = require('node:fs');
const { probe, makePreview, detectSilences, exportVideo, run } = require('./core/media');
const { validateProject, removeSilences } = require('./core/project');
const { transcribe, srt } = require('./core/captions');
const ai = require('./core/ai');
ai.loadEnv(__dirname);
const ROOT = __dirname, CACHE = path.join(ROOT, '.cache');
const VERSION = require('./package.json').version;
const MAX_PROXIES = 6;
const token = crypto.randomBytes(32).toString('hex');
let media = null, preview = null, finalPreview = null, project = null, job = null, origin;
function cancelJob() {
  if(job?.state!=='running')return;
  job.cancelled=true; job.abort?.();
  if(job.child?.pid) {
    if(process.platform==='win32') spawn('taskkill',['/PID',String(job.child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',shell:false});
    else job.child.kill();
  }
}

async function dialog(kind, dialogJob = {}) {
  const scripts = {
    video: "$d = New-Object System.Windows.Forms.OpenFileDialog; $d.Filter = 'Videos|*.mp4;*.mov;*.mkv;*.m4v;*.webm;*.avi'; $d.Title = 'Importar video';",
    open: "$d = New-Object System.Windows.Forms.OpenFileDialog; $d.Filter = 'Proyecto Leo|*.leovideo'; $d.Title = 'Abrir proyecto';",
    save: "$d = New-Object System.Windows.Forms.SaveFileDialog; $d.Filter = 'Proyecto Leo|*.leovideo'; $d.FileName = 'Mi proyecto.leovideo'; $d.Title = 'Guardar proyecto';",
    export: "$d = New-Object System.Windows.Forms.SaveFileDialog; $d.Filter = 'Video MP4|*.mp4'; $d.FileName = 'Mi video editado.mp4'; $d.Title = 'Exportar MP4 con un nombre nuevo';",
    srt: "$d = New-Object System.Windows.Forms.SaveFileDialog; $d.Filter = 'Subtitulos SRT|*.srt'; $d.FileName = 'Subtitulos.srt';"
  };
  if (!scripts[kind]) throw new Error('Diálogo inválido.');
  const code = "Add-Type -AssemblyName System.Windows.Forms; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; " + scripts[kind] + " $d.RestoreDirectory = $true; $owner = New-Object System.Windows.Forms.Form; $owner.TopMost = $true; if ($d.ShowDialog($owner) -eq 'OK') { [Console]::Write($d.FileName) }; $owner.Dispose(); $d.Dispose();";
  const { output } = await run('powershell.exe', ['-NoProfile', '-STA', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64')], dialogJob);
  return output.replace(/^\uFEFF/, '').trim();
}
function startJob(task) {
  if (job?.state === 'running') throw new Error('Esperá a que termine la operación actual.');
  const current = { id: crypto.randomUUID(), state: 'running', progress: 0, message: 'Preparando…', cancelled: false };
  job = current;
  Promise.resolve().then(() => task(current)).then(result => {
    if(current.cancelled){current.state='cancelled';current.error='Operación cancelada.';return;}
    current.result = result; current.state = 'done'; current.progress = 1; current.message = 'Listo.';
  }).catch(e => { current.state = current.cancelled ? 'cancelled' : 'error'; current.error = e.message; });
  return { id: current.id };
}
function publicJob() { if (!job) return null; const { child, ...data } = job; return data; }
// Copia liviana solo para lo que el navegador no reproduce (HEVC, HDR, 10 bits…).
// Se guarda por ruta+tamaño+fecha del original: reabrir un proyecto no la recalcula.
async function proxyFor(info, j) {
  const key = crypto.createHash('sha1').update(`${info.path.toLowerCase()}|${info.fingerprint.size}|${info.fingerprint.mtimeMs}`).digest('hex').slice(0, 20);
  const dest = path.join(CACHE, `proxy-${key}.mp4`);
  try { await fs.access(dest); const now = new Date(); await fs.utimes(dest, now, now).catch(() => {}); return dest; } catch {}
  const part = path.join(CACHE, `proxy-${key}-${j.id}.part.mp4`);
  try { await makePreview(info, part, j); await fs.rename(part, dest); } finally { await fs.rm(part, { force: true }); }
  const old = [];
  for (const name of await fs.readdir(CACHE)) if (/^proxy-[0-9a-f]{20}.mp4$/.test(name)) old.push({ file: path.join(CACHE, name), time: (await fs.stat(path.join(CACHE, name))).mtimeMs });
  for (const item of old.sort((a, b) => b.time - a.time).slice(MAX_PROXIES)) if (item.file !== dest) await fs.rm(item.file, { force: true }).catch(() => {});
  return dest;
}
async function importFile(file, j, saved) {
  const info = await probe(file, j);
  if (saved?.fingerprint && (saved.fingerprint.size !== info.fingerprint.size || Math.abs(saved.fingerprint.mtimeMs - info.fingerprint.mtimeMs) > 1)) throw new Error('El original fue modificado desde que guardaste el proyecto. Importalo como un video nuevo.');
  const next = validateProject(saved || { version: 1, format: 'original', clips: [{ start: 0, end: info.duration }] },info);
  // `preview` puede ser el original: nunca se borra desde acá.
  const file2 = info.direct ? info.path : await proxyFor(info, j);
  media = info; preview = file2; project = next;
  return { media: info, project: next, previewUrl: `/media/preview?t=${token}&v=${j.id}` };
}
async function readBody(req) {
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 8_000_000) throw new Error('Solicitud demasiado grande.'); }
  return body ? JSON.parse(body) : {};
}
function json(res, data, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
async function handle(req, res) {
  const url = new URL(req.url, origin);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.headers.host !== new URL(origin).host) return json(res, { error: 'Host no permitido.' }, 403);
  if (url.pathname.startsWith('/api/')) {
    if (req.headers.authorization !== `Bearer ${token}` || (req.headers.origin && req.headers.origin !== origin)) return json(res, { error: 'Acceso no autorizado.' }, 403);
    if (req.method === 'GET' && url.pathname === '/api/job') return json(res, publicJob());
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, { ok: true, version: VERSION });
    if (req.method === 'GET' && url.pathname === '/api/ai-status') { const c = ai.config(); return json(res, { configured: !!c.key, model: c.model, transcribe: c.key ? c.transcribe : 'local' }); }
    if (req.method !== 'POST') return json(res, { error: 'Método no permitido.' }, 405);
    const body = await readBody(req);
    if (url.pathname === '/api/cancel') { cancelJob(); return json(res, { ok: true }); }
    if (url.pathname === '/api/quit') { cancelJob(); json(res, { ok: true }); setTimeout(() => process.exit(0), 400); return; }
    if (job?.state === 'running') throw new Error('Hay una operación en curso. Esperá o cancelala.');
    if (url.pathname === '/api/import') return json(res, startJob(async j => { const file = await dialog('video',j); return file ? importFile(file, j) : { dismissed: true }; }));
    if (url.pathname === '/api/demo') return json(res, startJob(async j => {
      const sample = path.join(CACHE, 'ejemplo.mp4');
      try { await fs.access(sample); } catch {
        j.message = 'Generando video de prueba con pausas…';
        const part = path.join(CACHE, `demo-${j.id}.mp4`);
        try {
          await run('ffmpeg', ['-hide_banner', '-nostdin', '-n', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=8', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=8', '-af', "volume=0:enable='between(t,2,3)+between(t,5,6)'", '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', part], j);
          await fs.rename(part, sample);
        } finally { await fs.rm(part, { force: true }); }
      }
      return importFile(sample, j);
    }));
    if (url.pathname === '/api/open') return json(res, startJob(async j => {
      const file = await dialog('open',j); if (!file) return { dismissed: true };
      const stat = await fs.stat(file); if (stat.size > 8_000_000) throw new Error('Proyecto demasiado grande.');
      const saved = JSON.parse(await fs.readFile(file, 'utf8'));
      if (![1,2].includes(saved.version) || typeof saved.source !== 'string' || !path.isAbsolute(saved.source)) throw new Error('Proyecto inválido.');
      return importFile(saved.source, j, saved);
    }));
    if (url.pathname === '/api/restore') return json(res,startJob(async j=>{
      const saved=JSON.parse(await fs.readFile(path.join(CACHE,'draft.leovideo'),'utf8').catch(()=>{throw new Error('No hay una recuperación guardada.');}));
      return importFile(saved.source,j,saved);
    }));
    if (!media) throw new Error('Primero importá un video.');
    if (url.pathname === '/api/proxy') return json(res, startJob(async j => { preview = await proxyFor(media, j); return { proxied: true, previewUrl: `/media/preview?t=${token}&v=${j.id}` }; }));
    if (url.pathname === '/api/draft') {
      project=validateProject(body.project,media);
      const tmp=path.join(CACHE,'draft.tmp'); await fs.writeFile(tmp,JSON.stringify(project)); await fs.rename(tmp,path.join(CACHE,'draft.leovideo'));
      return json(res,{ok:true});
    }
    if (url.pathname === '/api/transcribe') {
      validateProject(body.project,media);
      return json(res,startJob(async j=>{
        const c=ai.config();
        if(!c.key||c.transcribe==='local')return {captions:await transcribe(media,CACHE,j,run),engine:'local'};
        try {return {captions:await ai.transcribeOpenAI(media,CACHE,j,run,c),engine:'openai'};}
        catch(e) {
          // Sin conexión o con un error de OpenAI, el trabajo sigue con Whisper local.
          if(j.cancelled)throw e;
          j.progress=0;const captions=await transcribe(media,CACHE,j,run);
          return {captions,engine:'local',notice:e.message};
        }
      }));
    }
    if (url.pathname === '/api/analyze') {
      const p=validateProject(body.project,media);
      return json(res,startJob(async j=>({proposals:await ai.analyze(p.captions,media.duration,j)})));
    }
    if (url.pathname === '/api/apply-cuts') {
      const next = validateProject(body.project, media);
      if (!Array.isArray(body.cuts) || body.cuts.length > 2000 || !body.cuts.every(s => Number.isFinite(s.start) && Number.isFinite(s.end) && s.start >= 0 && s.end <= media.duration + 0.1 && s.end > s.start)) throw new Error('Cortes inválidos.');
      return json(res, { clips: removeSilences(next.clips, body.cuts, media.duration, 0) });
    }
    if (url.pathname === '/api/srt') {
      const p=validateProject(body.project,media), dest=await dialog('srt');
      if(!dest)return json(res,{dismissed:true});
      if(path.extname(dest).toLowerCase()!=='.srt'||path.resolve(dest).toLowerCase()===media.path.toLowerCase())throw new Error('Elegí un archivo .srt.');
      await fs.writeFile(dest,srt(p),'utf8'); return json(res,{path:dest});
    }
    if (url.pathname === '/api/final-preview') {
      const p=validateProject(body.project,media);
      return json(res,startJob(async j=>{
        const file=path.join(CACHE,`final-${j.id}.mp4`);
        try {await exportVideo(media,p,file,j,{maxSide:720});} catch(e) {await fs.rm(file,{force:true});throw e;}
        const old=finalPreview; finalPreview=file; if(old)await fs.rm(old,{force:true}).catch(()=>{});
        return {finalUrl:`/media/final?t=${token}&v=${j.id}`};
      }));
    }
    if (url.pathname === '/api/save') {
      const next = validateProject(body.project, media), dest = await dialog('save');
      if (!dest) return json(res, { dismissed: true });
      if (path.resolve(dest).toLowerCase() === media.path.toLowerCase()) throw new Error('No se puede sobrescribir el original.');
      if (path.extname(dest).toLowerCase() !== '.leovideo') throw new Error('Usá la extensión .leovideo.');
      // Write to a sibling file first: a failed write must not corrupt a saved project.
      const temp = `${dest}.${crypto.randomUUID()}.tmp`;
      try { await fs.writeFile(temp, JSON.stringify(next, null, 2), { flag: 'wx' }); await fs.rename(temp, dest); } finally { await fs.rm(temp, { force: true }); }
      project = next; return json(res, { path: dest });
    }
    if (url.pathname === '/api/silences') {
      validateProject(body.project, media);
      return json(res, startJob(async j => ({ silences: await detectSilences(media, body.threshold, body.minimum, j) })));
    }
    if (url.pathname === '/api/apply-silences') {
      const next = validateProject(body.project, media);
      if (!Array.isArray(body.silences) || body.silences.length > 10000 || !body.silences.every(s => Number.isFinite(s.start) && Number.isFinite(s.end) && s.start >= 0 && s.end <= media.duration + 0.1 && s.end > s.start)) throw new Error('Detección inválida.');
      return json(res, { clips: removeSilences(next.clips, body.silences, media.duration) });
    }
    if (url.pathname === '/api/export') {
      const next = validateProject(body.project, media);
      return json(res, startJob(async j => { const dest = await dialog('export',j); return dest ? { exported: await exportVideo(media, next, dest, j) } : { dismissed: true }; }));
    }
    return json(res, { error: 'Ruta inexistente.' }, 404);
  }
  if (['/media/preview','/media/final'].includes(url.pathname)) {
    const servingFile=url.pathname==='/media/final'?finalPreview:preview;
    if (url.searchParams.get('t') !== token || !servingFile) return json(res, { error: 'Acceso no autorizado.' }, 403);
    const stat = await fs.stat(servingFile), range = req.headers.range;
    let start = 0, end = stat.size - 1, status = 200;
    if (range) {
      const m = range.match(/^bytes=(\d+)-(\d*)$/);
      if (!m) { res.writeHead(416); return res.end(); }
      start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), end) : end; status = 206;
      if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
    }
    const headers = { 'Content-Type': 'video/mp4', 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
    if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
    res.writeHead(status, headers);
    const stream = createReadStream(servingFile, { start, end }); stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res); return;
  }
  const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/creative.js':['creative.js','text/javascript'], '/ai.js':['ai.js','text/javascript'], '/creative.css':['creative.css','text/css'] };
  const item = files[url.pathname];
  if (!item) { res.writeHead(404); return res.end(); }
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; media-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  res.writeHead(200, { 'Content-Type': `${item[1]}; charset=utf-8`, 'Cache-Control': 'no-store' }); res.end(await fs.readFile(path.join(ROOT, 'ui', item[0])));
}
async function main() {
  await fs.mkdir(CACHE, { recursive: true });
  const server = http.createServer((req, res) => handle(req, res).catch(e => { if (!res.headersSent) json(res, { error: e.message }, 400); else res.destroy(); }));
  server.requestTimeout = 0;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  const url = `${origin}/#${token}`;
  await fs.writeFile(path.join(CACHE, 'session.json'), JSON.stringify({ url, pid: process.pid }));
  console.log(`Leo Video disponible en ${origin}`);
  if (process.argv.includes('--desktop')) {
    const candidates = [path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')];
    let browser;
    for (const c of candidates) { try { await fs.access(c); browser = c; break; } catch {} }
    if (!browser) throw new Error('Instalá Chrome o Edge para abrir la ventana del editor.');
    const child = spawn(browser, [`--app=${url}`, `--user-data-dir=${path.join(CACHE, 'browser')}`, '--no-first-run', '--no-default-browser-check'], { detached: true, stdio: 'ignore', windowsHide: false });
    child.unref();
  }
}
main().catch(e => { console.error(e.message); process.exit(1); });
