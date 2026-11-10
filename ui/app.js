'use strict';
const $ = id => document.getElementById(id), video = $('video');
let token = location.hash.slice(1);
if (token) sessionStorage.setItem('leo-token', token);
token ||= sessionStorage.getItem('leo-token');
history.replaceState(null, '', '/');
let media = null, project = null, selected = 0, active = 0, undoStack = [], busy = false, silences = [], dirty = false, proxyTried = false, pendingSeek = 0;
const time = n => { n = Math.max(0, n || 0); return `${String(Math.floor(n / 60)).padStart(2, '0')}:${(n % 60).toFixed(2).padStart(5, '0')}`; };
const total = () => project?.clips.reduce((n, c) => n + c.end - c.start, 0) || 0;
const offsetOf = i => project.clips.slice(0, i).reduce((n, c) => n + c.end - c.start, 0);
const position = () => project ? offsetOf(active) + Math.max(0, Math.min(project.clips[active].end - project.clips[active].start, video.currentTime - project.clips[active].start)) : 0;
function status(message, error = false) { $('status').textContent = message; document.querySelector('.statusbar').classList.toggle('error', error); }
async function api(route, data) {
  const res = await fetch(`/api/${route}`, { method: data === undefined ? 'GET' : 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
  const result = await res.json(); if (!res.ok) throw new Error(result.error || 'No se pudo completar la operación.'); return result;
}
function listen(id, fn) { $(id).addEventListener('click', () => Promise.resolve().then(fn).catch(e => status(e.message, true))); }
function controls() {
  document.querySelectorAll('[data-edit]').forEach(el => el.disabled = !project || busy);
  for (const id of ['import', 'open', 'import-empty', 'demo','restore']) $(id).disabled = busy;
  $('undo').disabled = !project || !undoStack.length || busy;
  $('remove').disabled = !project || project.clips.length < 2 || busy;
  $('earlier').disabled = !project || selected === 0 || busy;
  $('later').disabled = !project || selected === project.clips.length - 1 || busy;
  $('detect').disabled = !media?.audio || busy;
  $('transcribe').disabled = !media?.audio || busy;
}
function remember() { undoStack.push(structuredClone(project)); if (undoStack.length > 100) undoStack.shift(); dirty = true; if(typeof scheduleDraft==='function')scheduleDraft(); }
function resizeFrame() {
  if (!media) return;
  const ratios = { original: media.width / media.height, vertical: 9/16, horizontal: 16/9, square: 1, portrait: 4/5,custom:project.width/project.height };
  const ratio = ratios[project.format], stage = $('stage');
  const w = Math.min(stage.clientWidth - 30, (stage.clientHeight - 24) * ratio);
  $('video-frame').style.width = `${Math.max(1,w)}px`; $('video-frame').style.height = `${Math.max(1,w/ratio)}px`;
}
function render() {
  const ready = !!project;
  $('empty-state').hidden = ready; $('video-frame').hidden = !ready;
  if (!ready) { controls(); return; }
  selected = Math.min(selected, project.clips.length - 1); active = Math.min(active, project.clips.length - 1);
  $('media-name').textContent = media.name;
  $('media-info').textContent = `${media.width} × ${media.height} · ${media.codec.toUpperCase()}\n${time(media.duration)} · ${(media.fingerprint.size/1024/1024).toFixed(1)} MB\n${media.audio ? 'Con audio' : 'Sin pista de audio'}`;
  $('project-title').textContent = media.name;
  $('format').value = project.format;
  $('total-time').textContent = `/ ${time(total())}`; $('clip-count').textContent = `${project.clips.length} clips`;
  $('scrub').max = total();
  const saved = media.duration - total(); $('duration-saved').textContent = saved >= 0 ? `${time(saved)} recortados` : `${time(-saved)} añadidos`;
  const list = $('clips'); list.replaceChildren();
  project.clips.forEach((c,i) => {
    const b = document.createElement('button'); b.className = `clip ${i === selected ? 'selected' : ''}`;
    b.style.flexGrow = c.end - c.start; b.style.flexBasis = '0';
    b.title = `Clip ${i + 1}: ${time(c.start)} a ${time(c.end)} del original`;
    const name = document.createElement('strong'); name.textContent = `CLIP ${String(i+1).padStart(2,'0')}`;
    const duration = document.createElement('small'); duration.textContent = time(c.end-c.start); b.append(name,duration);
    b.addEventListener('click', () => { video.pause(); selected = i; seek(offsetOf(i)); render(); }); list.append(b);
  });
  $('ruler').replaceChildren(); for (let i = 0; i <= 4; i++) { const s = document.createElement('span'); s.textContent = time(total()*i/4); $('ruler').append(s); }
  const c = project.clips[selected]; $('trim-start').value = c.start.toFixed(2); $('trim-end').value = c.end.toFixed(2);
  $('trim-start').max = media.duration; $('trim-end').max = media.duration;
  if(typeof renderCreative==='function')renderCreative();
  resizeFrame(); controls(); updateTime();
}
function seek(t) {
  if (!project) return;
  t = Math.min(Math.max(0,t), total()); let offset = 0;
  for (let i = 0; i < project.clips.length; i++) {
    const c = project.clips[i], length = c.end - c.start;
    if (t < offset + length || i === project.clips.length - 1) { active = i; video.currentTime = Math.min(c.end - 0.001, c.start + t - offset); break; } offset += length;
  }
  updateTime();
}
function updateTime() { if (project) { $('play-time').textContent = time(position()); $('scrub').value = position(); } }
function advance() {
  if (!project || video.paused) return;
  const c = project.clips[active];
  if (video.currentTime >= c.end - 0.012) {
    if (active + 1 < project.clips.length) { active++; video.currentTime = project.clips[active].start; }
    else { video.pause(); video.currentTime = c.end - 0.001; }
  }
  updateTime();
}
function tick() { advance(); requestAnimationFrame(tick); } tick();
video.addEventListener('ended', () => {
  if (project && active + 1 < project.clips.length) { active++; video.currentTime = project.clips[active].start; video.play().catch(e => status(e.message, true)); }
});
video.addEventListener('play', () => $('play').textContent = 'Pausar'); video.addEventListener('pause', () => $('play').textContent = 'Reproducir');
video.addEventListener('timeupdate', () => { advance(); updateTime(); });
video.addEventListener('error', () => {
  // El original se reproduce sin convertir; si este equipo no puede, se genera la copia liviana una sola vez.
  if (media?.direct && !proxyTried && !busy) { proxyTried = true; status('Este video necesita una vista previa liviana. Generándola…'); operation('proxy', {}).catch(e => status(e.message, true)); }
  else status('No se pudo reproducir la vista previa. Volvé a importar el video.', true);
});
video.addEventListener('loadedmetadata', () => { seek(pendingSeek); pendingSeek = 0; resizeFrame(); });
new ResizeObserver(resizeFrame).observe($('stage'));
function changed(message, target = 0) { video.pause(); render(); seek(target); status(message); }
function silenceList() {
  $('silences').replaceChildren();
  silences.forEach((s,i) => {
    const label = document.createElement('label'), input = document.createElement('input'); input.type = 'checkbox'; input.checked = true; input.dataset.index = i;
    const span = document.createElement('span'); span.textContent = `${time(s.start)} → ${time(s.end)}`; label.append(input,span); label.title = 'Seleccioná la pausa para cortarla'; $('silences').append(label);
    span.addEventListener('click', e => { e.preventDefault(); video.pause(); const index = project.clips.findIndex(c => s.start >= c.start && s.start < c.end); if (index >= 0) seek(offsetOf(index)+s.start-project.clips[index].start); });
  });
  $('apply-silences').hidden = !silences.length;
}
async function operation(route, data = {}) {
  busy = true; video.pause(); controls(); $('job-overlay').hidden = false; $('job-progress').value = 0; $('job-message').textContent = 'Preparando…'; $('job-percent').textContent = '0 %'; $('cancel').disabled = false;
  try {
    await api(route, data);
    while (true) {
      const j = await api('job'); $('job-message').textContent = j.message; $('job-progress').value = j.progress; $('job-percent').textContent = `${Math.round(j.progress*100)} %`;
      if (j.state === 'error' || j.state === 'cancelled') throw new Error(j.error || 'Operación cancelada.');
      if (j.state === 'done') {
        const r = j.result;
        if (r?.dismissed) return status('Operación cerrada sin cambios.');
        if (r?.media) {
          media = r.media; project = r.project; selected = active = 0; undoStack = []; silences = []; dirty = false; proxyTried = false; pendingSeek = 0;
          video.src = r.previewUrl; silenceList(); render(); status('Video listo. La exportación usará el original.');
        }
        if (r?.proxied) { pendingSeek = position(); video.src = r.previewUrl; status('Vista previa liviana lista.'); }
        if (r?.silences) { silences = r.silences; silenceList(); status(`${silences.length} pausas detectadas. Revisá las seleccionadas antes de aplicar.`); }
        if(r?.captions) { remember();project.captions=r.captions;render();status(`${r.captions.length} palabras o segmentos generados. Revisalos antes de exportar.`); }
        if(r?.finalUrl) { $('final-video').src=r.finalUrl;$('final-dialog').showModal();status('Resultado calculado. Revisá el efecto antes de exportar.'); }
        if (r?.exported) status(`MP4 verificado: ${r.exported.path} · ${time(r.exported.duration)}`);
        return r;
      }
      await new Promise(resolve => setTimeout(resolve, 450));
    }
  } finally { busy = false; $('job-overlay').hidden = true; controls(); }
}
async function canReplace() { return !dirty || confirm('Hay cambios sin guardar. ¿Querés descartarlos para abrir otro video o proyecto?'); }
for (const id of ['import','import-empty']) listen(id, async () => { if (await canReplace()) await operation('import'); });
listen('demo', async () => { if (await canReplace()) await operation('demo'); });
listen('open', async () => { if (await canReplace()) await operation('open'); });
listen('save', async () => { busy=true;controls();try{const r = await api('save', {project}); if (r.path) { dirty = false; status(`Proyecto guardado: ${r.path}`); }}finally{busy=false;controls();} });
listen('export', () => operation('export', {project}));
listen('detect', () => operation('silences', { project, threshold: Number($('threshold').value), minimum: Number($('minimum').value) }));
listen('cancel', async () => { $('cancel').disabled = true; $('job-message').textContent = 'Cancelando…'; await api('cancel', {}); });
listen('apply-silences', async () => {
  const chosen = [...$('silences').querySelectorAll('input:checked')].map(input => silences[Number(input.dataset.index)]);
  if (!chosen.length) throw new Error('Seleccioná al menos una pausa.');
  const result = await api('apply-silences', { project, silences: chosen }); remember(); project.clips = result.clips;
  silences = []; silenceList(); changed('Pausas recortadas. Podés deshacer el resultado.');
});
listen('undo', () => { if (!undoStack.length) return; project = undoStack.pop(); dirty = true; scheduleDraft();changed('Último cambio deshecho.'); });
listen('split', () => {
  const c = project.clips[active], at = video.currentTime;
  if (at-c.start < 0.08 || c.end-at < 0.08) throw new Error('Mové el cursor al interior del clip, lejos de sus extremos.');
  if (project.clips.length >= 300) throw new Error('Límite de 300 clips alcanzado.');
  const pos = position(); remember(); project.clips.splice(active,1,{ start:c.start,end:at },{ start:at,end:c.end }); selected = active+1; changed('Clip dividido en el cursor.',pos);
});
listen('remove', () => { if (project.clips.length < 2) return; remember(); project.clips.splice(selected,1); changed('Clip eliminado del montaje.'); });
listen('trim', () => {
  const start = Number($('trim-start').value), end = Number($('trim-end').value);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > media.duration || end-start < 0.08) throw new Error('El recorte debe durar al menos 0,08 s y estar dentro del original.');
  remember(); project.clips[selected] = { start,end }; changed('Recorte ajustado.',offsetOf(selected));
});
for (const [id,delta] of [['earlier',-1],['later',1]]) listen(id, () => { const target = selected+delta; if (target<0 || target>=project.clips.length) return; remember(); [project.clips[selected],project.clips[target]] = [project.clips[target],project.clips[selected]]; selected = target; changed('Orden de clips actualizado.',offsetOf(selected)); });
$('format').addEventListener('change', () => { remember(); project.format = $('format').value; render(); status('Formato de salida actualizado.'); });
$('threshold').addEventListener('input', () => $('threshold-value').textContent = `${$('threshold').value} dB`);
$('scrub').addEventListener('input', () => { video.pause(); seek(Number($('scrub').value)); });
listen('play', async () => { if (video.paused) { if (position() >= total()-0.05) seek(0); await video.play(); } else video.pause(); });
listen('back', () => { video.pause(); seek(0); });
listen('quit', async () => { if (dirty && !confirm('Hay cambios sin guardar. ¿Cerrar el editor de todas formas?')) return; await api('quit', {}); status('Motor detenido. Podés cerrar esta ventana.'); document.querySelectorAll('button,input,select').forEach(el => el.disabled = true); });
document.addEventListener('keydown', e => {
  if (['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName) || busy || !project) return;
  if (e.code === 'Space') { e.preventDefault(); $('play').click(); }
  if (e.key.toLowerCase() === 's' && !e.ctrlKey) $('split').click();
  if (e.key.toLowerCase() === 'z' && e.ctrlKey) { e.preventDefault(); $('undo').click(); }
  if (e.key.toLowerCase() === 's' && e.ctrlKey) { e.preventDefault(); $('save').click(); }
});
window.addEventListener('beforeunload', e => { if (dirty || busy) { e.preventDefault(); e.returnValue = ''; } });
controls();
