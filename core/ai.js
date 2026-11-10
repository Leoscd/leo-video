'use strict';
// Capa de IA con la API de OpenAI. El motor sigue siendo local: a OpenAI solo viajan
// el audio comprimido (transcripción) y el texto de la transcripción (análisis).
const fs = require('node:fs/promises');
const path = require('node:path');
const { readFileSync } = require('node:fs');

function loadEnv(root) {
  let text;
  try { text = readFileSync(path.join(root, '.env'), 'utf8'); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
function config(env = process.env) {
  return {
    key: (env.OPENAI_API_KEY || '').trim(),
    base: (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    model: env.OPENAI_MODEL || 'gpt-6.1-sol',
    transcribeModel: env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1',
    transcribe: env.LEO_TRANSCRIBE === 'local' ? 'local' : 'openai'
  };
}
async function request(cfg, route, init, job) {
  if (!cfg.key) throw new Error('Falta OPENAI_API_KEY. Copiá .env.example como .env y pegá tu clave.');
  const controller = new AbortController();
  job.abort = () => controller.abort();
  try {
    const res = await fetch(cfg.base + route, { ...init, headers: { Authorization: `Bearer ${cfg.key}`, ...init.headers }, signal: controller.signal });
    const text = await res.text();
    let data = null; try { data = JSON.parse(text); } catch {}
    if (!res.ok) throw new Error(`OpenAI respondió ${res.status}: ${data?.error?.message || text.slice(0, 200)}`);
    if (!data) throw new Error('OpenAI devolvió una respuesta ilegible.');
    return data;
  } catch (e) {
    if (job.cancelled) throw new Error('Operación cancelada.');
    if (e.name === 'TypeError') throw new Error('No se pudo conectar con OpenAI. Revisá la conexión a internet.');
    throw e;
  } finally { job.abort = null; }
}

function wordsFrom(data, duration) {
  if (!Array.isArray(data.words) || !data.words.length) throw new Error('OpenAI no devolvió palabras con tiempos.');
  return data.words
    .map(w => ({ start: Number(w.start), end: Number(w.end), text: String(w.word || '').trim().slice(0, 500) }))
    .filter(w => w.text && Number.isFinite(w.start) && w.start >= 0 && w.start < duration)
    .map(w => ({ start: w.start, end: Math.min(duration, Math.max(Number.isFinite(w.end) ? w.end : 0, w.start + 0.05)), text: w.text }))
    .filter(w => w.end > w.start);
}
async function transcribeOpenAI(media, folder, job, run, cfg = config(), language = 'es') {
  if (!media.audio) throw new Error('Este video no tiene audio.');
  const dir = await fs.mkdtemp(path.join(folder, 'transcript-'));
  try {
    const audio = path.join(dir, 'audio.mp3');
    job.message = 'Preparando el audio…';
    // Voz en mono a 32 kbps: unos 0,25 MB por minuto. Sube en segundos.
    await run('ffmpeg', ['-v', 'error', '-nostdin', '-n', '-i', media.path, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '32k', audio], job);
    const bytes = await fs.readFile(audio);
    if (bytes.length > 24 * 1024 * 1024) throw new Error('El audio supera el límite de subida de OpenAI (unos 100 minutos).');
    job.message = `Transcribiendo con OpenAI (${(bytes.length / 1024 / 1024).toFixed(1)} MB de audio)…`; job.progress = 0.3;
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: 'audio/mpeg' }), 'audio.mp3');
    form.append('model', cfg.transcribeModel);
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
    if (language !== 'auto') form.append('language', language);
    return wordsFrom(await request(cfg, '/audio/transcriptions', { method: 'POST', body: form }, job), media.duration);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

const range = extra => ({ type: 'object', additionalProperties: false, required: ['from', 'to', extra], properties: { from: { type: 'integer' }, to: { type: 'integer' }, [extra]: { type: 'string' } } });
const SCHEMA = { type: 'object', additionalProperties: false, required: ['cuts', 'highlights', 'zooms'],
  properties: { cuts: { type: 'array', items: range('reason') }, highlights: { type: 'array', items: range('text') }, zooms: { type: 'array', items: range('reason') } } };
const INSTRUCTIONS = `Sos el asistente de edición de un creador que graba videos hablando a cámara en español.
Recibís la transcripción con cada palabra numerada así: [12]palabra. El símbolo ‖ marca una pausa larga.
Devolvé propuestas usando SOLO esos números (from y to son inclusivos). No inventes números ni texto.

cuts — tramos a eliminar:
- Tomas repetidas: cuando la persona dice una frase, se traba o la reformula y la vuelve a decir, eliminá los intentos anteriores y conservá el ÚLTIMO intento completo.
- Arranques en falso, frases que quedan cortadas y se abandonan, y muletillas largas ("eh…", "bueno, a ver…").
- Nunca cortes contenido que aparece una sola vez. Lo que queda debe leerse como una frase natural y completa.
- reason: explicación breve en español (por ejemplo "repite la frase siguiente").

highlights — palabras o frases clave para mostrar como texto grande en pantalla:
- De 1 a 4 palabras consecutivas tal como se dicen: cifras, conceptos, beneficios, nombres de herramientas.
- Como máximo una cada 8 segundos de habla aproximadamente, y nunca dentro de un tramo que propongas cortar.
- text: el texto a mostrar, en mayúsculas, sin puntuación final.

zooms — momentos de énfasis para acercar la cámara:
- La idea más importante, una afirmación fuerte, una pregunta al espectador o el remate. Entre 4 y 12 palabras cada uno.
- Pocos y espaciados (como máximo uno cada 15 segundos aproximadamente), sin superponerse y nunca dentro de un corte.
- reason: explicación breve en español.

Si no hay nada que proponer en una categoría, devolvé una lista vacía.`;

function numbered(words, offset) {
  return words.map((w, i) => `${i && w.start - words[i - 1].end > 0.7 ? '‖ ' : ''}[${i + offset}]${w.text}`).join(' ');
}
// Convierte índices de palabras en tiempos del original y descarta lo inválido.
function toProposals(raw, words, duration) {
  const valid = r => Number.isInteger(r?.from) && Number.isInteger(r?.to) && r.from >= 0 && r.to < words.length && r.from <= r.to;
  const said = r => words.slice(r.from, r.to + 1).map(w => w.text).join(' ').slice(0, 120);
  const out = [], list = v => Array.isArray(v) ? v : [];
  const cuts = list(raw.cuts).filter(valid).filter(r => r.to - r.from < 400).sort((a, b) => a.from - b.from);
  const inCut = r => cuts.some(c => r.from <= c.to && r.to >= c.from);
  for (const r of cuts) {
    // Hasta el inicio de la palabra siguiente: la pausa posterior se va con el corte.
    const start = words[r.from].start, end = r.to + 1 < words.length ? words[r.to + 1].start : Math.min(duration, words[r.to].end);
    if (end - start >= 0.15) out.push({ kind: 'cut', start, end, text: said(r), reason: String(r.reason || '').slice(0, 200) });
  }
  for (const r of list(raw.highlights).filter(valid)) {
    if (inCut(r) || r.to - r.from > 5) continue;
    const text = String(r.text || '').trim().slice(0, 60) || said(r).toUpperCase();
    const start = words[r.from].start, end = Math.min(duration, Math.max(words[r.to].end, start + 1.2));
    if (end - start >= 0.3) out.push({ kind: 'highlight', start, end, text, reason: '' });
  }
  let last = -1;
  for (const r of list(raw.zooms).filter(valid).sort((a, b) => a.from - b.from)) {
    if (inCut(r)) continue;
    const start = words[r.from].start, end = Math.min(duration, Math.max(words[r.to].end, start + 1.5), start + 6);
    if (start < last + 0.2 || end - start < 0.8) continue;
    last = end; out.push({ kind: 'zoom', start, end, text: said(r), reason: String(r.reason || '').slice(0, 200) });
  }
  return out;
}
async function analyze(captions, duration, job, cfg = config()) {
  const words = captions.filter(c => c.text.trim());
  if (!words.length) throw new Error('Primero generá los subtítulos: la IA analiza la transcripción.');
  const CHUNK = 2500, raw = { cuts: [], highlights: [], zooms: [] };
  for (let offset = 0; offset < words.length; offset += CHUNK) {
    job.message = 'Analizando la transcripción con IA…'; job.progress = Math.min(0.95, 0.05 + offset / words.length);
    const data = await request(cfg, '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      model: cfg.model,
      messages: [{ role: 'system', content: INSTRUCTIONS }, { role: 'user', content: numbered(words.slice(offset, offset + CHUNK), offset) }],
      response_format: { type: 'json_schema', json_schema: { name: 'propuestas_de_edicion', strict: true, schema: SCHEMA } }
    }) }, job);
    const message = data.choices?.[0]?.message;
    if (message?.refusal) throw new Error(`La IA no analizó el texto: ${message.refusal}`);
    let part; try { part = JSON.parse(message?.content); } catch { throw new Error('La IA devolvió un análisis ilegible. Probá de nuevo.'); }
    for (const key of Object.keys(raw)) if (Array.isArray(part[key])) raw[key].push(...part[key]);
  }
  return toProposals(raw, words, duration);
}
module.exports = { loadEnv, config, transcribeOpenAI, wordsFrom, analyze, toProposals, numbered };
