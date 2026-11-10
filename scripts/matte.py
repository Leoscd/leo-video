"""CPU human segmentation for selected source intervals. No upload, fixed CFR input."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import numpy as np
import onnxruntime as ort
from PIL import Image, ImageFilter

def read_exact(stream, n):
    buf = bytearray()
    while len(buf) < n:
        part = stream.read(n - len(buf))
        if not part:
            break
        buf.extend(part)
    return bytes(buf)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('video'); ap.add_argument('output'); ap.add_argument('settings')
    args = ap.parse_args()
    cfg = json.loads(Path(args.settings).read_text(encoding='utf-8'))
    model = os.environ.get('LEO_MATTE_MODEL', str(Path.home()/'.cache/hyperframes/background-removal/models/u2net_human_seg.onnx'))
    options = ort.SessionOptions(); options.intra_op_num_threads = 4; options.inter_op_num_threads = 1
    session = ort.InferenceSession(model, sess_options=options, providers=['CPUExecutionProvider'])
    name = session.get_inputs()[0].name
    startup = {'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {}
    decoder = subprocess.Popen(['ffmpeg','-v','error','-nostdin','-i',args.video,'-vf','scale=320:320','-an','-f','rawvideo','-pix_fmt','rgb24','pipe:1'], stdout=subprocess.PIPE, **startup)
    encoder = subprocess.Popen(['ffmpeg','-v','error','-nostdin','-n','-f','rawvideo','-pix_fmt','gray','-s','320x320','-r',str(cfg['fps']),'-i','pipe:0','-an','-c:v','ffv1',args.output], stdin=subprocess.PIPE, **startup)
    frames = 0
    try:
        while True:
            raw = read_exact(decoder.stdout,320*320*3)
            if not raw: break
            if len(raw) != 320*320*3: raise RuntimeError('Cuadro de video incompleto.')
            t = frames/cfg['fps']
            if any(s['start'] <= t < s['end'] for s in cfg['intervals']):
                rgb = np.frombuffer(raw, dtype=np.uint8).reshape((320,320,3)).astype(np.float32)
                rgb = rgb/max(float(rgb.max()),1.0)
                rgb = (rgb-np.array([.485,.456,.406],np.float32))/np.array([.229,.224,.225],np.float32)
                pred = session.run(None,{name:rgb.transpose(2,0,1)[None].copy()})[0][0,0]
                lo,hi=float(pred.min()),float(pred.max())
                pred = (pred-lo)/max(hi-lo,1e-6)
                # A narrow soft threshold permits explicit edge correction in the editor.
                alpha = np.clip((pred-cfg['threshold'])/.20+.5,0,1)
                image = Image.fromarray((alpha*255).astype(np.uint8))
                if cfg['feather']: image=image.filter(ImageFilter.GaussianBlur(cfg['feather']))
                mask = image.tobytes()
            else: mask = bytes(320*320)
            encoder.stdin.write(mask)
            frames += 1
            if frames%5==0: print(f'matte_frame={frames}',file=sys.stderr,flush=True)
        encoder.stdin.close()
        if decoder.wait() or encoder.wait(): raise RuntimeError('FFmpeg no pudo procesar la máscara.')
        if not frames: raise RuntimeError('No se decodificaron cuadros.')
    finally:
        for child in [decoder,encoder]:
            if child.poll() is None: child.kill(); child.wait()

if __name__=='__main__': main()
