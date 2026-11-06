# Tarea: terminar la internacionalización (es / en)

Para el modelo barato: codifica. Claude verifica después.

## Estado real (medido)

- Ya existe un módulo central: `apps/desktop/src/i18n.ts` (`useI18n()`, `translate()`, `es` y `en` tipados, 202 claves, paridad es/en completa). **No hay que crear otro sistema.**
- El problema es la cobertura: unos 200 textos siguen escritos a mano dentro de ~30 componentes `.tsx` (JSX, `title`, `aria-label`, `placeholder`, `alt`), más textos en archivos `.ts` (mensajes de error, etiquetas como `featureLabel`, `genreLabel`, `dateWords`, frases de `filterSentence.ts`). Con el idioma en inglés se ven palabras en español, y al revés.
- Los peores: `LibraryDetailPanel.tsx`, `App.tsx`, `AppLibrarySphere.tsx`, `DownloadCatalogPanel.tsx`, `SteamStoreDetail.tsx`, `SentencePanels.tsx`, `LibraryFilterDialog.tsx`, `GenrePicker.tsx`, `LibraryRoomParts.tsx`, `BigScreenControls.tsx`, `LibraryInputController.tsx`, `GameStorageContextMenu.tsx`, `AppCards.tsx`, `ParentalControlSection.tsx`, `AppSessionOverlay.tsx`.

## Reglas

- Rama `dev`, commits chicos (uno por grupo de archivos), sin push. Trailers del repo en cada commit.
- No tocar plugins, ni lógica, ni `apps/desktop/public/brand/logo-opening.mp3`.
- Español simple, sin jerga (voseo: "Elegí", "Tocá"). El inglés natural, no traducción literal.
- Nombres propios y marcas no se traducen (Steam, GameAccess, PLUS, nombres de fuentes).
- Claves con prefijo por pantalla (`filters…`, `detail…`, `library…`). Nada de textos duplicados: reutilizar la clave existente si ya dice lo mismo.

## Pasos

1. **Dividir el diccionario.** Mover `es` y `en` a `src/locales/es.ts` y `src/locales/en.ts` (mismo contenido, `i18n.ts` los importa). Sin cambiar claves ni comportamiento.
2. **Test de paridad.** Un test que falle si una clave está en un idioma y no en el otro, o si un valor en inglés es igual al español (lista corta de excepciones: marcas).
3. **Componentes uno por uno** (orden de la lista de arriba): pasar cada texto fijo a `t("clave")`. Textos con variables usan `{{param}}` (ya soportado).
4. **Archivos `.ts`**: las funciones que devuelven texto (`filterSentence.ts`, `featureLabel`, `dateWords`, `PLAYER_MODE_WORDS`, etiquetas de géneros) reciben el idioma o usan `translate()`. Los tests existentes se actualizan para correr en `es` y en `en`.
5. **Guardia automática.** Un test (o script `npm run check:i18n`) que recorra los `.tsx` y falle si encuentra texto visible o `title/aria-label/placeholder/alt` literal con letras, salvo lista de excepciones explícita. Así nadie vuelve a escribir texto a mano.
6. **Revisión visual**: abrir la app en `es` y en `en` (selector de idioma) y pasar por catálogo, filtros, detalle, biblioteca, ajustes, descargas y gran pantalla. Anotar lo que quede sin traducir.

## Verificación (la hace Claude después)

- `npx tsc --noEmit` y `npm test` (ojo: en la terminal de Seba hay que poner `$env:NODE_ENV='test'` antes de vitest).
- Screenshots en `en` y en `es` de las pantallas de arriba, sin mezcla de idiomas.
- El test de paridad y la guardia pasan.
