'use strict';
// Pruebas de la capa de IA contra un servidor simulado: no usan la clave ni la red real.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { run, probe } = require('../core/media');
const { config, transcribeOpenAI, analyze, toProposals, numbered, wordsFrom } = require('../core/ai');
const dir = path.resolve('test-output');
let server, cfg, calls = [], reply = {};
const words = 'hola a todos hoy vamos a ‖ hoy vamos a ver cómo ahorrar diez horas por semana con inteligencia artificial'.split(' ').filter(w => w !== '‖')
  .map((text, i) => ({ start: i * 0.5 + (i >= 6 ? 1 : 0), end: i * 0.5 + 0.4 + (i >= 6 ? 1 : 0), text }));

before(async () => {
  await fs.mkdir(dir, { recursive: true });
  server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    calls.push({ url: req.url, auth: req.headers.authorization, type: req.headers['content-type'], body });
    const r = reply[req.url] || { status: 404, json: { error: { message: 'ruta' } } };
    res.writeHead(r.status || 200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(r.json));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  cfg = { ...config({ OPENAI_API_KEY: 'clave-de-prueba', OPENAI_BASE_URL: `http://127.0.0.1:${server.address().port}/v1` }) };
});
after(() => server.close());

test('configuración: valores por defecto y transcripción local opcional', () => {
  const c = config({});
  assert.equal(c.key, ''); assert.equal(c.base, 'https://api.openai.com/v1'); assert.equal(c.transcribeModel, 'whisper-1'); assert.equal(c.transcribe, 'openai');
  assert.equal(config({ LEO_TRANSCRIBE: 'local' }).transcribe, 'local');
});
test('sin clave no se llama a OpenAI', async () => {
  await assert.rejects(analyze(words, 20, {}, config({})), /OPENAI_API_KEY/);
});
test('transcribe: sube audio comprimido y conserva tiempos por palabra', async () => {
  const video = path.join(dir, `ia-${crypto.randomUUID()}.mp4`);
  await run('ffmpeg', ['-v', 'error', '-nostdin', '-n', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=500:sample_rate=48000:duration=4', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video]);
  const media = await probe(video);
  reply['/v1/audio/transcriptions'] = { json: { text: 'hola mundo', words: [{ word: 'hola', start: 0.2, end: 0.6 }, { word: ' mundo', start: 0.7, end: 0.7 }, { word: 'fuera', start: 99, end: 100 }] } };
  calls = [];
  const job = {}, result = await transcribeOpenAI(media, dir, job, run, cfg);
  assert.deepEqual(result.map(w => w.text), ['hola', 'mundo']);
  assert.equal(result[0].start, 0.2); assert.ok(result[1].end > result[1].start);
  assert.equal(calls[0].auth, 'Bearer clave-de-prueba'); assert.match(calls[0].type, /multipart\/form-data/);
  const sent = calls[0].body.toString('latin1');
  assert.match(sent, /name="model"\r\n\r\nwhisper-1/); assert.match(sent, /name="timestamp_granularities\[\]"\r\n\r\nword/); assert.match(sent, /name="response_format"\r\n\r\nverbose_json/); assert.match(sent, /filename="audio\.mp3"/);
  assert.ok(calls[0].body.length < 200_000, 'el audio de 4 s debe pesar muy poco');
  assert.equal((await fs.readdir(dir)).filter(n => n.startsWith('transcript-')).length, 0, 'no quedan temporales');
  await fs.rm(video, { force: true });
});
test('transcribe: error de OpenAI y respuesta sin palabras se informan', async () => {
  assert.throws(() => wordsFrom({ text: 'x' }, 10), /palabras con tiempos/);
  reply['/v1/chat/completions'] = { status: 401, json: { error: { message: 'Incorrect API key' } } };
  await assert.rejects(analyze(words, 20, {}, cfg), /401.*Incorrect API key/);
});
test('analyze: envía palabras numeradas y convierte índices en tiempos', async () => {
  reply['/v1/chat/completions'] = { json: { choices: [{ message: { content: JSON.stringify({
    cuts: [{ from: 3, to: 5, reason: 'repite la frase siguiente' }, { from: 50, to: 60, reason: 'fuera de rango' }],
    highlights: [{ from: 12, to: 13, text: 'DIEZ HORAS' }, { from: 4, to: 4, text: 'DENTRO DE CORTE' }],
    zooms: [{ from: 10, to: 16, reason: 'promesa principal' }, { from: 11, to: 15, reason: 'superpuesto' }] }) } }] } };
  calls = [];
  const job = {}, list = await analyze(words, 20, job, cfg);
  const sent = JSON.parse(calls[0].body.toString('utf8'));
  assert.equal(sent.response_format.json_schema.strict, true); assert.equal(sent.model, cfg.model);
  assert.match(sent.messages[1].content, /^\[0\]hola \[1\]a/); assert.match(sent.messages[1].content, /‖ \[6\]hoy/);
  const cut = list.filter(p => p.kind === 'cut'), hi = list.filter(p => p.kind === 'highlight'), zoom = list.filter(p => p.kind === 'zoom');
  assert.equal(cut.length, 1); assert.equal(cut[0].start, words[3].start); assert.equal(cut[0].end, words[6].start); assert.equal(cut[0].text, 'hoy vamos a');
  assert.equal(hi.length, 1); assert.equal(hi[0].text, 'DIEZ HORAS'); assert.ok(hi[0].end - hi[0].start > 1.19);
  assert.equal(zoom.length, 1); assert.equal(zoom[0].start, words[10].start);
});
test('toProposals descarta datos corruptos sin fallar', () => {
  assert.deepEqual(toProposals({ cuts: [{ from: 'a', to: 2 }, { from: 5, to: 2 }, null], highlights: 'x', zooms: undefined }, words, 20).length, 0);
  assert.equal(numbered(words.slice(0, 2), 7), '[7]hola [8]a');
});
