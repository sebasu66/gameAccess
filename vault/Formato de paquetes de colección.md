# Paquetes de colección de Game Access · Formato 1

**Propuesta para revisión de Seba · 19 de noviembre de 2026.** Una colección agrega una vista a Librería › Jugar. Quien arma el paquete elige una distribución, aporta imágenes y textos y puede seleccionar juegos de la biblioteca. Game Access dibuja la vista y ofrece las acciones que correspondan a cada juego. La importación y la asignación local de juegos requieren PLUS.

Las decisiones de [[Colecciones]] fijan el uso de un ZIP declarativo, imágenes locales, variables y transiciones de una lista cerrada y pertenencia editable. **Se proponen** los nombres de campos, los límites, los valores iniciales y los parámetros concretos de esta versión. El documento sirve de contrato para las maquetas y los paquetes de ejemplo.

## 1. Qué se entrega

Un archivo `.zip`. Al abrirlo debe verse `collection.json` directamente. Este sería el contenido del paquete de carreras del ejemplo.

```text
collection.json
img/banner-pista.webp
img/asfalto.jpg
img/franja.png
```

| Recurso | Límite propuesto, inclusive |
|---|---|
| ZIP | 20 MiB comprimidos y 48 MiB en total al descomprimir. Se admiten entradas almacenadas o comprimidas con Deflate. |
| Manifiesto | Un archivo `collection.json`, hasta 128 KiB, JSON estricto en UTF-8 sin BOM. |
| Imágenes | Hasta 4 archivos distintos, uno por cada lugar de arte. Se puede reutilizar una imagen en varios lugares. La carpeta `img/` es opcional cuando la colección usa solo las portadas de la biblioteca. |
| Cada imagen | Hasta 8 MiB descomprimidos, de 1 a 4096 píxeles por lado y hasta 8 388 608 píxeles en total. WebP, PNG o JPEG estáticos. El contenido debe coincidir con la extensión `.webp`, `.png` o `.jpg`. |

1 KiB equivale a 1024 bytes. Se cuentan los bytes reales leídos, también al descomprimir. Solo se admiten archivos ordinarios y la entrada de directorio opcional `img/`. El ZIP debe estar completo y abrirse sin contraseña.

Cada imagen vive directamente en `img/`. Su nombre antes de la extensión tiene entre 1 y 64 caracteres ASCII, empieza con una letra minúscula o un dígito y solo admite letras minúsculas, dígitos, guiones y guiones bajos. Se excluyen los nombres de dispositivo de Windows como `con`, `nul` o `com1`. Los nombres siguen la misma regla en el índice del ZIP y en el JSON. La barra es siempre `/`. Se rechazan rutas absolutas, direcciones web, letras de unidad, barras inversas, segmentos `.` o `..`, enlaces y entradas duplicadas. Se comprueba cada nombre tal como llega antes de escribir archivos.

## 2. Cómo se lee el manifiesto

La raíz es un objeto. Los nombres de campo distinguen mayúsculas. En todos los objetos se rechazan claves desconocidas o repetidas. Omitir un campo opcional aplica el valor de la tabla. Un valor explícito `null` es inválido. Las cadenas de texto visible son texto plano, sin caracteres de control, con al menos un carácter visible y sin espacios en los extremos. Los límites de texto se cuentan en puntos de código Unicode.

| Campo | Tipo | ¿Obligatorio? | Si se omite | Ejemplo o regla |
|---|---|---|---|---|
| `formato_version` | entero positivo | Sí | — | `1`. Identifica el contrato que debe leer la app. |
| `id` | cadena | Sí | — | `linea-de-largada`. De 1 a 64 caracteres. Letras ASCII minúsculas y dígitos en grupos separados por un solo guion. Se conserva al actualizar la colección. |
| `version` | cadena SemVer | Sí | — | `"1.0.0"`. Versión de la colección elegida por su autor. Admite sufijo de prelanzamiento y metadatos según SemVer 2.0.0. |
| `autor` | texto | Sí | — | `"Taller de Pista"`, hasta 80 caracteres. |
| `idiomas` | lista de cadenas únicas | Sí | — | `["es","en"]`. Debe incluir español e inglés. Puede sumar hasta 6 idiomas más con códigos de dos letras ASCII minúsculas. |
| `nombre` | objeto de textos por idioma | Sí | — | `{"es":"Línea de largada","en":"Starting Grid"}`, hasta 60 caracteres por texto. |
| `descripcion` | objeto de textos por idioma | Sí | — | `{"es":"Tu selección de carreras.","en":"Your racing picks."}`, hasta 240 caracteres por texto. |
| `plantilla` | objeto | Sí | — | `{"nombre":"carreras"}`. Ver §3. |
| `arte` | objeto de rutas | No | `{}` | `{"banner":"img/banner-pista.webp"}`. Ver §4. |
| `colores` | objeto de variables | No | Valores de la vista de Game Access | `{"--col-acento":"#FF823C"}`. Ver §5. |
| `transiciones` | objeto | No | Sin animación declarada | `{"seleccion":{"nombre":"crecer","duracion_ms":180}}`. Ver §6. |
| `juegos` | objeto | No | `{}` | `{"app_ids":[1551360],"generos":["racing"]}`. Ver §7. |

`nombre` y `descripcion` llevan exactamente una entrada por cada código de `idiomas`. Así cada traducción se escribe una sola vez. Para mostrar la colección se busca el idioma principal de la app (por ejemplo, `es` para `es-AR`), con español como respaldo. Los botones y los nombres de género los traduce Game Access.

## 3. Plantilla y parámetros

`plantilla.nombre` es una cadena obligatoria. `plantilla.parametros` es un objeto opcional que por defecto vale `{}`. Cada variante acepta solo los parámetros de su fila. Todos son opcionales. Las cantidades son enteros y sus límites son inclusivos.

| Nombre exacto | Distribución | Parámetros admitidos y valor inicial |
|---|---|---|
| `carreras` | Banner superior y barras diagonales. Al pasar el puntero o dar foco a una barra, la portada pasa del recorte a la imagen completa dentro del marco diagonal. Aparecen Jugar, cuando corresponde, y Ficha. | `angulo_grados` de 5 a 25, inicial **14**. `barras_visibles` de 2 a 8, inicial **5**. |
| `mosaico` | Banner superior y portadas en filas. | `columnas` de 2 a 8, inicial **4**. |
| `fila` | Fondo de toda la vista y una fila con desplazamiento horizontal. | `tarjetas_visibles` de 2 a 8, inicial **4**. |
| `mazos` | Grupos con título y portadas apiladas. | `agrupar_por` admite `"mazo"` (inicial, usa el mazo local del juego) o `"inicial"` (primera letra del título). Sin mazo se usa el grupo traducido «Sin mazo». |
| `estante` | Cajas de canto. La seleccionada se adelanta para mostrar la portada. | `cajas_visibles` de 3 a 16, inicial **8**. |

Las cantidades visibles orientan el tamaño de las piezas cuando hay espacio. Al achicarse la ventana, la vista puede mostrar menos a la vez. Los juegos restantes siguen accesibles. La selección por teclado o mando produce el mismo estado que el puntero.

## 4. Arte y ausencias

Todos los campos de `arte` son cadenas opcionales con una ruta del §1. El autor puede omitir cualquier lugar. **Si escribe una ruta, el archivo pasa a ser obligatorio.** Dos lugares pueden apuntar al mismo archivo. Toda imagen incluida en el ZIP debe aparecer al menos una vez en este objeto.

| Campo | Uso | Cuando se omite |
|---|---|---|
| `banner` | Cabecera ancha de `carreras` y `mosaico`. Ej. `img/banner-pista.webp`. Solo estas dos variantes admiten el campo. | Cabecera compacta con el nombre traducido y el color de la superficie. |
| `fondo` | Fondo de la vista en cualquier variante. Ej. `img/asfalto.jpg`. | Se usa el color de fondo. |
| `adorno_izquierdo` | Imagen decorativa del lateral izquierdo. Ej. `img/franja.png`. | El lateral queda libre. |
| `adorno_derecho` | Imagen decorativa del lateral derecho. Ej. `img/franja.png`. | El lateral queda libre. |

Las portadas de los juegos se obtienen de la biblioteca. Si falta una, se conserva el título y se usa el reemplazo habitual de Game Access.

## 5. Variables admitidas en `colores`

La lista es cerrada. Todos los valores son cadenas. Para colores se admiten exactamente `#` y seis dígitos hexadecimales. Para medidas se admite un entero decimal sin signo seguido inmediatamente de `px`. Cada campo es opcional y afecta solo la vista de la colección. Las referencias a otras variables, funciones, URLs y expresiones CSS se rechazan.

| Variable | Tipo y límites | Si se omite | Ejemplo |
|---|---|---|---|
| `--col-fondo` | Color | Fondo del contenido activo | `"#101820"` |
| `--col-superficie` | Color | Superficie del panel activo | `"#202B35"` |
| `--col-tinta` | Color | Texto principal de la vista | `"#FAFAFA"` |
| `--col-acento` | Color | Resalte del modo actual | `"#FF823C"` |
| `--col-borde` | Color | Color de borde del panel | `"#71808E"` |
| `--col-radio` | De 0 a 32 px | Radio de las tarjetas de la vista | `"12px"` |
| `--col-grosor-borde` | De 0 a 4 px | Grosor de borde de las tarjetas | `"1px"` |

## 6. Transiciones

Hay dos momentos opcionales en `transiciones`. `entrada` se aplica al abrir la vista y `seleccion` al cambiar la pieza activa. Cada uno recibe un objeto con estos campos.

| Campo | Tipo | ¿Obligatorio? | Si se omite | Valores |
|---|---|---|---|---|
| `nombre` | cadena | Sí, si se declara el momento | — | `ninguna` (cambio inmediato), `fundido` (opacidad), `deslizar` (desplazamiento), `crecer` (escala) o `inclinar` (inclinación plana). |
| `duracion_ms` | entero | No | **0** para `ninguna` y **200** para las demás | Para `ninguna` solo se acepta 0. Para las otras, de **80 a 600** ms inclusive. Ej. `180`. |

Un momento ausente equivale a `{"nombre":"ninguna","duracion_ms":0}`. La transición afecta el paso entre estados. En carreras, el marco conserva la misma diagonal y la barra elegida se abre incluso con cambio inmediato. Si se elige `inclinar`, el efecto se aplica al contenido interior.

## 7. Juegos de la colección

| Campo de `juegos` | Tipo | ¿Obligatorio? | Si se omite | Ejemplo |
|---|---|---|---|---|
| `app_ids` | Lista de hasta 2048 enteros únicos entre 1 y 4 294 967 295 | No | `[]` | `[1551360,244210]` |
| `generos` | Lista de hasta 64 identificadores únicos del vocabulario de géneros de Game Access | No | `[]` | `["racing","sports"]`. Se usan los identificadores estables del catálogo, por ejemplo `survival` para supervivencia. |

Entra cada juego de la biblioteca que coincida por AppID **o** por cualquiera de los géneros. Un juego que coincida dos veces aparece una sola vez. Un AppID ausente en la biblioteca es válido y se verá si el juego se incorpora más adelante. Con ambas listas vacías se obtiene una colección vacía válida. Sobre esa selección se suman las inclusiones locales y se quitan las exclusiones locales. La exclusión prevalece si hubiera conflicto. Estas preferencias pertenecen al usuario y se guardan fuera del ZIP.

## 8. Versión y validación antes de guardar

`formato_version` comienza en **1**. Cada revisión que cambie lo que puede contener o significar un paquete recibe un entero nuevo. La app usa las reglas y los valores iniciales de la versión declarada. Una app que conozca la versión 2 deberá seguir aceptando paquetes válidos de la 1. Una app que conozca hasta la 1 rechaza una versión 2 y explica cómo continuar. Cero, valores negativos, decimales y cadenas no designan una versión. La `version` del autor puede cambiar con solo reemplazar una imagen y se evalúa por separado.

El importador sigue este orden y muestra el primer error con el nombre del archivo o campo que se debe corregir. Los textos entre llaves se sustituyen al mostrar el mensaje. Se guarda la colección completa una vez superados todos los pasos. Un fallo conserva la versión instalada y sus asignaciones locales.

| Paso | Comprobación | Mensaje para quien importa |
|---|---|---|
| 1 | Tamaño del ZIP | «El paquete supera los 20 MiB. Reducí el tamaño de las imágenes y volvé a comprimirlo.» |
| 2 | ZIP legible, completo, sin cifrado y con compresión admitida | «No pudimos abrir el ZIP. Volvé a crearlo sin contraseña, con compresión normal o sin compresión.» |
| 3 | Rutas internas seguras y únicas, archivos ordinarios | «La entrada “{ruta}” no se puede usar. Quitá enlaces, rutas externas y nombres repetidos. Guardá cada imagen directamente en img/ con un nombre simple en minúsculas.» |
| 4 | Manifiesto en la raíz y solo entradas admitidas | «Falta collection.json en la raíz. Comprimí el archivo junto con img/ y dejá afuera la carpeta que los contiene.» / «Sacá “{ruta}” del ZIP. Solo se admiten collection.json e imágenes WebP, PNG o JPG en img/.» |
| 5 | Cantidad y límites de bytes declarados y reales, e integridad durante la lectura | «El paquete excede el límite de {límite}. Reducí {recurso} y volvé a comprimirlo.» / «No pudimos leer “{ruta}” completo. Volvé a crear el ZIP desde los originales.» |
| 6 | Manifiesto legible, UTF-8, JSON válido, un objeto en la raíz y claves únicas | «Revisá collection.json cerca de {ubicación}. Guardalo como un objeto JSON en UTF-8 sin BOM, sin comentarios, comas finales ni campos repetidos.» |
| 7 | Presencia, tipo y compatibilidad de `formato_version` | «Indicá la versión del formato en formato_version con un entero a partir de 1.» / «Este paquete usa el formato {versión}. Tu Game Access entiende hasta el {máxima}. Actualizá la app o pedí el paquete en un formato anterior.» |
| 8 | Campos obligatorios, tipos, claves conocidas, identidad y traducciones | «Falta “{campo}”. Agregalo en {lugar}.» / «Revisá “{campo}”. El formato admite {regla}.» / «Quitá el campo “{campo}” de {lugar}.» / «Completá nombre y descripcion para {idioma} y comprobá que idiomas incluya es y en.» |
| 9 | Plantilla y parámetros propios de la variante | «La plantilla “{valor}” es desconocida. Elegí carreras, mosaico, fila, mazos o estante.» / «Revisá “{campo}” en la plantilla {plantilla}. Los valores permitidos son {regla}.» |
| 10 | Lugares de arte admitidos, rutas internas, archivos referenciados y archivos sobrantes | «La plantilla {plantilla} no usa “{lugar}”. Quitá esa entrada de arte.» / «Corregí la ruta de {lugar}. Elegí un archivo dentro de img/ con el formato img/nombre.webp, .png o .jpg.» / «Falta “{ruta}”. Agregá esa imagen al ZIP o corregí su nombre en arte.» / «La imagen “{ruta}” está en el ZIP y ningún lugar la usa. Asignala en arte o sacala del paquete.» |
| 11 | Contenido, extensión, dimensiones y un solo fotograma | «Revisá “{ruta}”. Exportala como imagen estática {formato}, de hasta 4096 píxeles por lado y 8 388 608 píxeles en total.» |
| 12 | Lista de variables, colores y medidas | «La variable “{campo}” no está admitida. Elegí una de la tabla de colores o quitala.» / «El color de “{campo}” debe tener seis dígitos después de #, por ejemplo #FF823C.» / «Usá una medida entera de {mínimo}px a {máximo}px en “{campo}”.» |
| 13 | Momento, nombre y duración de la transición | «Elegí entrada o seleccion en transiciones.» / «La transición “{valor}” es desconocida. Elegí ninguna, fundido, deslizar, crecer o inclinar.» / «Para {nombre} usá {intervalo} en duracion_ms.» |
| 14 | AppIDs, géneros conocidos, cantidades y duplicados | «Revisá juegos.app_ids. Usá hasta 2048 números enteros distintos entre 1 y 4294967295.» / «Revisá juegos.generos. Usá hasta 64 géneros distintos del catálogo. Para carreras, por ejemplo, escribí racing.» |

Para conservar mensajes específicos, en el paso 8 se revisan la raíz y los campos de identidad y traducción. Los objetos de las secciones restantes se revisan en sus propios pasos. En cualquier paso se puede usar el mensaje de campo obligatorio o tipo incorrecto cuando corresponda.

## 9. Ejemplo completo · Línea de largada

El siguiente bloque se puede guardar directamente como `collection.json`. Sus comentarios de lectura están debajo para que el archivo siga siendo JSON válido.

```json
{
  "formato_version": 1,
  "id": "linea-de-largada",
  "version": "1.0.0",
  "autor": "Taller de Pista",
  "idiomas": ["es", "en"],
  "nombre": {
    "es": "Línea de largada",
    "en": "Starting Grid"
  },
  "descripcion": {
    "es": "Elegí una barra para ver el auto y salir a la pista.",
    "en": "Pick a strip to reveal the car and head to the track."
  },
  "plantilla": {
    "nombre": "carreras",
    "parametros": {"angulo_grados": 14, "barras_visibles": 5}
  },
  "arte": {
    "banner": "img/banner-pista.webp",
    "fondo": "img/asfalto.jpg",
    "adorno_izquierdo": "img/franja.png",
    "adorno_derecho": "img/franja.png"
  },
  "colores": {
    "--col-fondo": "#101820",
    "--col-superficie": "#202B35",
    "--col-tinta": "#FAFAFA",
    "--col-acento": "#FF823C",
    "--col-borde": "#71808E",
    "--col-radio": "12px",
    "--col-grosor-borde": "1px"
  },
  "transiciones": {
    "entrada": {"nombre": "fundido", "duracion_ms": 240},
    "seleccion": {"nombre": "crecer", "duracion_ms": 180}
  },
  "juegos": {"app_ids": [1551360, 244210], "generos": ["racing"]}
}
```

- **Qué se ve al abrir.** Arriba aparece la imagen panorámica de la pista. Debajo, cinco barras en diagonal cuando hay espacio. Una sola franja PNG decora ambos lados.
- **Qué pasa al elegir una barra.** Se expande durante 180 ms y revela la portada completa y las acciones. El marco conserva sus 14 grados.
- **Qué juegos entran.** La vista reúne los dos AppID si están en la biblioteca y todos los juegos con el concepto `racing`. Quitar uno desde el Manager lo oculta en esta colección.
