# App del celular del padre (MN.7): encargo para Lovable

Seba, 2026-11-02: la empieza Lovable, la sube a GitHub y Claude sigue desde ahí. Lovable hace **solo la interfaz**,
con datos de mentira detrás de un cliente con un contrato fijo. El servidor (`apps/api`, MN.9) y la parte de la PC
(el Game Access de la cuenta del niño, que consulta cada 30 s) los hace Claude en este repo. Así lo que entrega
Lovable se conecta sin reescribirlo.

Cómo usarlo: crear el proyecto en Lovable, pegar el bloque de abajo tal cual y, cuando esté la primera versión,
conectarlo a GitHub (Lovable → GitHub → repositorio **privado** `gameaccess-parent-app`) y pasarle a Claude el enlace.

---

```text
Construí una web app móvil (PWA instalable, pensada para celular, vertical) llamada "Game Access Padres".

QUÉ ES
Game Access es una app de PC para juegos. Tiene un "modo niño": el chico tiene su propia cuenta de Windows donde
solo ve Game Access, con juegos permitidos, horario y tiempo por día. Esta app del celular es para el padre o la
madre: ver qué está haciendo su hijo y darle o quitarle tiempo desde cualquier lado, como Google Family Link.

ALCANCE DE ESTA ENTREGA: SOLO LA INTERFAZ
- NO uses Supabase ni ningún backend, base de datos, auth propia ni edge functions. No agregues login con email.
- Todos los datos pasan por un cliente en src/api/client.ts con la interfaz de abajo. Implementá dos versiones:
  mockClient (datos de mentira en memoria, con demoras de 300-800 ms y estados que cambian solos) y httpClient
  (fetch a import.meta.env.VITE_API_URL con el token en "Authorization: Bearer"). Si VITE_API_URL no está, usa mockClient.
- React + TypeScript + Vite + Tailwind. Versiones exactas en package.json (sin ^ ni ~).
- Textos con i18n (español rioplatense con voseo por defecto, inglés como segundo idioma), nunca texto fijo en JSX.

PANTALLAS
1. Emparejar: el padre escribe el código corto (6 caracteres) que le muestra Game Access en la PC
   (Control parental). Al canjearlo queda guardado el token en el teléfono. Explicá en una línea dónde encontrar el código.
2. Inicio (uno o varios hijos; si hay uno solo, entra directo a su tarjeta):
   - Nombre del hijo y nombre de la PC, "visto hace X" (si hace más de 2 min, avisá que la PC está apagada o sin internet
     y que las órdenes se aplican cuando vuelva).
   - Estado grande: Jugando a <juego> / Sin jugar / Bloqueado / Fuera de horario / Desbloqueado hasta HH:MM /
     Modo niño apagado / En pausa (sin PLUS).
   - Anillo de tiempo de hoy: jugado y restante sobre el límite del día; horario de hoy (desde-hasta).
   - Acciones grandes: "Sumar tiempo" (15, 30, 60 min o elegir), "Desbloquear ahora", "Desbloquear por…" (30 min, 1 h,
     2 h o elegir), "Bloquear ahora", y el interruptor "Modo niño encendido/apagado".
   - Cada orden queda "Enviada, esperando a la PC" hasta que el servidor la marque aplicada (consultar cada 5 s),
     después "Aplicada"; si vence, "No llegó a la PC". Confirmación antes de apagar el modo niño y de bloquear mientras juega.
3. Estadísticas: últimos 7 días en barras (minutos por día) y los juegos más jugados de la semana con su carátula
   (la URL viene en los datos) y minutos. Tocar un día muestra los juegos de ese día.
4. Ajustes: idioma, desvincular este teléfono, versión.

CONTRATO (src/api/types.ts y src/api/client.ts; respetalo tal cual)
type Mode = "on" | "off" | "paused_plus";
type Activity = "playing" | "idle" | "blocked" | "out_of_schedule" | "unlocked";
interface ChildStatus {
  id: string; name: string; pcName: string; lastSeen: string;          // ISO 8601
  mode: Mode; activity: Activity;
  playing?: { appId: number; name: string; cover?: string; since: string };
  unlockedUntil?: string;                                            // ISO, si activity = "unlocked"
  today: { playedMin: number; limitMin: number | null; remainingMin: number | null; schedule: { from: string; to: string } | null };
}
interface DayStats { date: string; minutes: number; games: { appId: number; name: string; cover?: string; minutes: number }[] }
type Command =
  | { type: "add_time"; minutes: number }
  | { type: "unlock_now" }
  | { type: "unlock_for"; minutes: number }
  | { type: "lock_now" }
  | { type: "set_enabled"; enabled: boolean };
interface CommandState { id: string; command: Command; status: "pending" | "applied" | "expired"; createdAt: string; appliedAt?: string }
interface ParentApi {
  pair(code: string): Promise<{ token: string; children: ChildStatus[] }>;  // POST /parent/pair {code}
  children(): Promise<ChildStatus[]>;                                         // GET  /parent/children
  stats(childId: string, days: number): Promise<DayStats[]>;                  // GET  /parent/children/{id}/stats?days=7
  send(childId: string, command: Command): Promise<CommandState>;             // POST /parent/children/{id}/commands
  command(id: string): Promise<CommandState>;                                 // GET  /parent/commands/{id}
  unpair(): Promise<void>;                                                    // POST /parent/unpair
}
Errores HTTP: 401 = token inválido (volver a Emparejar), 404 = código inexistente o vencido, 429 = demasiados intentos.

DISEÑO (el mismo lenguaje que la app de PC)
- Fondo #111416; paneles de vidrio rgba(21,25,29,.94) con borde fino degradado y radio 12 px; texto #f4f4f2,
  secundario #929ba2; separadores #ffffff20.
- Acción principal naranja #cc8333 (hover #d69959) con texto #140a02, nunca blanco. Peligro #be4750. Éxito #a0d2b4.
- Títulos: Bebas Neue en naranja, mayúsculas. Cuerpo y botones: Manrope; botones bold 16 px, 44 px de alto (táctiles),
  radio 8 px. Etiquetas de sección: Manrope 800, 11 px, mayúsculas, letter-spacing .14em, color #d79d5d.
- Nada de texto de menos de 14 px. Espaciado en escala de 4 px. Una sola acción naranja por pantalla.
- Iconos de lucide-react. Animaciones cortas y suaves; respetar prefers-reduced-motion.
- Modo oscuro solamente. Funciona bien de 360 px de ancho en adelante.

ENTREGA
- README con cómo correrlo, cómo apuntarlo a un servidor (VITE_API_URL) y dónde está el contrato.
- Manifest y service worker de PWA (instalable, ícono provisorio con las letras "GA").
```
