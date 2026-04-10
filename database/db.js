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
    formacion        TEXT DEFAULT '4-3-3'
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
    ];
    for (const [k, v] of defaults) initSetting.run(k, v);
});
initDefaults();

console.log('✅ Base de datos Clutch Draft lista (WAL + better-sqlite3).');

module.exports = db;