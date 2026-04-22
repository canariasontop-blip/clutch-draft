-- ============================================================
--  CLUTCH DRAFT — Datos de prueba (4 equipos, 44 jugadores bot)
--  Ejecutar con:  sqlite3 database/clutch.db < seed_prueba.sql
--  IMPORTANTE: Sustituye TU_DISCORD_ID por tu ID real de Discord
-- ============================================================

-- Limpiar datos anteriores (mantiene settings)
DELETE FROM picks;
DELETE FROM players;
DELETE FROM teams;
DELETE FROM clasificacion;
UPDATE settings SET value = 'cerrado' WHERE key = 'draft_estado';
UPDATE settings SET value = ''        WHERE key = 'turno_actual';
UPDATE settings SET value = 'asc'    WHERE key = 'direccion_snake';
UPDATE settings SET value = '1'      WHERE key = 'ronda_actual';

-- ── CAPITANES (4 equipos de prueba) ───────────────────────────
-- Reemplaza TU_DISCORD_ID con tu ID real (el que tienes en ADMIN_ID del .env)
-- Los IDs BOT_CAP_x son ficticios para la prueba

INSERT INTO teams (capitan_id, capitan_username, nombre_equipo) VALUES
  ('1255657744388722731',  'K1NGxBAROU',   'Los Cracks'),
  ('BOT_CAP_001',    'BotCapitan1',  'Galácticos'),
  ('BOT_CAP_002',    'BotCapitan2',  'Los Titanes'),
  ('BOT_CAP_003',    'BotCapitan3',  'Dream Team');

INSERT INTO clasificacion (capitan_id, equipo_nombre) VALUES
  ('TU_DISCORD_ID',  'Los Cracks'),
  ('BOT_CAP_001',    'Galácticos'),
  ('BOT_CAP_002',    'Los Titanes'),
  ('BOT_CAP_003',    'Dream Team');

-- ── JUGADORES (44 bots — 8 DC, 12 MC, 8 CARR, 12 DFC, 4 POR) ─
-- Cada equipo necesita: 2 DC + 3 MC + 2 CARR + 3 DFC + 1 POR = 11 jugadores

-- DELANTEROS CENTRO (8 — límite 2 por equipo x 4 equipos)
INSERT INTO players (discord_id, nombre, posicion, telefono, eafc_id) VALUES
  ('P_DC_001', 'Lewandowski Bot',  'DC', '600000001', 'LEWABOT01'),
  ('P_DC_002', 'Benzema Bot',      'DC', '600000002', 'BENZEBOT2'),
  ('P_DC_003', 'Haaland Bot',      'DC', '600000003', 'HAALBOT03'),
  ('P_DC_004', 'Kane Bot',         'DC', '600000004', 'KANEBOT04'),
  ('P_DC_005', 'Mbappe Bot',       'DC', '600000005', 'MBAPBOT05'),
  ('P_DC_006', 'Osimhen Bot',      'DC', '600000006', 'OSIMBOT06'),
  ('P_DC_007', 'Vlahovic Bot',     'DC', '600000007', 'VLAHBOT07'),
  ('P_DC_008', 'Darwin Bot',       'DC', '600000008', 'DARWBOT08');

-- MEDIOCENTROS (12 — límite 3 por equipo x 4 equipos)
INSERT INTO players (discord_id, nombre, posicion, telefono, eafc_id) VALUES
  ('P_MC_001', 'Modric Bot',       'MC', '600000101', 'MODRBOT01'),
  ('P_MC_002', 'De Bruyne Bot',    'MC', '600000102', 'DEBRBOT02'),
  ('P_MC_003', 'Kroos Bot',        'MC', '600000103', 'KROOSBOT3'),
  ('P_MC_004', 'Camavinga Bot',    'MC', '600000104', 'CAMVBOT04'),
  ('P_MC_005', 'Bellingham Bot',   'MC', '600000105', 'BELLBOT05'),
  ('P_MC_006', 'Pedri Bot',        'MC', '600000106', 'PEDRIBOT6'),
  ('P_MC_007', 'Gavi Bot',         'MC', '600000107', 'GAVIBOT07'),
  ('P_MC_008', 'Valverde Bot',     'MC', '600000108', 'VALVBOT08'),
  ('P_MC_009', 'Enzo Bot',         'MC', '600000109', 'ENZOBOT09'),
  ('P_MC_010', 'Caicedo Bot',      'MC', '600000110', 'CAICBOT10'),
  ('P_MC_011', 'Veiga Bot',        'MC', '600000111', 'VEIGBOT11'),
  ('P_MC_012', 'Zubimendi Bot',    'MC', '600000112', 'ZUBIBOT12');

-- CARRILEROS (8 — límite 2 por equipo x 4 equipos)
INSERT INTO players (discord_id, nombre, posicion, telefono, eafc_id) VALUES
  ('P_CA_001', 'Cancelo Bot',      'CARR', '600000201', 'CANCBOT01'),
  ('P_CA_002', 'Alexander Bot',    'CARR', '600000202', 'ALEXBOT02'),
  ('P_CA_003', 'Theo Bot',         'CARR', '600000203', 'THEOBOT03'),
  ('P_CA_004', 'Cucurella Bot',    'CARR', '600000204', 'CUCUBOT04'),
  ('P_CA_005', 'Mendy Bot',        'CARR', '600000205', 'MENDBOT05'),
  ('P_CA_006', 'Hakimi Bot',       'CARR', '600000206', 'HAKIBOT06'),
  ('P_CA_007', 'Trent Bot',        'CARR', '600000207', 'TRENBOT07'),
  ('P_CA_008', 'Grimaldo Bot',     'CARR', '600000208', 'GRIMBOT08');

-- DEFENSAS CENTRALES (12 — límite 3 por equipo x 4 equipos)
INSERT INTO players (discord_id, nombre, posicion, telefono, eafc_id) VALUES
  ('P_DF_001', 'Van Dijk Bot',     'DFC', '600000301', 'VANDBOT01'),
  ('P_DF_002', 'Militao Bot',      'DFC', '600000302', 'MILIBOT02'),
  ('P_DF_003', 'Rudiger Bot',      'DFC', '600000303', 'RUDIBOT03'),
  ('P_DF_004', 'Alaba Bot',        'DFC', '600000304', 'ALABBOT04'),
  ('P_DF_005', 'Konate Bot',       'DFC', '600000305', 'KONABOT05'),
  ('P_DF_006', 'Bastoni Bot',      'DFC', '600000306', 'BASTOBOT6'),
  ('P_DF_007', 'Gvardiol Bot',     'DFC', '600000307', 'GVARBOT07'),
  ('P_DF_008', 'Laporte Bot',      'DFC', '600000308', 'LAPBOT008'),
  ('P_DF_009', 'Skriniar Bot',     'DFC', '600000309', 'SKRIBOT09'),
  ('P_DF_010', 'Marquinhos Bot',   'DFC', '600000310', 'MARQUBOT0'),
  ('P_DF_011', 'Saliba Bot',       'DFC', '600000311', 'SALIBOT11'),
  ('P_DF_012', 'Timber Bot',       'DFC', '600000312', 'TIMBOT012');

-- PORTEROS (4 — límite 1 por equipo x 4 equipos)
INSERT INTO players (discord_id, nombre, posicion, telefono, eafc_id) VALUES
  ('P_PO_001', 'Courtois Bot',     'POR', '600000401', 'COURBOT01'),
  ('P_PO_002', 'Alisson Bot',      'POR', '600000402', 'ALIBOT002'),
  ('P_PO_003', 'Ter Stegen Bot',   'POR', '600000403', 'TERSSBOT3'),
  ('P_PO_004', 'Ederson Bot',      'POR', '600000404', 'EDERBOT04');

-- ── VERIFICAR ─────────────────────────────────────────────────
SELECT '=== JUGADORES ===' as info;
SELECT posicion, COUNT(*) as total FROM players GROUP BY posicion ORDER BY posicion;
SELECT '=== EQUIPOS ===' as info;
SELECT capitan_username, nombre_equipo FROM teams;
SELECT '=== TOTAL ===' as info;
SELECT COUNT(*) as total_jugadores FROM players;
