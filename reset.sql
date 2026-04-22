-- ============================================================
--  CLUTCH DRAFT — Reset completo de la base de datos
--  Borra todos los datos y deja la BD lista para producción
--  Ejecutar con:  sqlite3 database/clutch.db < reset.sql
-- ============================================================

DELETE FROM picks;
DELETE FROM players;
DELETE FROM teams;
DELETE FROM clasificacion;
UPDATE settings SET value = 'cerrado' WHERE key = 'draft_estado';
UPDATE settings SET value = ''        WHERE key = 'turno_actual';
UPDATE settings SET value = 'asc'     WHERE key = 'direccion_snake';
UPDATE settings SET value = '1'       WHERE key = 'ronda_actual';

-- ── VERIFICAR ─────────────────────────────────────────────────
SELECT '=== RESET COMPLETADO ===' as info;
SELECT 'picks'         as tabla, COUNT(*) as registros FROM picks
UNION ALL
SELECT 'players',                COUNT(*)               FROM players
UNION ALL
SELECT 'teams',                  COUNT(*)               FROM teams
UNION ALL
SELECT 'clasificacion',          COUNT(*)               FROM clasificacion;
SELECT '=== SETTINGS ===' as info;
SELECT key, value FROM settings;
