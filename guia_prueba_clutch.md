# 🧪 Guía de Prueba Completa — Clutch Draft

## Antes de empezar

Asegúrate de tener el `.env` rellenado con tus valores reales. El campo más crítico ahora mismo es `ADMIN_ID` (tu Discord ID real) y `TuUsername` en el script SQL.

---

## Paso 0 — Preparar los datos de prueba

### 0.1 Aplicar el parche de picks de admin

Abre `server.js` y localiza el bloque que empieza con:
```
// Deshacer último pick
app.post('/admin/deshacer-pick', ...
```

Justo **después** de ese bloque (después del cierre `});` de la función), pega todo el contenido del archivo `patch_admin_picks.js`. Esto añade dos rutas nuevas:
- `POST /admin/forzar-pick` — elige un jugador en nombre del capitán de turno
- `POST /admin/auto-draft` — completa el draft entero automáticamente

### 0.2 Editar el script SQL

Abre `seed_prueba.sql` y sustituye estos dos valores en la primera fila del INSERT de teams:
- `TU_DISCORD_ID` → tu ID real de Discord (el mismo que está en `ADMIN_ID` del `.env`)
- `TuUsername` → tu nombre de usuario de Discord exacto (sensible a mayúsculas)

### 0.3 Cargar los datos en la base de datos

```bash
sqlite3 database/clutch.db < seed_prueba.sql
```

Deberías ver algo como:
```
=== JUGADORES ===
CARR|8
DC|8
DFC|12
MC|12
POR|4
=== EQUIPOS ===
TuUsername|Los Cracks
BotCapitan1|Galácticos
...
=== TOTAL ===
44
```

### 0.4 Corregir el bug del ID de Barou (mientras estás editando)

En `bot/bot.js` línea 82, cambia:
```js
const ID_DISCORD_BAROU = 'T1255657744388722731';
```
por:
```js
const ID_DISCORD_BAROU = '1255657744388722731';
```

---

## Paso 1 — Arrancar el sistema

```bash
npm install    # solo si no lo has hecho antes
npm run dev    # arranca servidor (3000) + bot (3001) en paralelo
```

Deberías ver en la consola:
```
✅ Base de datos Clutch Draft lista (WAL + better-sqlite3).
🚀 Clutch Draft en http://0.0.0.0:3000
🤖 Bot conectado como ClutchDraftBot#xxxx
```

---

## Paso 2 — Prueba del login y hub

1. Abre `http://localhost:3000` en el navegador.
2. Haz clic en **"Iniciar sesión con Discord"**.
3. Autoriza la app de Discord.
4. Deberías llegar al `/hub` con tu avatar y nombre.
5. Verifica que el hub muestra:
   - 4 equipos registrados
   - 44 jugadores totales
   - Estado del draft: **CERRADO**

✅ Si ves todo esto, el login OAuth2 y la base de datos funcionan correctamente.

---

## Paso 3 — Prueba del draft

### 3.1 Abrir el draft desde el panel admin

1. Ve a `http://localhost:3000/admin`
2. En la pestaña **Draft**, haz clic en **"ABRIR DRAFT"**
3. Verifica en el panel que:
   - Estado cambia a **ABIERTO**
   - Turno actual muestra tu username (`TuUsername`)
4. En el **log de actividad** (caja verde) deberías ver el evento

### 3.2 Verificar que el bot recibe el evento en Discord

Cuando abres el draft, el servidor llama a `http://localhost:3001/api/crear-canales`. El bot debería crear canales de voz en tu servidor de Discord para cada equipo. Revisa en Discord que aparecen los canales.

### 3.3 Hacer picks como admin (tu turno)

Ve a `http://localhost:3000/draft`. Deberías ver:
- El banner de turno con tu nombre resaltado
- La lista de 44 jugadores disponibles con botones **⚡ FICHAR**
- El timer contando hacia atrás

Haz clic en **⚡ FICHAR** en un DC (delantero). Verifica:
- El jugador desaparece de la lista con animación
- El turno cambia a `BotCapitan1`
- En Discord aparece el embed de fichaje en el canal de fichajes
- El log de admin muestra la actividad

### 3.4 Hacer picks en nombre de los bots (picks forzados)

Ahora el turno es de `BotCapitan1`. Para hacer el pick en su nombre, usa la API de admin desde la consola del navegador (o usa `curl`):

**Desde la consola del navegador (F12):**
```javascript
// Ver jugadores disponibles
const r = await fetch('/draft'); // no útil directamente

// Forzar un pick para el capitán de turno
// Primero necesitas el discord_id del jugador que quieres fichar
// Los IDs están en el script SQL (P_DC_001, P_MC_001, etc.)

await fetch('/admin/forzar-pick', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({ player_id: 'P_DC_003' })  // Haaland Bot
}).then(r => r.json()).then(console.log);
```

Deberías recibir: `{ ok: true, capitan: "BotCapitan1", jugador: "Haaland Bot", turnoSiguiente: "BotCapitan2" }`

Repite para BotCapitan2 y BotCapitan3. La dirección snake hará que el turno vuelva a ti en orden inverso.

### 3.5 Auto-completar el draft entero de golpe

Si no quieres hacer pick a pick, puedes completar todo el draft de un golpe:

**Desde la consola del navegador:**
```javascript
const r = await fetch('/admin/auto-draft', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'}
}).then(r => r.json());
console.log(r); // { ok: true, totalPicks: 44, fichados: 44 }
```

Esto ficha automáticamente a todos los jugadores sin respetar tus preferencias — úsalo cuando quieras pasar rápido a probar el torneo.

### 3.6 Verificar que el snake draft funciona

La dirección del turno sigue este patrón (con 4 equipos: A, B, C, D):
```
Ronda 1: A → B → C → D
Ronda 2: D → C → B → A
Ronda 3: A → B → C → D
...
```

Puedes verificarlo en el panel admin (columna "Turno actual" y "Ronda").

### 3.7 Cerrar el draft

Una vez que todos los equipos tengan sus 11 jugadores (o cuando quieras):

1. En `/admin` → pestaña **Draft** → **"CERRAR DRAFT"**
2. El bot publicará en Discord el canal con los equipos e IDs de EA FC
3. Los canales de voz del draft se borrarán

---

## Paso 4 — Prueba del torneo

### 4.1 Generar el torneo

1. En `/admin` → pestaña **Fase 2** → **"GENERAR TORNEO"**
2. Verifica en Discord:
   - En el canal de calendario aparece el fixture completo
   - Se crean canales privados `j1-tueq-vs-botcap` por cada partido
   - En el canal de clasificación aparece la tabla inicial
3. En `/torneo` (web) verifica que se ven los partidos y la clasificación

Con 4 equipos el formato es **Liga todos vs todos (solo ida)**: 6 partidos en 3 jornadas.

### 4.2 Simular resultados de partidos

En el panel admin → pestaña **Partidos**, introduce resultados:

Para cada partido verás un formulario con marcador. Introduce por ejemplo:
- J1: Los Cracks 2 - 1 Galácticos
- J1: Los Titanes 0 - 0 Dream Team

Al confirmar:
- La clasificación se actualiza en la web en tiempo real (Socket.io)
- El bot actualiza el canal de clasificación en Discord
- El log de admin muestra la actividad

### 4.3 Verificar resultados en Discord

En el canal privado de cada partido (`j1-...`), los bots capitanes deberían poder usar el botón **"📊 Reportar resultado"**. Como sus IDs son ficticios (`BOT_CAP_001`), no podrán pulsar el botón en Discord. Por eso usamos el panel admin directamente para introducir resultados, que es el flujo correcto para pruebas.

### 4.4 Completar todas las jornadas

Introduce resultados para los 6 partidos. Una vez todos estén en estado `finalizado`, el sistema debería:
1. Detectarlo automáticamente (cron cada 5 minutos)
2. Guardar el historial del torneo
3. Anunciar al campeón en Discord

O puedes hacerlo manualmente desde el panel admin → **"CERRAR TORNEO Y GUARDAR HISTORIAL"**.

### 4.5 Verificar el hall of fame

Ve a `http://localhost:3000/ganadores`. Debería aparecer el torneo que acabas de completar con campeón y subcampeón.

---

## Paso 5 — Prueba de Socket.io en tiempo real

Para verificar que los eventos llegan en tiempo real:

1. Abre **dos ventanas del navegador** con `http://localhost:3000/draft`
2. Desde el panel admin, haz un pick forzado
3. Ambas ventanas deberían actualizar el DOM instantáneamente sin recargar

Si funciona, los sockets están bien integrados.

---

## Paso 6 — Prueba del bot de Discord (inscripción real)

Si quieres probar el flujo de inscripción real del bot:

1. Escribe `!panel` en un canal de tu servidor de Discord
2. El bot publicará el embed de inscripciones con botones por posición
3. Pulsa un botón (ej: DC) — aparece un modal pidiendo teléfono y EA FC ID
4. Rellena y confirma
5. En la web (`/draft` o `/hub`) deberías ver que los contadores se actualizan en tiempo real

---

## Resumen de lo que verifica cada paso

| Paso | Qué verifica |
|------|-------------|
| 0    | Datos de prueba cargados, bug del ID corregido |
| 1    | Servidor + bot arrancan sin errores |
| 2    | OAuth2 Discord, sesiones, base de datos |
| 3    | Draft: turnos snake, picks, timer, sockets, bot Discord |
| 4    | Torneo: generación, calendario, canales, resultados, clasificación |
| 5    | Socket.io en tiempo real (multi-ventana) |
| 6    | Flujo de inscripción real desde Discord |

---

## Solución de problemas comunes

**"No es tu turno" al intentar fichar**
→ Verifica que el `username` de tu sesión coincide exactamente con el `capitan_username` en la tabla `teams`. Sensible a mayúsculas.

**El bot no responde en Discord**
→ Revisa que `DISCORD_TOKEN` es correcto en `.env` y que el bot tiene los intents activados en el portal de desarrolladores (especialmente `MESSAGE CONTENT` y `SERVER MEMBERS`).

**Los canales de partido no se crean**
→ El bot necesita permiso de `Manage Channels` en tu servidor de Discord, y la `CATEGORIA_PARTIDOS` (ID hardcodeado en bot.js línea 87) debe existir en tu servidor.

**La clasificación no se actualiza en Discord**
→ Verifica que el `CANAL_CLASIFICACION` (línea 86 de bot.js) existe y el bot tiene permisos de escritura y `Manage Messages` (para borrar mensajes anteriores).

**`forzar-pick` devuelve 403**
→ Tu sesión no tiene el `ADMIN_ID` correcto. Asegúrate de que tu Discord ID en el `.env` coincide con el de tu cuenta.
