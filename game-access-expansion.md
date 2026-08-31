# Game Access

## Documento de ampliación del proyecto

### De launcher y gestor de bibliotecas a entorno social 3D para descubrir, organizar y jugar

**Nombre de trabajo actual:** Game Access  
**Nombre definitivo:** pendiente de definir  
**Tipo de documento:** visión de producto, requisitos funcionales, ideas de diseño y sugerencias de implementación  
**Fecha:** 31 de agosto de 2026

---

## 1. Cómo leer este documento

Este documento describe una ampliación importante del proyecto existente llamado provisoriamente **Game Access**. No parte de la base de que el lector conozca las conversaciones anteriores ni de que conozca el objetivo original del programa.

Algunas partes son requisitos o decisiones recomendadas. Otras son ideas exploratorias: pueden modificarse, posponerse o descartarse después de probar un prototipo. Para distinguirlas:

- **Objetivo:** dirección principal del producto.
- **Propuesta:** forma recomendada de implementarlo.
- **Idea futura:** posibilidad que todavía no debe tratarse como requisito del primer lanzamiento.

La intención no es construir todo de una vez, sino conservar todas las ideas relevantes y convertirlas en un camino de implementación gradual.

## 2. Punto de partida: qué problema quiere resolver Game Access

Steam es muy útil para comprar, instalar y ejecutar juegos, pero su experiencia puede resultar poco atractiva para descubrir lo que el usuario ya tiene. Una biblioteca grande se presenta principalmente como una lista o una grilla. Ese formato es eficiente cuando la persona ya sabe qué juego quiere abrir, pero no necesariamente la invita a recorrer su colección, recordar juegos antiguos, descubrir títulos olvidados o compartir esa experiencia con amigos.

Además, una misma PC puede tener juegos instalados pertenecientes a varias cuentas de Steam. Cuando se consulta la biblioteca de manera superficial, puede parecer que todos los juegos instalados pertenecen a la cuenta actualmente seleccionada. El usuario necesita distinguir:

- juegos propios de la cuenta actual;
- juegos disponibles mediante Family Sharing, cuando Steam lo permite;
- juegos instalados por otra cuenta local;
- juegos instalados pero no disponibles para la sesión actual;
- juegos que podrían jugarse después de cambiar de cuenta mediante un flujo autorizado;
- juegos que todavía necesitan descargarse.

Game Access puede funcionar como interfaz unificada para organizar varias cuentas propias en la misma PC, sin convertirse en una alternativa que suplante la seguridad, las licencias o la ejecución de Steam.

La ampliación agrega una segunda dimensión: no limitarse a mostrar una biblioteca mejor ordenada, sino convertir el descubrimiento de juegos en una experiencia espacial, visual y social.

## 3. Visión general del producto ampliado

Game Access sería una aplicación de escritorio que combina cuatro capas:

1. **Biblioteca:** reúne y organiza información de juegos de las cuentas locales autorizadas.
2. **Integración con Steam:** deriva a Steam las operaciones que Steam debe controlar: autenticación, licencias, descargas, actualizaciones y ejecución.
3. **Experiencia 3D:** presenta juegos, colecciones y contenido dentro de un entorno virtual navegable.
4. **Comunidad:** permite encontrarse con amigos, conversar, compartir contenido sincronizado y organizar partidas.

La idea central es un **contenedor de juegos**: un lugar virtual que el usuario puede recorrer como si fuera una pequeña experiencia jugable. Los juegos no aparecen únicamente como filas de texto, sino también como objetos, carteles, estanterías, televisores, máquinas arcade, cuadros y pantallas gigantes.

La pantalla inicial o **Home** debería poder ser, en el futuro, una vista social 3D. Al entrar, el usuario podría ver a otros usuarios autorizados, saber quién está jugando o mirando contenido y elegir si quiere recorrer el espacio, abrir la biblioteca rápida o entrar directamente a una sala.

La grilla tradicional no desaparece. Sigue siendo necesaria para buscar por nombre, género, cuenta, estado de instalación o filtro. El entorno 3D se usa para descubrir, explorar, ambientar y compartir.

El nombre actual es provisional. Cuando la propuesta deje de ser principalmente un launcher, convendrá elegir un nombre que represente mejor una casa virtual, arcade social, museo interactivo o club de juegos.

## 4. La metáfora espacial: una casa, un arcade o un museo

La primera imagen conceptual fue una casa 3D con distintas habitaciones. Luego apareció una alternativa posiblemente más adecuada: un **arcade o club de juegos** como zona principal comunitaria, acompañado por áreas tranquilas y temáticas.

No es necesario decidir ahora que todo el producto será literalmente una casa. Lo importante es la organización espacial: las colecciones se distribuyen en lugares que el usuario puede reconocer y recordar.

### Ejemplos de zonas

#### Arcade central

Zona social activa con máquinas que representan juegos multijugador, una pantalla de novedades, áreas de espera, mesas, un tablero de partidas próximas y accesos a salas temáticas.

#### Sala cozy o biblioteca

Zona tranquila para juegos de un jugador, RPG, aventuras y experiencias narrativas. Los títulos pueden aparecer en estanterías, televisores, cuadros, consolas representadas visualmente o mesas.

#### Museo de juegos

Exposición con información histórica, portadas, fechas, desarrolladores, géneros, capturas, videos, curiosidades y juegos relacionados. Puede contener salas dedicadas a consolas, estudios, géneros o períodos.

#### Cine o sala de proyección

Pantalla grande para trailers, gameplays, reseñas o listas seleccionadas. Puede ser una experiencia individual o compartida con quienes estén presentes.

#### Salas temáticas

Una zona puede dedicarse a una saga o juego concreto. Por ejemplo, una sección de God of War podría tener carteles, estatuas, colores, música ambiental, pantallas con gameplay y un sillón desde el cual iniciar un título disponible. Una zona de Grand Theft Auto podría presentar material histórico de la serie y títulos disponibles.

Estos son ejemplos de ambientación, no una autorización para copiar assets, música, personajes o material protegido.

## 5. Qué hace el usuario dentro del entorno

La experiencia debe sentirse como un espacio interactivo, pero no necesita la complejidad de un videojuego comercial.

### Acciones básicas

- caminar o desplazarse;
- mirar con el mouse;
- acercarse a una pantalla u objeto;
- recibir una indicación de que el objeto es interactivo;
- abrir la ficha de un juego;
- reproducir un trailer o video;
- cambiar entre vista 3D, modo enfocado y pantalla completa;
- iniciar una descarga a través de Steam cuando sea posible;
- iniciar un juego a través de Steam;
- invitar a amigos;
- entrar o crear una sala;
- volver al espacio después de cerrar el juego.

### Controles iniciales

- **WASD o flechas:** desplazamiento;
- **mouse:** mirar alrededor;
- **Esc:** liberar el cursor o abrir el menú;
- **Enter o E:** interactuar;
- **Tab:** abrir biblioteca o amigos;
- **clic:** seleccionar una pantalla, máquina o botón.

También puede existir un modo alternativo para quien no desea usar primera persona: clic para moverse, cámara libre o navegación mediante mapa.

### Objetos interactivos

El modelo visual no debe contener directamente la lógica de Steam. Una máquina arcade emite una acción con un `appId`; una capa de orquestación decide si el juego está disponible, instalado o requiere abrir Steam.

```ts
type InteractiveObject = {
  id: string;
  kind: "game" | "screen" | "poster" | "arcade" | "door" | "lobby";
  action: "openGame" | "playMedia" | "enterRoom" | "launchGame";
  payload?: Record<string, unknown>;
};
```

## 6. Biblioteca espacial y vista tradicional

La biblioteca unificada debe funcionar en dos modos complementarios.

### Vista rápida

Sirve para buscar por nombre, ordenar por última ejecución, fecha o género, filtrar por instalado/no instalado/disponible, ver la cuenta asociada e iniciar instalación o ejecución.

### Vista espacial

Sirve para recorrer colecciones, descubrir títulos olvidados, asociar una colección con una ambientación, mostrar material visual y compartir la exploración con amigos.

Un juego puede aparecer en varias zonas mediante referencias sin duplicar su registro. Un título multijugador, por ejemplo, puede estar en el arcade y también en una sala de su género.

```ts
type GameRecord = {
  appId: number;
  title: string;
  sourceAccountId: string;
  installed: boolean;
  playableNow: boolean;
  availability: "owned" | "family" | "installedOtherAccount" | "unknown";
  installState?: "notInstalled" | "queued" | "downloading" | "paused" | "ready" | "error";
  media: {
    cover?: string;
    screenshots?: string[];
    trailer?: string;
  };
};
```

`playableNow` debe representar una conclusión de Game Access basada en la información disponible, no una promesa de que Steam aceptará la ejecución. Steam conserva la decisión final.

## 7. Comunidad, amigos y presencia

El espacio 3D no debe ser solamente una animación individual. Una parte importante de la idea es que los usuarios puedan reunirse.

### Presencia

El sistema puede mostrar estados como conectado en el arcade, explorando una sala, viendo un video, esperando una partida, jugando, ausente o desconectado. La visibilidad debe ser configurable: offline, solo amigos o contactos seleccionados.

### Amigos de varias cuentas

Game Access puede mostrar una lista combinada de amigos procedentes de cuentas Steam locales autorizadas por la misma persona, complementada por contactos propios de Game Access.

La interfaz debe distinguir:

- las cuentas Steam del propietario del dispositivo;
- la cuenta social de Game Access;
- el origen de cada amigo;
- las acciones que dependen de Steam.

### Avatares

Los avatares pueden comenzar siendo cuerpos low-poly con color, accesorio, nombre, estado y animaciones básicas. No hace falta iniciar con captura facial, modelos realistas o personalización compleja.

### Chat y lobbies

Funciones posibles:

- chat de texto por sala;
- mensajes directos;
- chat de voz por proximidad o grupo;
- invitación a sala o juego;
- lista de participantes;
- botón para volver a biblioteca o Steam;
- bloqueo, silenciamiento y reporte.

Una sala puede funcionar como lobby físico: los usuarios se encuentran, conversan y luego interactúan con una puerta, máquina o zona para iniciar una actividad.

## 8. Experiencia compartida de videos e imágenes

Una función importante es decirle a un amigo “mirá este video” y verlo al mismo tiempo, en vez de enviar un enlace y dejar que cada persona lo reproduzca por separado.

### Reproducción sincronizada

```ts
type SharedMediaState = {
  mediaId: string;
  status: "playing" | "paused" | "ended";
  positionSeconds: number;
  playbackRate: number;
  changedAtServerMs: number;
  controllerUserId: string;
};
```

Cuando alguien pausa o adelanta, el cliente envía una orden al servidor. El servidor valida el permiso, actualiza el estado y lo distribuye. Cada cliente calcula la posición esperada y corrige pequeñas diferencias.

### Modos de visualización

1. **Pantalla dentro del mundo:** el video forma parte de la sala.
2. **Modo enfocado:** la pantalla se vuelve plana y queda frente a la cámara, manteniendo visible parte del entorno.
3. **Pantalla completa:** el contenido ocupa la ventana, pero chat y voz siguen activos.

### Implementación con Three.js

Un video HTML puede convertirse en textura 3D:

```ts
const video = document.createElement("video");
video.src = mediaUrl;
video.crossOrigin = "anonymous";
video.playsInline = true;

const texture = new THREE.VideoTexture(video);
const material = new THREE.MeshBasicMaterial({ map: texture });
const screen = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.25), material);
scene.add(screen);
```

En producción hay que agregar permisos, errores de reproducción, codecs compatibles, pausa por distancia y una política para no mantener decenas de videos activos.

## 9. Integración con Steam: límites y responsabilidades

Steam debe seguir siendo la autoridad para las acciones sensibles.

### Steam conserva el control sobre

- autenticación y Steam Guard;
- cuentas y sesiones;
- propiedad o licencia de los juegos;
- Family Sharing;
- restricciones regionales o de producto;
- instalación, actualización y verificación;
- inicio del juego;
- protección antitrampas y requisitos propios.

### Game Access puede aportar

- descubrimiento de cuentas locales autorizadas;
- biblioteca unificada;
- filtros y estados claros;
- interfaz 3D;
- información enriquecida;
- organización espacial;
- amigos y salas propias;
- monitoreo local de procesos y cambios de instalación;
- estimaciones de descarga;
- transición entre el entorno y Steam.

### Acceso temporal y Family Sharing

La idea de una “sesión prestada” debe tratarse con especial cuidado. Game Access puede trabajar con mecanismos que Steam permita explícitamente, como Family Sharing cuando la relación, el juego y la sesión cumplen sus condiciones.

No debe diseñarse un sistema para interceptar, copiar o reutilizar credenciales, tokens o sesiones de terceros, ni para evadir límites de Steam. Si en el futuro se ofrece acceso a juegos de otra persona o entidad, debe existir autorización expresa, separación de cuentas y revisión legal. El producto no debe describirse como transferencia de propiedad de un juego o de una cuenta.

## 10. Inicio de juegos y vuelta al mundo 3D

La experiencia ideal es que el usuario elija un juego dentro del entorno, Steam haga su trabajo y Game Access vuelva a aparecer cuando el juego termine.

### Flujo recomendado

1. El usuario interactúa con una pantalla, máquina arcade o ficha.
2. Game Access consulta el estado local.
3. Si no está instalado, muestra la opción de instalar y deriva la acción a Steam.
4. Si está instalado pero la cuenta no puede jugarlo, explica el motivo y muestra alternativas autorizadas.
5. Si es ejecutable, solicita el lanzamiento mediante el mecanismo permitido por el sistema y Steam.
6. El mundo 3D pasa a modo suspendido o de bajo consumo.
7. Un monitor observa el proceso relevante.
8. Al cerrarse el juego, Game Access restaura el mundo y actualiza la ficha.

### Detección de procesos

Un proceso nativo pequeño puede informar si Steam está activo, si el juego asociado está activo y cuándo comenzó o terminó. Debe manejar cierres inesperados, actualizaciones, launchers secundarios y ejecutables cuyo nombre varía.

### Standby

Mientras el juego está abierto, Game Access puede detener el renderizado cuando la ventana no está visible, reducir la frecuencia de presencia, pausar videos y mantener solo shell, monitor y notificaciones.

### Uso con dos pantallas

El diseño debe contemplar desde el comienzo equipos con dos monitores. En una configuración como la del usuario, Game Access puede permanecer en la primera pantalla mientras Steam o el juego se lanza en la segunda.

Flujo previsto:

1. Game Access está abierto en el monitor principal.
2. El usuario elige un juego desde la biblioteca o desde el entorno 3D.
3. Steam y el juego se abren en el monitor secundario, según la configuración del sistema y del juego.
4. Game Access permanece activo en el monitor principal, en modo social, biblioteca reducida o panel de sesión.
5. El usuario puede ver amigos, estado de la partida, chat, información del juego y controles de sesión sin tapar el juego.
6. Al terminar, Game Access detecta el cierre y restaura la vista de biblioteca o del mundo 3D.

Game Access no siempre podrá forzar que cada juego respete una pantalla concreta: algunos títulos tienen su propio launcher, recuerdan la última posición de ventana o se ejecutan en pantalla completa exclusiva. Por eso la implementación debe combinar configuración de ventanas, detección de monitores, opciones del juego y un fallback manual. La función debe presentarse como “preferir monitor secundario” y no como una garantía universal.

Para una primera implementación de escritorio se puede:

- detectar la lista y resolución de monitores mediante Tauri;
- guardar el monitor preferido del usuario;
- iniciar Game Access en la pantalla principal;
- recordar la posición de su ventana social;
- solicitar al juego o launcher una posición cuando sea compatible;
- observar si el juego apareció en la pantalla esperada;
- ofrecer botones “mover Game Access al monitor principal” y “abrir configuración de pantalla”.

## 11. Capa social durante la partida

La primera versión social puede limitarse a presencia, chat de texto, voz, invitaciones y videos sincronizados dentro de las salas. Pero la visión de producto debe reservar una capa social persistente para cuando el juego esté ejecutándose en otra pantalla.

El objetivo no es interferir con el juego ni superponer elementos que puedan causar problemas con antitrampas. La opción más segura es que Game Access permanezca como una ventana independiente en el segundo monitor o como panel externo, no como una inyección dentro del proceso del juego.

### Información que se podría compartir

- nombre, portada y estado del juego actual;
- quién está jugando y desde qué cuenta autorizada;
- amigos que están conectados o esperando;
- notas personales sobre el juego;
- guías o referencias guardadas;
- videos, trailers o reviews relacionados;
- capturas recientes;
- enlaces o artículos asociados;
- objetivos, listas de tareas o recordatorios;
- mensajes del grupo de juego;
- invitaciones para unirse después;
- estado de descarga, actualización o sesión.

### Formas de mostrarlo

- panel compacto en la primera pantalla;
- ventana lateral redimensionable;
- modo “compañero” con chat, voz y ficha del juego;
- panel de notas que no roba el foco al juego;
- pantalla secundaria con contenido sincronizado;
- notificaciones discretas;
- controles para ocultar temporalmente toda la interfaz social.

### Ideas futuras

Más adelante podrían agregarse comentarios anclados a una parte de un video, notas asociadas a un juego, compartir una captura desde la partida, consultar una guía con el mando o teclado, votar qué jugar después y mantener una sala social activa mientras cada persona juega en su propia pantalla.

Estas funciones deben diseñarse con cuidado para no convertirse en una distracción ni requerir overlays inyectados en juegos protegidos. La intención inicial es que Game Access sea un compañero en la segunda pantalla.

## 12. Descargas: qué se puede hacer y qué no conviene prometer

El usuario quiere que la descarga sea más fácil de entender sin tener que navegar manualmente por toda la interfaz de Steam. La recomendación es que Steam siga descargando y Game Access proporcione una capa visual de seguimiento.

### Funciones posibles

- botón “Instalar” desde ficha o máquina;
- handoff a Steam;
- detección de descarga iniciada;
- lectura de estados locales disponibles, como manifiestos cuando corresponda;
- observación de espacio utilizado y espacio libre;
- actividad de disco;
- cálculo de velocidad;
- estimación de tiempo restante;
- notificación cuando el juego parece listo;
- apertura de Steam para resolver errores.

### Estimación

```text
bytes_restantes = bytes_totales - bytes_descargados
velocidad_promedio = bytes_descargados_en_ventana / segundos_de_ventana
tiempo_estimado = bytes_restantes / velocidad_promedio
```

Debe mostrarse como estimación aproximada: la velocidad varía, existe descompresión local y el tamaño en disco no siempre equivale al progreso de red.

Game Access no debería prometer un descargador independiente equivalente a Steam sin una API oficial. Los formatos internos, rutas y procesos pueden cambiar. Si no puede determinar el progreso, debe indicar “gestionado por Steam” y ofrecer abrir su interfaz.

## 13. Arcade retro y juegos clásicos

Una zona arcade con juegos clásicos puede atraer a usuarios que crecieron con títulos como Golden Axe. También puede servir como actividad mientras se descarga un juego o mientras llegan amigos.

### Posibilidades

- máquinas decorativas que muestran fichas y videos;
- juegos retro distribuidos oficialmente;
- homebrew y software de dominio público;
- emulación local de contenido que el usuario tenga derecho a utilizar;
- streaming desde una PC anfitriona autorizada;
- minijuegos propios de Game Access.

### Streaming con host

Para un prototipo, una PC puede ejecutar un juego autorizado y transmitir audio/video con Sunshine/Moonlight. Game Access sería el punto de encuentro y presentación, no el distribuidor de ROMs.

Este enfoque puede servir para juegos livianos, juegos por turnos, demostraciones y experiencias nostálgicas. Los juegos de acción rápida y multijugador competitivo requieren pruebas de latencia y probablemente no sean adecuados para la primera versión.

## 14. Pantallas, carteles y objetos de contenido

Las pantallas hacen que el mundo sea una biblioteca visual viva, pero no todo debe ser video.

### Soportes

- televisores;
- proyectores;
- monitores de arcade;
- pantallas gigantes;
- carteles con portadas;
- cuadros con capturas;
- vitrinas con objetos 3D;
- estanterías;
- consolas decorativas;
- máquinas interactivas;
- mapas o tableros de actividad.

### Rendimiento de pantallas

Una pantalla lejana debería mostrar una imagen estática, miniatura o material de baja frecuencia. El video completo solo se activa cuando está cerca, visible, seleccionado o requerido por una sala sincronizada.

### Capturas durante el juego

Game Access podría solicitar una captura mediante el mecanismo permitido de Steam y mostrarla después en una pared personal, galería, colección de momentos o exposición compartida. El usuario debe decidir quién puede verla.

## 15. Arquitectura técnica propuesta

### Aplicación de escritorio

Se recomienda conservar **Tauri** si el proyecto actual ya está basado en tecnologías web. Tauri permite que la interfaz web conviva con capacidades nativas para archivos, procesos, notificaciones y comunicación con servicios locales.

### Interfaz y mundo 3D

Se recomienda utilizar **Three.js** —si “Trivia DS” se refería a esta tecnología— para el entorno 3D, integrado en la aplicación existente.

Three.js es adecuado para una escena navegable en primera persona, geometría low-poly, iluminación, modelos simples, pantallas de video, objetos interactivos, cámaras alternativas e integración directa con React y HTML.

El sistema de controles puede basarse en `PointerLockControls`:

```ts
const controls = new PointerLockControls(camera, renderer.domElement);

function update(deltaSeconds: number) {
  const speed = 3.5;
  if (keys.forward) controls.moveForward(speed * deltaSeconds);
  if (keys.backward) controls.moveForward(-speed * deltaSeconds);
  if (keys.left) moveSideways(-speed * deltaSeconds);
  if (keys.right) moveSideways(speed * deltaSeconds);
}
```

El código real debe agregar colisiones, límites, interacción y accesibilidad.

### Cuándo elegir Godot

Godot también puede representar este entorno y tiene herramientas fuertes para escenas, animaciones, físicas, audio y lógica de juego. Sería atractivo si el mundo se convierte en un juego completo con muchas mecánicas nativas, físicas complejas, minijuegos y un editor de escenas como flujo principal.

Para la primera etapa, Three.js reduce la duplicación: biblioteca, chat, configuración, videos y mundo 3D comparten el modelo web y la ventana Tauri. Godot podría incorporarse más adelante como módulo separado.

### Backend social

El backend debe gestionar identidad, amigos, permisos, salas, presencia, estado multimedia, invitaciones, moderación, claves temporales y suscripciones.

La comunicación puede utilizar WebSocket o un servicio realtime. La voz puede implementarse con WebRTC o LiveKit.

```text
Game Access Desktop
├── React: biblioteca, fichas, chat, configuración
├── Three.js: mundo, cámara, objetos, pantallas
├── Tauri: procesos, archivos, notificaciones, integración local
└── Orquestador: Steam, instalación y lanzamiento

Game Access Backend
├── identidad y permisos
├── amigos y presencia
├── salas y lobbies
├── sincronización multimedia
├── monetización y límites
└── moderación y auditoría
```

## 16. Rendimiento y compatibilidad

El launcher debe ser liviano. Aunque el usuario termine ejecutando un juego pesado, Game Access no debe competir con él.

### Técnicas

- modelos low-poly y modulares;
- iluminación cocinada o muy limitada;
- sombras simples y desactivables;
- texturas comprimidas y atlas;
- instancing para objetos repetidos;
- LOD por distancia;
- frustum culling y occlusion culling;
- carga diferida por zona;
- descarga de recursos de salas lejanas;
- límite de FPS configurable;
- suspensión del renderizado cuando la ventana está oculta;
- modo 2D o compatibilidad para equipos modestos;
- límite de avatares visibles;
- pocos videos simultáneos.

| Perfil | Mundo | Sombras | Videos | Avatares | Uso |
|---|---|---|---|---|---|
| Básico | low-poly | apagadas | una activa | pocos | PCs modestos |
| Medio | materiales simples | suaves | varias cercanas | normal | general |
| Alto | iluminación mejorada | activas | según capacidad | más usuarios | PCs con GPU |

## 17. Monetización y acceso por anuncios

La idea discutida es ofrecer acceso gratuito o temporal mediante una clave obtenida después de atravesar una plataforma de anuncios/enlaces como Linkvertise. La clave podría indicar duración y vencimiento. El usuario la copia en Game Access y obtiene acceso durante ese período.

### Modelo tentativo

- primer acceso del día: hasta dos horas;
- segundo acceso: una hora;
- usos posteriores: duración menor o espera hasta el día siguiente;
- renovación mediante otra interacción publicitaria;
- plan premium sin esa fricción.

Son ejemplos, no decisiones. Una duración demasiado corta hace que el producto parezca inutilizable; una demasiado larga reduce la razón para suscribirse.

También se contempló que Linkvertise podría mostrar un texto con la clave, la duración y la fecha/hora de vencimiento, en lugar de entregar un archivo o una integración compleja. Deben cumplirse las reglas de la plataforma y evitarse usos engañosos o no autorizados.

### Servidor de claves

La clave no debe validarse solo en el cliente. El backend debe comprobar firma o identificador, emisión, expiración, activaciones, usuario o instalación si corresponde, abuso y funciones habilitadas.

### Premium como venta de comodidad

La suscripción puede ofrecer ausencia de anuncios, mayor duración, salas privadas, biblioteca multicuenta avanzada, automatizaciones, perfiles, decoración y sincronización multimedia ampliada.

La propuesta de valor debe ser comodidad y mejor experiencia, no venta o transferencia de cuentas de Steam.

## 18. Seguridad, privacidad y cumplimiento

El sistema manejará cuentas, amigos, procesos locales, juegos instalados, presencia y conversaciones.

- no almacenar contraseñas de Steam;
- no pedir códigos de Steam Guard fuera de flujos oficiales;
- no compartir tokens o sesiones;
- no evadir restricciones de Family Sharing;
- pedir autorización para leer información local;
- mostrar qué cuenta está activa y de dónde proviene cada licencia;
- separar datos de Steam de la identidad Game Access;
- cifrar comunicaciones;
- permitir eliminar datos sociales;
- incluir bloqueo, silenciamiento y reporte;
- registrar solo la actividad necesaria.

El acceso a juegos de terceros, cuentas temporales, emulación, ROMs, videos, reseñas, capturas, modelos 3D y música requiere revisar derechos y condiciones específicas. Este documento describe producto y tecnología; no sustituye asesoramiento legal.

## 19. Prototipo recomendado: vertical slice

La primera prueba debe ser un arcade de una sola sala con entrada, cinco máquinas, una pantalla grande, una pared de capturas, un rincón cozy y un portal a la biblioteca tradicional.

### Secuencia de demostración

1. El usuario camina con WASD y mira con el mouse.
2. Se acerca a una máquina.
3. Aparecen nombre, portada y estado del juego.
4. Abre una ficha con género, descripción e instalación.
5. Reproduce un trailer.
6. Cambia a modo enfocado.
7. Invita a un amigo.
8. Ambos ven el video sincronizado.
9. Selecciona “Jugar”.
10. Game Access deriva el lanzamiento a Steam.
11. El entorno entra en standby.
12. Al cerrar el juego, Game Access recupera la sesión y muestra el estado actualizado.

### Qué validar

- comodidad de la navegación;
- claridad de los objetos interactivos;
- utilidad de la vista 3D para descubrir juegos;
- preferencia entre pantalla 3D, enfocada y completa;
- claridad del cambio entre Game Access y Steam;
- consumo de recursos en standby;
- preferencia frente a abrir Steam directamente.

## 20. Roadmap

### Fase 0 — Documentación y arquitectura

Definir límites, revisar el stack actual, separar shell/biblioteca/Steam/3D, definir modelos `GameRecord`, `Room`, `Presence` y `SharedMediaState`, y crear una matriz de riesgos.

### Fase 1 — Mundo 3D local

Integrar Three.js en Tauri, crear una sala arcade, cámara, movimiento, colisiones básicas, objetos interactivos, fichas, portadas, videos, modo enfocado y pantalla completa.

### Fase 2 — Biblioteca, Steam y dos pantallas

Identificar cuentas locales autorizadas, diferenciar juegos instalados y disponibles, mostrar estados, derivar instalación/ejecución, monitorear procesos, estimar descargas y probar el lanzamiento preferente en el segundo monitor mientras Game Access queda activo en el primero.

### Fase 3 — Comunidad y compañero de segunda pantalla

Crear cuenta Game Access, amigos, presencia, salas privadas, chat de texto y voz, videos sincronizados, invitaciones y lobbies. Agregar el panel social independiente para acompañar una partida en ejecución, con ficha del juego, chat, voz, notas, capturas y referencias.

### Fase 4 — Contenido retro

Agregar contenido autorizado, evaluar emulación, probar streaming con Sunshine/Moonlight y medir latencia/input.

### Fase 5 — Personalización

Agregar salas temáticas, decoración, coleccionables, paredes de capturas, eventos, proyecciones, perfiles y curaduría.

### Fase 6 — Monetización

Probar acceso gratuito limitado, validación server-side de claves, medición de conversión, plan premium y controles contra abuso.

La monetización debería probarse después de verificar que la experiencia base tiene valor. Una clave temporal no compensa un arcade que no resulta atractivo.

## 21. Riesgos y respuestas

| Riesgo | Consecuencia | Respuesta inicial |
|---|---|---|
| El mundo 3D consume demasiado | Compite con el juego | escena pequeña, standby y perfiles |
| Steam no expone una función | Estado incompleto | Steam como autoridad y fallback |
| Un video no puede reproducirse | Pantalla vacía | contenido autorizado y estados de error |
| La sincronización deriva | Usuarios ven momentos distintos | servidor autoritativo y corrección |
| Navegación incómoda | Vuelta a la grilla | modo 2D, mapa y controles alternativos |
| Abuso comunitario | Spam o acoso | privadas, bloqueo, reporte y moderación |
| Fraude con claves | Costos y abuso | firma, expiración y rate limits |
| Problemas de derechos retro | Riesgo legal | contenido autorizado |
| Parece un simple launcher | Baja diferenciación | priorizar descubrimiento, social y ambientación |

## 22. Estrategia de desarrollo acelerado y reutilización

El desarrollo debe aprovechar todos los recursos confiables disponibles para avanzar rápido y evitar reinventar componentes que ya existen. Game Access no necesita construir desde cero un motor de red, un sistema de voz, un reproductor sincronizado, un editor de escenarios o un generador de avatares si existen soluciones open source adecuadas.

La regla es reutilizar la rueda cuando la rueda ya es sólida, mantenida, compatible con la licencia del proyecto y suficientemente adaptable. El código propio debe concentrarse en la experiencia que diferencia a Game Access: la biblioteca unificada, la relación con Steam, la organización espacial, el flujo de dos pantallas y la combinación entre jugar y socializar.

### Áreas en las que conviene reutilizar tecnología

#### Multijugador y comunicación entre peers

Hay que evaluar bibliotecas de networking para presencia, movimiento de avatares, salas, lobbies, sincronización de objetos y mensajes. Para un prototipo puede bastar WebSocket con un servidor pequeño. Si después se necesita una arquitectura peer-to-peer o parcialmente distribuida, se pueden evaluar WebRTC DataChannels y soluciones de networking que ya resuelvan reconexión, autoridad, interpolación y serialización.

La comunicación entre peers no debe significar que cualquier cliente tenga autoridad sobre licencias, cuentas o acciones de Steam. La red puede distribuir presencia y estado social, mientras que el cliente local conserva las operaciones de su propia PC y el backend valida permisos de sala.

#### Voz y comunicación en tiempo real

Conviene usar WebRTC o una solución open source/autoalojable como LiveKit para audio de sala, proximidad, grupos y silenciamiento. No es necesario crear desde cero captura de micrófono, adaptación de bitrate, cancelación de eco, reconexión y selección de dispositivos.

#### Video sincronizado

El reproductor puede apoyarse en el elemento HTML `video`, `THREE.VideoTexture` y un protocolo de sincronización propio pequeño. Si luego se requiere distribución de video en vivo, se pueden evaluar WebRTC, HLS, WebTransport o servidores multimedia open source. Para trailers y contenido con URL autorizada, es preferible que cada cliente reproduzca la fuente permitida y que Game Access sincronice el estado, en lugar de retransmitir innecesariamente todo el video desde un servidor.

#### Creación de casas, salones y entornos 3D

Se deben evaluar herramientas open source para modelado, edición de escenas, generación procedural, iluminación, baking, optimización y exportación a glTF/GLB. Blender puede ser la herramienta principal de creación de assets; Three.js puede cargar los modelos optimizados en la aplicación. También pueden utilizarse bibliotecas de geometría modular, generadores de interiores y paquetes de assets con licencias claras.

La arquitectura debe permitir que una sala se defina como datos —modelo, posición, iluminación, objetos interactivos y referencias— en lugar de tener toda la lógica codificada a mano. Así se pueden crear nuevas habitaciones sin reescribir la aplicación.

```ts
type RoomDefinition = {
  id: string;
  name: string;
  sceneAsset: string;
  spawnPoint: [number, number, number];
  portals: Array<{ targetRoomId: string; position: [number, number, number] }>;
  interactives: Array<InteractiveObject>;
  permissions?: "public" | "friends" | "private";
};
```

#### Streaming o casteo de una sesión compartida

Para compartir la imagen de una computadora con otras personas se pueden evaluar Sunshine/Moonlight, WebRTC, Parsec-like open source alternatives y servidores de streaming compatibles con el entorno. La primera versión puede hacer que un host ejecute el juego o emulador autorizado y transmita la imagen a los demás participantes.

Esto debe diferenciarse del lanzamiento local de Steam. En una sesión compartida, una PC host ejecuta el contenido y los demás reciben audio/video y, si corresponde, envían entradas. Game Access organiza la sala, muestra el estado y ofrece controles de conexión; no distribuye ilegalmente el juego ni las ROMs.

#### Alternancia del host

La idea del “host que va alternando entre los componentes de la red” puede traducirse en una arquitectura con autoridad transferible. En vez de depender siempre de un servidor central o de una sola PC, la autoridad de una actividad puede cambiar entre participantes:

- un usuario hospeda la sala social;
- otro usuario hospeda una proyección o juego compartido;
- el host actual puede transferir la sesión;
- los clientes reciben un estado replicado y validan la transición;
- si el host se desconecta, se elige otro mediante una regla determinista o un servidor de coordinación.

Para una primera versión conviene no implementar host migration completa. Se puede comenzar con un backend que mantenga la sala y un host explícito para cada actividad. La alternancia se incorpora después de medir latencia, estabilidad y complejidad de recuperación.

#### Personajes y avatares 3D

Se pueden evaluar generadores de personajes, bibliotecas de avatares, modelos humanoides compatibles con glTF, Mixamo cuando su licencia sea compatible, Ready Player Me u otras alternativas, además de herramientas open source para rigging, retargeting, animaciones y lip sync.

El avatar debe ser intercambiable por un modelo simple si el equipo no soporta personajes completos. La identidad, el nombre, los permisos y la presencia deben vivir en Game Access; el modelo 3D es únicamente una representación visual.

### Criterios para elegir recursos externos

Cada librería, herramienta o asset debe revisarse según:

- licencia y permiso de uso comercial;
- compatibilidad con Tauri, React, Three.js y Windows;
- actividad y mantenimiento del repositorio;
- tamaño y consumo de recursos;
- soporte para fallback y exportación;
- seguridad de dependencias;
- facilidad de reemplazo si el proyecto desaparece;
- posibilidad de autoalojar el servicio;
- documentación y ejemplos reproducibles.

No se debe incorporar un paquete solo porque tiene una demostración atractiva. Primero hay que probarlo en una escena mínima, revisar su licencia y confirmar que no introduce una dependencia imposible de mantener.

### Proceso de integración

Para cada capacidad nueva se recomienda:

1. registrar el problema que resuelve;
2. buscar dos o tres alternativas open source o autoalojables;
3. revisar licencia, actividad y compatibilidad;
4. construir una prueba aislada;
5. medir rendimiento y experiencia;
6. documentar la decisión;
7. integrarla detrás de una interfaz reemplazable;
8. conservar un fallback simple.

Este enfoque permite avanzar con rapidez sin atar todo Game Access a una única biblioteca o proveedor.

## 23. Decisión recomendada

Construir primero un **arcade social 3D pequeño**, integrado en la aplicación de escritorio existente mediante Tauri y Three.js. El prototipo debe combinar biblioteca, pantalla de video, presencia básica y lanzamiento hacia Steam.

La prioridad no es tener muchas habitaciones, modelos realistas o cientos de pantallas. Es comprobar la secuencia completa:

> entrar, recorrer, descubrir un juego, verlo presentado de forma atractiva, compartirlo con un amigo, iniciarlo mediante Steam y volver después al entorno.

Si esa secuencia se siente natural y aporta algo que Steam no ofrece, el proyecto puede crecer hacia museo, cine, arcade retro, espacios temáticos, lobbies, sincronización avanzada, personalización, compañero de segunda pantalla y modelo premium.

## 24. Referencias y ejemplos técnicos

- [Three.js PointerLockControls](https://threejs.org/docs/pages/PointerLockControls.html): controles para cámara en primera persona.
- [Three.js VideoTexture](https://threejs.org/docs/pages/VideoTexture.html): video HTML como textura 3D.
- [Arquitectura de Tauri](https://v2.tauri.app/concept/architecture/): interfaz web y capacidades nativas.
- [Renderizadores de Godot](https://docs.godotengine.org/en/stable/tutorials/rendering/renderers.html): comparación con un motor de juegos.
- [Sunshine](https://github.com/LizardByte/Sunshine) y [Moonlight](https://moonlight-stream.org/): streaming desde un equipo anfitrión autorizado.
- [Steam Subscriber Agreement](https://store.steampowered.com/subscriber_agreement/): cuentas, licencias y uso.
- [Linkvertise — Earnings](https://help.linkvertise.com/hc/en-us/articles/26897224314641-Earnings-Everything-you-need-to-know): variables del rendimiento publicitario.
- [World Explorer 3D](https://github.com/RRG314/WorldExplorer3D): referencia técnica para un entorno 3D web; revisar su licencia antes de reutilizar código o assets.
