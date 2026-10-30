---
name: gameaccess-motion-ui
description: Game Access new interface (GSAP motion design). Use when implementing any task of docs/TAREA-interfaz-nueva.md in apps/desktop — catalog for discovery, bento library, card flip menu, detail open/close transitions, side panels (downloads, library manager, news), icon-only footer, the single bottom-right notice, or any GSAP animation. Enforces the approved demo, reduced motion, Flip rules and i18n.
---

# Game Access — interfaz nueva con movimiento

La referencia es la demo aprobada `docs/design/gameaccess-gsap-demo-2026-10-23/index.html` y el plan `docs/TAREA-interfaz-nueva.md`. Si esta skill y el plan se contradicen, manda el plan; si el plan y `docs/GUI_DESIGN.md` se contradicen, manda `GUI_DESIGN.md` (avisá para corregir el otro).

## Antes de empezar una tarea

1. Leé la tarea completa en `docs/TAREA-interfaz-nueva.md` (sección 5) y las reglas de la sección 3.
2. Abrí la demo (sección 1 del plan) y buscá en su código las funciones que cita la tarea. Copiá el comportamiento, no el código suelto: en la app va en componentes React.
3. `git status` limpio, `git pull --ff-only` en `dev`. Un commit por tarea.

## GSAP en React (siempre así)

- Importar desde `src/motion/gsap.ts` (registra `Flip`, `SplitText`, `ScrollTrigger`).
- Animar dentro de `useGSAP(() => {...}, { scope: ref, dependencies: [...] })` de `@gsap/react`. Nada de `gsap.to` sueltos en `useEffect` sin limpieza.
- Respetar "reducir movimiento": `gsap.matchMedia()` o `motionOk()`. Sin movimiento, el estado final se aplica al instante.
- Animar `transform` y `opacity`. Evitar animar `filter: blur` en muchas tarjetas a la vez.
- **Cola de transiciones (Seba, 2026-10-30):** toda transición (cambiar de modo o pantalla, grilla ↔ Library Manager, abrir o cerrar un panel, la palabra lateral y las que vengan) se agrega con `queueTransition(() => timeline, "nombre")` de `src/motion/transitions.ts` y corre sola, una después de la otra, nunca encimada. Cada paso arma su propio `gsap.timeline()` con sus tiempos y lo devuelve (o devuelve una promesa que espera sus timelines); no pongas `onComplete` en ese timeline (usá `.call()`). Si algo tiene que quedar oculto hasta su turno, ubicalo con `gsap.set` en su punto de partida antes de encolarlo. Un botón que alterna decide sobre lo último que se pidió, no sobre lo que se ve. Lo continuo (hover, imán, fondo) no va por la cola. En desarrollo, `window.__gaTransitionLog` lista cada paso con su inicio y fin.
- Nunca escalar ni animar una imagen de pantalla completa con `blur` grande, ni poner `backdrop-filter` sobre algo que cambia seguido: parpadea. Fondos desenfocados = lienzo chico estirado + solo `opacity`; imágenes que cambian = `img.decode()` antes de mostrarlas.
- GSAP y fuentes van empaquetados (npm y `public/fonts/`): la CSP de Tauri no deja cargar nada de internet salvo imágenes de Steam.

## Reglas de movimiento que ya costaron errores

- **Grillas (`Flip`):** las tarjetas que salen primero se achican dentro de su lugar (0,3 s) y después `Flip` reacomoda solo las que quedan. Nunca pasar a `Flip` una tarjeta que sale. No usar `scale: true` con tarjetas que tienen imagen.
- **Ficha:** se abre recortando con `clip-path` desde el rectángulo de la tarjeta; la portada viaja solo hasta la franja de arriba y se desvanece. Al cerrar, la portada reaparece como grilla de cuadraditos del centro hacia afuera en 1,2 s. Nunca mostrar la portada agrandada.
- **Botón principal:** naranja plano `#ff6a00`, sin degradado, sin volumen y sin resplandor (hasta que Seba pase el ejemplo de vidrio).
- **Aviso único:** abajo a la derecha; si salió bien, círculo temporizador arriba a la derecha que cierra en 3 s; un error nunca se cierra solo; confirmaciones con Cancelar + acción. No crear diálogos nuevos para resultados o confirmaciones simples.

## Componentes (uno solo de cada uno)

`GaButton` (primary / secondary / danger / frost), `GaIconButton` (cubo del pie, etiqueta al pasar el mouse, `pressed`, `badge`), `GaClose`, `GaBack`, `GaNotice` (+ `notify`, `confirmNotice`, `runSteps`). Si falta una variante, se agrega primero a `docs/GUI_DESIGN.md` §4.

## Textos

Todo con `t("clave")` en `src/locales/es.ts` y `en.ts`. La palabra gigante del costado va sin tilde: `CATALOGO` / `LIBRERIA` (`CATALOG` / `LIBRARY`). Correr `npm run check:i18n`.

## Para cerrar una tarea

`npx tsc --noEmit -p tsconfig.json`, `npx vitest run`, `npm run check:i18n`; verlo con `npm run dev` en `es` y `en` y en 1024 / 1440 / 1920 px; tildar la tarea en `vault/Tareas.md`, registrar el commit en `vault/Log.md`, leer `vault/Mensajes.md`.
