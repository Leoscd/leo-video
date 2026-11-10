'use strict';
// Panel de IA: muestra las propuestas del análisis y las aplica al proyecto solo cuando el usuario las aprueba.
let proposals = [];
const AI_GROUPS = [['cut', 'Repeticiones a cortar'], ['highlight', 'Textos a resaltar'], ['zoom', 'Zooms de énfasis']];
function seekOriginal(t) {
  const index = project.clips.findIndex(c => t >= c.start && t < c.end);
  if (index < 0) return status('Ese momento ya no está en el montaje.');
  video.pause(); seek(offsetOf(index) + t - project.clips[index].start);
}
function renderProposals() {
  const box = $('ai-proposals'); box.replaceChildren();
  for (const [kind, title] of AI_GROUPS) {
    const items = proposals.map((p, i) => [p, i]).filter(([p]) => p.kind === kind);
    if (!items.length) continue;
    const heading = document.createElement('h4'); heading.textContent = `${title} · ${items.length}`; box.append(heading);
    const list = document.createElement('div'); list.className = 'silence-list ai-list';
    for (const [p, i] of items) {
      const label = document.createElement('label'), input = document.createElement('input'), span = document.createElement('span');
      input.type = 'checkbox'; input.checked = true; input.dataset.index = i;
      span.textContent = `${time(p.start)} → ${time(p.end)} · ${p.text}`;
      if (p.reason) { const why = document.createElement('small'); why.textContent = p.reason; span.append(why); }
      span.addEventListener('click', e => { e.preventDefault(); seekOriginal(p.start); });
      label.title = 'Clic en el texto para ir a ese momento'; label.append(input, span); list.append(label);
    }
    box.append(list);
  }
  $('ai-apply').hidden = !proposals.length;
}
function showProposals(list) {
  proposals = list; renderProposals();
  status(list.length ? `${list.length} propuestas de la IA. Revisalas antes de aplicar.` : 'La IA no encontró repeticiones ni momentos para resaltar.');
}
listen('ai-analyze', async () => {
  if (!project.captions.length) throw new Error('Primero generá los subtítulos: la IA analiza la transcripción.');
  await operation('analyze', { project });
});
listen('ai-apply', async () => {
  const chosen = [...$('ai-proposals').querySelectorAll('input:checked')].map(input => proposals[Number(input.dataset.index)]);
  if (!chosen.length) throw new Error('Seleccioná al menos una propuesta.');
  const cuts = chosen.filter(p => p.kind === 'cut').map(p => ({ start: p.start, end: p.end }));
  const clips = cuts.length ? (await api('apply-cuts', { project, cuts })).clips : project.clips;
  remember(); project.clips = clips;
  let added = 0, skipped = 0;
  for (const p of chosen.filter(p => p.kind !== 'cut')) {
    const zoom = p.kind === 'zoom';
    if (project.effects.length >= 200 || (zoom && project.effects.some(e => e.type === 'zoom' && e.end > p.start && e.start < p.end))) { skipped++; continue; }
    project.effects.push({ id: crypto.randomUUID(), type: zoom ? 'zoom' : 'text', start: p.start, end: p.end, text: zoom ? '' : p.text, layer: 'front',
      animation: 'pop', color: '#E9B96B', size: 0.1, x: 0.5, y: zoom ? 0.4 : 0.3, zoom: 1.25, tilt: 0 });
    added++;
  }
  proposals = []; renderProposals();
  changed(`Aplicado: ${cuts.length} cortes y ${added} efectos${skipped ? ` (${skipped} omitidos por superposición o límite)` : ''}. Podés deshacer.`);
});
api('ai-status').then(s => {
  $('ai-status').textContent = s.configured
    ? `OpenAI configurado · análisis con ${s.model} · transcripción ${s.transcribe === 'openai' ? 'con OpenAI' : 'local'}.`
    : 'Falta la clave de OpenAI: copiá .env.example como .env en la carpeta de la app, pegá tu clave y reiniciá el editor.';
}).catch(() => {});
