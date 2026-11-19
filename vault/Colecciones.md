---
tipo: nota
actualizado: 2026-11-19
---
# Colecciones — paquetes de vista para Librería › Jugar

> **Qué es.** Una colección es una **vista de juegos personalizada** que llega como un paquete (un zip con un JSON y sus imágenes), se valida al importarla y después aparece en Librería › Jugar como un modo de vista más, al lado de los que ya hay: «Juegos de carreras», «Deportes», «Supervivencia». El paquete dice la distribución, dónde va cada imagen, qué transiciones usa y el color; no trae código.
> **Plan.** Importar una colección, crearla y asignarle juegos es **PLUS**, como toda la personalización del contenido (label, portada, mazo). Importar juegos y cambiarles idioma y ejecución es **BASE**.
> Decisiones de diseño y orden de implementación: ver más abajo, [[Tareas]] y [[Log]].

## Decisiones tomadas (Seba + Claude, 2026-11-19)

1. **El género del catálogo no se toca.** Es dato de la base, de solo lectura. El campo local que ya existe (`gameCard.genre`) solo decide **en qué mazo** aparece el juego en Jugar › Por género, así que en la interfaz se llama **Mazo**, no «Género principal». Las colecciones son el otro eje, el curado.
2. **v1 del paquete es declarativo: sin llamadas a funciones.** Banner, fondo, variante de distribución y transiciones son dato. La API invocable desde el JSON se agrega después, con lista blanca, cuando haya un caso que la pida: es justo la parte que puede romper la ventana.
3. **CSS con lista blanca, no CSS libre.** El paquete declara un juego fijo de variables nuestras que la plantilla lee (`--col-*`). Nada de hojas de estilo abiertas: un paquete con CSS libre puede tapar la aplicación entera o llamar afuera por un `url()`. Las imágenes salen **solo de dentro del zip**; ninguna dirección web.
4. **Cada vista de colección se dibuja dentro de un límite de error**, para que un paquete malo se apague solo y no se lleve la ventana.
5. **Pertenencia en dos capas.** El paquete trae la plantilla, el arte y *opcionalmente* qué juegos (por app id de Steam o por concepto de género); la asignación local del usuario suma y resta encima. Así sirve igual un paquete que viene con juegos y uno vacío que el usuario llena desde el Manager.
6. **El importador valida antes de guardar.** Una colección existe en la aplicación solo después de pasar la validación.

## Orden de implementación

| # | Qué | Quién |
|---|---|---|
| 1 | Manager lista-detalle (layout, limpieza de comandos de espacio, grupos colapsables, propiedades en el detalle con candado PLUS) | Claude |
| 2 | **Especificación del paquete** (`collection.json`) | ChatGPT — *Encargo 1* |
| 3 | **Maquetas de las variantes de distribución**, HTML suelto | ChatGPT — *Encargo 2* |
| 4 | **Paquetes de ejemplo**, buenos y rotos a propósito | ChatGPT — *Encargo 3* |
| 5 | Store + importador + validador + límite de error | Claude |
| 6 | La colección como un modo de vista más en Jugar | Claude |
| 7 | «Asignar colección» en el Manager (campo en el detalle y botón para varios marcados) | Claude |
| 8 | Editor nativo de colecciones | Claude |
| 9 | **La skill** para que un modelo arme paquetes solo | ChatGPT — *Encargo 4* |

Lo que **no** va a ChatGPT: el importador, el store, el límite de error y cualquier cosa que toque las plantillas de diseño o las stores de la app. Ahí el contexto del repositorio es el trabajo.

---

# Encargos para ChatGPT

> Para Seba: pasale **Encargo 1** primero y solo. Los encargos 2 y 3 pueden ir en paralelo con el 1 pero son más útiles después de que el 1 esté firme; el 4 va al final, cuando el formato no se mueva más.
> Cada encargo está escrito para que se entienda **sin ver nuestro código**: no hace falta darle nada más.

## Encargo 1 — La especificación del paquete de colección

Contexto que le das: *Game Access es una aplicación de escritorio (Windows) que organiza la biblioteca de juegos de PC. Queremos que el usuario pueda instalar «colecciones»: vistas personalizadas de sus juegos, que llegan como un paquete y aparecen en la aplicación como un modo de vista más. El paquete es un zip con un `collection.json` y sus imágenes. No contiene código.*

Lo que tiene que entregar: **un documento de especificación en Markdown** (en español) del formato, con esto dentro.

1. **El zip.** Qué archivos lleva y con qué nombres (`collection.json` obligatorio en la raíz; una carpeta `img/` para las imágenes). Rutas siempre relativas y siempre dentro del zip: nada de `..`, rutas absolutas ni direcciones web. Topes: tamaño del zip (propone uno, del orden de 20 MB), cantidad de imágenes, tamaño de cada imagen, formatos aceptados (webp, png, jpg).
2. **El `collection.json`,** campo por campo, con tipo, si es obligatorio, valor por defecto y un ejemplo. Como mínimo:
   - identidad: `id` (slug), `nombre`, `version` (semver), `autor`, `descripcion`, `idiomas` (los textos del paquete en varios idiomas: por lo menos `es` y `en`);
   - `plantilla`: el nombre de la variante de distribución (ver Encargo 2) y sus parámetros;
   - `arte`: qué imagen va en cada lugar (banner, fondo, adorno de los costados), cada una apuntando a un archivo del zip, y qué hacer cuando falta;
   - `colores`: el juego fijo de variables (`--col-fondo`, `--col-tinta`, `--col-acento`, `--col-radio`, `--col-borde`…). **Vos propone la lista cerrada**: cuáles son, qué tipo de valor acepta cada una (color, largo en px o rem, número) y los límites. Nada fuera de esa lista se acepta.
   - `transiciones`: nombres de un conjunto cerrado (por ejemplo `ninguna`, `fundido`, `deslizar`, `crecer`, `inclinar`) con su duración en milisegundos, con topes mínimo y máximo.
   - `juegos`: la pertenencia que trae el paquete, opcional. Dos formas que se suman: `app_ids` (números de Steam) y `generos` (conceptos como `racing`, `sports`, `survival`). Si no hay ninguna, la colección arranca vacía y el usuario le asigna los juegos.
3. **Las reglas de validación**, como lista de comprobaciones concretas y en orden, cada una con **el mensaje de error que le mostraríamos al usuario, en español, explicando qué arreglar** (no códigos ni jerga). Ejemplos de lo que tiene que cubrir: el JSON no parsea, falta un campo obligatorio, la versión del formato no la entendemos, una imagen declarada no está en el zip, una imagen del zip que nadie declara, una ruta que se escapa del zip, un color que no es color, una duración fuera de rango, una variable de color que no está en la lista, un nombre de plantilla desconocido, el zip pasado de tamaño.
4. **`formato_version`**: cómo versionamos la especificación y qué hace la aplicación con un paquete de una versión más nueva de la que conoce (rechazarlo con un mensaje claro) o más vieja (aceptarlo).
5. **Un ejemplo completo y comentado** del `collection.json` de la colección de carreras que describimos abajo.

Lo que **no** tiene que hacer: nada de JavaScript, ni de nuestra aplicación, ni tests, ni código de validación. Solo el documento del formato. Si algo no está decidido, que **proponga** un valor y lo marque como propuesta en vez de dejarlo abierto.

## Encargo 2 — Las maquetas de las variantes de distribución

Lo que tiene que entregar: **un archivo `.html` independiente por variante** (todo dentro: HTML, CSS y, si hace falta para el hover, un poco de JS propio), que se abra con doble clic y se vea funcionando con 12 juegos de mentira. Cada archivo lleva arriba, en un comentario, qué parámetros necesitaría del `collection.json`.

Reglas para las maquetas:

- Fondo oscuro, nada de librerías ni fuentes de internet (fuentes del sistema), nada de imágenes externas: un rectángulo de color con el nombre del juego hace de portada.
- Todo medido con variables CSS al principio del archivo, para que después se puedan reemplazar por las nuestras.
- Que funcione de 1000 px de ancho hasta 1920 px.

Las variantes que queremos ver:

1. **Carreras** (la que describió Seba, la más importante): un **banner ancho arriba** con la imagen que el usuario elija (un auto, una pista, cualquier cosa) y, debajo, los juegos acomodados en **barras diagonales** que muestran solo una parte de la imagen; al pasar el cursor, la barra **se expande** y se ve la imagen completa, **todavía en diagonal**, con los botones de **Jugar** y uno o dos más. Simple: sin profundidad 3D ni rotaciones raras, la diagonal se mantiene siempre.
2. **Con banner arriba** y los juegos en mosaico normal.
3. **Con imagen de fondo** a toda la vista y los juegos en una fila que se desliza de costado.
4. **En mazos**: grupos con un título cada uno y los juegos apilados como cartas.
5. **En estante**: los juegos de canto, como cajas en una repisa, y el elegido se adelanta.

## Encargo 3 — Paquetes de ejemplo

Cuando el Encargo 1 esté entregado, que arme los zips de ejemplo **según esa especificación**:

- **Tres buenos**: carreras, deportes y supervivencia. Las imágenes pueden ser placas de color generadas por él (no hace falta arte real), con el tamaño y el formato que diga la especificación.
- **Siete rotos a propósito**, uno por cada clase de error, con una línea que diga qué está mal en cada uno: JSON que no parsea, campo obligatorio ausente, imagen declarada que no está, ruta que se escapa del zip (`../`), color inválido, variable de color que no está en la lista, plantilla desconocida.

Son el material con el que probamos el importador.

## Encargo 4 — La skill para armar colecciones

Al final, cuando el formato no se mueva más: **un archivo que un modelo pueda leer para armar paquetes de colección solo**, a partir de lo que pida el usuario («quiero una colección de juegos de terror con fondo oscuro y las portadas en mosaico»). Lleva el formato entero, la lista cerrada de variables y transiciones, las variantes de distribución con sus parámetros, los límites, los errores frecuentes y dos o tres ejemplos completos. Que termine diciendo cómo se empaqueta el zip y cómo se importa en Game Access.

---

## La colección de carreras (lo que pidió Seba, 2026-11-19)

Es el caso de referencia para la especificación y la primera maqueta:

- **Arriba, un banner ancho** con una imagen que pone el usuario: un auto, una pista, lo que sea.
- **Debajo, los juegos en barras diagonales.** Cada barra muestra solo una parte de la imagen del juego.
- **Al pasar el cursor, la barra se expande** y muestra la imagen completa, **sin salir de la diagonal**, con los botones de Jugar y alguno más.

Nada más que eso: la gracia está en la diagonal y en que se expanda.
