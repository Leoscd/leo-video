# Validación de Leo Video 0.2.1

Verificación de implementación y una primera muestra real del usuario. No constituye aceptación de todos los formatos y duraciones.

## Ejecutado

- `npm test`: 16 pruebas aprobadas. Original intacto, cortes/orden, silencios, audio/sin audio, cancelación, rotación, 4K, migración, tiempos tras cortes/reordenado, texto animado, zoom/perspectiva, tamaño personalizado, 60 fps, HDR PQ → SDR, rutas con apóstrofes, HEVC con velocidad variable y conservación de palabras con token de duración cero.
- `tests/ui-smoke.cjs`: montaje, reproducción, cortes, deshacer, silencios y formato vertical en dos tamaños de ventana.
- `tests/ui-creative.cjs`: SRT, corrección, resaltado, texto y zoom, resultado calculado reproducible, borrador automático y configuración personalizada.
- `tests/ai-smoke.cjs`: U2Net Human Seg + FFmpeg para texto detrás de una persona; Whisper.cpp ejecutado con tiempos de palabra válidos.
- `tests/cancel-smoke.cjs`: cancelación de una operación real del servidor y limpieza de sus temporales.
- `Leo Video.exe`: compilado y ejecutado; servidor 0.2.0 activo y ventana del editor confirmada.
- `Instalar Leo Video.exe`: instalación de prueba dentro de `.install-test`, salida 0 y archivos comprobados por SHA-256. El instalador ofrece carpeta de destino y acceso directo; las dependencias de IA son externas al paquete.
- `tests/installer-smoke.cjs`: la copia instalada inició su servidor, importó una muestra, exportó subtítulos y sirvió el video final por rangos HTTP.
- Las exportaciones pasan FFprobe y decodificación completa FFmpeg. Se inspeccionaron capturas del resultado.

## Muestras

- Video sintético FFmpeg para cortes, color y movimiento.
- `skimage.data.astronaut()` (Eileen Collins, NASA; muestra de scikit-image) para comparar texto delante/detrás. Imagen fija convertida en video; no prueba movimiento de pelo/manos.
- `samples/jfk.wav` del checkout local de Whisper.cpp para verificar reconocimiento y tiempos. Está en inglés y la prueba usa `language=en`; la interfaz solicita español. No evalúa precisión en español.

## Evidencias

- `test-output/resultado-mascara.mp4` y `resultado-mascara.png`: composición detrás de la figura.
- `test-output/resultado-frente.png`: capa delante para comparación.
- `test-output/resultado-efectos.mp4`: textos, subtítulos y movimiento.
- `test-output/transcripcion-verificada.json`: reconocimiento local.
- `test-output/interfaz-efectos-v02.png` e `interfaz-resultado-v02.png`: interfaz y resultado.

## Pendiente de aceptación

Se validó `no trabaja por vos-1.mp4`, una grabación real de 3,808 s, vertical 1080 × 1920, H.264 SDR a 30 fps, en español y con movimiento de cabeza/manos. Se generaron 16 palabras, texto detrás de la cabeza y zoom/perspectiva suaves. El original se verificó por SHA-256 antes y después. Se encontró y corrigió la pérdida de «La» por un token de duración cero. La prueba de UI `tests/ui-short-caption.cjs` comprobó el SRT real, su edición y recuperación en la copia instalada.

Evidencias en `validaciones/no-trabaja-por-vos-final/`: MP4 Full HD decodificado, proyecto editable, SRT, máscara de auditoría, frames e informe. Transcripción: 5,58 s; exportación: 26,65 s. Audio: correlación 0,9978 y desplazamiento medido de −1,875 ms frente al original (no es una evaluación manual de cada palabra).

Quedan pendientes una grabación horizontal, un archivo largo y HDR real. En el clip corto no se detectaron silencios a −35 dB y 0,3 s; no se aplicaron cortes de silencio artificiales para simular éxito.

La instalación aprovecha las dependencias locales de este equipo. No se validó instalación autónoma en otra computadora.
