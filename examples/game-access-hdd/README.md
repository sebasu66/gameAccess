# Game Access · HDD animado

Web Component (`<game-access-hdd>`) independiente de framework, pensado para una UI Tauri. Mantiene las **tres capas PNG con transparencia** y sitúa SVG de datos en la zona derecha del disco.

## Archivos

- `assets/hdd-body.png`: cuerpo, marco y cavidad, tamaño original 2172×724
- `assets/hdd-platter.png`: plato independiente, 715×720
- `assets/hdd-head.png`: cabezal independiente, 575×417
- `src/game-access-hdd.js`: componente, SVG, lógica de capacidad y animación con GSAP
- `src/demo.js` / `index.html`: demo de cuatro discos en grilla

## Integración en Tauri con Vite

1. Instalar GSAP en tu proyecto: `npm install gsap`
2. Copiar `src/game-access-hdd.js` y la carpeta `assets/` conservando la ubicación relativa entre ellas (el JS presupone `../assets/`).
3. En el punto de entrada de tu frontend:

```js
import { gsap } from 'gsap';
window.gsap = gsap; // el componente usa esta instancia, sin cargar scripts remotos
await import('./src/game-access-hdd.js');

const disk = document.querySelector('game-access-hdd');
disk.setData({
  letter: 'D:', label: 'BIBLIOTECA STEAM',
  totalBytes: 2_000_000_000_000,
  usedBytes: 1_200_000_000_000,
  activity: 'reading' // 'idle' | 'reading' | 'writing'
});

// Eventos del backend de Tauri pueden llamar a:
disk.setUsage(1_300_000_000_000); // animación de porcentaje
// disk.setActivity('writing');
// disk.setActivity('idle');
```

En HTML:

```html
<div class="grid">
  <game-access-hdd letter="C:" label="SISTEMA" total="1000000000000" used="680000000000"></game-access-hdd>
  <game-access-hdd letter="D:" label="JUEGOS" total="2000000000000" used="1200000000000"></game-access-hdd>
</div>
```

```css
.grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }
@media (max-width: 900px) { .grid { grid-template-columns:1fr; } }
```

## API / comportamiento

| Atributo o método | Uso |
|---|---|
| `letter` | Letra de unidad, p. ej. `C:` |
| `label` | Etiqueta, p. ej. `STEAM` |
| `total` | Capacidad en bytes |
| `used` | Bytes utilizados |
| `activity` | `idle`, `reading`, `writing` |
| `status` | Opcional: `normal`, `warning`, `critical` (fuerza el color) |
| `setData({...})` | Actualización integral sin repintado intermedio |
| `setUsage(usedBytes, totalBytes?)` | Actualiza barra SVG y porcentaje con GSAP |
| `setActivity(mode)` | Inicia/detiene las animaciones de lectura/escritura |
| `pause()` y `resume()` | Pausa/reanuda la actividad animada |

Umbrales automáticos: azul (`<75%`), amarillo (`75–89,9%`), rojo (`≥90%`). Se usa 1 GB = 1.000.000.000 bytes. El contador indica el porcentaje ocupado. El SVG muestra espacio ocupado, libre y capacidad total.

La rotación del plato es GSAP lineal e infinita durante `reading`/`writing`, con mayor velocidad de escritura; el cabezal oscila alrededor del rodamiento, `transform-origin: 35% 61%`. Al pasar a `idle`, se detiene el plato y el cabezal vuelve suavemente al origen. Respeta la preferencia `prefers-reduced-motion`. El componente puede mostrar los datos sin GSAP, pero no animará si GSAP no está disponible.

**Importante:** los datos de actividad son eventos que debes proporcionar desde Tauri. El frontend no detecta lecturas/escrituras del HDD por sí solo. El CSS de la UI se encapsula en Shadow DOM, por lo que las tarjetas pueden reutilizarse sin conflictos. Los assets se incorporan localmente, sin dependencia de red en producción.

### Demo

Con las dependencias disponibles: `npm install && npm run dev`. La demo importa GSAP desde npm mediante Vite, sin CDN. Una vez instaladas las dependencias, puede funcionar sin conexión.
