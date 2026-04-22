-- ============================================================
--  CLUTCH DRAFT — Datos de prueba (10 equipos, 110 jugadores bot)
--  Ejecutar con:  sqlite3 database/clutch.db < seed_prueba_10equipos.sql
--  IMPORTANTE: Sustituye TU_DISCORD_ID y TuUsername con tus datos reales
-- ============================================================

-- Limpiar datos anteriores (mantiene settings)
DELETE FROM picks;
DELETE FROM players;
DELETE FROM teams;
DELETE FROM clasificacion;
UPDATE settings SET value = 'cerrado' WHERE key = 'draft_estado';
UPDATE settings SET value = ''        WHERE key = 'turno_actual';
UPDATE settings SET value = 'asc'     WHERE key = 'direccion_snake';
UPDATE settings SET value = '1'       WHERE key = 'ronda_actual';

-- ── CAPITANES (10 equipos de prueba) ──────────────────────────
-- Reemplaza TU_DISCORD_ID y TuUsername con tus datos reales del .env

INSERT INTO teams (capitan_id, capitan_username, nombre_equipo) VALUES
  ('1255657744388722731', 'K1NGxBAROU',   'Los Cracks'),
  ('BOT_CAP_001',         'BotCapitan1',  'Galácticos'),
  ('BOT_CAP_002',         'BotCapitan2',  'Los Titanes'),
  ('BOT_CAP_003',         'BotCapitan3',  'Dream Team'),
  ('BOT_CAP_004',         'BotCapitan4',  'Thunder FC'),
  ('BOT_CAP_005',         'BotCapitan5',  'Los Invictos'),
  ('BOT_CAP_006',         'BotCapitan6',  'Elite Squad'),
  ('BOT_CAP_007',         'BotCapitan7',  'Phoenix FC'),
  ('BOT_CAP_008',         'BotCapitan8',  'Los Fenómenos'),
  ('BOT_CAP_009',         'BotCapitan9',  'Underdogs FC');

-- equipo_nombre DEBE coincidir con capitan_username (así lo busca el código)
INSERT INTO clasificacion (capitan_id, equipo_nombre) VALUES
  ('1255657744388722731', 'K1NGxBAROU'),
  ('BOT_CAP_001',         'BotCapitan1'),
  ('BOT_CAP_002',         'BotCapitan2'),
  ('BOT_CAP_003',         'BotCapitan3'),
  ('BOT_CAP_004',         'BotCapitan4'),
  ('BOT_CAP_005',         'BotCapitan5'),
  ('BOT_CAP_006',         'BotCapitan6'),
  ('BOT_CAP_007',         'BotCapitan7'),
  ('BOT_CAP_008',         'BotCapitan8'),
  ('BOT_CAP_009',         'BotCapitan9');

-- ── JUGADORES (110 bots) ──────────────────────────────────────
-- Distribución por equipo: 2 DC + 3 MC + 2 CARR + 3 DFC + 1 POR = 11
-- Total: 20 DC | 30 MC | 20 CARR | 30 DFC | 10 POR = 110

-- ── DELANTEROS CENTRO (20) ────────────────────────────────────
INSERT INTO players (discord_id, nombre, posicion, telefono, eafc_id) VALUES
  ('P_DC_001', 'Lewandowski Bot',  'DC', '600000001', 'LEWABOT01'),
  ('P_DC_002', 'Benzema Bot',      'DC', '600000002', 'BENZEBOT2'),
  ('P_DC_003', 'Haaland Bot',      'DC', '600000003', 'HAALBOT03'),
  ('P_DC_004', 'Kane Bot',         'DC', '600000004', 'KANEBOT04'),
  ('P_DC_005', 'Mbappe Bot',       'DC', '600000005', 'MBAPBOT05'),
  ('P_DC_006', 'Osimhen Bot',      'DC', '600000006', 'OSIMBOT06'),
  ('P_DC_007', 'Vlahovic Bot',     'DC', '600000007', 'VLAHBOT07'),
  ('P_DC_008', 'Darwin Bot',       'DC', '600000008', 'DARWBOT08'),
  ('P_DC_009', 'Lukaku Bot',       'DC', '600000009', 'LUKBOT009'),
  ('P_DC_010', 'Giroud Bot',       'DC', '600000010', 'GIRBOT010'),
  ('P_DC_011', 'Firmino Bot',      'DC', '600000011', 'FIRMBOT11'),
  ('P_DC_012', 'Lautaro Bot',      'DC', '600000012', 'LAUTBOT12'),
  ('P_DC_013', 'Morata Bot',       'DC', '600000013', 'MORBOT013'),
  ('P_DC_014', 'Dovbyk Bot',       'DC', '600000014', 'DOVBBOT14'),
  ('P_DC_015', 'Immobile Bot',     'DC', '600000015', 'IMMOBOT15'),
  ('P_DC_016', 'Werner Bot',       'DC', '600000016', 'WERNBOT16'),
  ('P_DC_017', 'Isak Bot',         'DC', '600000017', 'ISAKBOT17'),
  ('P_DC_018', 'Sorloth Bot',      'DC', '600000018', 'SORLBOT18'),
  ('P_DC_019', 'Dembele Bot',      'DC', '600000019', 'DEMBOT019'),
  ('P_DC_020', 'Gnabry Bot',       'DC', '600000020', 'GNABBOT20');

-- ── MEDIOCENTROS (30) ─────────────────────────────────────────
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
  ('P_MC_012', 'Zubimendi Bot',    'MC', '600000112', 'ZUBIBOT12'),
  ('P_MC_013', 'Tchouameni Bot',   'MC', '600000113', 'TCHOBOT13'),
  ('P_MC_014', 'Kovacic Bot',      'MC', '600000114', 'KOVABOT14'),
  ('P_MC_015', 'Fernandes Bot',    'MC', '600000115', 'FERNBOT15'),
  ('P_MC_016', 'Kimmich Bot',      'MC', '600000116', 'KIMMBOT16'),
  ('P_MC_017', 'Rice Bot',         'MC', '600000117', 'RICEBOT17'),
  ('P_MC_018', 'Mac Allister Bot', 'MC', '600000118', 'MACABOT18'),
  ('P_MC_019', 'Gravenberch Bot',  'MC', '600000119', 'GRAVBOT19'),
  ('P_MC_020', 'Guler Bot',        'MC', '600000120', 'GULERBOT20'),
  ('P_MC_021', 'Reijnders Bot',    'MC', '600000121', 'REIJBOT21'),
  ('P_MC_022', 'Wirtz Bot',        'MC', '600000122', 'WIRTBOT22'),
  ('P_MC_023', 'Musiala Bot',      'MC', '600000123', 'MUSIBOT23'),
  ('P_MC_024', 'Nkunku Bot',       'MC', '600000124', 'NKUNBOT24'),
  ('P_MC_025', 'Saka Bot',         'MC', '600000125', 'SAKABOT25'),
  ('P_MC_026', 'Palmer Bot',       'MC', '600000126', 'PALMBOT26'),
  ('P_MC_027', 'Odegaard Bot',     'MC', '600000127', 'ODEABOT27'),
  ('P_MC_028', 'Olmo Bot',         'MC', '600000128', 'OLMOBOT28'),
  ('P_MC_029', 'Diaz Bot',         'MC', '600000129', 'DIAZBOT29'),
  ('P_MC_030', 'Yamal Bot',        'MC', '600000130', 'YAMALBOT30');

-- ── CARRILEROS (20) ───────────────────────────────────────────
INSERT INTO players (discord_id, nombre, posicion, telefono, eafc_id) VALUES
  ('P_CA_001', 'Cancelo Bot',      'CARR', '600000201', 'CANCBOT01'),
  ('P_CA_002', 'Alexander Bot',    'CARR', '600000202', 'ALEXBOT02'),
  ('P_CA_003', 'Theo Bot',         'CARR', '600000203', 'THEOBOT03'),
  ('P_CA_004', 'Cucurella Bot',    'CARR', '600000204', 'CUCUBOT04'),
  ('P_CA_005', 'Mendy Bot',        'CARR', '600000205', 'MENDBOT05'),
  ('P_CA_006', 'Hakimi Bot',       'CARR', '600000206', 'HAKIBOT06'),
  ('P_CA_007', 'Trent Bot',        'CARR', '600000207', 'TRENBOT07'),
  ('P_CA_008', 'Grimaldo Bot',     'CARR', '600000208', 'GRIMBOT08'),
  ('P_CA_009', 'Dest Bot',         'CARR', '600000209', 'DESTBOT09'),
  ('P_CA_010', 'Dodo Bot',         'CARR', '600000210', 'DODOBOT10'),
  ('P_CA_011', 'Pedro Porro Bot',  'CARR', '600000211', 'PORRBOT11'),
  ('P_CA_012', 'Frimpong Bot',     'CARR', '600000212', 'FRIMBOT12'),
  ('P_CA_013', 'Maatsen Bot',      'CARR', '600000213', 'MAABOT013'),
  ('P_CA_014', 'Ben Yedder Bot',   'CARR', '600000214', 'BENYBOT14'),
  ('P_CA_015', 'Araujo Bot',       'CARR', '600000215', 'ARAUJBOT5'),
  ('P_CA_016', 'Trippier Bot',     'CARR', '600000216', 'TRIPBOT16'),
  ('P_CA_017', 'Dumfries Bot',     'CARR', '600000217', 'DUMFBOT17'),
  ('P_CA_018', 'Castagne Bot',     'CARR', '600000218', 'CASTAGBOT8'),
  ('P_CA_019', 'Henrichs Bot',     'CARR', '600000219', 'HENRBOT19'),
  ('P_CA_020', 'Mazzocchi Bot',    'CARR', '600000220', 'MAZZBOT20');

-- ── DEFENSAS CENTRALES (30) ───────────────────────────────────
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
  ('P_DF_012', 'Timber Bot',       'DFC', '600000312', 'TIMBOT012'),
  ('P_DF_013', 'Dias Bot',         'DFC', '600000313', 'DIASBOT13'),
  ('P_DF_014', 'Upamecano Bot',    'DFC', '600000314', 'UPABOT014'),
  ('P_DF_015', 'Bremer Bot',       'DFC', '600000315', 'BREBOT015'),
  ('P_DF_016', 'Carvajal Bot',     'DFC', '600000316', 'CARVBOT16'),
  ('P_DF_017', 'Acerbi Bot',       'DFC', '600000317', 'ACEBOT017'),
  ('P_DF_018', 'Pavard Bot',       'DFC', '600000318', 'PAVABOT18'),
  ('P_DF_019', 'Kounde Bot',       'DFC', '600000319', 'KOUNBOT19'),
  ('P_DF_020', 'White Bot',        'DFC', '600000320', 'WHITBOT20'),
  ('P_DF_021', 'Tomori Bot',       'DFC', '600000321', 'TOMORBOT1'),
  ('P_DF_022', 'Lovren Bot',       'DFC', '600000322', 'LOVREBOT2'),
  ('P_DF_023', 'Diallo Bot',       'DFC', '600000323', 'DIALBOT23'),
  ('P_DF_024', 'Danso Bot',        'DFC', '600000324', 'DANSBOT24'),
  ('P_DF_025', 'Le Normand Bot',   'DFC', '600000325', 'LENORBOT5'),
  ('P_DF_026', 'Scalvini Bot',     'DFC', '600000326', 'SCALBOT26'),
  ('P_DF_027', 'Quenda Bot',       'DFC', '600000327', 'QUEBOT027'),
  ('P_DF_028', 'Vallejo Bot',      'DFC', '600000328', 'VALLBOT28'),
  ('P_DF_029', 'Hummels Bot',      'DFC', '600000329', 'HUMMBOT29'),
  ('P_DF_030', 'Boateng Bot',      'DFC', '600000330', 'BOATBOT30');

-- ── PORTEROS (10) ─────────────────────────────────────────────
INSERT INTO players (discord_id, nombre, posicion, telefono, eafc_id) VALUES
  ('P_PO_001', 'Courtois Bot',     'POR', '600000401', 'COURBOT01'),
  ('P_PO_002', 'Alisson Bot',      'POR', '600000402', 'ALIBOT002'),
  ('P_PO_003', 'Ter Stegen Bot',   'POR', '600000403', 'TERSSBOT3'),
  ('P_PO_004', 'Ederson Bot',      'POR', '600000404', 'EDERBOT04'),
  ('P_PO_005', 'Oblak Bot',        'POR', '600000405', 'OBLAKBOT5'),
  ('P_PO_006', 'Onana Bot',        'POR', '600000406', 'ONANBOT06'),
  ('P_PO_007', 'Flekken Bot',      'POR', '600000407', 'FLEKBOT07'),
  ('P_PO_008', 'Raya Bot',         'POR', '600000408', 'RAYABOT08'),
  ('P_PO_009', 'Vlachodimos Bot',  'POR', '600000409', 'VLACBOT09'),
  ('P_PO_010', 'Szczesny Bot',     'POR', '600000410', 'SZCZBOT10');

-- ── VERIFICAR ─────────────────────────────────────────────────
SELECT '=== JUGADORES POR POSICION ===' as info;
SELECT posicion, COUNT(*) as total FROM players GROUP BY posicion ORDER BY posicion;
SELECT '=== EQUIPOS ===' as info;
SELECT capitan_username, nombre_equipo FROM teams;
SELECT '=== TOTAL ===' as info;
SELECT COUNT(*) as total_jugadores FROM players;
