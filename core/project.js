'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

const FORMATS = { original: null, vertical: [1080, 1920], horizontal: [1920, 1080], square: [1080, 1080], portrait: [1080, 1350], custom: null };
const number = (v, fallback, min, max) => {
  const n = v === undefined ? fallback : v;
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`Valor fuera de rango: ${min} a ${max}.`);
  return n;
};
function interval(c, duration, minimum = 0.04) {
  const start = number(c.start, 0, 0, duration), end = number(c.end, duration, 0, duration + 0.02);
  if (end - start + 1e-9 < minimum) throw new Error('El intervalo es demasiado corto.');
  return { start, end: Math.min(duration, end) };
}
function enumValue(v, fallback, list) { v ??= fallback; if (!list.includes(v)) throw new Error('Opción de proyecto inválida.'); return v; }
function textValue(v, limit) { if (typeof v !== 'string' || v.length > limit) throw new Error('Texto inválido o demasiado largo.'); return v; }
function validateClips(clips, duration) {
  if (!Array.isArray(clips) || !clips.length || clips.length > 300) throw new Error('El proyecto debe tener entre 1 y 300 clips.');
  return clips.map(c => {
    if (!Number.isFinite(c.start) || !Number.isFinite(c.end) || c.start < 0 || c.end > duration + 0.02 || c.end - c.start < 0.08) throw new Error('Hay un corte fuera del video o demasiado corto (mínimo 0,08 s).');
    return { start: c.start, end: Math.min(c.end, duration) };
  });
}
function validateProject(p, media) {
  if (![1, 2].includes(p?.version) || !Object.hasOwn(FORMATS, p.format)) throw new Error('Proyecto incompatible.');
  if (p.source !== undefined && (typeof p.source !== 'string' || path.resolve(p.source).toLowerCase() !== media.path.toLowerCase())) throw new Error('El video activo cambió en otra ventana. Volvé a abrir este proyecto.');
  if (p.fingerprint && (p.fingerprint.size !== media.fingerprint.size || Math.abs(p.fingerprint.mtimeMs - media.fingerprint.mtimeMs) > 1)) throw new Error('El proyecto corresponde a otra versión del original.');
  const cues = p.captions || [], fx = p.effects || [];
  if (!Array.isArray(cues) || cues.length > 20000 || !Array.isArray(fx) || fx.length > 200) throw new Error('Demasiados subtítulos o efectos.');
  const effects = fx.map(e => ({ ...interval(e, media.duration), id: textValue(e.id, 80), type: enumValue(e.type, 'text', ['text','zoom']),
    text: textValue(e.text || '', 300), layer: enumValue(e.layer, 'front', ['front','behind']),
    animation: enumValue(e.animation, 'fade', ['none','fade','pop','slide']),
    x: number(e.x, 0.5, 0.05, 0.95), y: number(e.y, 0.4, 0.05, 0.95), size: number(e.size, 0.09, 0.015, 0.3),
    color: /^#[a-fA-F0-9]{6}$/.test(e.color || '') ? e.color : '#FFFFFF',
    zoom: number(e.zoom, 1.2, 1, 2.5), tilt: number(e.tilt, 0, -0.12, 0.12) }));
  const zooms = effects.filter(e=>e.type==='zoom').sort((a,b)=>a.start-b.start);
  for (let i=1;i<zooms.length;i++) if (zooms[i].start < zooms[i-1].end) throw new Error('Los tramos de zoom no pueden superponerse.');
  const out = { version: 2, source: media.path, fingerprint: media.fingerprint, format: p.format, clips: validateClips(p.clips, media.duration),
    width: number(p.width, 1080, 128, 7680), height: number(p.height, 1920, 128, 7680),
    fit: enumValue(p.fit, 'contain', ['contain','cover']), panX: number(p.panX,0.5,0,1), panY: number(p.panY,0.5,0,1),
    fps: number(p.fps,30,24,60),
    captionStyle: enumValue(p.captionStyle, 'phrase', ['off','phrase','word','karaoke']),
    captionSize: number(p.captionSize,0.045,0.02,0.12), captionY: number(p.captionY,0.84,0.1,0.92),
    matteThreshold: number(p.matteThreshold,0.45,0.1,0.9), matteFeather: number(p.matteFeather,1.2,0,4),
    captions: cues.map(c=>({...interval(c,media.duration,0.001),text:textValue(c.text,500)})).sort((a,b)=>a.start-b.start), effects };
  if (out.width%2 || out.height%2 || ![24,25,30,50,60].includes(out.fps)) throw new Error('Usá dimensiones pares y 24, 25, 30, 50 o 60 fps.');
  return out;
}
function outputSize(p, media, maxSide) {
  let size = p.format==='custom' ? [p.width,p.height] : FORMATS[p.format] || [Math.ceil(media.width/2)*2,Math.ceil(media.height/2)*2];
  if (maxSide) { const factor = Math.min(1,maxSide/Math.max(...size)); size=size.map(n=>Math.max(2,Math.round(n*factor/2)*2)); }
  return size;
}
function localItems(items, clip) { return items.filter(e=>e.end>clip.start && e.start<clip.end).map(e=>({...e,start:Math.max(0,e.start-clip.start),end:Math.min(clip.end,e.end)-clip.start})); }
function durationOf(clips) { return clips.reduce((n, c) => n + c.end - c.start, 0); }
function removeSilences(clips, silences, duration, margin = 0.12) {
  let kept = clips.map(c => ({ ...c }));
  for (const s of silences) {
    const a = Math.max(0, s.start + (s.start > 0 ? margin : 0));
    const b = Math.min(duration, s.end - (s.end < duration ? margin : 0));
    if (b <= a) continue;
    kept = kept.flatMap(c => b <= c.start || a >= c.end ? [c] : [
      { start: c.start, end: Math.min(a, c.end) },
      { start: Math.max(b, c.start), end: c.end }
    ].filter(x => x.end - x.start >= 0.08));
  }
  if (!kept.length) throw new Error('La detección eliminaría todo el video. Ajustá el umbral antes de aplicar.');
  return validateClips(kept, duration);
}
async function fingerprint(file) { const s = await fs.stat(file); return { size: s.size, mtimeMs: s.mtimeMs }; }
module.exports = { FORMATS, validateClips, validateProject, durationOf, removeSilences, fingerprint, outputSize, localItems };
