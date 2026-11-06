# Tarea: editor de filtros en formato "asistente" (3 columnas, apaisado)

Para el modelo barato: codifica. Claude verifica después con screenshots.
Es solo diseño y estructura de la interfaz: NO cambiar la forma de `LibrarySearchFilters`, ni la lógica de `libraryFilterLogic`/`librarySearch`, ni las reglas de control parental.

## Por qué

El editor actual (`src/LibraryFilterDialog.tsx`) se ve complejo y con diseño básico: una columna larga de acordeones, texto técnico y poca jerarquía. No sirve para mostrar en la web ni para que alguien nuevo lo entienda. Hay que convertirlo en un asistente simple, de lectura natural.

## Resultado esperado

Ventana **apaisada** (más ancha que alta, ~1100–1300 px de ancho máximo, que se adapte a ventanas chicas), misma estética de la app (cristal oscuro, naranja, esquinas redondeadas). Tres columnas sutiles una al lado de la otra, cada una con un número y un título corto. Todo es opcional: cada paso ya viene con los valores por defecto de hoy, así que se puede abrir y apretar "Mostrar" sin tocar nada.

### Arriba: una oración que se arma sola

Debajo del título "Filtros" va una frase grande, legible, que se actualiza en vivo con lo que se elige. Los valores elegidos se resaltan en naranja (chips o texto en negrita).

- Vacío (defaults): "Quiero encontrar **juegos** con al menos **60 %** de reseñas positivas."
- Ejemplo: "Quiero encontrar juegos de **Acción** y **Aventura**, pero no de **Terror**, de **un solo jugador**, con al menos **70 %** de reseñas positivas, lanzados en los **últimos 2 años** y con fuente **X**."
- Con multijugador: "…que admitan **multijugador**: **Co-op**, en **Online**."
- Reglas de redacción: incluir solo lo que está activo; unir con comas y "y"; usar "pero no de…" para los géneros excluidos (estado "−"). Textos en español simple, con versión inglesa en i18n (`es` y `en`). Si la frase queda muy larga, que haga salto de línea y no se corte.
- Tocar un valor resaltado de la frase lo quita (opcional, nice-to-have).

### Columna 1 · "Quiero encontrar juegos de"

- Campo de búsqueda propio ("Buscá un género") que filtra la lista de géneros al escribir.
- Lista/grilla de géneros, **cada uno con su icono** (lucide-react) y su nombre. Fuente de los géneros: la misma que usa hoy el diálogo (`genres` / `libraryGenres.ts`, `genreLabel`).
- Cada género mantiene el comportamiento actual de tres estados (`TriStateOption`): neutro / "+" exigir / "−" excluir. Que se vea claro: borde naranja para "+", tachado o rojo suave para "−". Una pista breve arriba: "Tocá una vez para sumar, dos para excluir".
- Iconos sugeridos (verificar que el nombre exista en la versión instalada de lucide-react; si no existe, usar `Gamepad2`): Acción → `Swords`, Aventura → `Compass`, RPG → `Scroll`, Estrategia → `Castle`, Simulación → `Cog`, Deportes → `Trophy`, Carreras → `Car`, Terror → `Ghost`, Indie → `Sparkles`, Casual → `Coffee`, Puzzle → `Puzzle`, Disparos/Shooter → `Crosshair`, Lucha → `Swords`, Plataformas → `Footprints`, Mundo abierto → `Map`, Supervivencia → `Flame`, Música/Ritmo → `Music`, Cartas/Mesa → `Dices`, Familia → `Heart`, Gratis → `Gift`. Definir el mapa en un archivo chico (por ejemplo `genreIcons.ts`) con un icono por defecto para los no listados.
- Si el control parental bloquea "Contenido sexual", mostrar ese género bloqueado con candado y la leyenda actual (no cambiar la lógica; ver `ParentalControlSection.tsx` / `useParentalLocked`).
- La lista con scroll propio (usar `CircularScrollbar` si ya se usa en el diálogo), sin que crezca la ventana.

### Columna 2 · "Que sea"

- Dos opciones grandes tipo tarjeta (con icono): **Solo un jugador** (`User`) y **Admite multijugador** (`Users`). Siguen siendo excluyentes como hoy (`MultiplayerParentOption`).
- Al elegir "Admite multijugador" la tarjeta se **expande** (animación corta) y muestra, con el mismo contenido que hoy pero mejor formateado y con iconos:
  - Co-op / PvE (`Handshake`), PvP (`Swords`).
  - Cómo se juega: Pantalla compartida (`MonitorSmartphone` o `Tv`), LAN (`Network`), Online (`Globe`).
  - Escala: MMO (`Users`).
  - Mantener las explicaciones cortas de hoy, en una línea y en gris ("Jugar con otros contra el juego", etc.), pero sin párrafos largos.
- Al elegir "Solo un jugador" se contrae lo anterior.
- Mantener las reglas actuales (cada casilla de dentro del grupo es un requisito; ver `MULTIPLAYER_BRANCHES`, `MULTIPLAYER_OPTION_KEYS`).

### Columna 3 · "Y además"

- **Puntaje mínimo** (slider, defecto actual: activado en 60 %), con su explicación corta de una línea.
- **Antigüedad / fecha de lanzamiento** (slider de rango, defecto actual: desactivado). Mostrar el valor en lenguaje natural ("últimos 2 años", "entre 2015 y 2020").
- **Fuentes de descarga** (hoy "Download sources", sin traducir): título en español ("Fuentes de descarga"), lista de las fuentes disponibles con casilla/icono. Si no hay fuentes importadas, mostrar un texto corto y amable en vez de una lista vacía.
- Reutilizar `QualitySliders.tsx`; solo ajustar su apariencia y textos.
- "Qué buscás" (Juegos / Programas, hoy con contadores) pasa a un control compacto (dos botones) en la cabecera de esta columna o arriba a la derecha de la oración. No perder esta función.

### Pie

- A la izquierda: contador "37.128 juegos" (se actualiza en vivo como hoy) y, si aplica, el aviso de tope de resultados de la tarea de catálogo ("Más de 1000 resultados: mostrando los primeros 1000").
- A la derecha: "Limpiar todo" (vuelve a los valores por defecto, no a vacío) y el botón principal naranja "Mostrar N juegos".

## Reglas técnicas

- Mantener las props actuales de `LibraryFilterDialog` (`games, query, filters, genres, onApply`) y la forma de `LibrarySearchFilters`. Los helpers `criterionState` / `setCriterionState` y el conteo en vivo se conservan.
- Dividir en componentes chicos (por ejemplo `FilterSentence.tsx`, `GenrePicker.tsx`, `PlayersPicker.tsx`, `ExtrasPicker.tsx`) y un archivo `filter-wizard.css` nuevo. Evitar crecer `LibraryFilterDialog.tsx`.
- La función que arma la frase va en un archivo puro (`filterSentence.ts`) con tests (`filterSentence.test.ts`): sin filtros, solo géneros, géneros con exclusión, solo un jugador, multijugador con ramas, rating, fechas, fuentes, y combinaciones.
- Teclado y mando: orden de tab lógico (columna 1 → 2 → 3 → pie), Enter/Espacio alterna, Escape cierra (ya lo resuelve `useDialogFocus` / `useOverlayClose`; no romperlo). Que el foco visible se vea con el naranja.
- Textos nuevos en `i18n.ts` (es/en), lenguaje simple y sin jerga.
- Estética: mantener glass, fondo pixelado y paleta naranja; no usar `backdrop-filter` en elementos repetidos de la lista (costo de rendimiento sobre el fondo animado); sin animaciones largas.
- En ventanas angostas (< ~900 px) las columnas pueden apilarse, pero el diseño principal es apaisado.
- No tocar plugins ni `apps/desktop/public/brand/logo-opening.mp3`.
- Rama `dev`, commits chicos (uno por componente/paso), sin push. Tras cada paso: `npm test`, `npx tsc --noEmit` en `apps/desktop`.

## Pasos

1. `filterSentence.ts` + tests (función pura, sin UI).
2. `genreIcons.ts` + `GenrePicker.tsx` (buscador, iconos, tres estados).
3. `PlayersPicker.tsx` (tarjetas y rama multijugador expandible).
4. `ExtrasPicker.tsx` (sliders, fuentes, Juegos/Programas).
5. Armar el diálogo apaisado con las 3 columnas, la oración y el pie; borrar el código viejo que quede sin uso; actualizar los tests existentes.

## Verificación (la hace Claude después)

- Abrir el diálogo en el dev y sacar screenshots a 1920×1080 y a ~1100 px de ancho.
- Probar: abrir y "Mostrar" sin tocar nada devuelve lo mismo que hoy; la frase refleja cada cambio; "Limpiar todo" vuelve a los defectos; el control parental sigue bloqueando; funciona con teclado.
- Con el diseño final se hace la captura para la web de Game Access.
