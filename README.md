# Leo Video 0.2.2

Editor personal para Windows. Abrí **Leo Video.exe** o **Abrir editor.cmd**. Conservá el lanzador junto al resto de esta carpeta.

Para instalarlo en tu equipo, ejecutá **Instalar Leo Video.exe**, elegí una carpeta y pulsá **Instalar y abrir**. Puede crear un acceso directo en el Escritorio. El paquete instala la aplicación y aprovecha los motores y modelos ya disponibles; no incluye una copia de todas las dependencias para otra computadora.

La interfaz usa una ventana de Chrome/Edge. El motor escucha solamente en `127.0.0.1`. Videos, transcripción y máscaras se procesan localmente.

## Cómo usarlo

1. **Importar video** abre al instante los videos H.264 SDR en MP4/MOV (lo habitual en teléfonos): se reproduce el original, sin conversión previa. Para HEVC, HDR, 10 bits u otros contenedores se genera una vista liviana una sola vez y se reutiliza al reabrir el proyecto. El original se conserva y se usa para exportar.
2. Cortá, reordená o ajustá los clips. **Detectar silencios** permite revisar las pausas antes de aplicar cortes. Podés deshacer.
3. En **Subtítulos**, pulsá **Generar subtítulos** y corregí palabras/tiempos. Elegí frases, palabras o resaltado de la palabra activa. También podés importar SRT y exportarlo sincronizado con el montaje.
4. En **Efectos**, indicá inicio/fin, usá el cursor o **Usar el clip seleccionado**. Agregá texto con fundido, pop o entrada desde abajo; ajustá color, tamaño y posición. **Detrás de mí** usa tu figura como máscara. Pulsá **Guardar efecto** para agregarlo al proyecto.
5. En ese panel podés crear un zoom con foco y perspectiva, con acercamiento y regreso suaves. Los zooms no pueden superponerse; los textos sí.
6. Elegí original, 9:16, 16:9, 1:1, 4:5 o tamaño personalizado. **Rellenar** recorta bordes y permite desplazar el encuadre; **Ajustar** conserva la imagen con bandas cuando corresponde. Seleccioná 24, 25, 30, 50 o 60 fps.
7. **Ver resultado con efectos** calcula una vista con el mismo motor de exportación a 720 píxeles de lado mayor. Volvé a generarla después de editar.
8. Guardá el proyecto `.leovideo` y exportá MP4 con un nombre nuevo. Se comprueban duración, audio y decodificación antes de publicar la salida.

La reproducción de la línea de tiempo sirve para cortar y navegar; no calcula efectos o máscaras en tiempo real. Usá la vista final para revisarlos.

Los tiempos de subtítulos y efectos son segundos del **original**. Esto permite conservarlos al dividir, eliminar y reordenar clips. El SRT importado usa tiempos del original; el exportado usa los del montaje.

## Máscara de la persona

Capas: video original → texto → persona recortada. U2Net Human Seg calcula la máscara a 320 × 320; luego se amplía para componer en la resolución elegida. No necesita fondo verde.

Para una sola persona de frente a cámara. **Umbral de máscara** y **Suavizado** ajustan bordes. Puede fallar o parpadear en pelo, manos rápidas, objetos sostenidos y fondos complejos. No incluye pincel manual ni seguimiento de varias personas. El cálculo CPU puede tardar más que el tramo.

## Proyectos y recuperación

- Abre proyectos v1 y los guarda como v2 con subtítulos, estilos, efectos y ajustes de salida.
- **Recuperar sesión** abre el último borrador automático, guardado aproximadamente 0,8 s después de editar cuando no hay una operación en curso. Conservá también proyectos con nombre.
- Los proyectos referencian el original: no lo borres ni muevas si querés reabrirlos.
- **Cerrar editor y detener motor** termina la sesión. Cerrar solo la ventana deja el motor disponible.

## Requisitos

- Windows, Chrome/Edge, Node.js 22+, FFmpeg y FFprobe en PATH.
- Whisper.cpp y modelo multilingüe, buscados en `%USERPROFILE%\.cache\hyperframes\whisper`.
- Python con `numpy`, `Pillow`, `onnxruntime`; modelo `u2net_human_seg.onnx` en `%USERPROFILE%\.cache\hyperframes\background-removal\models`.
- Espacio para reproducción y temporales. Los temporales de exportación se eliminan al terminar o cancelar.

Los motores se comprobaron en este equipo. Para otras ubicaciones: variables `LEO_WHISPER_EXE`, `LEO_WHISPER_MODEL`, `LEO_PYTHON`, `LEO_MATTE_MODEL`. El lanzador no instala ni descarga modelos silenciosamente.

## Límites

- Un video fuente; no hay pistas de música ni montaje con varias fuentes.
- Hasta 300 clips, 200 efectos, 20.000 subtítulos/segmentos y 100 pasos de deshacer.
- Dimensiones pares de 128 a 7680 píxeles por lado. El rendimiento depende del equipo.
- HDR PQ/HLG se convierte a SDR: no se preserva HDR. Falta revisar color de teléfonos reales y Dolby Vision.
- Se probaron HEVC y velocidad variable con muestras sintéticas. Faltan grabaciones reales, videos largos y evaluación de máscara con movimiento.
- La transcripción necesita revisión; no se promete exactitud literal automática.
- Las vistas livianas (`proxy-*.mp4`) están en `.cache` y se conservan las 6 más recientes. Las vistas finales calculadas no tienen limpieza automática general.

## Código y pruebas

- `core/project.js`: validación/migración y relación entre tiempos del original y clips.
- `core/captions.js`: transcripción, palabras con tiempos reales, estilos ASS y SRT.
- `core/compositor.js`: capas, máscara, texto y zoom. Coordenadas proporcionales para reutilizar entre resoluciones.
- `scripts/matte.py`: inferencia ONNX CPU y máscara por cuadro.
- `core/media.js`: inspección, color/encuadre, procesamiento y verificación de salida.
- `server.js`: operaciones cancelables, API local y diálogos de Windows.
- `ui/app.js` y `ui/creative.js`: montaje, subtítulos, efectos y recuperación.

`npm test` ejecuta pruebas del motor. `tests/ui-smoke.cjs` y `tests/ui-creative.cjs` requieren Playwright y servidor iniciado. `tests/ai-smoke.cjs` ejecuta los modelos locales con las muestras de VALIDACION.md. `scripts/build-launcher.ps1` y `scripts/build-installer.ps1` recompilan los ejecutables con .NET Framework.

Referencias: [FFmpeg](https://ffmpeg.org/ffmpeg-filters.html), [Whisper.cpp](https://github.com/ggml-org/whisper.cpp), [U2Net](https://github.com/xuebinqin/U-2-Net). Se tomó como referencia el flujo de capas de la skill local `embedded-captions`; la app usa su propio motor FFmpeg.

## Corrección validada con video real

La versión 0.2.1 conserva palabras cuyo token Whisper tiene duración cero cuando el segmento reconocido sí tiene tiempos válidos. Se detectó con «La» al comienzo de una grabación real en español. Los subtítulos cortos también se pueden validar, editar e importar por SRT sin errores de redondeo. Ver `validaciones/no-trabaja-por-vos-final` para la exportación, proyecto y comprobación de integridad.
