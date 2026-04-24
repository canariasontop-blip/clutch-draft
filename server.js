// Test deploy automático
require('dotenv').config();
const express   = require('express');
const http      = require('http');
const { Server } = require('socket.io');
const session   = require('express-session');
const rateLimit = require('express-rate-limit');
const path      = require('path');
const axios     = require('axios');
const multer    = require('multer');
const fs        = require('fs');
const db        = require('./database/db');
const XLSX      = require('xlsx');

// ── Asegurar tablas opcionales existen ────────────────────────
try {
    db.prepare(`CREATE TABLE IF NOT EXISTS matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jornada INTEGER DEFAULT 1,
        equipo1 TEXT,
        equipo2 TEXT,
        goles1 INTEGER,
        goles2 INTEGER,
        estado TEXT DEFAULT 'pendiente',
        canal_discord TEXT
    )`).run();
} catch(e) {
    console.warn('Error creando tablas opcionales:', e.message);
}

// Añadir columna canal_discord si no existe (migración segura)
try {
    db.prepare(`ALTER TABLE matches ADD COLUMN canal_discord TEXT`).run();
} catch(e) { /* ya existe */ }

// Migrar formación por defecto de 4-3-3 a 3-1-4-2
try {
    db.prepare(`UPDATE teams SET formacion='3-1-4-2' WHERE formacion IS NULL OR formacion='4-3-3'`).run();
} catch(e) { /* ignorar */ }

// Añadir columnas capitan2 si no existen
try { db.prepare(`ALTER TABLE teams ADD COLUMN capitan2_id TEXT DEFAULT NULL`).run(); } catch(e) {}
try { db.prepare(`ALTER TABLE teams ADD COLUMN capitan2_username TEXT DEFAULT NULL`).run(); } catch(e) {}

// Orden personalizado del draft (ruleta)
try { db.prepare(`ALTER TABLE teams ADD COLUMN orden_draft INTEGER DEFAULT NULL`).run(); } catch(e) {}

// Cola de pendientes para forzar turno sin saltarse a nadie
try { db.prepare(`INSERT OR IGNORE INTO settings (key,value) VALUES ('pending_queue','')`).run(); } catch(e) {}

// ── Tabla historial torneos ───────────────────────────────────
try {
    db.prepare(`CREATE TABLE IF NOT EXISTS historial_torneos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fecha_inicio TEXT,
        fecha_fin TEXT,
        n_equipos INTEGER,
        formato TEXT,
        campeon TEXT,
        subcampeon TEXT,
        clasificacion TEXT
    )`).run();
} catch(e) {
    console.warn('Error creando tabla historial_torneos:', e.message);
}

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
    pingTimeout:  60000,
    pingInterval: 25000,
    transports:   ['websocket', 'polling']
});

function emitNuevoJugador() {
    const totalJugadores = db.prepare(`SELECT COUNT(*) as c FROM players`).get().c;
    const totalFichados  = db.prepare(`SELECT COUNT(*) as c FROM players WHERE equipo IS NOT NULL`).get().c;
    const totalEquipos   = db.prepare(`SELECT COUNT(*) as c FROM teams`).get().c;
    io.emit('nuevo-jugador', { totalJugadores, totalFichados, totalEquipos });
    axios.post('http://localhost:3001/api/actualizar-panel-inscripciones').catch(() => {});
}

// ══════════════════════════════════════════════════════════════
//  CACHÉ EN MEMORIA
// ══════════════════════════════════════════════════════════════
let cache = {
    turnoActual:   '',
    draftEstado:   'cerrado',
    tiempoRestante: 90,
    timerInterval:  null
};

function refreshCache() {
    const turno  = db.prepare(`SELECT value FROM settings WHERE key='turno_actual'`).get();
    const estado = db.prepare(`SELECT value FROM settings WHERE key='draft_estado'`).get();
    const tiempo = db.prepare(`SELECT value FROM settings WHERE key='tiempo_turno'`).get();
    cache.turnoActual    = turno?.value  || '';
    cache.draftEstado    = estado?.value || 'cerrado';
    cache.tiempoRestante = parseInt(tiempo?.value || '90');
}
refreshCache();

// ══════════════════════════════════════════════════════════════
//  CONFIGURACIÓN
// ══════════════════════════════════════════════════════════════
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('trust proxy', 1);
app.use(session({
    secret:            process.env.SESSION_SECRET || 'clutch-secret-dev',
    resave:            false,
    saveUninitialized: false,
    cookie:            { maxAge: 86400000, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' }
}));

const pickLimiter = rateLimit({
    windowMs: 60 * 1000,
    max:      5,
    message:  'Demasiadas peticiones, espera un momento.'
});

// ══════════════════════════════════════════════════════════════
//  MIDDLEWARES AUTH
// ══════════════════════════════════════════════════════════════
function requireLogin(req, res, next) {
    if (!req.session.user) return res.redirect('/login');
    next();
}

function requireAdmin(req, res, next) {
    if (!req.session.user) return res.redirect('/hub');
    if (req.session.user.id === process.env.ADMIN_ID) return next();
    const enDB = db.prepare('SELECT id FROM admins WHERE discord_id=?').get(req.session.user.id);
    if (enDB) return next();
    if (req.session.user.esAdmin) return next(); // rol Discord 🧠 STAFF
    return res.redirect('/hub');
}

function isSuperAdmin(req) {
    return req.session.user && req.session.user.id === process.env.ADMIN_ID;
}

// ══════════════════════════════════════════════════════════════
//  AUTH — Discord OAuth2
// ══════════════════════════════════════════════════════════════
app.get('/', (req, res) => { res.redirect('/login'); });
app.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/hub');
    res.render('login', { error: null });
});

app.get('/auth/discord', (req, res) => {
    if (req.query.next) req.session.authNext = req.query.next;
    const url = `https://discord.com/api/oauth2/authorize` +
        `?client_id=${process.env.DISCORD_CLIENT_ID}` +
        `&redirect_uri=${encodeURIComponent(process.env.DISCORD_CALLBACK_URL)}` +
        `&response_type=code&scope=identify`;
    res.redirect(url);
});

app.get('/auth/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.redirect('/login');
    try {
        const params = new URLSearchParams({
            client_id:     process.env.DISCORD_CLIENT_ID,
            client_secret: process.env.DISCORD_CLIENT_SECRET,
            grant_type:    'authorization_code',
            code,
            redirect_uri:  process.env.DISCORD_CALLBACK_URL
        });
        const tokenRes = await axios.post('https://discord.com/api/oauth2/token', params);
        const userRes  = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${tokenRes.data.access_token}` }
        });
        const u = userRes.data;

        // Comprobar si tiene rol de admin (superadmin | DB | rol Discord 🧠 STAFF)
        let esAdmin = u.id === process.env.ADMIN_ID;
        if (!esAdmin) {
            esAdmin = !!db.prepare('SELECT id FROM admins WHERE discord_id=?').get(u.id);
        }
        if (!esAdmin) {
            try {
                const check = await axios.get(`http://localhost:3001/api/es-admin/${u.id}`, { timeout: 1500 });
                esAdmin = check.data.esAdmin === true;
            } catch { /* bot no disponible, sin rol de Discord */ }
        }

        req.session.user = {
            id:       u.id,
            username: u.username,
            avatar:   u.avatar
                ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png`
                : `https://cdn.discordapp.com/embed/avatars/0.png`,
            esAdmin
        };
        const next = req.session.authNext || '/hub';
        delete req.session.authNext;
        res.redirect(next);
    } catch (e) {
        console.error('OAuth2 error:', e.message);
        res.redirect('/login');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
});

// ══════════════════════════════════════════════════════════════
//  INSCRIPCIONES (web, público)
// ══════════════════════════════════════════════════════════════
app.get('/inscripciones', async (req, res) => {
    if (!req.session.user) return res.redirect('/auth/discord?next=/inscripciones');
    const draftAbierto = cache.draftEstado === 'abierto';
    const did = req.session.user.id;

    // Comprobar si el usuario está en el servidor de Discord
    let enServidor = true;
    try {
        const check = await axios.get(`http://localhost:3001/api/en-servidor/${did}`, { timeout: 2000 });
        enServidor = check.data.enServidor === true;
    } catch(e) {
        // Si el bot no responde, permitimos el acceso para no bloquear
        enServidor = true;
    }

    const jugadorExistente = db.prepare(`SELECT * FROM players WHERE discord_id=?`).get(did);
    const jugadoresPorPosicion = {
        POR:  db.prepare(`SELECT eafc_id, nombre, discord_id FROM players WHERE posicion='POR'  ORDER BY nombre`).all(),
        DFC:  db.prepare(`SELECT eafc_id, nombre, discord_id FROM players WHERE posicion='DFC'  ORDER BY nombre`).all(),
        CARR: db.prepare(`SELECT eafc_id, nombre, discord_id FROM players WHERE posicion='CARR' ORDER BY nombre`).all(),
        MC:   db.prepare(`SELECT eafc_id, nombre, discord_id FROM players WHERE posicion='MC'   ORDER BY nombre`).all(),
        DC:   db.prepare(`SELECT eafc_id, nombre, discord_id FROM players WHERE posicion='DC'   ORDER BY nombre`).all(),
    };
    const totalJugadores = db.prepare(`SELECT COUNT(*) as c FROM players`).get().c;
    const preinscripcionAbierta = !!db.prepare(`SELECT value FROM settings WHERE key='preinscripcion_abierta'`).get()?.value;
    const miPreinscripcion = db.prepare(`SELECT * FROM preinscripciones WHERE discord_id=?`).get(did);
    const totalPreinscritos = db.prepare(`SELECT COUNT(*) as c FROM preinscripciones`).get().c;
    res.render('inscripciones', {
        user: req.session.user,
        draftAbierto,
        jugadorExistente,
        jugadoresPorPosicion,
        totalJugadores,
        enServidor,
        discordInvite: process.env.DISCORD_INVITE || '#',
        mensaje: req.query.cancelado ? 'cancelado' : (req.query.preinsc_ok ? 'preinsc_ok' : null),
        tipoMensaje: req.query.cancelado ? 'success' : (req.query.preinsc_ok ? 'success' : null),
        preinscripcionAbierta,
        miPreinscripcion,
        totalPreinscritos,
    });
});

app.post('/inscripciones/cancelar', (req, res) => {
    if (!req.session.user) return res.redirect('/auth/discord?next=/inscripciones');
    if (cache.draftEstado === 'abierto') return res.redirect('/inscripciones');
    const did = req.session.user.id;
    const jugador = db.prepare(`SELECT nombre, equipo FROM players WHERE discord_id=?`).get(did);
    if (!jugador) return res.redirect('/inscripciones');
    if (jugador.equipo) return res.redirect('/inscripciones'); // ya tiene equipo asignado, no puede salirse
    db.prepare(`DELETE FROM players WHERE discord_id=?`).run(did);
    emitNuevoJugador();
    io.emit('activity', `🚪 ${jugador.nombre} se ha desinscrito.`);
    axios.post('http://localhost:3001/api/actualizar-lista-draft').catch(() => {});
    axios.post('http://localhost:3001/api/actualizar-jugadores-inscritos').catch(() => {});
    return res.redirect('/inscripciones?cancelado=1');
});

// ── PRE-INSCRIPCIONES (siguiente draft) ────────────────────────
app.post('/preinscripciones', (req, res) => {
    if (!req.session.user) return res.redirect('/auth/discord?next=/inscripciones');
    const preinscAbierta = !!db.prepare(`SELECT value FROM settings WHERE key='preinscripcion_abierta'`).get()?.value;
    if (!preinscAbierta) return res.redirect('/inscripciones');
    const did = req.session.user.id;
    const { eafc_id, posicion, telefono } = req.body;
    const POSICIONES_VALIDAS = ['DC','CARR','MC','DFC','POR'];
    if (!eafc_id?.trim() || !posicion || !telefono?.trim()) return res.redirect('/inscripciones');
    if (!POSICIONES_VALIDAS.includes(posicion)) return res.redirect('/inscripciones');
    db.prepare(`
        INSERT INTO preinscripciones (discord_id, username, nombre, posicion, telefono, eafc_id)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(discord_id) DO UPDATE SET
            nombre=excluded.nombre, posicion=excluded.posicion,
            telefono=excluded.telefono, eafc_id=excluded.eafc_id
    `).run(did, req.session.user.username, eafc_id.trim(), posicion, telefono.trim(), eafc_id.trim());
    io.emit('activity', `📋 ${req.session.user.username} pre-inscrito para el siguiente draft.`);
    axios.post('http://localhost:3001/api/actualizar-preinscripciones').catch(() => {});
    return res.redirect('/inscripciones?preinsc_ok=1');
});

app.post('/preinscripciones/cancelar', (req, res) => {
    if (!req.session.user) return res.redirect('/auth/discord?next=/inscripciones');
    const did = req.session.user.id;
    db.prepare(`DELETE FROM preinscripciones WHERE discord_id=?`).run(did);
    io.emit('activity', `🚪 ${req.session.user.username} canceló su pre-inscripción.`);
    axios.post('http://localhost:3001/api/actualizar-preinscripciones').catch(() => {});
    return res.redirect('/inscripciones');
});

app.post('/admin/abrir-preinscripcion', requireLogin, requireAdmin, (req, res) => {
    db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('preinscripcion_abierta','1')`).run();
    axios.post('http://localhost:3001/api/abrir-preinscripcion').catch(() => {});
    io.emit('activity', '📋 Pre-inscripciones para el siguiente draft ABIERTAS.');
    res.redirect('/admin');
});

app.post('/admin/cerrar-preinscripcion', requireLogin, requireAdmin, (req, res) => {
    db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('preinscripcion_abierta','')`).run();
    axios.post('http://localhost:3001/api/cerrar-preinscripcion').catch(() => {});
    io.emit('activity', '🔒 Pre-inscripciones para el siguiente draft CERRADAS.');
    res.redirect('/admin');
});

app.post('/inscripciones', async (req, res) => {
    if (!req.session.user) return res.redirect('/auth/discord?next=/inscripciones');
    const draftAbierto = cache.draftEstado === 'abierto';
    if (draftAbierto) return res.redirect('/inscripciones');

    const did  = req.session.user.id;
    const { eafc_id, posicion, telefono } = req.body;
    const POSICIONES_VALIDAS = ['DC', 'CARR', 'MC', 'DFC', 'POR'];

    const renderError = (msg) => {
        const jugadorExistente = db.prepare(`SELECT * FROM players WHERE discord_id=?`).get(did);
        const jugadoresPorPosicion = {
            POR:  db.prepare(`SELECT eafc_id, nombre, discord_id FROM players WHERE posicion='POR'  ORDER BY nombre`).all(),
            DFC:  db.prepare(`SELECT eafc_id, nombre, discord_id FROM players WHERE posicion='DFC'  ORDER BY nombre`).all(),
            CARR: db.prepare(`SELECT eafc_id, nombre, discord_id FROM players WHERE posicion='CARR' ORDER BY nombre`).all(),
            MC:   db.prepare(`SELECT eafc_id, nombre, discord_id FROM players WHERE posicion='MC'   ORDER BY nombre`).all(),
            DC:   db.prepare(`SELECT eafc_id, nombre, discord_id FROM players WHERE posicion='DC'   ORDER BY nombre`).all(),
        };
        const totalJugadores = db.prepare(`SELECT COUNT(*) as c FROM players`).get().c;
        res.render('inscripciones', {
            user: req.session.user,
            draftAbierto: false,
            jugadorExistente,
            jugadoresPorPosicion,
            totalJugadores,
            mensaje: msg,
            tipoMensaje: 'error'
        });
    };

    if (!eafc_id?.trim() || !posicion || !telefono?.trim())
        return renderError('Todos los campos son obligatorios.');
    if (!POSICIONES_VALIDAS.includes(posicion))
        return renderError('Posición no válida.');

    const eaid = eafc_id.trim();
    const tel  = telefono.trim();
    const yaExistia = !!db.prepare(`SELECT 1 FROM players WHERE discord_id=?`).get(did);

    const foto = req.session.user.avatar || null;
    db.prepare(`
        INSERT INTO players (discord_id, nombre, posicion, telefono, eafc_id, foto, equipo)
        VALUES (?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(discord_id) DO UPDATE SET
            nombre=excluded.nombre,
            posicion=excluded.posicion,
            telefono=excluded.telefono,
            eafc_id=excluded.eafc_id,
            foto=excluded.foto
    `).run(did, eaid, posicion, tel, eaid, foto);

    emitNuevoJugador();
    io.emit('jugador_añadido', { discord_id: did, nombre: eaid, eafc_id: eaid, posicion, foto });
    io.emit('activity', `📝 ${eaid} se inscribió desde la web (${posicion})`);

    axios.post('http://localhost:3001/api/asignar-rol-jugador', { discord_id: did }).catch(() => {});
    axios.post('http://localhost:3001/api/actualizar-panel-inscripciones').catch(() => {});
    axios.post('http://localhost:3001/api/actualizar-lista-draft').catch(() => {});
    axios.post('http://localhost:3001/api/actualizar-jugadores-inscritos').catch(() => {});

    const jugadorExistente = db.prepare(`SELECT * FROM players WHERE discord_id=?`).get(did);
    const jugadoresPorPosicion = {
        POR:  db.prepare(`SELECT eafc_id, nombre, discord_id FROM players WHERE posicion='POR'  ORDER BY nombre`).all(),
        DFC:  db.prepare(`SELECT eafc_id, nombre, discord_id FROM players WHERE posicion='DFC'  ORDER BY nombre`).all(),
        CARR: db.prepare(`SELECT eafc_id, nombre, discord_id FROM players WHERE posicion='CARR' ORDER BY nombre`).all(),
        MC:   db.prepare(`SELECT eafc_id, nombre, discord_id FROM players WHERE posicion='MC'   ORDER BY nombre`).all(),
        DC:   db.prepare(`SELECT eafc_id, nombre, discord_id FROM players WHERE posicion='DC'   ORDER BY nombre`).all(),
    };
    const totalJugadores = db.prepare(`SELECT COUNT(*) as c FROM players`).get().c;
    res.render('inscripciones', {
        user: req.session.user,
        draftAbierto: false,
        jugadorExistente,
        jugadoresPorPosicion,
        totalJugadores,
        mensaje: yaExistia ? 'Datos actualizados correctamente.' : '¡Inscripción completada! Ya apareces en la lista del draft.',
        tipoMensaje: 'success'
    });
});

// ══════════════════════════════════════════════════════════════
//  HUB
// ══════════════════════════════════════════════════════════════
app.get('/hub', requireLogin, (req, res) => {
    const top5           = db.prepare(`
        SELECT c.*, COALESCE(NULLIF(t.nombre_equipo,''), c.equipo_nombre) AS display_nombre
        FROM clasificacion c
        LEFT JOIN teams t ON t.capitan_id = c.capitan_id
        ORDER BY c.puntos DESC, c.gf DESC LIMIT 5
    `).all();
    const fichados       = db.prepare(`SELECT COUNT(*) as c FROM players WHERE equipo IS NOT NULL`).get();
    const totalJugadores = db.prepare(`SELECT COUNT(*) as c FROM players`).get();
    const totalEquipos   = db.prepare(`SELECT COUNT(*) as c FROM teams`).get();
    const miEquipo       = db.prepare(`SELECT * FROM teams WHERE capitan_id=?`).get(req.session.user.id);
    const ultimosFichajes = db.prepare(`
        SELECT p.nombre, p.posicion, p.equipo, pk.timestamp
        FROM picks pk JOIN players p ON p.discord_id = pk.jugador_id
        ORDER BY pk.id DESC LIMIT 5
    `).all();

    res.render('hub', {
        user:           { ...req.session.user, esCapitan: !!miEquipo },
        top5,
        totalFichados:  fichados?.c || 0,
        totalJugadores: totalJugadores?.c || 0,
        totalEquipos:   totalEquipos?.c || 0,
        draftEstado:    cache.draftEstado,
        turnoActual:    cache.turnoActual,
        ultimosFichajes
    });
});

// ══════════════════════════════════════════════════════════════
//  DRAFT
// ══════════════════════════════════════════════════════════════
app.get('/draft', requireLogin, (req, res) => {
    const userId    = req.session.user.id;
    const jugadores = db.prepare(`SELECT * FROM players ORDER BY posicion, nombre`).all();
    const miEquipo  = db.prepare(`SELECT * FROM teams WHERE capitan_id=?`).get(userId);
    const teams     = db.prepare(`SELECT * FROM teams ORDER BY id`).all();

    const esCapitan = !!miEquipo;
    const misJugadores = miEquipo
        ? jugadores.filter(j => j.equipo === req.session.user.username)
        : [];

    const conteo = { DC: 0, MC: 0, CARR: 0, DFC: 0, POR: 0 };
    misJugadores.forEach(j => { if (conteo[j.posicion] !== undefined) conteo[j.posicion]++; });

    const allPicks = db.prepare(`
        SELECT pl.nombre, pl.eafc_id, pl.foto, pl.posicion,
               COALESCE(t.nombre_equipo, pk.capitan) AS equipo
        FROM picks pk
        JOIN players pl ON pk.jugador_id = pl.discord_id
        LEFT JOIN teams t ON pk.capitan = t.capitan_username
        ORDER BY pk.id DESC
    `).all();

    const torneoGenerado = db.prepare(`SELECT value FROM settings WHERE key='torneo_generado'`).get();
    res.render('draft', {
        user:            { ...req.session.user, esCapitan },
        jugadores:       jugadores.filter(j => !j.equipo),
        todosFichados:   jugadores.filter(j => j.equipo),
        miEquipo:        miEquipo || null,
        misJugadores,
        conteo,
        turnoActual:     cache.turnoActual,
        draftEstado:     cache.draftEstado,
        tiempoRestante:  cache.tiempoRestante,
        teams,
        allPicks,
        torneoGenerado:  !!torneoGenerado?.value,
        LIMS: { DC: 2, MC: 3, CARR: 2, DFC: 3, POR: 1 }
    });
});

app.get('/draft-stream', requireLogin, requireAdmin, (req, res) => {
    const jugadores        = db.prepare(`SELECT * FROM players ORDER BY posicion, nombre`).all();
    const jugadoresLibres  = jugadores.filter(j => !j.equipo);
    const jugadoresFichados= jugadores.filter(j =>  j.equipo);
    const teams            = db.prepare(`SELECT * FROM teams ORDER BY COALESCE(orden_draft, id)`).all();
    const ronda            = db.prepare(`SELECT value FROM settings WHERE key='ronda_actual'`).get();

    res.render('draft-stream', {
        user:             req.session.user,
        jugadoresLibres,
        jugadoresFichados,
        teams,
        turnoActual:      cache.turnoActual,
        draftEstado:      cache.draftEstado,
        tiempoRestante:   cache.tiempoRestante,
        rondaActual:      ronda?.value || 1,
    });
});

// ── Confirmar orden de picks (desde ruleta en draft-stream) ──────
app.post('/admin/confirmar-orden-draft', requireLogin, requireAdmin, async (req, res) => {
    const { orden } = req.body;
    if (!orden || !Array.isArray(orden) || orden.length === 0)
        return res.status(400).json({ error: 'Orden inválido' });

    const stmt = db.prepare(`UPDATE teams SET orden_draft = ? WHERE capitan_username = ?`);
    db.transaction(() => {
        orden.forEach((username, idx) => stmt.run(idx + 1, username));
    })();

    try {
        const teams = db.prepare(`SELECT capitan_username, nombre_equipo FROM teams ORDER BY COALESCE(orden_draft, id)`).all();
        await axios.post('http://localhost:3001/api/orden-draft-confirmado', {
            orden: teams.map(t => ({ username: t.capitan_username, nombre: t.nombre_equipo || t.capitan_username }))
        });
    } catch(e) { /* bot offline */ }

    res.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════
//  PICK — fichar jugador (solo desde draft-stream vía admin/forzar-pick)
// ══════════════════════════════════════════════════════════════
const LIMITES = { DC: 2, MC: 3, CARR: 2, DFC: 3, POR: 1 };

// Los capitanes NO pueden fichar desde draft.ejs — se redirige a solo lectura
// El pick real se hace desde draft-stream.ejs via /admin/forzar-pick
app.post('/pick', requireLogin, pickLimiter, (req, res) => {
    // Bloquear picks directos desde capitanes en draft.ejs
    // Los picks deben hacerse desde draft-stream.ejs (admin)
    return res.status(403).json({ error: 'Los picks se realizan desde la pantalla de stream. Espera tu turno.' });
});

// ══════════════════════════════════════════════════════════════
//  SNAKE DRAFT LOGIC
// ══════════════════════════════════════════════════════════════
function avanzarTurnoSnake(capitanActual) {
    const teams  = db.prepare(`SELECT capitan_username FROM teams ORDER BY COALESCE(orden_draft, id) ASC`).all();
    if (!teams.length) return;

    // ── Verificar si el draft está completo (la DB ya tiene el pick recién guardado) ──
    let draftCompleto = true;
    for (const team of teams) {
        const jugCount = db.prepare(`SELECT COUNT(*) as c FROM players WHERE equipo=?`).get(team.capitan_username)?.c || 0;
        if (jugCount < 11) { draftCompleto = false; break; }
    }

    if (draftCompleto) {
        // Cerrar draft automáticamente
        db.prepare(`UPDATE settings SET value='cerrado' WHERE key='draft_estado'`).run();
        cache.draftEstado = 'cerrado';
        if (cache.timerInterval) { clearInterval(cache.timerInterval); cache.timerInterval = null; }
        io.emit('draft-cerrado');
        io.emit('activity', '🏆 ¡Draft completado! Todos los equipos están formados.');
        // Notificar bot para generar equipos-ids
        axios.post('http://localhost:3001/api/generar-equipos-ids').catch(() => {});
        axios.post('http://localhost:3001/api/borrar-canales').catch(() => {});
        console.log('✅ Draft auto-cerrado: todos los equipos completos.');
        return;
    }

    const tiempo  = db.prepare(`SELECT value FROM settings WHERE key='tiempo_turno'`).get()?.value || '90';

    // ── Cola de pendientes (capitanes saltados por forzar turno) ──
    const queueVal = db.prepare(`SELECT value FROM settings WHERE key='pending_queue'`).get()?.value || '';
    const queue = queueVal ? queueVal.split(',').filter(Boolean) : [];
    if (queue.length > 0) {
        const nextFromQueue = queue.shift();
        db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('pending_queue',?)`).run(queue.join(','));
        db.prepare(`UPDATE settings SET value=? WHERE key='turno_actual'`).run(nextFromQueue);
        cache.turnoActual    = nextFromQueue;
        cache.tiempoRestante = parseInt(tiempo);
        iniciarTimer();
        io.emit('activity', `📋 Turno pendiente: ${nextFromQueue} (cola restante: ${queue.length})`);
        return;
    }

    const lista   = teams.map(t => t.capitan_username);
    const indice  = lista.indexOf(capitanActual);
    const dir     = db.prepare(`SELECT value FROM settings WHERE key='direccion_snake'`).get()?.value || 'asc';

    let siguiente     = capitanActual;
    let nuevaDireccion = dir;

    // Snake: el capitán del extremo elige 2 veces seguidas (compensa la desventaja de posición)
    if (dir === 'asc') {
        if (indice >= lista.length - 1) {
            siguiente      = lista[lista.length - 1];
            nuevaDireccion = 'desc';
            const ronda = db.prepare(`SELECT value FROM settings WHERE key='ronda_actual'`).get();
            db.prepare(`UPDATE settings SET value=? WHERE key='ronda_actual'`).run(
                String(parseInt(ronda?.value || 1) + 1)
            );
        } else {
            siguiente = lista[indice + 1];
        }
    } else {
        // DESC
        if (indice <= 0) {
            siguiente      = lista[0];
            nuevaDireccion = 'asc';
        } else {
            siguiente = lista[indice - 1];
        }
    }

    db.prepare(`UPDATE settings SET value=? WHERE key='turno_actual'`).run(siguiente);
    db.prepare(`UPDATE settings SET value=? WHERE key='direccion_snake'`).run(nuevaDireccion);

    cache.turnoActual    = siguiente;
    cache.tiempoRestante = parseInt(tiempo);

    iniciarTimer();

    // Notificar al capitán cuyo turno acaba de comenzar
    axios.post('http://localhost:3001/api/notificar-turno', { capitan: siguiente }).catch(() => {});
}

// ══════════════════════════════════════════════════════════════
//  TIMER DE TURNO
// ══════════════════════════════════════════════════════════════
function iniciarTimer() {
    if (cache.timerInterval) clearInterval(cache.timerInterval);
    const tiempo = db.prepare(`SELECT value FROM settings WHERE key='tiempo_turno'`).get();
    cache.tiempoRestante = parseInt(tiempo?.value || 90);

    cache.timerInterval = setInterval(() => {
        if (cache.draftEstado !== 'abierto') return;
        cache.tiempoRestante--;
        io.emit('timer_tick', { segundos: cache.tiempoRestante });

        if (cache.tiempoRestante <= 0) {
            const capitanSaltado = cache.turnoActual;
            io.emit('activity', `⏱️ Turno de ${capitanSaltado} expirado. Turno saltado.`);
            io.emit('turno_saltado', { capitan: capitanSaltado });
            avanzarTurnoSnake(capitanSaltado);
            io.emit('turno_actualizado', { turno: cache.turnoActual });
            io.emit('timer_tick', { segundos: cache.tiempoRestante });
            io.emit('nuevo-fichaje', { turno: cache.turnoActual, timer: cache.tiempoRestante });
            axios.post('http://localhost:3001/api/notificar-turno-saltado', { capitan: capitanSaltado }).catch(() => {});
        }
    }, 1000);
}

// ══════════════════════════════════════════════════════════════
//  EXPORT EXCEL
// ══════════════════════════════════════════════════════════════
app.get('/admin/exportar-excel', requireLogin, requireAdmin, (req, res) => {
    const teams     = db.prepare(`SELECT * FROM teams ORDER BY COALESCE(orden_draft, id)`).all();
    const jugadores = db.prepare(`SELECT * FROM players ORDER BY posicion, nombre`).all();

    // ── Hoja 1: Equipos ──────────────────────────────────────
    const POS_ORDEN = ['POR','DFC','DFC','DFC','CARR','CARR','MC','MC','MC','DC','DC'];
    const POSICIONES = ['POR','DFC','CARR','MC','DC'];
    const aoa = [];

    // Fila cabecera — nombres de equipos
    aoa.push(['', ...teams.map(t => t.nombre_equipo || t.capitan_username)]);

    // 11 filas de jugadores por posición
    POS_ORDEN.forEach((pos, i) => {
        const row = [pos];
        teams.forEach(t => {
            const enEquipo = jugadores.filter(j => j.equipo === t.capitan_username && j.posicion === pos);
            const yaUsados = POS_ORDEN.slice(0, i).filter(p => p === pos).length;
            const j = enEquipo[yaUsados] || null;
            row.push(j ? (j.eafc_id || j.nombre) : '');
        });
        aoa.push(row);
    });

    // Fila vacía de separación
    aoa.push([]);
    aoa.push([]);

    // ── Sección inferior: jugadores por posición ─────────────
    aoa.push(POSICIONES);
    const porPos = {};
    POSICIONES.forEach(p => { porPos[p] = jugadores.filter(j => j.posicion === p); });
    const maxRows = Math.max(...POSICIONES.map(p => porPos[p].length), 0);
    for (let i = 0; i < maxRows; i++) {
        aoa.push(POSICIONES.map(p => {
            const j = porPos[p][i];
            return j ? `${j.eafc_id || j.nombre}${j.equipo ? ` (${j.equipo})` : ''}` : '';
        }));
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // Ancho columnas: primera estrecha, resto equipos/posiciones
    ws['!cols'] = [{ wch: 6 }, ...Array(Math.max(teams.length, POSICIONES.length)).fill({ wch: 22 })];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Draft');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const fecha = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="clutch-draft-${fecha}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
});

// ══════════════════════════════════════════════════════════════
//  ADMIN PANEL
// ══════════════════════════════════════════════════════════════
app.get('/admin', requireLogin, requireAdmin, (req, res) => {
    const jugadores = db.prepare(`SELECT * FROM players ORDER BY nombre`).all();
    const equipos   = db.prepare(`SELECT * FROM teams ORDER BY id`).all();
    const matches   = db.prepare(`SELECT * FROM matches ORDER BY jornada, id`).all();
    const ronda     = db.prepare(`SELECT value FROM settings WHERE key='ronda_actual'`).get();
    const jornada   = db.prepare(`SELECT value FROM settings WHERE key='jornada_actual'`).get();

    let historial = [];
    try {
        historial = db.prepare(`SELECT * FROM historial_torneos ORDER BY id DESC`).all();
    } catch(e2) {
        console.warn('[/admin] Tabla historial_torneos no existe aún:', e2.message);
    }

    const admins = db.prepare('SELECT * FROM admins ORDER BY id').all();
    let candidatosCapitan = [];
    try { candidatosCapitan = db.prepare(`SELECT * FROM candidatos_capitan ORDER BY forzado DESC, rowid ASC`).all(); } catch {}
    const numEquiposManual = db.prepare(`SELECT value FROM settings WHERE key='num_equipos_manual'`).get()?.value || '';
    const formatoManual    = db.prepare(`SELECT value FROM settings WHERE key='formato_manual'`).get()?.value || '';
    const capsPorEquipo    = parseInt(db.prepare(`SELECT value FROM settings WHERE key='caps_por_equipo'`).get()?.value || '1');
    const draftTipo        = db.prepare(`SELECT value FROM settings WHERE key='draft_tipo'`).get()?.value || '';
    res.render('admin', {
        user:          req.session.user,
        esSuperAdmin:  isSuperAdmin(req),
        jugadores,
        equipos,
        matches,
        admins,
        turnoActual:    cache.turnoActual,
        draftEstado:    cache.draftEstado,
        direccionSnake: db.prepare(`SELECT value FROM settings WHERE key='direccion_snake'`).get()?.value || 'asc',
        tiempoTurno:    db.prepare(`SELECT value FROM settings WHERE key='tiempo_turno'`).get()?.value || 90,
        tiempoUltimaHora: parseInt(db.prepare(`SELECT value FROM settings WHERE key='tiempo_ultima_hora'`).get()?.value || '30'),
        rondaActual:    ronda?.value || 1,
        jornadaActual:  jornada?.value || 1,
        fichados:       jugadores.filter(j => j.equipo).length,
        total:          jugadores.length,
        historial,
        candidatosCapitan,
        numEquiposManual,
        formatoManual,
        capsPorEquipo,
        draftTipo,
        pendingQueue: (db.prepare(`SELECT value FROM settings WHERE key='pending_queue'`).get()?.value || '').split(',').filter(Boolean),
        preinscripcionAbierta: !!db.prepare(`SELECT value FROM settings WHERE key='preinscripcion_abierta'`).get()?.value,
        totalPreinscritos: db.prepare(`SELECT COUNT(*) as c FROM preinscripciones`).get().c,
    });
});

// Abrir draft
app.post('/admin/abrir-draft', requireLogin, requireAdmin, (req, res) => {
    const teams = db.prepare(`SELECT * FROM teams ORDER BY COALESCE(orden_draft, id) ASC`).all();
    if (!teams.length) return res.redirect('/admin');

    const primerCapitan = teams[0].capitan_username;

    db.transaction(() => {
        db.prepare(`UPDATE settings SET value='abierto' WHERE key='draft_estado'`).run();
        db.prepare(`UPDATE settings SET value=? WHERE key='turno_actual'`).run(primerCapitan);
        db.prepare(`UPDATE settings SET value='asc' WHERE key='direccion_snake'`).run();

        // Auto-asignar capitanes a sus equipos antes de empezar el draft
        const stmtEnsure = db.prepare(`INSERT OR IGNORE INTO players (discord_id, nombre, posicion) VALUES (?, ?, 'DC')`);
        const stmtEquipo = db.prepare(`UPDATE players SET equipo=? WHERE discord_id=? AND (equipo IS NULL OR equipo='')`);
        const stmtPick   = db.prepare(`INSERT OR IGNORE INTO picks (ronda, capitan, jugador_id) VALUES (0, ?, ?)`);

        for (const team of teams) {
            if (team.capitan_id) {
                stmtEnsure.run(team.capitan_id, team.capitan_username);
                stmtEquipo.run(team.capitan_username, team.capitan_id);
                stmtPick.run(team.capitan_username, team.capitan_id);
            }
            if (team.capitan2_id) {
                stmtEnsure.run(team.capitan2_id, team.capitan_username);
                stmtEquipo.run(team.capitan_username, team.capitan2_id);
                stmtPick.run(team.capitan_username, team.capitan2_id);
            }
        }
    })();

    cache.draftEstado = 'abierto';
    cache.turnoActual = primerCapitan;

    // Cerrar inscripciones automáticamente al abrir el draft
    db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('inscripciones_estado','cerrado')`).run();
    io.emit('inscripciones-update', { estado: 'cerrado' });

    iniciarTimer();
    io.emit('draft-abierto', { turno: primerCapitan });
    res.redirect('/admin');
});

// Cerrar draft
app.post('/admin/cerrar-draft', requireLogin, requireAdmin, (req, res) => {
    db.prepare(`UPDATE settings SET value='cerrado' WHERE key='draft_estado'`).run();
    cache.draftEstado = 'cerrado';
    if (cache.timerInterval) { clearInterval(cache.timerInterval); cache.timerInterval = null; }

    axios.post('http://localhost:3001/api/generar-equipos-ids').catch(() => {});
    axios.post('http://localhost:3001/api/borrar-canales').catch(() => {});

    io.emit('draft-cerrado');
    res.redirect('/admin');
});

// Limpiar cola de pendientes
app.post('/admin/limpiar-cola', requireLogin, requireAdmin, (req, res) => {
    db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('pending_queue','')`).run();
    io.emit('activity', '🗑️ Cola de turnos pendientes vaciada por admin.');
    res.redirect('/admin');
});

// Saltar turno
app.post('/admin/saltar-turno', requireLogin, requireAdmin, (req, res) => {
    io.emit('activity', `⏭️ Turno de ${cache.turnoActual} saltado por el admin.`);
    avanzarTurnoSnake(cache.turnoActual);
    io.emit('turno_actualizado', { turno: cache.turnoActual });
    io.emit('timer_tick', { segundos: cache.tiempoRestante });
    io.emit('nuevo-fichaje', { turno: cache.turnoActual, timer: cache.tiempoRestante });
    res.redirect('/admin');
});

// Forzar turno manualmente a un capitán específico
app.post('/admin/forzar-turno', requireLogin, requireAdmin, (req, res) => {
    const { capitan, direccion } = req.body;
    if (!capitan) return res.redirect('/admin');
    const team = db.prepare(`SELECT capitan_username FROM teams WHERE capitan_username=?`).get(capitan);
    if (!team) return res.redirect('/admin');

    // Calcular capitanes saltados y meterlos en cola pendiente
    const lista = db.prepare(`SELECT capitan_username FROM teams ORDER BY COALESCE(orden_draft, id) ASC`).all().map(t => t.capitan_username);
    const currentIdx = lista.indexOf(cache.turnoActual);
    const targetIdx  = lista.indexOf(capitan);
    const dir = db.prepare(`SELECT value FROM settings WHERE key='direccion_snake'`).get()?.value || 'asc';

    let skipped = [];
    if (currentIdx !== -1 && targetIdx !== -1 && currentIdx !== targetIdx) {
        if (dir === 'asc' && targetIdx > currentIdx + 1) {
            skipped = lista.slice(currentIdx + 1, targetIdx);
        } else if (dir === 'desc' && targetIdx < currentIdx - 1) {
            skipped = lista.slice(targetIdx + 1, currentIdx).reverse();
        }
    }

    if (skipped.length > 0) {
        const existingQueue = db.prepare(`SELECT value FROM settings WHERE key='pending_queue'`).get()?.value || '';
        const existing = existingQueue ? existingQueue.split(',').filter(Boolean) : [];
        const newQueue = [...skipped, ...existing].filter(Boolean);
        db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('pending_queue',?)`).run(newQueue.join(','));
        io.emit('activity', `⚠️ Capitanes añadidos a cola pendiente: ${skipped.join(', ')}`);
    }

    const tiempo = parseInt(db.prepare(`SELECT value FROM settings WHERE key='tiempo_turno'`).get()?.value || '90');
    db.prepare(`UPDATE settings SET value=? WHERE key='turno_actual'`).run(capitan);
    if (direccion === 'asc' || direccion === 'desc')
        db.prepare(`UPDATE settings SET value=? WHERE key='direccion_snake'`).run(direccion);
    cache.turnoActual    = capitan;
    cache.tiempoRestante = tiempo;
    if (cache.timerInterval) { clearInterval(cache.timerInterval); cache.timerInterval = null; }
    iniciarTimer();
    io.emit('turno_actualizado', { turno: capitan });
    io.emit('timer_tick', { segundos: tiempo });
    io.emit('nuevo-fichaje', { turno: capitan, timer: tiempo });
    io.emit('activity', `🎯 Admin forzó el turno a: ${capitan}${skipped.length ? ` (${skipped.length} en cola)` : ''}`);
    res.redirect('/admin');
});

// Deshacer último pick
app.post('/admin/deshacer-pick', requireLogin, requireAdmin, (req, res) => {
    const ultimo = db.prepare(`SELECT * FROM picks WHERE ronda > 0 ORDER BY id DESC LIMIT 1`).get();
    if (!ultimo) return res.redirect('/admin');

    db.transaction(() => {
        db.prepare(`UPDATE players SET equipo=NULL WHERE discord_id=?`).run(ultimo.jugador_id);
        db.prepare(`DELETE FROM picks WHERE id=?`).run(ultimo.id);
        db.prepare(`UPDATE settings SET value=? WHERE key='turno_actual'`).run(ultimo.capitan);
    })();

    // Re-abrir draft si estaba cerrado por completarse
    if (cache.draftEstado === 'cerrado') {
        db.prepare(`UPDATE settings SET value='abierto' WHERE key='draft_estado'`).run();
        cache.draftEstado = 'abierto';
    }

    cache.turnoActual = ultimo.capitan;

    const jugador = db.prepare(`SELECT * FROM players WHERE discord_id=?`).get(ultimo.jugador_id);
    io.emit('pick_deshecho', {
        jugador_id: ultimo.jugador_id,
        equipo:     ultimo.capitan,
        jugador:    { discord_id: ultimo.jugador_id, nombre: jugador?.nombre || '', posicion: jugador?.posicion || '' }
    });
    io.emit('turno_actualizado', { turno: cache.turnoActual });
    io.emit('timer_tick', { segundos: cache.tiempoRestante });
    io.emit('nuevo-fichaje', { turno: cache.turnoActual, timer: cache.tiempoRestante });
    io.emit('activity', `↩️ Último pick de ${ultimo.capitan} deshecho.`);
    res.redirect('/admin');
});

// ── Pick forzado por admin desde draft-stream ────────────────
app.post('/admin/forzar-pick', requireLogin, requireAdmin, (req, res) => {
    const { player_id } = req.body;

    if (cache.draftEstado !== 'abierto')
        return res.status(403).json({ error: 'El draft está cerrado.' });

    if (!cache.turnoActual)
        return res.status(400).json({ error: 'No hay turno activo.' });

    const jugador = db.prepare(`SELECT * FROM players WHERE discord_id=? AND equipo IS NULL`).get(player_id);
    if (!jugador) return res.status(400).json({ error: 'Jugador no disponible.' });

    const LIMITES_PICK = { DC: 2, MC: 3, CARR: 2, DFC: 3, POR: 1 };
    const capitan = cache.turnoActual;

    const enEquipo = db.prepare(
        `SELECT COUNT(*) as c FROM players WHERE equipo=? AND posicion=?`
    ).get(capitan, jugador.posicion);
    if (enEquipo.c >= LIMITES_PICK[jugador.posicion])
        return res.status(400).json({ error: `Límite de ${jugador.posicion} alcanzado para ${capitan}.` });

    const ronda = db.prepare(`SELECT value FROM settings WHERE key='ronda_actual'`).get();

    db.transaction(() => {
        db.prepare(`UPDATE players SET equipo=? WHERE discord_id=?`).run(capitan, player_id);
        db.prepare(`INSERT INTO picks (ronda, capitan, jugador_id) VALUES (?,?,?)`).run(
            parseInt(ronda?.value || 1), capitan, player_id
        );
    })();

    avanzarTurnoSnake(capitan);

    io.emit('jugador_fichado', {
        equipo:  capitan,
        jugador: { discord_id: player_id, nombre: jugador.nombre, eafc_id: jugador.eafc_id || '', foto: jugador.foto || '', posicion: jugador.posicion },
        turno:   cache.turnoActual,
        timer:   cache.tiempoRestante
    });
    io.emit('turno_actualizado', { turno: cache.turnoActual });
    io.emit('timer_tick', { segundos: cache.tiempoRestante });
    io.emit('nuevo-fichaje', {
        capitan,
        jugador:   jugador.nombre,
        jugadorId: player_id,
        posicion:  jugador.posicion,
        turno:     cache.turnoActual,
        timer:     cache.tiempoRestante
    });
    io.emit('activity', `⚡ ${capitan} fichó a ${jugador.nombre} (${jugador.posicion})`);

    axios.post(`http://localhost:3001/api/fichaje`, {
        capitan,
        jugador:  jugador.eafc_id || jugador.nombre,
        discord:  jugador.nombre,
        posicion: jugador.posicion,
        telefono: jugador.telefono || 'No disponible'
    }).catch(() => {});

    res.json({ ok: true, capitan, jugador: jugador.nombre, turnoSiguiente: cache.turnoActual });
});

// ── Auto-draft ────────────────────────────────────────────────
app.post('/admin/auto-draft', requireLogin, requireAdmin, (req, res) => {
    if (cache.draftEstado !== 'abierto')
        return res.status(403).json({ error: 'El draft está cerrado.' });

    const necesita = { DC: 2, MC: 3, CARR: 2, DFC: 3, POR: 1 };
    let totalPicks = 0;
    let iteraciones = 0;
    const MAX_ITER = 500;

    while (iteraciones++ < MAX_ITER) {
        const capitan = cache.turnoActual;
        if (!capitan) break;

        let jugadorElegido = null;
        for (const pos of ['POR', 'DFC', 'CARR', 'MC', 'DC']) {
            const enEquipo = db.prepare(
                `SELECT COUNT(*) as c FROM players WHERE equipo=? AND posicion=?`
            ).get(capitan, pos)?.c || 0;
            if (enEquipo >= necesita[pos]) continue;
            const candidato = db.prepare(
                `SELECT * FROM players WHERE posicion=? AND equipo IS NULL LIMIT 1`
            ).get(pos);
            if (candidato) { jugadorElegido = candidato; break; }
        }

        if (!jugadorElegido) break;

        const ronda = db.prepare(`SELECT value FROM settings WHERE key='ronda_actual'`).get();
        db.transaction(() => {
            db.prepare(`UPDATE players SET equipo=? WHERE discord_id=?`).run(capitan, jugadorElegido.discord_id);
            db.prepare(`INSERT INTO picks (ronda, capitan, jugador_id) VALUES (?,?,?)`).run(
                parseInt(ronda?.value || 1), capitan, jugadorElegido.discord_id
            );
        })();

        io.emit('jugador_fichado', {
            equipo:  capitan,
            jugador: { discord_id: jugadorElegido.discord_id, nombre: jugadorElegido.nombre, foto: jugadorElegido.foto || '', posicion: jugadorElegido.posicion },
            turno:   cache.turnoActual,
            timer:   cache.tiempoRestante
        });

        avanzarTurnoSnake(capitan);
        totalPicks++;
    }

    const fichados = db.prepare(`SELECT COUNT(*) as c FROM players WHERE equipo IS NOT NULL`).get()?.c || 0;
    io.emit('activity', `🤖 [ADMIN] Auto-draft completado: ${totalPicks} picks. Fichados: ${fichados}`);
    io.emit('nuevo-fichaje', { turno: cache.turnoActual });
    res.json({ ok: true, totalPicks, fichados });
});

// Registrar capitán
app.post('/admin/registrar-capitan', requireLogin, requireAdmin, (req, res) => {
    const { capitan_id, capitan_username } = req.body;
    try {
        db.prepare(`INSERT OR IGNORE INTO teams (capitan_id, capitan_username, formacion) VALUES (?,?,'3-1-4-2')`).run(capitan_id, capitan_username);
        db.prepare(`INSERT OR IGNORE INTO clasificacion (capitan_id, equipo_nombre) VALUES (?,?)`).run(capitan_id, capitan_username);
        io.emit('activity', `👑 Nuevo capitán registrado: ${capitan_username}`);
        axios.post('http://localhost:3001/api/actualizar-equipos').catch(() => {});
    } catch(e) { console.error(e); }
    res.redirect('/admin');
});

// Eliminar capitán
app.post('/admin/eliminar-capitan', requireLogin, requireAdmin, (req, res) => {
    const { capitan_id } = req.body;
    const equipo = db.prepare(`SELECT capitan_username FROM teams WHERE capitan_id=?`).get(capitan_id);
    db.prepare(`DELETE FROM teams WHERE capitan_id=?`).run(capitan_id);
    db.prepare(`DELETE FROM clasificacion WHERE capitan_id=?`).run(capitan_id);
    io.emit('activity', `🗑️ Capitán eliminado: ${equipo?.capitan_username || capitan_id}`);
    io.emit('clasificacion-update');
    axios.post('http://localhost:3001/api/actualizar-equipos').catch(() => {});
    axios.post('http://localhost:3001/api/actualizar-clasificacion').catch(() => {});
    res.redirect('/admin');
});

// ── Gestión de equipos ───────────────────────────────────────

// Asignar 2º capitán a un equipo
app.post('/admin/asignar-capitan2', requireLogin, requireAdmin, (req, res) => {
    const { equipo_id, discord_id, username } = req.body;
    if (!equipo_id) return res.redirect('/admin#tab-equipos');
    if (discord_id && username) {
        db.prepare(`UPDATE teams SET capitan2_id=?, capitan2_username=? WHERE id=?`).run(discord_id.trim(), username.trim(), equipo_id);
        io.emit('activity', `👑 2º capitán asignado: ${username} al equipo ${equipo_id}`);
    } else {
        db.prepare(`UPDATE teams SET capitan2_id=NULL, capitan2_username=NULL WHERE id=?`).run(equipo_id);
        io.emit('activity', `👑 2º capitán eliminado del equipo ${equipo_id}`);
    }
    res.redirect('/admin#tab-equipos');
});

// Mover jugador a un equipo
app.post('/admin/mover-jugador-equipo', requireLogin, requireAdmin, (req, res) => {
    const { discord_id, equipo } = req.body;
    if (!discord_id) return res.redirect('/admin#tab-equipos');
    db.prepare(`UPDATE players SET equipo=? WHERE discord_id=?`).run(equipo || null, discord_id);
    const j = db.prepare(`SELECT nombre FROM players WHERE discord_id=?`).get(discord_id);
    io.emit('activity', `🔄 ${j?.nombre || discord_id} movido al equipo: ${equipo || '(libre)'}`);
    emitNuevoJugador();
    res.redirect('/admin#tab-equipos');
});

// Dar rol capitán (individual, desde web)
app.post('/admin/dar-rol-capitan', requireLogin, requireAdmin, async (req, res) => {
    const { discord_id } = req.body;
    if (!discord_id) return res.redirect('/admin#tab-equipos');
    try {
        await axios.post('http://localhost:3001/api/dar-rol-capitan', { discord_id });
        io.emit('activity', `✅ Rol capitán dado a ${discord_id}`);
    } catch(e) { console.error('[dar-rol-capitan]', e.message); }
    res.redirect('/admin#tab-equipos');
});

// Quitar rol capitán (individual, desde web)
app.post('/admin/quitar-rol-capitan', requireLogin, requireAdmin, async (req, res) => {
    const { discord_id } = req.body;
    if (!discord_id) return res.redirect('/admin#tab-equipos');
    try {
        await axios.post('http://localhost:3001/api/quitar-rol-capitan', { discord_id });
        io.emit('activity', `🚫 Rol capitán quitado a ${discord_id}`);
    } catch(e) { console.error('[quitar-rol-capitan]', e.message); }
    res.redirect('/admin#tab-equipos');
});

// ── Gestión de admins secundarios ───────────────────────────
app.post('/admin/add-admin', requireLogin, requireAdmin, (req, res) => {
    if (!isSuperAdmin(req)) return res.status(403).json({ error: 'Solo el superadmin puede gestionar admins.' });
    const { discord_id, username } = req.body;
    if (!discord_id || !username) return res.redirect('/admin#tab-admins');
    if (discord_id === process.env.ADMIN_ID) return res.redirect('/admin#tab-admins');
    try {
        db.prepare('INSERT OR IGNORE INTO admins (discord_id, username) VALUES (?,?)').run(discord_id.trim(), username.trim());
        io.emit('activity', `🛡️ Nuevo admin añadido: ${username}`);
    } catch(e) { console.error(e); }
    res.redirect('/admin');
});

app.post('/admin/remove-admin', requireLogin, requireAdmin, (req, res) => {
    if (!isSuperAdmin(req)) return res.status(403).json({ error: 'Solo el superadmin puede gestionar admins.' });
    const { discord_id } = req.body;
    if (discord_id === process.env.ADMIN_ID) return res.redirect('/admin');
    db.prepare('DELETE FROM admins WHERE discord_id=?').run(discord_id);
    io.emit('activity', `🗑️ Admin eliminado (ID: ${discord_id})`);
    res.redirect('/admin');
});

// Añadir jugador manualmente (funciona con inscripciones cerradas)
app.post('/admin/agregar-jugador-manual', requireLogin, requireAdmin, (req, res) => {
    const { discord_id, nombre, posicion, telefono, eafc_id } = req.body;
    if (!discord_id || !nombre || !posicion) return res.redirect('/admin');
    const did = discord_id.trim();
    const nom = nombre.trim();
    db.prepare(`
        INSERT INTO players (discord_id, nombre, posicion, telefono, eafc_id, foto)
        VALUES (?, ?, ?, ?, ?, '')
        ON CONFLICT(discord_id) DO UPDATE SET
            nombre=excluded.nombre,
            posicion=excluded.posicion,
            telefono=excluded.telefono,
            eafc_id=excluded.eafc_id
    `).run(did, nom, posicion, telefono?.trim() || null, eafc_id?.trim() || null);
    emitNuevoJugador();
    const jugadorNuevo = db.prepare(`SELECT eafc_id FROM players WHERE discord_id=?`).get(did);
    io.emit('jugador_añadido', { discord_id: did, nombre: nom, eafc_id: jugadorNuevo?.eafc_id || '', posicion });
    io.emit('activity', `👤 Jugador añadido manualmente: ${nom} (${posicion})`);
    axios.post('http://localhost:3001/api/asignar-rol-jugador', { discord_id: did }).catch(() => {});
    axios.post('http://localhost:3001/api/actualizar-lista-draft').catch(() => {});
    axios.post('http://localhost:3001/api/actualizar-jugadores-inscritos').catch(() => {});
    res.redirect('/admin');
});

// Borrar jugador
app.post('/admin/borrar-jugador', requireLogin, requireAdmin, (req, res) => {
    const { discord_id } = req.body;
    const jugador = db.prepare(`SELECT nombre FROM players WHERE discord_id=?`).get(discord_id);
    db.prepare(`DELETE FROM players WHERE discord_id=?`).run(discord_id);
    emitNuevoJugador();
    io.emit('jugador_eliminado', { discord_id });
    io.emit('activity', `🗑️ Jugador eliminado: ${jugador?.nombre || discord_id}`);
    axios.post('http://localhost:3001/api/actualizar-equipos').catch(() => {});
    res.redirect('/admin');
});

// Editar jugador
app.post('/admin/editar-jugador', requireLogin, requireAdmin, (req, res) => {
    const { discord_id, nombre, posicion } = req.body;
    db.prepare(`UPDATE players SET nombre=?, posicion=? WHERE discord_id=?`).run(nombre, posicion, discord_id);
    const p = db.prepare(`SELECT eafc_id FROM players WHERE discord_id=?`).get(discord_id);
    emitNuevoJugador();
    io.emit('jugador_añadido', { discord_id, nombre: p?.eafc_id || nombre, eafc_id: p?.eafc_id || nombre, posicion });
    io.emit('activity', `✏️ Jugador editado: ${nombre} (${posicion})`);
    axios.post('http://localhost:3001/api/actualizar-equipos').catch(() => {});
    res.redirect('/admin');
});

// Liberar jugador
app.post('/admin/liberar-jugador', requireLogin, requireAdmin, (req, res) => {
    const { discord_id } = req.body;
    const jugador = db.prepare(`SELECT nombre FROM players WHERE discord_id=?`).get(discord_id);
    db.prepare(`UPDATE players SET equipo=NULL WHERE discord_id=?`).run(discord_id);
    io.emit('nuevo-fichaje', { turno: cache.turnoActual });
    io.emit('activity', `🔓 Jugador liberado: ${jugador?.nombre || discord_id}`);
    axios.post('http://localhost:3001/api/actualizar-equipos').catch(() => {});
    res.redirect(req.body.redirect_to || '/admin');
});

// Cambiar tiempo de turno
app.post('/admin/tiempo-turno', requireLogin, requireAdmin, (req, res) => {
    const { segundos } = req.body;
    db.prepare(`UPDATE settings SET value=? WHERE key='tiempo_turno'`).run(String(segundos));
    cache.tiempoRestante = parseInt(segundos);
    io.emit('timer_tick', { segundos: cache.tiempoRestante });
    res.redirect('/admin');
});

// Borrar todos los jugadores inscritos
app.post('/admin/borrar-todos-jugadores', requireLogin, requireAdmin, (req, res) => {
    db.prepare(`DELETE FROM players`).run();
    db.prepare(`DELETE FROM candidatos_capitan`).run();
    emitNuevoJugador();
    io.emit('jugadores_limpiados');
    io.emit('activity', '🗑️ Todos los jugadores borrados por el admin.');
    axios.post('http://localhost:3001/api/actualizar-jugadores-inscritos').catch(() => {});
    axios.post('http://localhost:3001/api/actualizar-lista-draft').catch(() => {});
    res.redirect('/admin');
});

// Reset completo del draft
app.post('/admin/reset-draft', requireLogin, requireAdmin, (req, res) => {
    db.transaction(() => {
        db.prepare(`UPDATE players SET equipo=NULL`).run();
        db.prepare(`DELETE FROM picks`).run();
        db.prepare(`DELETE FROM teams`).run();
        db.prepare(`UPDATE settings SET value='cerrado' WHERE key='draft_estado'`).run();
        db.prepare(`UPDATE settings SET value='' WHERE key='turno_actual'`).run();
        db.prepare(`UPDATE settings SET value='asc' WHERE key='direccion_snake'`).run();
        db.prepare(`UPDATE settings SET value='1' WHERE key='ronda_actual'`).run();
    })();
    cache.draftEstado = 'cerrado';
    cache.turnoActual = '';
    if (cache.timerInterval) clearInterval(cache.timerInterval);
    io.emit('draft-cerrado');
    axios.post('http://localhost:3001/api/borrar-canales').catch(() => {});
    io.emit('activity', '🔄 Draft reseteado completamente.');
    res.redirect('/admin');
});

// ── Limpiar TODA la web + Discord (draft + torneo + jugadores) ─
app.post('/admin/limpiar-todo', requireLogin, requireAdmin, (req, res) => {
    db.transaction(() => {
        // Transferir pre-inscritos al nuevo draft
        const preinscritos = db.prepare(`SELECT * FROM preinscripciones`).all();
        for (const p of preinscritos) {
            db.prepare(`
                INSERT INTO players (discord_id, nombre, posicion, telefono, eafc_id)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(discord_id) DO UPDATE SET
                    posicion=excluded.posicion, telefono=excluded.telefono, eafc_id=excluded.eafc_id, equipo=NULL
            `).run(p.discord_id, p.nombre, p.posicion, p.telefono || '', p.eafc_id || p.nombre);
        }
        db.prepare(`DELETE FROM preinscripciones`).run();
        db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('preinscripcion_abierta','')`).run();

        db.prepare(`UPDATE players SET equipo=NULL`).run();
        db.prepare(`DELETE FROM picks`).run();
        db.prepare(`DELETE FROM teams`).run();
        db.prepare(`DELETE FROM matches`).run();
        db.prepare(`DELETE FROM clasificacion`).run();
        db.prepare(`DELETE FROM cocapitanes`).run();
        db.prepare(`UPDATE settings SET value='cerrado' WHERE key='draft_estado'`).run();
        db.prepare(`UPDATE settings SET value='' WHERE key='turno_actual'`).run();
        db.prepare(`UPDATE settings SET value='asc' WHERE key='direccion_snake'`).run();
        db.prepare(`UPDATE settings SET value='1' WHERE key='ronda_actual'`).run();
        db.prepare(`UPDATE settings SET value='1' WHERE key='jornada_actual'`).run();
        db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('torneo_generado','')`).run();
        db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('total_rondas_swiss','')`).run();
        db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('fase_actual','')`).run();
        db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('fases_torneo','')`).run();
    })();
    cache.draftEstado = 'cerrado';
    cache.turnoActual = '';
    if (cache.timerInterval) { clearInterval(cache.timerInterval); cache.timerInterval = null; }

    // Limpiar canales de Discord (asíncrono en segundo plano)
    axios.post('http://localhost:3001/api/limpiar-torneo').catch(() => {});

    io.emit('draft-cerrado');
    io.emit('resultado');
    io.emit('torneo-limpiado');
    emitNuevoJugador();
    io.emit('activity', '🧹 Todo limpiado: jugadores, equipos, picks, partidos, clasificación y canales Discord reseteados.');
    res.redirect('/admin');
});

// ── Gestión de ganadores (historial_torneos) ─────────────────
app.post('/admin/ganadores/borrar', requireLogin, requireAdmin, (req, res) => {
    if (!isSuperAdmin(req)) return res.status(403).json({ error: 'Solo el superadmin.' });
    const { id } = req.body;
    db.prepare(`DELETE FROM historial_torneos WHERE id=?`).run(id);
    io.emit('activity', `🗑️ Entrada de ganadores eliminada (ID: ${id})`);
    res.redirect('/admin');
});

app.post('/admin/ganadores/añadir', requireLogin, requireAdmin, (req, res) => {
    if (!isSuperAdmin(req)) return res.status(403).json({ error: 'Solo el superadmin.' });
    const { campeon, subcampeon, n_equipos, formato, fecha_inicio } = req.body;
    db.prepare(`INSERT INTO historial_torneos (fecha_inicio, fecha_fin, n_equipos, formato, campeon, subcampeon, clasificacion)
                VALUES (?,?,?,?,?,?,?)`).run(
        fecha_inicio || new Date().toISOString(),
        new Date().toISOString(),
        parseInt(n_equipos) || 0,
        formato || 'Liga',
        campeon || '',
        subcampeon || '',
        '[]'
    );
    io.emit('activity', `🏆 Entrada de ganadores añadida: ${campeon}`);
    res.redirect('/admin');
});

// ══════════════════════════════════════════════════════════════
//  NUEVAS RUTAS — Torneo, Normas, Directo, Ganadores
// ══════════════════════════════════════════════════════════════

app.get('/torneo', requireLogin, (req, res) => {
    try {
        const tabla           = db.prepare(`
            SELECT c.*, COALESCE(NULLIF(t.nombre_equipo,''), c.equipo_nombre) AS display_nombre
            FROM clasificacion c
            LEFT JOIN teams t ON t.capitan_id = c.capitan_id
            ORDER BY c.puntos DESC, c.pg DESC, (c.gf-c.gc) DESC, c.gf DESC
        `).all();
        const matches         = db.prepare(`SELECT * FROM matches ORDER BY jornada ASC, id ASC`).all();
        const equipos         = db.prepare(`SELECT * FROM teams ORDER BY id`).all();
        const jornada         = db.prepare(`SELECT value FROM settings WHERE key='jornada_actual'`).get();
        const totalRondasLiga = parseInt(db.prepare(`SELECT value FROM settings WHERE key='total_rondas_swiss'`).get()?.value || '0');
        const fasesTorneo     = JSON.parse(db.prepare(`SELECT value FROM settings WHERE key='fases_torneo'`).get()?.value || '["liga"]');
        const faseActual      = db.prepare(`SELECT value FROM settings WHERE key='fase_actual'`).get()?.value || 'liga';
        const equiposMap      = {};
        equipos.forEach(e => { equiposMap[e.capitan_id] = e; });

        res.render('torneo', {
            user: req.session.user,
            tabla,
            matches,
            equipos,
            equiposMap,
            jornadaActual:   parseInt(jornada?.value || 1),
            totalRondasLiga,
            fasesTorneo,
            faseActual,
        });
    } catch(e) {
        console.error('[/torneo] Error:', e.message);
        res.render('torneo', {
            user: req.session.user,
            tabla: [], matches: [], equipos: [], equiposMap: {},
            jornadaActual: 1, totalRondasLiga: 0, fasesTorneo: ['liga'], faseActual: 'liga'
        });
    }
});

app.get('/normas', requireLogin, (req, res) => {
    try { res.render('normas', { user: req.session.user }); }
    catch(e) { res.status(500).send('Error cargando normas: ' + e.message); }
});

app.get('/app', requireLogin, (req, res) => {
    try { res.render('app', { user: req.session.user }); }
    catch(e) { res.status(500).send('Error: ' + e.message); }
});

app.get('/directo', requireLogin, (req, res) => {
    try {
        const matches        = db.prepare(`SELECT * FROM matches ORDER BY jornada ASC, id ASC`).all();
        const teamsRaw       = db.prepare(`SELECT capitan_username, nombre_equipo, logo_url FROM teams`).all();
        const equiposMap     = Object.fromEntries(teamsRaw.map(t => [t.capitan_username, t]));
        const enrichMatch    = m => ({
            ...m,
            equipo1_nombre: equiposMap[m.equipo1]?.nombre_equipo || m.equipo1,
            equipo1_logo:   equiposMap[m.equipo1]?.logo_url || '',
            equipo2_nombre: equiposMap[m.equipo2]?.nombre_equipo || m.equipo2,
            equipo2_logo:   equiposMap[m.equipo2]?.logo_url || '',
        });
        const enCurso        = matches.filter(m => m.estado === 'en_curso').map(enrichMatch);
        const proximos       = matches.filter(m => m.estado === 'pendiente').slice(0, 10).map(enrichMatch);
        const jugados        = matches.filter(m => m.estado === 'finalizado').length;
        const pendientesCount= matches.filter(m => m.estado === 'pendiente').length;
        const totalEquipos   = db.prepare(`SELECT COUNT(*) as c FROM teams`).get()?.c || 0;
        const jornada        = db.prepare(`SELECT value FROM settings WHERE key='jornada_actual'`).get();
        const twitchUrl    = db.prepare(`SELECT value FROM settings WHERE key='twitch_url'`).get()?.value || '';
        const twitchNombre = db.prepare(`SELECT value FROM settings WHERE key='twitch_nombre'`).get()?.value || '';
        let streamVivo   = null;
        let ultimoStream = null;
        try {
            streamVivo   = db.prepare(`SELECT * FROM twitch_tracked WHERE is_live=1 ORDER BY twitch_login LIMIT 1`).get() || null;
            ultimoStream = db.prepare(`SELECT * FROM twitch_tracked WHERE last_live_at IS NOT NULL ORDER BY last_live_at DESC LIMIT 1`).get() || null;
        } catch {}

        res.render('directo', {
            user: req.session.user,
            enCurso, proximos, jugados, pendientesCount, totalEquipos,
            jornadaActual: parseInt(jornada?.value || 1),
            twitchUrl, twitchNombre, streamVivo, ultimoStream,
        });
    } catch(e) {
        res.render('directo', {
            user: req.session.user,
            enCurso: [], proximos: [], jugados: 0, pendientesCount: 0,
            totalEquipos: 0, jornadaActual: 1, twitchUrl: '', twitchNombre: '', streamVivo: null, ultimoStream: null,
        });
    }
});

app.post('/admin/twitch', requireLogin, requireAdmin, (req, res) => {
    const { twitch_url, twitch_nombre } = req.body;
    db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('twitch_url',?)`).run(twitch_url || '');
    db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('twitch_nombre',?)`).run(twitch_nombre || '');
    io.emit('activity', `📺 Twitch actualizado: ${twitch_nombre}`);
    res.redirect('/admin');
});

app.post('/admin/match-en-curso', requireLogin, requireAdmin, (req, res) => {
    const { match_id } = req.body;
    db.prepare(`UPDATE matches SET estado='en_curso' WHERE id=?`).run(match_id);
    io.emit('resultado', { match_id, estado: 'en_curso' });
    io.emit('activity', `🔴 Partido #${match_id} marcado como en curso.`);
    axios.post('http://localhost:3001/api/actualizar-resultados').catch(() => {});
    res.redirect('/admin');
});

app.get('/ganadores', requireLogin, (req, res) => {
    try {
        let historial = [];
        try { historial = db.prepare(`SELECT * FROM historial_torneos ORDER BY id DESC`).all(); }
        catch(e2) { console.warn('[/ganadores]:', e2.message); }
        res.render('ganadores', { user: req.session.user, historial });
    } catch(e) {
        res.render('ganadores', { user: req.session.user, historial: [] });
    }
});

app.get('/clasificacion', requireLogin, (req, res) => res.redirect('/torneo?tab=clasificacion'));

// Admin: crear enfrentamiento
app.post('/admin/crear-match', requireLogin, requireAdmin, (req, res) => {
    const { equipo1, equipo2, jornada } = req.body;
    db.prepare(`INSERT INTO matches (jornada, equipo1, equipo2) VALUES (?,?,?)`).run(
        parseInt(jornada), equipo1, equipo2
    );
    io.emit('activity', `⚔️ Nuevo enfrentamiento: ${equipo1} vs ${equipo2} (J${jornada})`);
    io.emit('resultado');
    axios.post('http://localhost:3001/api/actualizar-resultados').catch(() => {});
    res.redirect('/admin');
});

// Admin: cargar resultado
app.post('/admin/resultado-match', requireLogin, requireAdmin, (req, res) => {
    const { match_id, goles1, goles2 } = req.body;
    const match = db.prepare(`SELECT * FROM matches WHERE id=?`).get(match_id);
    if (!match) return res.redirect('/admin');

    db.prepare(`UPDATE matches SET goles1=?, goles2=?, estado='finalizado' WHERE id=?`).run(
        parseInt(goles1), parseInt(goles2), match_id
    );

    actualizarClasificacion(match.equipo1, match.equipo2, parseInt(goles1), parseInt(goles2));

    io.emit('resultado', { match_id, equipo1: match.equipo1, equipo2: match.equipo2, goles1, goles2, estado: 'finalizado' });
    io.emit('clasificacion-update');
    io.emit('activity', `✅ Resultado: ${match.equipo1} ${goles1}-${goles2} ${match.equipo2}`);

    // Actualizar clasificación en Discord
    axios.post('http://localhost:3001/api/actualizar-clasificacion').catch(() => {});
    axios.post('http://localhost:3001/api/comprobar-avance-jornada').catch(() => {});

    res.redirect('/admin');
});

app.post('/admin/modificar-resultado', requireLogin, requireAdmin, (req, res) => {
    const { match_id, goles1, goles2 } = req.body;
    const match = db.prepare(`SELECT * FROM matches WHERE id=? AND estado='finalizado'`).get(match_id);
    if (!match) return res.redirect('/admin?tab=partidos&error=match_not_found');

    const g1New = parseInt(goles1), g2New = parseInt(goles2);
    if (isNaN(g1New) || isNaN(g2New) || g1New < 0 || g2New < 0) return res.redirect('/admin?tab=partidos');

    // Revertir resultado anterior y aplicar el nuevo (atómico)
    db.transaction(() => {
        revertirClasificacion(match.equipo1, match.equipo2, match.goles1, match.goles2);
        db.prepare(`UPDATE matches SET goles1=?, goles2=? WHERE id=?`).run(g1New, g2New, match_id);
        actualizarClasificacion(match.equipo1, match.equipo2, g1New, g2New);
    })();

    io.emit('resultado', { match_id, equipo1: match.equipo1, equipo2: match.equipo2, goles1: g1New, goles2: g2New, estado: 'finalizado' });
    io.emit('clasificacion-update');
    io.emit('activity', `✏️ Resultado modificado: ${match.equipo1} ${g1New}-${g2New} ${match.equipo2} (era ${match.goles1}-${match.goles2})`);

    axios.post('http://localhost:3001/api/actualizar-clasificacion').catch(() => {});
    res.redirect('/admin');
});

function revertirClasificacion(eq1, eq2, g1, g2) {
    const t1 = db.prepare(`SELECT capitan_id FROM teams WHERE capitan_username=?`).get(eq1);
    const t2 = db.prepare(`SELECT capitan_id FROM teams WHERE capitan_username=?`).get(eq2);
    if (!t1 || !t2) return;
    const update = db.prepare(`
        UPDATE clasificacion SET
            pj = pj - 1, gf = gf - ?, gc = gc - ?,
            pg = pg - ?, pe = pe - ?, pp = pp - ?, puntos = puntos - ?
        WHERE capitan_id = ?
    `);
    db.transaction(() => {
        if (g1 > g2) {
            update.run(g1, g2, 1, 0, 0, 3, t1.capitan_id);
            update.run(g2, g1, 0, 0, 1, 0, t2.capitan_id);
        } else if (g2 > g1) {
            update.run(g1, g2, 0, 0, 1, 0, t1.capitan_id);
            update.run(g2, g1, 1, 0, 0, 3, t2.capitan_id);
        } else {
            update.run(g1, g2, 0, 1, 0, 1, t1.capitan_id);
            update.run(g2, g1, 0, 1, 0, 1, t2.capitan_id);
        }
    })();
}

function actualizarClasificacion(eq1, eq2, g1, g2) {
    const t1 = db.prepare(`SELECT * FROM teams WHERE capitan_username=?`).get(eq1);
    const t2 = db.prepare(`SELECT * FROM teams WHERE capitan_username=?`).get(eq2);
    if (!t1 || !t2) return;

    // Asegurar filas en clasificacion (INSERT OR IGNORE para no pisar datos existentes)
    db.prepare(`INSERT OR IGNORE INTO clasificacion (capitan_id, equipo_nombre) VALUES (?,?)`).run(t1.capitan_id, eq1);
    db.prepare(`INSERT OR IGNORE INTO clasificacion (capitan_id, equipo_nombre) VALUES (?,?)`).run(t2.capitan_id, eq2);

    const update = db.prepare(`
        UPDATE clasificacion SET
            pj = pj + 1, gf = gf + ?, gc = gc + ?,
            pg = pg + ?, pe = pe + ?, pp = pp + ?, puntos = puntos + ?
        WHERE capitan_id = ?
    `);

    db.transaction(() => {
        if (g1 > g2) {
            update.run(g1, g2, 1, 0, 0, 3, t1.capitan_id);
            update.run(g2, g1, 0, 0, 1, 0, t2.capitan_id);
        } else if (g2 > g1) {
            update.run(g1, g2, 0, 0, 1, 0, t1.capitan_id);
            update.run(g2, g1, 1, 0, 0, 3, t2.capitan_id);
        } else {
            update.run(g1, g2, 0, 1, 0, 1, t1.capitan_id);
            update.run(g2, g1, 0, 1, 0, 1, t2.capitan_id);
        }
    })();
}

// ── Recalcular clasificación desde cero a partir de matches finalizados ──
function recalcularClasificacion() {
    // Resetear todos los contadores a 0
    db.prepare(`UPDATE clasificacion SET pj=0, pg=0, pe=0, pp=0, gf=0, gc=0, puntos=0`).run();
    // Reprocesar todos los partidos finalizados (excluye BYE)
    const finalizados = db.prepare(`SELECT * FROM matches WHERE estado='finalizado' AND equipo2 != 'BYE'`).all();
    for (const m of finalizados) {
        actualizarClasificacion(m.equipo1, m.equipo2, m.goles1, m.goles2);
    }
    // BYEs: 3 puntos al equipo1, sin contador de goles reales
    const byes = db.prepare(`SELECT * FROM matches WHERE estado='finalizado' AND equipo2='BYE'`).all();
    for (const m of byes) {
        const tb = db.prepare(`SELECT capitan_id FROM teams WHERE capitan_username=?`).get(m.equipo1);
        if (tb) db.prepare(`UPDATE clasificacion SET pj=pj+1, pg=pg+1, puntos=puntos+3 WHERE capitan_id=?`).run(tb.capitan_id);
    }
}

app.post('/admin/recalcular-clasificacion', requireLogin, requireAdmin, (req, res) => {
    recalcularClasificacion();
    io.emit('clasificacion-update');
    axios.post('http://localhost:3001/api/actualizar-clasificacion').catch(() => {});
    res.redirect('/admin?tab=partidos');
});

app.post('/admin/ajustar-jornada', requireLogin, requireAdmin, (req, res) => {
    const nueva = parseInt(req.body.jornada_actual);
    if (isNaN(nueva) || nueva < 0) return res.redirect('/admin#tab-sistema');
    db.prepare("UPDATE settings SET value=? WHERE key='jornada_actual'").run(String(nueva));
    res.redirect('/admin#tab-sistema');
});

app.post('/admin/borrar-jornada', requireLogin, requireAdmin, (req, res) => {
    const jornada = parseInt(req.body.jornada);
    if (isNaN(jornada) || jornada < 1) return res.redirect('/admin#tab-sistema');
    db.prepare('DELETE FROM matches WHERE jornada=?').run(jornada);
    res.redirect('/admin#tab-sistema');
});

// ══════════════════════════════════════════════════════════════
//  API PARA EL BOT
// ══════════════════════════════════════════════════════════════
app.post('/api/nuevo-jugador', (req, res) => {
    emitNuevoJugador();
    res.sendStatus(200);
});

// Versión completa: emite jugador_añadido para actualizar draft y draft-stream en tiempo real
app.post('/api/nuevo-jugador-completo', (req, res) => {
    const { discord_id, nombre, eafc_id, posicion, foto } = req.body;
    emitNuevoJugador();
    if (discord_id && nombre && posicion) {
        const p = db.prepare(`SELECT foto FROM players WHERE discord_id=?`).get(discord_id);
        io.emit('jugador_añadido', { discord_id, nombre, eafc_id: eafc_id || '', posicion, foto: foto || p?.foto || '' });
        io.emit('activity', `📝 ${eafc_id || nombre} se inscribió (${posicion})`);
    }
    res.sendStatus(200);
});

// Llamado por el bot cuando limpiarTorneo() termina — refresca caché y notifica clientes
app.post('/api/torneo-limpiado', (req, res) => {
    refreshCache();
    io.emit('torneo-limpiado');
    io.emit('draft-cerrado');
    io.emit('resultado');
    emitNuevoJugador();
    res.sendStatus(200);
});

// Llamado por el bot cuando avanza a la siguiente jornada Swiss
app.post('/api/jornada-avanzada', (req, res) => {
    io.emit('resultado');          // fuerza recarga de partidos/resultados en torneo.ejs
    io.emit('clasificacion-update');
    res.sendStatus(200);
});

app.get('/api/estado', (req, res) => {
    res.json({
        draftEstado:    cache.draftEstado,
        turnoActual:    cache.turnoActual,
        tiempoRestante: cache.tiempoRestante
    });
});

app.post('/admin/set-tiempo-ultima-hora', requireLogin, requireAdmin, (req, res) => {
    const mins = parseInt(req.body.tiempo_ultima_hora);
    if (!isNaN(mins) && mins >= 6 && mins <= 120) {
        db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('tiempo_ultima_hora',?)`).run(String(mins));
        io.emit('activity', `⏱️ Tiempo última hora actualizado: ${mins} minutos`);
    }
    res.redirect('/admin');
});

app.post('/admin/cerrar-inscripciones', requireLogin, requireAdmin, (req, res) => {
    axios.post('http://localhost:3001/api/cerrar-inscripciones').catch(() => {});
    io.emit('activity', '🔒 Inscripciones cerradas manualmente por el admin.');
    res.redirect('/admin');
});

app.post('/admin/cerrar-votacion-precio', requireLogin, requireAdmin, (req, res) => {
    axios.post('http://localhost:3001/api/cerrar-votacion-precio').catch(() => {});
    io.emit('activity', '💰 Votación de precio cerrada por el admin.');
    res.redirect('/admin');
});

// ── Ruleta Capitanes: obtener candidatos ─────────────────────
app.get('/admin/candidatos-capitan', requireLogin, requireAdmin, (req, res) => {
    try {
        const candidatos     = db.prepare(`SELECT * FROM candidatos_capitan WHERE confirmado=0 ORDER BY forzado DESC, rowid ASC`).all();
        const yaConfirmados  = db.prepare(`SELECT COUNT(*) as c FROM candidatos_capitan WHERE confirmado=1`).get().c;
        const numEquipos     = parseInt(db.prepare(`SELECT value FROM settings WHERE key='num_equipos_manual'`).get()?.value || '0');
        const capsPorEquipo  = parseInt(db.prepare(`SELECT value FROM settings WHERE key='caps_por_equipo'`).get()?.value || '1');
        const totalNecesarios = numEquipos > 0 ? numEquipos * capsPorEquipo : 0;
        const faltan         = totalNecesarios > 0 ? Math.max(0, totalNecesarios - yaConfirmados) : candidatos.length;
        res.json({ candidatos, confirmados: yaConfirmados, totalNecesarios, faltan });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

// ── Ruleta Capitanes: guardar configuración ──────────────────
app.post('/admin/config-ruleta-capitanes', requireLogin, requireAdmin, (req, res) => {
    const { num_equipos, formato, caps_por_equipo } = req.body;
    if (num_equipos !== undefined)
        db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('num_equipos_manual',?)`).run(String(num_equipos));
    if (formato !== undefined)
        db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('formato_manual',?)`).run(formato);
    if (caps_por_equipo !== undefined)
        db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('caps_por_equipo',?)`).run(String(caps_por_equipo));
    // Cerrar la votación de capitán si se han definido equipos Y formato
    const numDef = db.prepare(`SELECT value FROM settings WHERE key='num_equipos_manual'`).get()?.value;
    const fmtDef = db.prepare(`SELECT value FROM settings WHERE key='formato_manual'`).get()?.value;
    if (numDef && fmtDef) {
        axios.post('http://localhost:3001/api/cerrar-votacion-capitan').catch(() => {});
    }
    res.redirect('/admin');
});

// ── Ruleta Capitanes: forzar candidato ───────────────────────
app.post('/admin/forzar-candidato-capitan', requireLogin, requireAdmin, (req, res) => {
    const { discord_id } = req.body;
    const player = db.prepare(`SELECT nombre, eafc_id FROM players WHERE discord_id=?`).get(discord_id);
    if (!player) return res.status(404).json({ error: 'Jugador no encontrado' });
    db.prepare(`INSERT OR REPLACE INTO candidatos_capitan (discord_id, nombre, eafc_id, forzado, confirmado) VALUES (?, ?, ?, 1, 0)`)
        .run(discord_id, player.nombre, player.eafc_id || null);
    axios.post('http://localhost:3001/api/forzar-candidato-capitan', { discord_id, nombre: player.nombre, eafc_id: player.eafc_id }).catch(() => {});
    res.redirect('/admin');
});

// ── Ruleta Capitanes: quitar candidato ───────────────────────
app.post('/admin/quitar-candidato-capitan', requireLogin, requireAdmin, (req, res) => {
    const { discord_id } = req.body;
    db.prepare(`DELETE FROM candidatos_capitan WHERE discord_id=?`).run(discord_id);
    res.redirect('/admin');
});

// ── Ruleta Capitanes: confirmar capitanes seleccionados ──────
app.post('/admin/confirmar-capitanes-ruleta', requireLogin, requireAdmin, (req, res) => {
    const { capitanes } = req.body; // array of discord_ids in order
    if (!Array.isArray(capitanes) || !capitanes.length)
        return res.status(400).json({ error: 'No hay capitanes para confirmar' });

    const numEquiposManual = parseInt(db.prepare(`SELECT value FROM settings WHERE key='num_equipos_manual'`).get()?.value || '0');
    const capsPorEquipo    = parseInt(db.prepare(`SELECT value FROM settings WHERE key='caps_por_equipo'`).get()?.value || '1');
    const yaConfirmados    = db.prepare(`SELECT COUNT(*) as c FROM candidatos_capitan WHERE confirmado=1`).get().c;
    const totalNecesarios  = numEquiposManual > 0 ? numEquiposManual * capsPorEquipo : capitanes.length + yaConfirmados;
    const faltan           = Math.max(0, totalNecesarios - yaConfirmados);
    const seleccionados    = capitanes.slice(0, faltan || capitanes.length);

    db.transaction(() => {
        for (const discordId of seleccionados) {
            const cand = db.prepare(`SELECT nombre, eafc_id FROM candidatos_capitan WHERE discord_id=?`).get(discordId);
            if (!cand) continue;
            // Ensure player exists
            db.prepare(`INSERT OR IGNORE INTO players (discord_id, nombre, posicion) VALUES (?, ?, 'DC')`).run(discordId, cand.nombre);
            // Register as team captain
            db.prepare(`INSERT OR IGNORE INTO teams (capitan_id, capitan_username, nombre_equipo, formacion) VALUES (?, ?, ?, '3-1-4-2')`).run(discordId, cand.nombre, cand.nombre);
            // Mark as confirmed
            db.prepare(`UPDATE candidatos_capitan SET confirmado=1 WHERE discord_id=?`).run(discordId);
        }
    })();

    emitNuevoJugador();
    io.emit('clasificacion-update');
    io.emit('activity', `👑 ${seleccionados.length} capitán(es) confirmados via Ruleta Capitanes`);

    // Dar rol Capitán en Discord a los seleccionados
    axios.post('http://localhost:3001/api/dar-rol-capitanes', {
        discord_ids: seleccionados
    }).catch(() => {});
    axios.post('http://localhost:3001/api/actualizar-equipos').catch(() => {});

    res.json({ ok: true, confirmados: seleccionados.length });
});

app.post('/admin/generar-torneo', requireLogin, requireAdmin, async (req, res) => {
    try {
        const resp = await axios.post('http://localhost:3001/api/generar-torneo');
        io.emit('activity', `🏆 Torneo generado: ${resp.data.matches} partidos en ${resp.data.jornadas} jornadas.`);
        io.emit('torneo-generado');
        io.emit('resultado'); // fuerza recarga de partidos en torneo.ejs
    } catch(e) {
        console.error('Error generando torneo:', e.message);
        io.emit('activity', '❌ Error al generar el torneo: ' + e.message);
    }
    res.redirect('/admin');
});

app.post('/admin/cerrar-torneo', requireLogin, requireAdmin, async (req, res) => {
    await axios.post('http://localhost:3001/api/cerrar-torneo').catch(() => {});
    io.emit('activity', '🏆 Torneo cerrado. Canales se borran en 1h, datos en 2h.');
    io.emit('resultado');
    res.redirect('/admin');
});

app.post('/admin/limpiar-torneo', requireLogin, requireAdmin, async (req, res) => {
    axios.post('http://localhost:3001/api/limpiar-torneo').catch(() => {});
    io.emit('activity', '🧹 Torneo limpiado. Clasificación y partidos reseteados.');
    io.emit('resultado');
    io.emit('torneo-limpiado');
    res.redirect('/admin');
});

app.post('/admin/borrar-bots', requireLogin, requireAdmin, (req, res) => {
    db.prepare("DELETE FROM picks  WHERE capitan LIKE 'BOT_CAP_%'").run();
    db.prepare("DELETE FROM clasificacion WHERE capitan_id LIKE 'BOT_CAP_%'").run();
    db.prepare("DELETE FROM teams WHERE capitan_id LIKE 'BOT_CAP_%'").run();
    db.prepare("DELETE FROM players WHERE discord_id LIKE 'P_%'").run();
    io.emit('activity', '🗑️ Datos de prueba (bots) borrados.');
    io.emit('resultado');
    res.redirect('/admin');
});

app.post('/admin/actualizar-clasificacion', requireLogin, requireAdmin, (req, res) => {
    axios.post('http://localhost:3001/api/actualizar-clasificacion').catch(() => {});
    io.emit('activity', '📊 Clasificación de Discord actualizada.');
    res.redirect('/admin');
});

// ── Admin: retroceder a fase anterior ────────────────────────
app.post('/admin/retroceder-fase', requireLogin, requireAdmin, (req, res) => {
    const { fase_destino } = req.body;

    if (fase_destino === 'draft') {
        db.prepare(`UPDATE settings SET value='abierto' WHERE key='draft_estado'`).run();
        const primerTurno = db.prepare(`SELECT capitan_username FROM teams ORDER BY COALESCE(orden_draft, id) ASC LIMIT 1`).get();
        if (primerTurno && !cache.turnoActual) {
            db.prepare(`UPDATE settings SET value=? WHERE key='turno_actual'`).run(primerTurno.capitan_username);
            cache.turnoActual = primerTurno.capitan_username;
        }
        cache.draftEstado = 'abierto';
        iniciarTimer();
        io.emit('draft-abierto', { turno: cache.turnoActual });
        io.emit('activity', '↩️ [Admin] Vuelta a la fase de DRAFT.');
    } else if (fase_destino === 'inscripciones') {
        db.prepare(`UPDATE settings SET value='cerrado' WHERE key='draft_estado'`).run();
        db.prepare(`UPDATE settings SET value='' WHERE key='turno_actual'`).run();
        db.prepare(`UPDATE players SET equipo=NULL`).run();
        db.prepare(`DELETE FROM picks`).run();
        cache.draftEstado = 'cerrado';
        cache.turnoActual = '';
        if (cache.timerInterval) { clearInterval(cache.timerInterval); cache.timerInterval = null; }
        io.emit('draft-cerrado');
        io.emit('activity', '↩️ [Admin] Vuelta a la fase de INSCRIPCIONES. Picks reseteados.');
    } else if (fase_destino === 'pre-torneo') {
        db.prepare(`DELETE FROM matches`).run();
        db.prepare(`UPDATE clasificacion SET puntos=0,pj=0,pg=0,pe=0,pp=0,gf=0,gc=0`).run();
        db.prepare(`UPDATE settings SET value='1' WHERE key='jornada_actual'`).run();
        db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('torneo_generado','')`).run();
        db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('fase_actual','')`).run();
        db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('fases_torneo','')`).run();
        db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('total_rondas_swiss','')`).run();
        io.emit('resultado');
        io.emit('torneo-limpiado');
        io.emit('activity', '↩️ [Admin] Vuelta a pre-torneo. Partidos y clasificación reseteados.');
        axios.post('http://localhost:3001/api/limpiar-torneo').catch(() => {});
    }

    res.redirect('/admin');
});

// ── Admin: forzar siguiente fase del torneo ──────────────────
app.post('/admin/forzar-siguiente-fase', requireLogin, requireAdmin, async (req, res) => {
    try {
        await axios.post('http://localhost:3001/api/forzar-siguiente-fase');
        io.emit('activity', '⏭️ [Admin] Siguiente fase del torneo forzada manualmente.');
        io.emit('resultado');
        io.emit('clasificacion-update');
    } catch(e) {
        io.emit('activity', `❌ Error forzando siguiente fase: ${e.message}`);
    }
    res.redirect('/admin');
});

// ── Admin: establecer fase manualmente ───────────────────────
app.post('/admin/set-fase-torneo', requireLogin, requireAdmin, (req, res) => {
    const { fase, jornada } = req.body;
    if (fase) db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('fase_actual',?)").run(fase);
    if (jornada) db.prepare("UPDATE settings SET value=? WHERE key='jornada_actual'").run(String(parseInt(jornada)));
    io.emit('activity', `⚙️ [Admin] Fase de torneo establecida: ${fase || '—'} / Jornada: ${jornada || '—'}`);
    io.emit('resultado');
    res.redirect('/admin');
});

// ── Admin: recrear canales de partido faltantes ───────────────
app.post('/admin/recrear-canales-partido', requireLogin, requireAdmin, async (req, res) => {
    try {
        const resp = await axios.post('http://localhost:3001/api/recrear-canales-partido');
        io.emit('activity', `🔧 Canales de partido recreados: ${resp.data.creados} canales.`);
    } catch(e) {
        io.emit('activity', `❌ Error recreando canales: ${e.message}`);
    }
    res.redirect('/admin');
});

// ══════════════════════════════════════════════════════════════
//  API INTERNA — llamadas desde el bot (sin sesión, solo localhost)
// ══════════════════════════════════════════════════════════════

// Avisos de sistema del bot (errores de sincronización, flags colgados, etc.)
const systemWarnings = [];
app.post('/api/bot/system-warning', (req, res) => {
    const { msg } = req.body;
    if (!msg) return res.status(400).json({ error: 'msg requerido' });
    const entry = { msg, ts: new Date().toLocaleTimeString('es-ES') };
    systemWarnings.unshift(entry);
    if (systemWarnings.length > 20) systemWarnings.pop();
    io.emit('system_warning', entry);
    res.json({ ok: true });
});
app.get('/api/admin/system-warnings', requireAdmin, (req, res) => {
    res.json(systemWarnings);
});

app.post('/api/bot/inscripciones-abrir', (req, res) => {
    db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('inscripciones_estado','abierto')`).run();
    io.emit('activity', '🟢 Inscripciones abiertas.');
    io.emit('inscripciones-update', { estado: 'abierto' });
    res.sendStatus(200);
});

app.post('/api/bot/inscripciones-cerrar', (req, res) => {
    db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('inscripciones_estado','cerrado')`).run();
    io.emit('activity', '🔒 Inscripciones cerradas.');
    io.emit('inscripciones-update', { estado: 'cerrado' });
    res.sendStatus(200);
});

app.post('/api/bot/precio-torneo', (req, res) => {
    const { precio } = req.body;
    if (!precio) return res.status(400).json({ error: 'precio requerido' });
    db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('precio_torneo',?)`).run(String(precio));
    io.emit('activity', `💰 Precio del torneo fijado: ${precio}€`);
    io.emit('precio-update', { precio });
    res.sendStatus(200);
});

app.post('/api/bot/torneo-generado', (req, res) => {
    io.emit('activity', '🏆 Torneo generado desde Discord.');
    io.emit('torneo-generado');
    io.emit('resultado');
    res.sendStatus(200);
});

app.post('/api/bot/datos-actualizados', (req, res) => {
    refreshCache();
    io.emit('activity', req.body.msg || '🔄 Datos actualizados.');
    io.emit('resultado');
    io.emit('clasificacion-update');
    res.sendStatus(200);
});

app.post('/api/bot/abrir-draft', (req, res) => {
    const teams = db.prepare(`SELECT * FROM teams ORDER BY id ASC`).all();
    if (!teams.length) return res.status(400).json({ error: 'No hay equipos.' });
    const primerCapitan = teams[0].capitan_username;
    db.transaction(() => {
        db.prepare(`UPDATE settings SET value='abierto' WHERE key='draft_estado'`).run();
        db.prepare(`UPDATE settings SET value=? WHERE key='turno_actual'`).run(primerCapitan);
        db.prepare(`UPDATE settings SET value='asc' WHERE key='direccion_snake'`).run();
        const stmtEnsure = db.prepare(`INSERT OR IGNORE INTO players (discord_id, nombre, posicion) VALUES (?, ?, 'DC')`);
        const stmtEquipo = db.prepare(`UPDATE players SET equipo=? WHERE discord_id=? AND (equipo IS NULL OR equipo='')`);
        const stmtPick   = db.prepare(`INSERT OR IGNORE INTO picks (ronda, capitan, jugador_id) VALUES (0, ?, ?)`);
        for (const team of teams) {
            if (team.capitan_id) {
                stmtEnsure.run(team.capitan_id, team.capitan_username);
                stmtEquipo.run(team.capitan_username, team.capitan_id);
                stmtPick.run(team.capitan_username, team.capitan_id);
            }
            if (team.capitan2_id) {
                stmtEnsure.run(team.capitan2_id, team.capitan_username);
                stmtEquipo.run(team.capitan_username, team.capitan2_id);
                stmtPick.run(team.capitan_username, team.capitan2_id);
            }
        }
    })();
    cache.draftEstado = 'abierto';
    cache.turnoActual = primerCapitan;
    iniciarTimer();
    io.emit('draft-abierto', { turno: primerCapitan });
    res.json({ ok: true, turno: primerCapitan });
});

app.post('/api/bot/cerrar-draft', (req, res) => {
    db.prepare(`UPDATE settings SET value='cerrado' WHERE key='draft_estado'`).run();
    cache.draftEstado = 'cerrado';
    if (cache.timerInterval) { clearInterval(cache.timerInterval); cache.timerInterval = null; }
    axios.post('http://localhost:3001/api/generar-equipos-ids').catch(() => {});
    axios.post('http://localhost:3001/api/borrar-canales').catch(() => {});
    io.emit('draft-cerrado');
    res.json({ ok: true });
});

// Sync rol Capitán Discord → web
app.post('/api/bot/capitan-add', (req, res) => {
    const { discord_id, username } = req.body;
    if (!discord_id || !username) return res.status(400).json({ error: 'Faltan datos' });
    db.prepare(`INSERT OR IGNORE INTO teams (capitan_id, capitan_username, nombre_equipo, formacion) VALUES (?,?,?,'3-1-4-2')`).run(discord_id, username, username);
    db.prepare(`INSERT OR IGNORE INTO clasificacion (capitan_id, equipo_nombre) VALUES (?,?)`).run(discord_id, username);
    io.emit('activity', `👑 Capitán añadido (rol Discord): ${username}`);
    io.emit('clasificacion-update');
    axios.post('http://localhost:3001/api/actualizar-equipos').catch(() => {});
    res.json({ ok: true });
});

app.post('/api/bot/capitan-remove', (req, res) => {
    const { discord_id } = req.body;
    if (!discord_id) return res.status(400).json({ error: 'Faltan datos' });
    const equipo = db.prepare(`SELECT capitan_username FROM teams WHERE capitan_id=?`).get(discord_id);
    if (equipo) {
        db.prepare(`DELETE FROM teams WHERE capitan_id=?`).run(discord_id);
        db.prepare(`DELETE FROM clasificacion WHERE capitan_id=?`).run(discord_id);
        io.emit('activity', `🗑️ Capitán eliminado (rol Discord quitado): ${equipo.capitan_username}`);
        io.emit('clasificacion-update');
        axios.post('http://localhost:3001/api/actualizar-equipos').catch(() => {});
    }
    res.json({ ok: true });
});

app.post('/api/bot/saltar-turno', (req, res) => {
    if (cache.draftEstado !== 'abierto') return res.status(400).json({ error: 'Draft no está abierto.' });
    io.emit('activity', `⏭️ Turno de ${cache.turnoActual} saltado por el admin.`);
    avanzarTurnoSnake(cache.turnoActual);
    io.emit('turno_actualizado', { turno: cache.turnoActual });
    io.emit('timer_tick', { segundos: cache.tiempoRestante });
    io.emit('nuevo-fichaje', { turno: cache.turnoActual, timer: cache.tiempoRestante });
    res.json({ ok: true, turnoNuevo: cache.turnoActual });
});

// ── Resultado confirmado por el bot ──────────────────────────
app.post('/api/resultado-confirmado', (req, res) => {
    const { match_id, goles1, goles2 } = req.body;
    const match = db.prepare('SELECT * FROM matches WHERE id=?').get(match_id);
    if (!match) return res.sendStatus(404);

    db.prepare(`UPDATE matches SET goles1=?, goles2=?, estado='finalizado' WHERE id=?`)
        .run(parseInt(goles1), parseInt(goles2), match_id);

    actualizarClasificacion(match.equipo1, match.equipo2, parseInt(goles1), parseInt(goles2));

    io.emit('resultado', {
        match_id, equipo1: match.equipo1, equipo2: match.equipo2,
        goles1, goles2, estado: 'finalizado'
    });
    io.emit('clasificacion-update');
    io.emit('activity', `✅ Resultado confirmado: ${match.equipo1} ${goles1}-${goles2} ${match.equipo2}`);

    // Actualizar Discord
    axios.post('http://localhost:3001/api/actualizar-clasificacion').catch(() => {});

    res.sendStatus(200);
});

// ══════════════════════════════════════════════════════════════
//  SOCKETS
// ══════════════════════════════════════════════════════════════
io.on('connection', (socket) => {
    socket.emit('init', {
        turno:  cache.turnoActual,
        estado: cache.draftEstado,
        timer:  cache.tiempoRestante
    });
});

// ══════════════════════════════════════════════════════════════
//  EQUIPO — formación, nombre, escudo
// ══════════════════════════════════════════════════════════════
app.post('/equipo/formacion', requireLogin, (req, res) => {
    const { formacion } = req.body;
    const FORMACIONES_VALIDAS = ['3-5-2','3-1-4-2'];
    if (!FORMACIONES_VALIDAS.includes(formacion))
        return res.status(400).json({ error: 'Formación no válida.' });

    const userId = req.session.user.id;
    const equipo = db.prepare(`SELECT * FROM teams WHERE capitan_id=?`).get(userId);
    if (!equipo) return res.status(403).json({ error: 'No eres capitán.' });

    const estado         = db.prepare(`SELECT value FROM settings WHERE key='draft_estado'`).get();
    const torneoGenerado = db.prepare(`SELECT value FROM settings WHERE key='torneo_generado'`).get();
    const bloqueado      = estado?.value === 'abierto' || !!torneoGenerado?.value;
    if (bloqueado && req.session.user.id !== process.env.ADMIN_ID)
        return res.status(403).json({ error: 'No puedes cambiar la formación una vez iniciado el draft.' });

    db.prepare(`UPDATE teams SET formacion=? WHERE capitan_id=?`).run(formacion, userId);
    res.json({ ok: true });
});

app.post('/equipo/renombrar', requireLogin, (req, res) => {
    const { nombre_equipo } = req.body;
    const userId = req.session.user.id;

    if (!nombre_equipo || nombre_equipo.trim().length < 2)
        return res.status(400).json({ error: 'Nombre demasiado corto.' });

    const equipo = db.prepare(`SELECT * FROM teams WHERE capitan_id=?`).get(userId);
    if (!equipo) return res.status(403).json({ error: 'No eres capitán.' });

    db.prepare(`UPDATE teams SET nombre_equipo=? WHERE capitan_id=?`).run(nombre_equipo.trim(), userId);

    axios.post('http://localhost:3001/api/renombrar-canal', {
        capitan_username: req.session.user.username,
        nombre_equipo:    nombre_equipo.trim()
    }).catch(() => {});

    io.emit('equipo-renombrado', { capitan: req.session.user.username, nombre: nombre_equipo.trim() });
    res.json({ ok: true });
});

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = './public/uploads/escudos/';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const ext = file.originalname.split('.').pop();
        cb(null, `escudo_${req.session.user.id}.${ext}`);
    }
});
const uploadEscudo = multer({
    storage,
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) return cb(new Error('Solo imágenes'));
        cb(null, true);
    }
});

app.post('/equipo/escudo', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Sesión expirada, recarga la página.' });
    uploadEscudo.single('escudo')(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'La imagen supera 8MB.' : err.message });
        if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo.' });
        const userId = req.session.user.id;
        const equipo = db.prepare(`SELECT * FROM teams WHERE capitan_id=?`).get(userId);
        if (!equipo) return res.status(403).json({ error: 'No eres capitán.' });
        const logo_url = `/uploads/escudos/${req.file.filename}`;
        db.prepare(`UPDATE teams SET logo_url=? WHERE capitan_id=?`).run(logo_url, userId);
        io.emit('equipo-renombrado', { capitan: req.session.user.username });
        res.json({ ok: true, logo_url });
    });
});

// ══════════════════════════════════════════════════════════════
//  HISTORIAL DE TORNEOS
// ══════════════════════════════════════════════════════════════
app.get('/historial', requireLogin, (req, res) => {
    try {
        const torneos = db.prepare(`SELECT * FROM historial_torneos ORDER BY id DESC`).all().map(t => ({
            ...t,
            clasificacion: JSON.parse(t.clasificacion || '[]'),
            partidos:      JSON.parse(t.partidos      || '[]'),
        }));
        res.render('historial', { user: req.session.user, torneos });
    } catch(e) {
        console.error('[/historial]', e.message);
        res.render('historial', { user: req.session.user, torneos: [] });
    }
});

// ══════════════════════════════════════════════════════════════
//  PERFIL DE JUGADOR
// ══════════════════════════════════════════════════════════════
app.get('/jugador/:discord_id', requireLogin, (req, res) => {
    try {
        const jugador = db.prepare(`SELECT * FROM players WHERE discord_id=?`).get(req.params.discord_id);
        if (!jugador) return res.redirect('/torneo');

        const equipo = jugador.equipo
            ? db.prepare(`SELECT * FROM teams WHERE capitan_username=?`).get(jugador.equipo)
            : null;

        // Partidos del equipo del jugador
        const matchesEquipo = jugador.equipo ? db.prepare(`
            SELECT * FROM matches
            WHERE (equipo1=? OR equipo2=?) AND estado='finalizado'
            ORDER BY jornada ASC
        `).all(jugador.equipo, jugador.equipo) : [];

        // Calcular stats: PJ PG PE PP GF GC
        let pj=0, pg=0, pe=0, pp=0, gf=0, gc=0;
        for (const m of matchesEquipo) {
            const esLocal = m.equipo1 === jugador.equipo;
            const gLocal  = esLocal ? m.goles1 : m.goles2;
            const gVisit  = esLocal ? m.goles2 : m.goles1;
            pj++; gf += gLocal; gc += gVisit;
            if (gLocal > gVisit) pg++;
            else if (gLocal === gVisit) pe++;
            else pp++;
        }
        const pts = pg * 3 + pe;

        // Posición en clasificación del equipo
        const clasi = jugador.equipo
            ? db.prepare(`SELECT * FROM clasificacion WHERE equipo_nombre=?`).get(jugador.equipo)
            : null;

        // Posición en clasificación general
        const posicion = clasi ? (() => {
            const todos = db.prepare(`SELECT equipo_nombre FROM clasificacion ORDER BY puntos DESC, pg DESC, (gf-gc) DESC`).all();
            return todos.findIndex(t => t.equipo_nombre === jugador.equipo) + 1;
        })() : null;

        res.render('jugador', {
            user: req.session.user,
            jugador,
            equipo,
            matchesEquipo,
            stats: { pj, pg, pe, pp, gf, gc, pts },
            clasi,
            posicion,
        });
    } catch(e) {
        console.error('[/jugador]', e.message);
        res.redirect('/torneo');
    }
});

// ══════════════════════════════════════════════════════════════
//  ESTADÍSTICAS GLOBALES (JSON — usadas por torneo.ejs)
// ══════════════════════════════════════════════════════════════
app.get('/api/stats-globales', requireLogin, (req, res) => {
    try {
        const mejorAtaque  = db.prepare(`SELECT equipo_nombre, gf FROM clasificacion ORDER BY gf DESC LIMIT 1`).get();
        const mejorDefensa = db.prepare(`SELECT equipo_nombre, gc FROM clasificacion ORDER BY gc ASC LIMIT 1`).get();
        const masVictorias = db.prepare(`SELECT equipo_nombre, pg FROM clasificacion ORDER BY pg DESC LIMIT 1`).get();
        const masGoles     = db.prepare(`SELECT equipo_nombre, gf FROM clasificacion ORDER BY gf DESC LIMIT 5`).all();
        const masInvicto   = db.prepare(`SELECT equipo_nombre, (pg+pe) as inv, pp FROM clasificacion ORDER BY pp ASC, (pg+pe) DESC LIMIT 1`).get();
        const totalGoles   = db.prepare(`SELECT SUM(goles1)+SUM(goles2) as total FROM matches WHERE estado='finalizado'`).get()?.total || 0;
        const totalPartidos= db.prepare(`SELECT COUNT(*) as c FROM matches WHERE estado='finalizado'`).get()?.c || 0;
        res.json({ mejorAtaque, mejorDefensa, masVictorias, masGoles, masInvicto, totalGoles, totalPartidos });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════
//  ESTADÍSTICAS DE PARTIDO
// ══════════════════════════════════════════════════════════════

function getEquipoDeUsuario(userId, match) {
    const isAdmin = userId === process.env.ADMIN_ID || !!db.prepare('SELECT id FROM admins WHERE discord_id=?').get(userId);
    if (isAdmin) return { miEquipo: match.equipo1, esAdmin: true };

    const cap1 = db.prepare("SELECT * FROM teams WHERE capitan_username=?").get(match.equipo1);
    const cap2 = db.prepare("SELECT * FROM teams WHERE capitan_username=?").get(match.equipo2);
    if (cap1?.capitan_id === userId || cap1?.capitan2_id === userId) return { miEquipo: match.equipo1, esAdmin: false };
    if (cap2?.capitan_id === userId || cap2?.capitan2_id === userId) return { miEquipo: match.equipo2, esAdmin: false };
    const cocap1 = cap1 && db.prepare("SELECT 1 FROM cocapitanes WHERE capitan_id=? AND cocapitan_id=?").get(cap1.capitan_id, userId);
    const cocap2 = cap2 && db.prepare("SELECT 1 FROM cocapitanes WHERE capitan_id=? AND cocapitan_id=?").get(cap2.capitan_id, userId);
    if (cocap1) return { miEquipo: match.equipo1, esAdmin: false };
    if (cocap2) return { miEquipo: match.equipo2, esAdmin: false };
    return null;
}

app.get('/partido/:match_id/estadisticas', requireLogin, (req, res) => {
    try {
        const matchId = req.params.match_id;
        const userId = req.session.user.id;
        const match = db.prepare('SELECT * FROM matches WHERE id=?').get(matchId);
        if (!match || match.estado !== 'finalizado') return res.redirect('/torneo');

        const auth = getEquipoDeUsuario(userId, match);
        if (!auth) return res.redirect('/torneo');

        const miEquipo = (auth.esAdmin && req.query.equipo) ? req.query.equipo : auth.miEquipo;
        const esEquipo1 = miEquipo === match.equipo1;
        const yaEnviado = esEquipo1 ? !!match.stats_equipo1 : !!match.stats_equipo2;
        const otroEnviado = esEquipo1 ? !!match.stats_equipo2 : !!match.stats_equipo1;

        const jugadores = db.prepare("SELECT * FROM players WHERE equipo=? ORDER BY CASE posicion WHEN 'POR' THEN 1 WHEN 'DFC' THEN 2 WHEN 'MC' THEN 3 WHEN 'CARR' THEN 4 WHEN 'DC' THEN 5 ELSE 6 END, nombre").all(miEquipo);

        const statsExistentes = {};
        const statsRows = db.prepare("SELECT * FROM player_match_stats WHERE match_id=? AND equipo=?").all(matchId, miEquipo);
        statsRows.forEach(r => { statsExistentes[r.discord_id] = r; });

        const golesRecibidos = esEquipo1 ? match.goles2 : match.goles1;

        res.render('estadisticas-partido', {
            user: req.session.user,
            match,
            miEquipo,
            esEquipo1,
            yaEnviado,
            otroEnviado,
            jugadores,
            statsExistentes,
            golesRecibidos,
            mensaje: req.query.ok ? 'ok' : (req.query.ya ? 'ya' : null),
            esAdmin: auth.esAdmin,
        });
    } catch(e) {
        console.error('[/partido/estadisticas GET]', e.message);
        res.redirect('/torneo');
    }
});

app.post('/partido/:match_id/estadisticas', requireLogin, (req, res) => {
    try {
        const matchId = req.params.match_id;
        const userId = req.session.user.id;
        const match = db.prepare('SELECT * FROM matches WHERE id=?').get(matchId);
        if (!match || match.estado !== 'finalizado') return res.redirect('/torneo');

        const auth = getEquipoDeUsuario(userId, match);
        if (!auth) return res.redirect('/torneo');

        const miEquipo = auth.miEquipo;
        const esEquipo1 = miEquipo === match.equipo1;

        const jugadores = db.prepare("SELECT * FROM players WHERE equipo=?").all(miEquipo);
        const golesRecibidos = esEquipo1 ? match.goles2 : match.goles1;
        const porteriaCero = golesRecibidos === 0 ? 1 : 0;

        const stmt = db.prepare(`
            INSERT INTO player_match_stats (match_id, discord_id, equipo, goles, asistencias, porterias_a_cero, reported_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(match_id, discord_id) DO UPDATE SET
                goles=excluded.goles, asistencias=excluded.asistencias,
                porterias_a_cero=excluded.porterias_a_cero,
                reported_by=excluded.reported_by
        `);

        db.transaction(() => {
            for (const j of jugadores) {
                const goles = Math.max(0, parseInt(req.body[`goles_${j.discord_id}`] || '0') || 0);
                const asist = Math.max(0, parseInt(req.body[`asist_${j.discord_id}`] || '0') || 0);
                const paCero = ['DFC','POR'].includes(j.posicion) ? porteriaCero : 0;
                stmt.run(matchId, j.discord_id, miEquipo, goles, asist, paCero, userId);
            }
            const col = esEquipo1 ? 'stats_equipo1' : 'stats_equipo2';
            db.prepare(`UPDATE matches SET ${col}=1 WHERE id=?`).run(matchId);
        })();

        io.emit('activity', `📊 ${req.session.user.username} registró estadísticas de ${miEquipo} (partido ${matchId})`);

        res.redirect(`/partido/${matchId}/estadisticas?ok=1`);
    } catch(e) {
        console.error('[/partido/estadisticas POST]', e.message);
        res.redirect('/torneo');
    }
});

// ══════════════════════════════════════════════════════════════
//  GOLEADORES — Clasificación individual por posición
// ══════════════════════════════════════════════════════════════
app.get('/goleadores', requireLogin, (req, res) => {
    try {
        const torneoActivo = !!db.prepare("SELECT value FROM settings WHERE key='torneo_generado'").get()?.value;

        const queryBase = `
            SELECT
                p.discord_id, p.nombre, p.posicion, p.eafc_id, p.foto,
                COALESCE(NULLIF(t.nombre_equipo,''), p.equipo) as equipo_display,
                t.logo_url,
                SUM(s.goles) as goles,
                SUM(s.asistencias) as asistencias,
                SUM(s.porterias_a_cero) as porterias_a_cero,
                COUNT(DISTINCT s.match_id) as partidos
            FROM player_match_stats s
            JOIN players p ON p.discord_id = s.discord_id
            LEFT JOIN teams t ON t.capitan_username = p.equipo
        `;

        const statsTorneo = torneoActivo ? db.prepare(queryBase + `
            JOIN matches m ON m.id = s.match_id
            WHERE m.estado = 'finalizado'
            GROUP BY s.discord_id
            ORDER BY goles DESC, asistencias DESC, porterias_a_cero DESC
        `).all() : [];

        const statsGlobal = db.prepare(queryBase + `
            GROUP BY s.discord_id
            ORDER BY goles DESC, asistencias DESC, porterias_a_cero DESC
        `).all();

        const POSICIONES = ['DC','CARR','MC','DFC','POR'];
        const agrupar = (arr) => {
            const result = {};
            for (const pos of POSICIONES) result[pos] = arr.filter(p => p.posicion === pos);
            return result;
        };

        res.render('goleadores', {
            user: req.session.user,
            torneo:  agrupar(statsTorneo),
            global:  agrupar(statsGlobal),
            torneoActivo,
        });
    } catch(e) {
        console.error('[/goleadores]', e.message);
        res.render('goleadores', { user: req.session.user, torneo: {}, global: {}, torneoActivo: false });
    }
});

// ══════════════════════════════════════════════════════════════
//  ARRANQUE
// ══════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Clutch Draft en http://0.0.0.0:${PORT}`);
});

module.exports = { app, io };
