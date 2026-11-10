# Prueba real — no trabaja por vos-1.mp4

Fuente: vertical 1080 × 1920, H.264 SDR, 30 fps, AAC estéreo, duración 3,808 s.

## Resultado

- Exportación Full HD con palabras resaltadas, título detrás de la cabeza y zoom/perspectiva suaves. Se inspeccionaron el resultado y la máscara sobre movimiento real.
- Transcripción automática: «La idea de este taller es que entiendas que la inteligencia artificial no trabaja por vos.» Son 16 palabras; no se corrigió el contenido manualmente.
- Se corrigió el importador: el token de «La» tenía duración cero, aunque el segmento reconocido abarcaba 0,11–0,15 s. Ahora se conserva el segmento y se admiten esos tiempos en proyecto, editor y SRT.
- Decodificación completa, resolución, duración y pista de audio comprobadas.
- Audio frente al original: correlación 0,99778; desplazamiento −1,875 ms. Ver `sincronizacion-audio.json`. No sustituye la evaluación manual de cada palabra.
- Original intacto: SHA-256 antes/después `962233608b09e7f6454f3d0ec3bc23e985f46cdbcbaeb1af72e9e7ed3c7322fc`.
- Tiempos: transcripción 5,58 s; exportación 26,65 s. La máscara CPU no es una vista en tiempo real.

## Archivos

- `prueba-real-1080x1920.mp4`: 1080 × 1920, 30 fps, H.264/AAC; duración de contenedor 3,821 s.
- `prueba-real.leovideo`: proyecto para abrir desde la app; referencia el original sin moverlo.
- `subtitulos.srt`: tiempos del montaje.
- `resultado-3.2s.png` y `resultado-contacto.png`: revisión visual.
- `audit-clip-0-mask.mkv` y `mascara-3.2s.png`: máscara usada por el compositor antes del zoom.
- `analisis.json`, `verificacion.json`, `sincronizacion-audio.json`: evidencia técnica.

## Alcance

No se detectaron silencios a −35 dB / 0,3 s. El clip no permite evaluar pausas largas, rendimiento prolongado, fuente horizontal ni HDR real. Esos casos siguen pendientes.
