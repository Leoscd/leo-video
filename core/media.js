'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fingerprint, validateProject, durationOf, outputSize, localItems } = require('./project');

function run(exe, args, job = {}, onLine = () => {}, options = {}) {
  return new Promise((resolve, reject) => {
    if (job.cancelled) return reject(new Error('Operación cancelada.'));
    const child = spawn(exe, args, { windowsHide: true, shell: false, cwd: options.cwd });
    job.child = child;
    let output = '', errors = '', pending = '';
    child.stdout.on('data', b => { output += b; if (output.length > 8_000_000) { child.kill(); reject(new Error('Salida del proceso demasiado grande.')); } });
    child.stderr.on('data', b => {
      errors = (errors + b).slice(-2_000_000); pending += b;
      const lines = pending.split(/[\r\n]/); pending = lines.pop(); lines.forEach(onLine);
    });
    child.on('error', e => reject(new Error(e.code === 'ENOENT' ? `No se encontró ${exe}. Instalalo y agregalo al PATH.` : e.message)));
    child.on('close', code => {
      if (job.child === child) job.child = null;
      if (pending) onLine(pending);
      if (job.cancelled) reject(new Error('Operación cancelada.'));
      else if (code !== 0) reject(new Error(errors.slice(-2000) || `${exe} terminó con código ${code}.`));
      else resolve({ output, errors });
    });
  });
}
// Chrome/Edge reproducen H.264 de 8 bits en MP4/MOV sin recodificar. En ese caso la
// edición usa el original directamente y la importación no espera ninguna conversión.
function canPlayDirect(m) {
  return m.codec === 'h264' && !m.hdr && ['yuv420p', 'yuvj420p'].includes(m.pixFmt) && /(^|,)(mp4|mov)(,|$)/.test(m.container || '')
    && (!m.audio || ['aac', 'mp3'].includes(m.audioCodec)) && Math.max(m.width, m.height) <= 4096;
}
async function probe(file, job) {
  const { output } = await run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file], job);
  const p = JSON.parse(output), v = p.streams.find(s => s.codec_type === 'video');
  if (!v || !v.width || !v.height) throw new Error('El archivo no contiene una pista de video válida.');
  const duration = Number(p.format.duration || v.duration);
  if (!Number.isFinite(duration) || duration < 0.08) throw new Error('No se pudo determinar la duración.');
  const rotation = Number(v.side_data_list?.find(s => s.rotation !== undefined)?.rotation || v.tags?.rotate || 0);
  const swapped = Math.abs(rotation) % 180 === 90;
  const a = p.streams.find(s => s.codec_type === 'audio');
  const info = { path: path.resolve(file), name: path.basename(file), duration, width: swapped ? v.height : v.width, height: swapped ? v.width : v.height,
    codec: v.codec_name, fps: v.avg_frame_rate, audio: !!a, hdr: ['smpte2084', 'arib-std-b67'].includes(v.color_transfer),
    pixFmt: v.pix_fmt, container: p.format.format_name, audioCodec: a?.codec_name || null, fingerprint: await fingerprint(file) };
  info.direct = canPlayDirect(info);
  return info;
}
function progressLine(job, offset = 0, span = 1, duration = 1) {
  return line => {
    const m = line.match(/^out_time_us=(\d+)/);
    if (m) job.progress = Math.min(0.99, offset + span * Number(m[1]) / 1e6 / duration);
  };
}
function videoFilter(media, size, p = {}) {
  let filter = '';
  if (media.hdr) filter = 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p,';
  const [w, h] = size;
  if(p.fit==='cover') filter+=`scale=${w}:${h}:force_original_aspect_ratio=increase:force_divisible_by=2,crop=${w}:${h}:(iw-ow)*${p.panX}:(ih-oh)*${p.panY}`;
  else filter+=`scale=${w}:${h}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black`;
  filter += `,setsar=1,fps=${p.fps || 30},format=yuv420p`;
  if(media.hdr)filter+=',setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709';
  return filter;
}
async function makePreview(media, output, job) {
  const ratio = Math.min(1, 1280 / Math.max(media.width, media.height));
  const size = [Math.max(2, Math.round(media.width * ratio / 2) * 2), Math.max(2, Math.round(media.height * ratio / 2) * 2)];
  const vf = videoFilter(media, size);
  job.message = 'Preparando vista previa liviana…';
  await run('ffmpeg', ['-hide_banner', '-nostdin', '-n', '-i', media.path, '-map', '0:v:0', '-map', '0:a:0?', '-vf', vf, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '27', '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', '48000', '-movflags', '+faststart', '-progress', 'pipe:2', output], job, progressLine(job, 0, 1, media.duration));
}
async function detectSilences(media, threshold, minimum, job) {
  if (!media.audio) throw new Error('El video no tiene audio.');
  if (!Number.isFinite(threshold) || threshold < -70 || threshold > -10 || !Number.isFinite(minimum) || minimum < 0.2 || minimum > 5) throw new Error('Parámetros de silencio inválidos.');
  job.message = 'Analizando el audio original…';
  const { errors } = await run('ffmpeg', ['-hide_banner', '-nostdin', '-i', media.path, '-vn', '-af', `silencedetect=noise=${threshold}dB:d=${minimum}`, '-progress', 'pipe:2', '-f', 'null', '-'], job, progressLine(job, 0, 1, media.duration));
  const silences = []; let start = null;
  for (const line of errors.split(/[\r\n]/)) {
    const a = line.match(/silence_start: ([\d.e+-]+)/), b = line.match(/silence_end: ([\d.e+-]+)/);
    if (a) start = Number(a[1]);
    if (b && start !== null) { silences.push({ start, end: Math.min(media.duration, Number(b[1])) }); start = null; }
  }
  if (start !== null) silences.push({ start, end: media.duration });
  return silences;
}
async function exportVideo(media, inputProject, destination, job, options = {}) {
  const p = validateProject(inputProject, media);
  if (path.resolve(destination).toLowerCase() === media.path.toLowerCase()) throw new Error('La exportación no puede reemplazar el video original.');
  if (path.extname(destination).toLowerCase() !== '.mp4') throw new Error('La salida debe tener extensión .mp4.');
  try { await fs.access(destination); throw new Error('Ese archivo ya existe. Elegí otro nombre para conservarlo.'); } catch(e) { if (e.code !== 'ENOENT') throw e; }
  const current = await fingerprint(media.path);
  if (current.size !== media.fingerprint.size || current.mtimeMs !== media.fingerprint.mtimeMs) throw new Error('El video original cambió. Volvé a importarlo.');
  const temp = await fs.mkdtemp(path.join(path.dirname(destination), '.leo-export-'));
  const total = durationOf(p.clips), size = outputSize(p,media,options.maxSide);
  try {
    let offset = 0;
    for (let i = 0; i < p.clips.length; i++) {
      const c = p.clips[i], length = c.end - c.start;
      job.message = `Exportando clip ${i + 1} de ${p.clips.length}…`;
      const hasFx = localItems(p.effects,c).length || (p.captionStyle!=='off'&&localItems(p.captions,c).length);
      const ready=path.join(temp,`clip-${i}.mp4`), base=hasFx?path.join(temp,`base-${i}.mp4`):ready;
      const args = ['-hide_banner', '-nostdin', '-n', '-ss', String(c.start), '-i', media.path, '-t', String(length), '-map', '0:v:0', '-map', '0:a:0?', '-vf', videoFilter(media, size,p), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', hasFx?'16':'20'];
      if (media.audio) args.push('-af', 'asetpts=PTS-STARTPTS,aresample=48000:async=1:first_pts=0', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2');
      args.push('-video_track_timescale', '90000', '-progress', 'pipe:2', base);
      await run('ffmpeg', args, job, progressLine(job, offset / total * 0.85, length / total * 0.85, length));
      if(hasFx) await require('./compositor').compose(base,ready,p,c,size,temp,job,run,{directory:options.auditDir,index:i});
      offset += length;
    }
    await fs.writeFile(path.join(temp, 'clips.txt'), p.clips.map((_, i) => `file 'clip-${i}.mp4'`).join('\n'));
    job.message = 'Uniendo clips…'; job.progress = 0.87;
    const resultPath = path.join(temp, 'resultado.mp4');
    await run('ffmpeg', ['-hide_banner', '-nostdin', '-n', '-f', 'concat', '-safe', '1', '-i', path.join(temp, 'clips.txt'), '-c', 'copy', '-movflags', '+faststart', resultPath], job);
    job.message = 'Verificando imagen, audio y duración…'; job.progress = 0.92;
    const result = await probe(resultPath, job);
    if (Math.abs(result.duration - total) > Math.max(0.3, p.clips.length * 0.07)) throw new Error('La duración exportada no coincide con la edición.');
    if (media.audio && !result.audio) throw new Error('La exportación perdió la pista de audio.');
    await run('ffmpeg', ['-v', 'error', '-xerror', '-nostdin', '-i', resultPath, '-f', 'null', '-'], job);
    if (job.cancelled) throw new Error('Operación cancelada.');
    // Same-volume hard link publishes a verified file atomically, without another 4K-sized copy.
    try { await fs.link(resultPath,destination); }
    catch(e) {
      if(!['EPERM','ENOTSUP','EXDEV','ENOSYS'].includes(e.code))throw e;
      await fs.copyFile(resultPath,destination,require('node:fs').constants.COPYFILE_EXCL);
      if(job.cancelled){await fs.unlink(destination);throw new Error('Operación cancelada.');}
    }
    return { path: destination, duration: result.duration, width: result.width, height: result.height, audio: result.audio };
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
}
module.exports = { run, probe, canPlayDirect, makePreview, detectSilences, exportVideo, videoFilter };
