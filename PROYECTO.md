# Editor personal de video

## Alcance confirmado

- Aplicación de escritorio para Windows, para uso personal.
- Fuente principal: videos grabados con teléfono, verticales y horizontales.
- Primera versión: línea de tiempo, eliminación de silencios, subtítulos automáticos editables, estilos de texto y zoom con perspectiva.
- Formatos principales: 9:16 y 16:9. Admitir también 1:1, 4:5 y dimensiones personalizadas.

## Flujo principal

1. Importar un video y mostrar sus datos reales: duración, tamaño, orientación, audio y velocidad de cuadros.
2. Crear un proyecto editable que referencie el original sin modificarlo.
3. Detectar silencios con umbral, duración mínima y margen para preservar comienzos y finales de palabras. Revisar y deshacer los cortes.
4. Generar transcripción con tiempos; corregir palabras y sincronizar subtítulos después de los cortes.
5. Editar cortes en una línea de tiempo y agregar textos, estilos de subtítulos y puntos de zoom.
6. Elegir tamaño de salida y ajustar encuadre sin deformar la imagen.
7. Exportar MP4 y comprobar duración, imagen, audio y sincronización.

## Condiciones técnicas

- Separar el proyecto y sus tiempos del motor de reproducción y exportación.
- Guardar explícitamente la relación entre tiempos del video original y de la edición.
- Normalizar orientación y tiempos de videos de teléfono; comprobar velocidad variable, HEVC y HDR con muestras reales antes de prometer compatibilidad.
- La vista previa y la exportación deben interpretar los mismos cortes y efectos.
- Procesamiento local: Whisper.cpp multilingüe para transcripción y U2Net Human Seg con ONNX Runtime CPU para máscara humana.
- Zoom 3D significa transformar el plano de imagen con perspectiva; no reconstruir una escena tridimensional.
- REA puede servir para investigar comportamientos concretos; no es el motor de edición ni una dependencia necesaria del producto.

## Orden de construcción

1. Importación, proyecto, reproducción y exportación de un corte real.
2. Línea de tiempo editable y cortes de silencios revisables.
3. Transcripción, edición y exportación de subtítulos.
4. Textos animados y zoom con perspectiva.
5. Verificación integral con grabaciones reales verticales y horizontales.

Las tres áreas forman parte de la primera versión; el orden permite verificar cada una antes de integrarlas.

## Estado

Versión 0.2 implementada: conserva el montaje e incorpora transcripción local, corrección de subtítulos y tiempos, presentación por frases/palabras/resaltado, importación y exportación SRT, textos animados por tramo, texto detrás de la persona mediante máscara, ajustes de bordes, zoom y perspectiva, tamaño personalizado, reencuadre, 24–60 fps, conversión HDR a SDR y recuperación automática de sesión.

Los proyectos usan esquema v2 y migran v1 al abrir. Subtítulos y efectos se guardan en tiempos del original y siguen a los clips al cortar y reordenar. La vista final calculada utiliza el motor de exportación a 720 píxeles para revisión.

Incluye Leo Video.exe como lanzador e Instalar Leo Video.exe para instalar la app y crear un acceso directo. Depende de Chrome/Edge, Node, FFmpeg y los motores de IA instalados en este equipo; el paquete no transporta todos esos motores a otra computadora.

Actualización 0.2.1: se validó una grabación real vertical del usuario (3,808 s, Full HD SDR) con subtítulos, movimiento y texto detrás de su cabeza; se corrigió la pérdida de una palabra del reconocimiento y se comprobaron 16 pruebas del motor más la regresión SRT en interfaz instalada. El original conserva su SHA-256. Faltan videos largos y muestras reales horizontales/HDR. Ver VALIDACION.md y validaciones/no-trabaja-por-vos-final/INFORME.md.

Actualización 0.2.2: la importación ya no recodifica los videos que el navegador reproduce directamente (H.264 SDR de 8 bits en MP4/MOV). Con una grabación real de teléfono (1080 × 1920, 2:48 min, 400 MB) pasó de unos 30 s a 0,14 s. El resto usa una vista liviana guardada por original, que no se recalcula al reabrir. Si el equipo no puede reproducir un original, la interfaz genera la vista liviana automáticamente.

Actualización 0.3.0: capa de IA con la API de OpenAI. Transcripción con tiempos por palabra subiendo solo el audio comprimido (respaldo en Whisper local) y pestaña «IA» que propone tomas repetidas a cortar, textos a resaltar y zooms de énfasis para revisar antes de aplicar. Probado con un servidor de OpenAI simulado (pruebas del motor e interfaz); falta la validación con clave real y una grabación con repeticiones.

Pendiente: zoom y subtítulos en vivo en el reproductor, zoom sostenido, y motion graphics con plantillas.
