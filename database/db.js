/**
 * database/db.js
 * ─────────────────────────────────────────────────────────────
 * Usamos better-sqlite3 (síncrono) en lugar del callback-based
 * sqlite3. Ventajas para 150+ usuarios:
 *   · WAL mode: lecturas y escrituras no se bloquean entre sí
 *   · Síncrono: sin callback hell, sin race conditions
 *   · 10-15x más rápido que el sqlite3 original
 *   · Una sola conexión compartida (SQLite no necesita pool)
 */

const Database = require('better-sqlite3');
const path     = require('path');

const db = new Database(path.join(__dirname, 'clutch.db'));

// ── PRAGMAS DE RENDIMIENTO ─────────────────────────────────────
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -64000');  // 64 MB RAM cache
db.pragma('temp_store = MEMORY');
db.pragma('foreign_keys = ON');

// ── SCHEMA ─────────────────────────────────────────────────────
db.exec(`

  CREATE TABLE IF NOT EXISTS players (
    discord_id  TEXT PRIMARY KEY,
    nombre      TEXT NOT NULL,
    posicion    TEXT NOT NULL,
    telefono    TEXT,
    eafc_id     TEXT,
    foto        TEXT,
    equipo      TEXT DEFAULT NULL
);

  CREATE TABLE IF NOT EXISTS teams (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    capitan_id       TEXT NOT NULL UNIQUE,
    capitan_username TEXT NOT NULL,
    nombre_equipo    TEXT,
    logo_url         TEXT DEFAULT '',
    formacion        TEXT DEFAULT '3-1-4-2',
    capitan2_id      TEXT DEFAULT NULL,
    capitan2_username TEXT DEFAULT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS picks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ronda       INTEGER NOT NULL,
    capitan     TEXT NOT NULL,
    jugador_id  TEXT NOT NULL,
    timestamp   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS matches (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    jornada       INTEGER NOT NULL DEFAULT 1,
    equipo1       TEXT NOT NULL,
    equipo2       TEXT NOT NULL,
    goles1        INTEGER DEFAULT NULL,
    goles2        INTEGER DEFAULT NULL,
    estado        TEXT DEFAULT 'pendiente',
    canal_discord TEXT DEFAULT NULL,
    fecha         TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS clasificacion (
    capitan_id    TEXT PRIMARY KEY,
    equipo_nombre TEXT NOT NULL,
    puntos        INTEGER DEFAULT 0,
    pj            INTEGER DEFAULT 0,
    pg            INTEGER DEFAULT 0,
    pe            INTEGER DEFAULT 0,
    pp            INTEGER DEFAULT 0,
    gf            INTEGER DEFAULT 0,
    gc            INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS historial_torneos (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha_inicio  TEXT NOT NULL,
    fecha_fin     TEXT NOT NULL,
    n_equipos     INTEGER NOT NULL,
    formato       TEXT NOT NULL,
    campeon       TEXT NOT NULL,
    subcampeon    TEXT NOT NULL,
    clasificacion TEXT NOT NULL  -- JSON snapshot de la tabla completa
  );

  CREATE TABLE IF NOT EXISTS cocapitanes (
    capitan_id   TEXT NOT NULL,
    cocapitan_id TEXT NOT NULL,
    PRIMARY KEY (capitan_id, cocapitan_id)
  );

  CREATE TABLE IF NOT EXISTS admins (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id  TEXT UNIQUE NOT NULL,
    username    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS twitch_tracked (
    twitch_login    TEXT PRIMARY KEY,
    display_name    TEXT NOT NULL,
    profile_image   TEXT DEFAULT NULL,
    is_live         INTEGER DEFAULT 0,
    stream_id       TEXT DEFAULT NULL,
    stream_title    TEXT DEFAULT NULL,
    stream_game     TEXT DEFAULT NULL,
    stream_viewers  INTEGER DEFAULT 0,
    stream_thumbnail TEXT DEFAULT NULL
  );

  CREATE TABLE IF NOT EXISTS candidatos_capitan (
    discord_id  TEXT PRIMARY KEY,
    nombre      TEXT NOT NULL,
    eafc_id     TEXT,
    forzado     INTEGER DEFAULT 0,
    confirmado  INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS preinscripciones (
    discord_id  TEXT PRIMARY KEY,
    username    TEXT NOT NULL,
    nombre      TEXT NOT NULL,
    posicion    TEXT NOT NULL,
    telefono    TEXT,
    eafc_id     TEXT,
    fecha       TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS player_match_stats (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id         INTEGER NOT NULL,
    discord_id       TEXT NOT NULL,
    equipo           TEXT NOT NULL,
    goles            INTEGER DEFAULT 0,
    asistencias      INTEGER DEFAULT 0,
    porterias_a_cero INTEGER DEFAULT 0,
    reported_by      TEXT NOT NULL,
    UNIQUE(match_id, discord_id)
  );

`);

// ── VALORES INICIALES ──────────────────────────────────────────
const initSetting = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
const initDefaults = db.transaction(() => {
    const defaults = [
        ['draft_estado',    'cerrado'],
        ['turno_actual',    ''],
        ['direccion_snake', 'asc'],
        ['tiempo_turno',    '90'],
        ['ronda_actual',    '1'],
        ['jornada_actual',  '1'],
        ['panel_msg_id',          ''],
        ['panel_ch_id',           ''],
        ['inscripciones_estado',  'abierto'],
        ['precio_torneo',         ''],
        ['torneo_generado',       ''],
        ['torneo_inicio',         ''],
        ['twitch_url',            ''],
        ['twitch_nombre',         ''],
        ['total_rondas_swiss',    ''],
        ['canal_cocapitanes',     ''],
        ['torneo_fin_ts',         ''],
        ['discord_limpiado',      ''],
        ['datos_limpiados',       ''],
        ['fase_actual',               ''],
        ['fases_torneo',              ''],
        ['canal_jugadores_inscritos', ''],
        ['canal_votacion_precio',     ''],
        ['canal_pagos',               ''],
        ['admin_panel_status_id',     ''],
        ['admin_panel_msg_ids',       '[]'],
        ['horario_torneo',            ''],
        ['fecha_draft',               ''],
        ['fecha_limite_inscripciones',''],
        ['tiempo_ultima_hora',        '30'],
        ['draft_tipo',               ''],
        ['num_equipos_manual',        ''],
        ['formato_manual',            ''],
        ['caps_por_equipo',           '1'],
        ['canal_votacion_capitan',    ''],
        ['preinscripcion_abierta',    ''],
        ['canal_preinscripcion',      ''],
    ];
    for (const [k, v] of defaults) initSetting.run(k, v);
});
initDefaults();

// Migración historial_torneos: añadir columna partidos
try { db.prepare(`ALTER TABLE historial_torneos ADD COLUMN partidos TEXT DEFAULT '[]'`).run(); } catch { /* ya existe */ }

// Migraciones estadísticas de partido
try { db.prepare(`ALTER TABLE matches ADD COLUMN stats_equipo1 INTEGER DEFAULT 0`).run(); } catch { /* ya existe */ }
try { db.prepare(`ALTER TABLE matches ADD COLUMN stats_equipo2 INTEGER DEFAULT 0`).run(); } catch { /* ya existe */ }

// Migraciones twitch_tracked (columnas nuevas en instalaciones previas)
for (const [col, def] of [
    ['profile_image',    'TEXT DEFAULT NULL'],
    ['stream_title',     'TEXT DEFAULT NULL'],
    ['stream_game',      'TEXT DEFAULT NULL'],
    ['stream_viewers',   'INTEGER DEFAULT 0'],
    ['stream_thumbnail', 'TEXT DEFAULT NULL'],
    ['last_live_at',     'TEXT DEFAULT NULL'],
]) {
    try { db.prepare(`ALTER TABLE twitch_tracked ADD COLUMN ${col} ${def}`).run(); } catch { /* ya existe */ }
}

console.log('✅ Base de datos Clutch Draft lista (WAL + better-sqlite3).');

module.exports = db;