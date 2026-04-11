// Test deploy automático
require('dotenv').config();
const express   = require('express');
const http      = require('http');
const { Server } = require('socket.io');
const session   = require('express-session');
const rateLimit = require('express-rate-limit');
const path      = require('path');
const axios     = require('axios');
const multer    = require('multer'); // ← AÑADIR AQUÍ
const fs        = require('fs');     // ← AÑADIR AQUÍ
const db        = require('./database/db');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
    // Optimización para muchos clientes
    pingTimeout:  60000,
    pingInterval: 25000,
    transports:   ['websocket', 'polling']
});

// ══════════════════════════════════════════════════════════════
//  CACHÉ EN MEMORIA — evita leer la DB en cada socket event
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
    cache.turnoActual   = turno?.value  || '';
    cache.draftEstado   = estado?.value || 'cerrado';
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
app.use(session({
    secret:            process.env.SESSION_SECRET || 'clutch-secret-dev',
    resave:            false,
    saveUninitialized: false,
    cookie:            { maxAge: 86400000 }
}));

// Rate limiting: máx 5 picks por minuto por IP (evita spam)
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
    if (!req.session.user || req.session.user.id !== process.env.ADMIN_ID)
        return res.redirect('/hub');
    next();
}

// ══════════════════════════════════════════════════════════════
//  AUTH — Discord OAuth2
// ══════════════════════════════════════════════════════════════
app.get('/', (req, res) => {
    res.redirect('/login');
});
app.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/hub');
    res.render('login', { error: null });
});

app.get('/auth/discord', (req, res) => {
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
        req.session.user = {
            id:       u.id,
            username: u.username,
            avatar:   u.avatar
                ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png`
                : `https://cdn.discordapp.com/embed/avatars/0.png`,
            esAdmin:  u.id === process.env.ADMIN_ID
        };
        res.redirect('/hub');
    } catch (e) {
        console.error('OAuth2 error:', e.message);
        res.redirect('/login');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
});

// ══════════════════════════════════════════════════════════════
//  HUB
// ══════════════════════════════════════════════════════════════
app.get('/hub', requireLogin, (req, res) => {
    const top5          = db.prepare(`SELECT * FROM clasificacion ORDER BY puntos DESC, gf DESC LIMIT 5`).all();
    const fichados      = db.prepare(`SELECT COUNT(*) as c FROM players WHERE equipo IS NOT NULL`).get();
    const totalJugadores= db.prepare(`SELECT COUNT(*) as c FROM players`).get();
    const totalEquipos  = db.prepare(`SELECT COUNT(*) as c FROM teams`).get();
    const miEquipo      = db.prepare(`SELECT * FROM teams WHERE capitan_id=?`).get(req.session.user.id);
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
    const userId   = req.session.user.id;
    const jugadores = db.prepare(`SELECT * FROM players ORDER BY posicion, nombre`).all();
    const miEquipo  = db.prepare(`SELECT * FROM teams WHERE capitan_id=?`).get(userId);
    const teams     = db.prepare(`SELECT * FROM teams ORDER BY id`).all();

    const esCapitan = !!miEquipo;
    const misJugadores = miEquipo
        ? jugadores.filter(j => j.equipo === req.session.user.username)
        : [];

    // Contar posiciones de mi equipo para mostrar límites
    const conteo = { DC: 0, MC: 0, CARR: 0, DFC: 0, POR: 0 };
    misJugadores.forEach(j => { if (conteo[j.posicion] !== undefined) conteo[j.posicion]++; });

    res.render('draft', {
        user:           { ...req.session.user, esCapitan },
        jugadores:      jugadores.filter(j => !j.equipo), // solo disponibles
        todosFichados:  jugadores.filter(j => j.equipo),
        miEquipo:       miEquipo || null,
        misJugadores,
        conteo,
        turnoActual:    cache.turnoActual,
        draftEstado:    cache.draftEstado,
        tiempoRestante: cache.tiempoRestante,
        teams,
        LIMS: { DC: 2, MC: 3, CARR: 2, DFC: 3, POR: 1 }
    });
});

// ══════════════════════════════════════════════════════════════
//  PICK — fichar jugador
// ══════════════════════════════════════════════════════════════
const LIMITES = { DC: 2, MC: 3, CARR: 2, DFC: 3, POR: 1 };

app.post('/pick', requireLogin, pickLimiter, (req, res) => {
    const { player_id } = req.body;
    const user = req.session.user;

    if (cache.draftEstado !== 'abierto')
        return res.status(403).json({ error: 'El draft está cerrado.' });

    if (cache.turnoActual !== user.username)
        return res.status(403).json({ error: 'No es tu turno.' });

    const jugador = db.prepare(`SELECT * FROM players WHERE discord_id=? AND equipo IS NULL`).get(player_id);
    if (!jugador) return res.status(400).json({ error: 'Jugador no disponible.' });

    // Verificar límite de posición
    const enMiEquipo = db.prepare(
        `SELECT COUNT(*) as c FROM players WHERE equipo=? AND posicion=?`
    ).get(user.username, jugador.posicion);
    if (enMiEquipo.c >= LIMITES[jugador.posicion])
        return res.status(400).json({ error: `Límite de ${jugador.posicion} alcanzado.` });

    // Transacción: fichar + registrar pick + avanzar turno
    const ronda = db.prepare(`SELECT value FROM settings WHERE key='ronda_actual'`).get();
    
    db.transaction(() => {
        db.prepare(`UPDATE players SET equipo=? WHERE discord_id=?`).run(user.username, player_id);
        db.prepare(`INSERT INTO picks (ronda, capitan, jugador_id) VALUES (?,?,?)`).run(
            parseInt(ronda?.value || 1), user.username, player_id
        );
    })();

    avanzarTurnoSnake(user.username);

    // Emitir a TODOS los clientes conectados
io.emit('nuevo-fichaje', {
    capitan:   user.username,
    jugador:   jugador.nombre,
    jugadorId: player_id,
    posicion:  jugador.posicion,
    turno:     cache.turnoActual,
    timer:     cache.tiempoRestante
});

// Anunciar fichaje en Discord (avisamos al bot por HTTP)
axios.post(`http://localhost:3001/api/fichaje`, {
    capitan:  user.username,
    jugador:  jugador.nombre,
    posicion: jugador.posicion,
    telefono: jugador.telefono || 'No disponible'
}).catch(() => {});

res.json({ ok: true, turno: cache.turnoActual });
});

// ══════════════════════════════════════════════════════════════
//  SNAKE DRAFT LOGIC
// ══════════════════════════════════════════════════════════════
function avanzarTurnoSnake(capitanActual) {
    const teams     = db.prepare(`SELECT capitan_username FROM teams ORDER BY id ASC`).all();
    if (!teams.length) return;

    const lista  = teams.map(t => t.capitan_username);
    const indice = lista.indexOf(capitanActual);
    const dir    = db.prepare(`SELECT value FROM settings WHERE key='direccion_snake'`).get()?.value || 'asc';
    const tiempo = db.prepare(`SELECT value FROM settings WHERE key='tiempo_turno'`).get()?.value || '90';

    let siguiente     = capitanActual;
    let nuevaDireccion = dir;

    if (dir === 'asc') {
        if (indice >= lista.length - 1) {
            siguiente       = lista[lista.length - 1]; // último repite
            nuevaDireccion  = 'desc';
            // Subir ronda
            const ronda = db.prepare(`SELECT value FROM settings WHERE key='ronda_actual'`).get();
            db.prepare(`UPDATE settings SET value=? WHERE key='ronda_actual'`).run(
                String(parseInt(ronda?.value || 1) + 1)
            );
        } else {
            siguiente = lista[indice + 1];
        }
    } else {
        if (indice <= 0) {
            siguiente      = lista[0];
            nuevaDireccion = 'asc';
        } else {
            siguiente = lista[indice - 1];
        }
    }

    db.prepare(`UPDATE settings SET value=? WHERE key='turno_actual'`).run(siguiente);
    db.prepare(`UPDATE settings SET value=? WHERE key='direccion_snake'`).run(nuevaDireccion);

    // Actualizar caché y reiniciar timer
    cache.turnoActual    = siguiente;
    cache.tiempoRestante = parseInt(tiempo);

    // Reiniciar el timer
    iniciarTimer();
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
        io.emit('timer-update', cache.tiempoRestante);

        if (cache.tiempoRestante <= 0) {
            // Saltar turno automáticamente
            io.emit('activity', `⏱️ Turno de ${cache.turnoActual} expirado. Turno saltado.`);
            avanzarTurnoSnake(cache.turnoActual);
            io.emit('nuevo-fichaje', { turno: cache.turnoActual, timer: cache.tiempoRestante });
        }
    }, 1000);
}

// ══════════════════════════════════════════════════════════════
//  ADMIN PANEL
// ══════════════════════════════════════════════════════════════
app.get('/admin', requireLogin, requireAdmin, (req, res) => {
    const jugadores = db.prepare(`SELECT * FROM players ORDER BY nombre`).all();
    const equipos   = db.prepare(`SELECT * FROM teams ORDER BY id`).all();
    const matches   = db.prepare(`SELECT * FROM matches ORDER BY jornada, id`).all();
    const ronda     = db.prepare(`SELECT value FROM settings WHERE key='ronda_actual'`).get();
    const jornada   = db.prepare(`SELECT value FROM settings WHERE key='jornada_actual'`).get();

    const historial = db.prepare(`SELECT * FROM historial_torneos ORDER BY id DESC`).all();

    res.render('admin', {
        user:        req.session.user,
        jugadores,
        equipos,
        matches,
        turnoActual: cache.turnoActual,
        draftEstado: cache.draftEstado,
        tiempoTurno: db.prepare(`SELECT value FROM settings WHERE key='tiempo_turno'`).get()?.value || 90,
        rondaActual: ronda?.value || 1,
        jornadaActual: jornada?.value || 1,
        fichados:    jugadores.filter(j => j.equipo).length,
        total:       jugadores.length,
        historial
    });
});

// Abrir draft
app.post('/admin/abrir-draft', requireLogin, requireAdmin, (req, res) => {
    const teams = db.prepare(`SELECT * FROM teams ORDER BY id ASC`).all();
    if (!teams.length) return res.redirect('/admin');

    const primerCapitan = teams[0].capitan_username;
    db.prepare(`UPDATE settings SET value='abierto' WHERE key='draft_estado'`).run();
    db.prepare(`UPDATE settings SET value=? WHERE key='turno_actual'`).run(primerCapitan);
    db.prepare(`UPDATE settings SET value='asc' WHERE key='direccion_snake'`).run();

    cache.draftEstado = 'abierto';
    cache.turnoActual = primerCapitan;

    // Avisar al bot para crear canales de voz
    axios.post('http://localhost:3001/api/crear-canales', { teams }).catch(() => {});

    io.emit('draft-abierto', { turno: primerCapitan });
    res.redirect('/admin');
});

// Cerrar draft
app.post('/admin/cerrar-draft', requireLogin, requireAdmin, (req, res) => {
    db.prepare(`UPDATE settings SET value='cerrado' WHERE key='draft_estado'`).run();
    cache.draftEstado = 'cerrado';
    
    // Generar canal equipos-ids
    axios.post('http://localhost:3001/api/generar-equipos-ids').catch(() => {});
    // Borrar canales de voz anteriores y crear nuevos
    axios.post('http://localhost:3001/api/borrar-canales').catch(() => {});

    io.emit('draft-cerrado');
    res.redirect('/admin');
});

// Saltar turno
app.post('/admin/saltar-turno', requireLogin, requireAdmin, (req, res) => {
    io.emit('activity', `⏭️ Turno de ${cache.turnoActual} saltado por el admin.`);
    avanzarTurnoSnake(cache.turnoActual);
    io.emit('nuevo-fichaje', { turno: cache.turnoActual, timer: cache.tiempoRestante });
    res.redirect('/admin');
});

// Deshacer último pick
app.post('/admin/deshacer-pick', requireLogin, requireAdmin, (req, res) => {
    const ultimo = db.prepare(`SELECT * FROM picks ORDER BY id DESC LIMIT 1`).get();
    if (!ultimo) return res.redirect('/admin');

    db.transaction(() => {
        db.prepare(`UPDATE players SET equipo=NULL WHERE discord_id=?`).run(ultimo.jugador_id);
        db.prepare(`DELETE FROM picks WHERE id=?`).run(ultimo.id);
        db.prepare(`UPDATE settings SET value=? WHERE key='turno_actual'`).run(ultimo.capitan);
    })();

    cache.turnoActual = ultimo.capitan;
    io.emit('nuevo-fichaje', { turno: cache.turnoActual, timer: cache.tiempoRestante });
    io.emit('activity', `↩️ Último pick de ${ultimo.capitan} deshecho.`);
    res.redirect('/admin');
});

// Registrar capitán
app.post('/admin/registrar-capitan', requireLogin, requireAdmin, (req, res) => {
    const { capitan_id, capitan_username } = req.body;
    try {
        db.prepare(`INSERT OR IGNORE INTO teams (capitan_id, capitan_username) VALUES (?,?)`).run(capitan_id, capitan_username);
        // Añadir a clasificación
        db.prepare(`INSERT OR IGNORE INTO clasificacion (capitan_id, equipo_nombre) VALUES (?,?)`).run(capitan_id, capitan_username);
        io.emit('activity', `👑 Nuevo capitán registrado: ${capitan_username}`);
    } catch(e) { console.error(e); }
    res.redirect('/admin');
});

// Eliminar capitán
app.post('/admin/eliminar-capitan', requireLogin, requireAdmin, (req, res) => {
    const { capitan_id } = req.body;
    db.prepare(`DELETE FROM teams WHERE capitan_id=?`).run(capitan_id);
    res.redirect('/admin');
});

// Borrar jugador
app.post('/admin/borrar-jugador', requireLogin, requireAdmin, (req, res) => {
    const { discord_id } = req.body;
    db.prepare(`DELETE FROM players WHERE discord_id=?`).run(discord_id);
    io.emit('nuevo-jugador');
    res.redirect('/admin');
});

// Editar jugador
app.post('/admin/editar-jugador', requireLogin, requireAdmin, (req, res) => {
    const { discord_id, nombre, posicion } = req.body;
    db.prepare(`UPDATE players SET nombre=?, posicion=? WHERE discord_id=?`).run(nombre, posicion, discord_id);
    io.emit('nuevo-jugador');
    res.redirect('/admin');
});

// Liberar jugador (quitarle el equipo)
app.post('/admin/liberar-jugador', requireLogin, requireAdmin, (req, res) => {
    const { discord_id } = req.body;
    db.prepare(`UPDATE players SET equipo=NULL WHERE discord_id=?`).run(discord_id);
    io.emit('nuevo-fichaje', { turno: cache.turnoActual });
    res.redirect('/admin');
});

// Cambiar tiempo de turno
app.post('/admin/tiempo-turno', requireLogin, requireAdmin, (req, res) => {
    const { segundos } = req.body;
    db.prepare(`UPDATE settings SET value=? WHERE key='tiempo_turno'`).run(String(segundos));
    cache.tiempoRestante = parseInt(segundos);
    io.emit('timer-update', cache.tiempoRestante);
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

// ══════════════════════════════════════════════════════════════
//  ENFRENTAMIENTOS / CLASIFICACIÓN
// ══════════════════════════════════════════════════════════════
app.get('/clasificacion', requireLogin, (req, res) => {
    const tabla   = db.prepare(`SELECT * FROM clasificacion ORDER BY puntos DESC, pg DESC, gf DESC`).all();
    const matches = db.prepare(`SELECT * FROM matches ORDER BY jornada DESC, id DESC`).all();
    const jornada = db.prepare(`SELECT value FROM settings WHERE key='jornada_actual'`).get();
    const equipos = db.prepare(`SELECT * FROM teams`).all();

    // Mapa capitan_id → datos del equipo
    const equiposMap = {};
    equipos.forEach(e => { equiposMap[e.capitan_id] = e; });

    res.render('clasificacion', {
        user: req.session.user,
        tabla,
        matches,
        jornadaActual: parseInt(jornada?.value || 1),
        guildId: process.env.GUILD_ID || '',
        equiposMap
    });
});

// Admin: crear enfrentamiento
app.post('/admin/crear-match', requireLogin, requireAdmin, (req, res) => {
    const { equipo1, equipo2, jornada } = req.body;
    db.prepare(`INSERT INTO matches (jornada, equipo1, equipo2) VALUES (?,?,?)`).run(
        parseInt(jornada), equipo1, equipo2
    );
    io.emit('activity', `⚔️ Nuevo enfrentamiento: ${equipo1} vs ${equipo2} (J${jornada})`);
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

    // Recalcular clasificación
    actualizarClasificacion(match.equipo1, match.equipo2, parseInt(goles1), parseInt(goles2));

    io.emit('resultado', { match_id, equipo1: match.equipo1, equipo2: match.equipo2, goles1, goles2 });
    io.emit('activity', `✅ Resultado: ${match.equipo1} ${goles1}-${goles2} ${match.equipo2}`);
    res.redirect('/admin');
});

function actualizarClasificacion(eq1, eq2, g1, g2) {
    // Asegurar que existen en clasificación
    const t1 = db.prepare(`SELECT * FROM teams WHERE capitan_username=?`).get(eq1);
    const t2 = db.prepare(`SELECT * FROM teams WHERE capitan_username=?`).get(eq2);
    if (t1) db.prepare(`INSERT OR IGNORE INTO clasificacion (capitan_id, equipo_nombre) VALUES (?,?)`).run(t1.capitan_id, eq1);
    if (t2) db.prepare(`INSERT OR IGNORE INTO clasificacion (capitan_id, equipo_nombre) VALUES (?,?)`).run(t2.capitan_id, eq2);

    const update = db.prepare(`
        UPDATE clasificacion SET
            pj = pj + 1,
            gf = gf + ?,
            gc = gc + ?,
            pg = pg + ?,
            pe = pe + ?,
            pp = pp + ?,
            puntos = puntos + ?
        WHERE equipo_nombre = ?
    `);

    db.transaction(() => {
        if (g1 > g2) {
            update.run(g1, g2, 1, 0, 0, 3, eq1); // eq1 gana
            update.run(g2, g1, 0, 0, 1, 0, eq2); // eq2 pierde
        } else if (g2 > g1) {
            update.run(g1, g2, 0, 0, 1, 0, eq1); // eq1 pierde
            update.run(g2, g1, 1, 0, 0, 3, eq2); // eq2 gana
        } else {
            update.run(g1, g2, 0, 1, 0, 1, eq1); // empate
            update.run(g2, g1, 0, 1, 0, 1, eq2);
        }
    })();
}

// ══════════════════════════════════════════════════════════════
//  API PARA EL BOT
// ══════════════════════════════════════════════════════════════
app.post('/api/nuevo-jugador', (req, res) => {
    io.emit('nuevo-jugador');
    res.sendStatus(200);
});

app.get('/api/estado', (req, res) => {
    res.json({
        draftEstado:   cache.draftEstado,
        turnoActual:   cache.turnoActual,
        tiempoRestante: cache.tiempoRestante
    });
});

// ── Fase 2: cerrar inscripciones desde panel admin ─────────
app.post('/admin/cerrar-inscripciones', requireLogin, requireAdmin, (req, res) => {
    axios.post('http://localhost:3001/api/cerrar-inscripciones').catch(() => {});
    io.emit('activity', '🔒 Inscripciones cerradas manualmente por el admin.');
    res.redirect('/admin');
});

// ── Fase 2: forzar cierre de votación de precio ────────────
app.post('/admin/cerrar-votacion-precio', requireLogin, requireAdmin, (req, res) => {
    axios.post('http://localhost:3001/api/cerrar-votacion-precio').catch(() => {});
    io.emit('activity', '💰 Votación de precio cerrada por el admin.');
    res.redirect('/admin');
});

// ── Fase 3: generar torneo ────────────────────────────────────
app.post('/admin/generar-torneo', requireLogin, requireAdmin, async (req, res) => {
    try {
        const resp = await axios.post('http://localhost:3001/api/generar-torneo');
        io.emit('activity', `🏆 Torneo generado: ${resp.data.matches} partidos en ${resp.data.jornadas} jornadas.`);
        io.emit('torneo-generado');
    } catch(e) {
        console.error('Error generando torneo:', e.message);
        io.emit('activity', '❌ Error al generar el torneo: ' + e.message);
    }
    res.redirect('/admin');
});

// ── Fase 3: guardar historial + limpiar torneo ───────────────
app.post('/admin/cerrar-torneo', requireLogin, requireAdmin, async (req, res) => {
    // Primero guardar historial vía bot (que tiene acceso a Discord)
    await axios.post('http://localhost:3001/api/cerrar-torneo').catch(() => {});
    io.emit('activity', '🏆 Torneo cerrado. Historial guardado y limpieza iniciada.');
    io.emit('resultado'); // fuerza recarga clasificación
    res.redirect('/admin');
});

// ── Fase 3: limpiar torneo ─────────────────────────────────
app.post('/admin/limpiar-torneo', requireLogin, requireAdmin, async (req, res) => {
    axios.post('http://localhost:3001/api/limpiar-torneo').catch(() => {});
    io.emit('activity', '🧹 Torneo limpiado. Clasificación y partidos reseteados.');
    io.emit('resultado'); // fuerza recarga en /clasificacion
    res.redirect('/admin');
});

// ── Fase 3: actualizar clasificación en Discord ────────────
app.post('/admin/actualizar-clasificacion', requireLogin, requireAdmin, (req, res) => {
    axios.post('http://localhost:3001/api/actualizar-clasificacion').catch(() => {});
    io.emit('activity', '📊 Clasificación de Discord actualizada.');
    res.redirect('/admin');
});

// ── Fase 3: resultado confirmado por ambos capitanes vía bot ─
app.post('/api/resultado-confirmado', (req, res) => {
    const { match_id, goles1, goles2 } = req.body;
    const match = db.prepare('SELECT * FROM matches WHERE id=?').get(match_id);
    if (!match) return res.sendStatus(404);

    db.prepare(`UPDATE matches SET goles1=?, goles2=?, estado='finalizado' WHERE id=?`)
        .run(parseInt(goles1), parseInt(goles2), match_id);

    actualizarClasificacion(match.equipo1, match.equipo2, parseInt(goles1), parseInt(goles2));

    io.emit('resultado', {
        match_id,
        equipo1: match.equipo1,
        equipo2: match.equipo2,
        goles1, goles2
    });
    io.emit('activity', `✅ Resultado confirmado: ${match.equipo1} ${goles1}-${goles2} ${match.equipo2}`);
    res.sendStatus(200);
});

// ══════════════════════════════════════════════════════════════
//  SOCKETS
// ══════════════════════════════════════════════════════════════
io.on('connection', (socket) => {
    // Al conectar, enviar estado actual inmediatamente
    socket.emit('init', {
        turno:  cache.turnoActual,
        estado: cache.draftEstado,
        timer:  cache.tiempoRestante
    });
});

// ══════════════════════════════════════════════════════════════
//  ARRANQUE
// ══════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
// ── Renombrar equipo (capitán desde la web) ──────────────
app.post('/equipo/renombrar', requireLogin, (req, res) => {
    const { nombre_equipo } = req.body;
    const userId = req.session.user.id;

    if (!nombre_equipo || nombre_equipo.trim().length < 2) {
        return res.status(400).json({ error: 'Nombre demasiado corto.' });
    }

    const equipo = db.prepare(`SELECT * FROM teams WHERE capitan_id=?`).get(userId);
    if (!equipo) return res.status(403).json({ error: 'No eres capitán.' });

    db.prepare(`UPDATE teams SET nombre_equipo=? WHERE capitan_id=?`)
        .run(nombre_equipo.trim(), userId);

    // Avisar al bot para renombrar el canal de voz
    axios.post('http://localhost:3001/api/renombrar-canal', {
        capitan_username: req.session.user.username,
        nombre_equipo:    nombre_equipo.trim()
    }).catch(() => {});

    io.emit('equipo-renombrado', {
        capitan:  req.session.user.username,
        nombre:   nombre_equipo.trim()
    });

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
    limits: { fileSize: 2 * 1024 * 1024 }, // 2MB máximo
    fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
            return cb(new Error('Solo imágenes'));
        }
        cb(null, true);
    }
});

app.post('/equipo/escudo', requireLogin, uploadEscudo.single('escudo'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo.' });

    const userId = req.session.user.id;
    const equipo = db.prepare(`SELECT * FROM teams WHERE capitan_id=?`).get(userId);
    if (!equipo) return res.status(403).json({ error: 'No eres capitán.' });

    const logo_url = `/uploads/escudos/${req.file.filename}`;
    db.prepare(`UPDATE teams SET logo_url=? WHERE capitan_id=?`).run(logo_url, userId);

    io.emit('equipo-renombrado', { capitan: req.session.user.username });
    res.json({ ok: true, logo_url });
});
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Clutch Draft en http://0.0.0.0:${PORT}`);
});

module.exports = { app, io };