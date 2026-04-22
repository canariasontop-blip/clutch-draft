/**
 * bot/bot.js — Clutch Draft
 * FIXES:
 *  - Canales de partido: robustos ante IDs de bots (no crashean)
 *  - limpiarTorneo limpia también CANAL_FICHAJES y CANAL_EQUIPOS_IDS
 *  - Comando !limpiar para admins
 *  - Notificación web (socket) al limpiar torneo
 *  - Canal clasificación se actualiza en cada resultado
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const axios = require('axios');
const cron  = require('node-cron');
const fs    = require('fs');
const {
    Client, GatewayIntentBits,
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
    EmbedBuilder, ModalBuilder,
    TextInputBuilder, TextInputStyle,
    StringSelectMenuBuilder,
    PermissionFlagsBits,
    AttachmentBuilder
} = require('discord.js');

const db = require('../database/db');
const express = require('express');
const botApp  = express();
botApp.use(express.json());

// ─────────────────────────────────────────────
// WEBHOOK STREAMS
// ─────────────────────────────────────────────
botApp.post('/api/stream-live', async (req, res) => {
    const { title, game, url } = req.body;
    try {
        const canal = await client.channels.fetch(CANAL_STREAMS_ID);
        const embed = new EmbedBuilder()
            .setTitle('🔴 EN DIRECTO EN TWITCH')
            .setDescription(`**${title || 'Estoy en directo!'}**`)
            .addFields(
                { name: '🎮 Juego', value: game || 'Desconocido', inline: true },
                { name: '🔗 Ver directo', value: url, inline: false }
            )
            .setColor(0x9146FF)
            .setTimestamp();
        await canal.send({ embeds: [embed] });
        res.json({ ok: true });
    } catch (e) {
        console.error('Error webhook stream:', e.message);
        res.status(500).json({ error: 'Error enviando stream' });
    }
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences
    ]
});

const POSICIONES   = ['DC', 'CARR', 'MC', 'DFC', 'POR'];
const COLORES_POS  = { DC: 0x00ffcc, CARR: 0xffcc00, MC: 0xa066ff, DFC: 0xff4d4d, POR: 0x3399ff };
const LIMITES      = { DC: 2, MC: 3, CARR: 2, DFC: 3, POR: 1 };
const IMAGENES_POS = {
    DC:   ['https://cdn.discordapp.com/attachments/1256961086792405145/1490042175646601388/isagi_yoichi.jpg?ex=69d88c2a&is=69d73aaa&hm=017198b377f0e9eebdd96102a4eba2f6a40d212d16381b994e1dbdb3f0ba78ab&.png', 'https://cdn.discordapp.com/attachments/1256961086792405145/1490041899740954895/rin_itoshi.jpg?ex=69d88be8&is=69d73a68&hm=50748578649e5d6155d2d98a1e19860644b298a25377b68a0e6a0f214b18a403&.png'],
    CARR: ['https://cdn.discordapp.com/attachments/1256961086792405145/1490039843957248180/chiguiri.jpg?ex=69d889fe&is=69d7387e&hm=c526f30f635a5b1d0b2ecbdb45bffdfd9d56b12a4ee96b42eb0968c50484acec&.png', 'https://cdn.discordapp.com/attachments/1256961086792405145/1490039672322134086/bachira.jpg?ex=69d889d5&is=69d73855&hm=e58ddfb2c72347d4c7072f02c4926964f870e3b7440d872e36793d93864c48ba&.png'],
    MC:   ['https://cdn.discordapp.com/attachments/1256961086792405145/1490041489328177172/reo_mikage.jpg?ex=69d88b86&is=69d73a06&hm=d2964dc079a0546bf87ebb070bf129f915e86fc2d977501ddf4cef7a22a3dfbe&.png', 'https://cdn.discordapp.com/attachments/1256961086792405145/1490040944643543301/sae_itoshi.jpg?ex=69d88b04&is=69d73984&hm=f8524b67afa75ff27736aae70e86531ca69f5309efde8378f493f643b905a217&.png', 'https://cdn.discordapp.com/attachments/1256961086792405145/1490040542082498570/karasu.jpg?ex=69d88aa4&is=69d73924&hm=3f0445ac896b214cfde94c8158d0031adb1d9860639937af69896fe17e534a10&.png'],
    DFC:  ['https://cdn.discordapp.com/attachments/1256961086792405145/1491786145820840079/niko_ikki.jpg?ex=69d8f59d&is=69d7a41d&hm=df7c802549de950c1658301aaadd9e1667f34fe059e29d8bc65720043b8009c2&.png', 'https://cdn.discordapp.com/attachments/1256961086792405145/1491786145481232648/don_lorenzo.jpg?ex=69d8f59d&is=69d7a41d&hm=580872b0c22360d6ab437cd0c88450094d417c9f05009171bf09625f18db93d7&.png', 'https://cdn.discordapp.com/attachments/1256961086792405145/1490038644478705834/aiku.jpg?ex=69d888e0&is=69d73760&hm=334be670061d37d473395951dd74deff6e573efa445aeeab2589ac89dc21a33c&.png'],
    POR:  ['https://cdn.discordapp.com/attachments/1256961086792405145/1490038169738022953/gagamaru.jpg?ex=69d8886f&is=69d736ef&hm=2ea741ba4157868e978ff202d7304e812406029f938a92c3dc5d6ea42b1c956e&.png'],
};
const contadorImagenes = { DC: 0, CARR: 0, MC: 0, DFC: 0, POR: 0 };

const CANAL_FICHAJES      = '1489289144399040634';
const CANAL_EQUIPOS_IDS   = '1489289270488207502';
const ROL_ADMIN_DISCORD   = '1489294592271712477'; // 🧠 STAFF [👑 Admin]
const CANAL_BIENVENIDA_ID = '1492509518679113930';
const CANAL_STREAMS_ID    = '1492704039656358073';
const ID_DISCORD_BAROU    = '1255657744388722731';
const ID_DISCORD_Z3US     = '649388427023876116';
const CANAL_ANUNCIOS      = '1489295624733069352';
const CANAL_ANUNCIOS_GRAL = '1489288832921637014';
const CANAL_CALENDARIO    = '1489289235189207070';
const CANAL_CLASIFICACION = '1494496104723648602';
const CATEGORIA_PARTIDOS  = '1489289188099620966';
const ROL_JUGADOR         = '1489295627153051728';
const ROL_CAPITAN         = '1489295091498745957';
const PAYPAL_LINK         = 'https://paypal.me/Mizrraiim';
const ADMIN_ID            = process.env.ADMIN_ID;
const CATEGORIA_ID        = '1489288382289805445';
const CANAL_PANEL_ADMIN   = '1494351892409483355';
const CANAL_NORMATIVA     = '1489288889305792673';
const CANAL_INSCRIPCIONES = '1489288999250952476';
const CATEGORIA_DRAFT     = '1489289040992927815';

// ── Estado en memoria ────────────────────────────────────────
const canalesPartido    = {}; // matchId → channelId
const reportesPendientes= {}; // matchId → { cap1: {g1,g2}, cap2: {g1,g2} }
const votosPrecios      = { '10': new Set(), '15': new Set(), '20': new Set() };
const candidatosCapitan = new Set();
let msgVotoPrecio  = null;
let msgVotoCapitan = null;
let slotsCapitan   = 0;
let canalesVoz     = [];

// ── URL base de la web ───────────────────────────────────────
function webUrl(ruta = '') {
    const base = (process.env.WEB_URL || 'http://localhost:3000').replace(/\/$/, '');
    return base + ruta;
}

// ── Botón de enlace a la web ─────────────────────────────────
function botonWeb(label, ruta, emoji = '🌐') {
    return new ButtonBuilder()
        .setLabel(`${emoji}  ${label}`)
        .setStyle(ButtonStyle.Link)
        .setURL(webUrl(ruta));
}

// ── Avisar a la web ──────────────────────────────────────────
const WEB = process.env.WEB_URL || 'http://localhost:3000';
async function refrescarWeb() {
    try { await axios.post(`${WEB}/api/nuevo-jugador`); } catch { /* ignorar */ }
}

async function notificarInscripcion(discord_id, nombre, eafc_id, posicion) {
    try { await axios.post(`${WEB}/api/nuevo-jugador-completo`, { discord_id, nombre, eafc_id, posicion }); } catch { /* ignorar */ }
    actualizarPanelDiscord().catch(() => {});
    // Actualizar lista-draft y jugadores-inscritos (gratuito) en Discord
    try { await axios.post('http://localhost:3001/api/actualizar-lista-draft'); } catch { /* ignorar */ }
    axios.post('http://localhost:3001/api/actualizar-jugadores-inscritos').catch(() => {});
}
async function notificarInscripciones(estado) {
    try { await axios.post(`${WEB}/api/bot/inscripciones-${estado}`); } catch { /* ignorar */ }
}
async function notificarPrecio(precio) {
    try { await axios.post(`${WEB}/api/bot/precio-torneo`, { precio }); } catch { /* ignorar */ }
}
async function notificarTorneoGenerado() {
    try { await axios.post(`${WEB}/api/bot/torneo-generado`); } catch { /* ignorar */ }
}
async function notificarDatosActualizados(msg) {
    try { await axios.post(`${WEB}/api/bot/datos-actualizados`, { msg }); } catch { /* ignorar */ }
}

// ── Comprobar si un usuario es admin (superadmin | DB | rol Discord) ──
async function esAdminDiscord(userId) {
    if (userId === ADMIN_ID) return true;
    if (db.prepare('SELECT id FROM admins WHERE discord_id=?').get(userId)) return true;
    try {
        const guild = client.guilds.cache.first();
        if (!guild) return false;
        const member = await guild.members.fetch(userId);
        return member.roles.cache.has(ROL_ADMIN_DISCORD);
    } catch { return false; }
}

function contarPorPosicion() {
    const conteo = {};
    for (const pos of POSICIONES) {
        const row = db.prepare(`SELECT COUNT(*) as c FROM players WHERE posicion=? AND equipo IS NULL`).get(pos);
        conteo[pos] = row?.c || 0;
    }
    return conteo;
}

async function actualizarPanelDiscord() {
    try {
        const chId  = db.prepare(`SELECT value FROM settings WHERE key='panel_ch_id'`).get()?.value;
        const msgId = db.prepare(`SELECT value FROM settings WHERE key='panel_msg_id'`).get()?.value;
        if (!chId || !msgId) return; // panel no publicado todavía
        const ch = await client.channels.fetch(chId);
        try {
            const msg = await ch.messages.fetch(msgId);
            await msg.edit({ embeds: [buildPanelEmbed()], components: buildPanelRows() });
        } catch (editErr) {
            // Si el mensaje ya no existe, publicar uno nuevo y guardar el ID
            console.warn('[panel] Mensaje anterior no encontrado, publicando nuevo:', editErr.message);
            const nuevo = await ch.send({ embeds: [buildPanelEmbed()], components: buildPanelRows() });
            db.prepare(`UPDATE settings SET value=? WHERE key='panel_msg_id'`).run(nuevo.id);
        }
    } catch(e) {
        console.error('[panel] Error actualizando panel Discord:', e.message);
    }
}

function buildPanelEmbed() {
    const conteo   = contarPorPosicion();
    const total    = db.prepare(`SELECT COUNT(*) as c FROM players`).get()?.c || 0;
    const horario       = db.prepare(`SELECT value FROM settings WHERE key='horario_torneo'`).get()?.value || '';
    const fechaDraft    = db.prepare(`SELECT value FROM settings WHERE key='fecha_draft'`).get()?.value || '';
    const fechaLimite   = db.prepare(`SELECT value FROM settings WHERE key='fecha_limite_inscripciones'`).get()?.value || '';

    const MAX_EQUIPOS = 10;
    const iconPos  = { DC: '🟢', CARR: '🟡', MC: '🟣', DFC: '🔴', POR: '🔵' };
    const conteoTxt = POSICIONES.map(p => {
        const max = LIMITES[p] * MAX_EQUIPOS;
        return `${iconPos[p]} **${p}** — ${conteo[p]}/${max}`;
    }).join('\n');

    const fields = [
        {
            name: '📊 __Jugadores por posición__',
            value: conteoTxt,
            inline: true
        },
        {
            name: `👥 __Total inscritos__`,
            value: `**${total}** jugador${total !== 1 ? 'es' : ''}`,
            inline: true
        }
    ];

    if (horario) {
        fields.push({
            name: '📅 __Horario__',
            value: horario,
            inline: false
        });
    }
    if (fechaLimite) {
        fields.push({
            name: '⏰ __Fecha límite inscripciones__',
            value: fechaLimite,
            inline: false
        });
    }
    if (fechaDraft) {
        fields.push({
            name: '📆 __Fecha del draft__',
            value: fechaDraft,
            inline: false
        });
    }

    return new EmbedBuilder()
        .setTitle('🏆 CLUTCH DRAFT — INSCRIPCIONES ABIERTAS')
        .setDescription(
            '### ¡El draft más competitivo está de vuelta!\n' +
            '> Elige tu **posición** pulsando uno de los botones de abajo y forma parte del próximo torneo.\n\n' +
            '```\n⚠️  Las plazas son limitadas — ¡no te quedes fuera!\n```'
        )
        .setColor(0x00ffcc)
        .addFields(...fields)
        .setImage('https://clutch-draft.duckdns.org/inscripciones.gif')
        .setFooter({ text: 'Clutch Draft System · Usa los botones para inscribirte' })
        .setTimestamp();
}

function buildPanelRows() {
    const colores = { DC: ButtonStyle.Primary, CARR: ButtonStyle.Success, MC: ButtonStyle.Secondary, DFC: ButtonStyle.Danger, POR: ButtonStyle.Primary };
    const row1 = new ActionRowBuilder().addComponents(
        ...POSICIONES.map(pos => new ButtonBuilder().setCustomId(`join_${pos}`).setLabel(pos).setStyle(colores[pos] || ButtonStyle.Secondary))
    );
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('leave_draft').setLabel('❌ Salirse del draft').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('ver_inscripcion').setLabel('🔍 Ver mi inscripción').setStyle(ButtonStyle.Secondary)
    );
    return [row1, row2];
}

// ══════════════════════════════════════════════════════════════
//  FICHAJE — embed en Discord
// ══════════════════════════════════════════════════════════════
async function enviarFichaje(capitan, jugador, discord, posicion, telefono) {
    try {
        const canal = await client.channels.fetch(CANAL_FICHAJES);
        const hora  = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        const idx   = contadorImagenes[posicion] % IMAGENES_POS[posicion].length;
        contadorImagenes[posicion]++;
        const embed = new EmbedBuilder()
            .setTitle('⚡ FICHAJE CONFIRMADO')
            .setColor(COLORES_POS[posicion] || 0x00ffcc)
            .addFields(
                { name: '👑 Capitán',    value: capitan,                    inline: true },
                { name: '🎮 EA FC ID',  value: jugador,                    inline: true },
                { name: '📌 Posición',  value: posicion,                   inline: true },
                { name: '💬 Discord',   value: discord || jugador,          inline: true },
                { name: '📱 Teléfono',  value: telefono || 'No disponible', inline: true },
                { name: '🕐 Hora',      value: hora,                       inline: true }
            )
            .setImage(IMAGENES_POS[posicion][idx])
            .setFooter({ text: 'Clutch Draft System' })
            .setTimestamp();
        await canal.send({ embeds: [embed] });
    } catch(e) {
        console.error('Error enviando fichaje:', e.message);
    }
}

// ══════════════════════════════════════════════════════════════
//  FASE 2 — INSCRIPCIONES, PRECIO, CAPITANES
// ══════════════════════════════════════════════════════════════
function calcularEquiposMaximos() {
    const conteo = {};
    for (const pos of POSICIONES) {
        const row = db.prepare(`SELECT COUNT(*) as c FROM players WHERE posicion=?`).get(pos);
        conteo[pos] = row?.c || 0;
    }
    return Math.min(
        10,
        Math.floor(conteo['DC']   / LIMITES['DC']),
        Math.floor(conteo['MC']   / LIMITES['MC']),
        Math.floor(conteo['CARR'] / LIMITES['CARR']),
        Math.floor(conteo['DFC']  / LIMITES['DFC']),
        Math.floor(conteo['POR']  / LIMITES['POR'])
    );
}

function formatoTorneo(n) {
    if (n <= 0)  return '❌ No hay suficientes jugadores.';
    if (n === 4) return '🏆 Liga todos vs todos — solo ida';
    if (n <= 6)  return '⚡ Relámpago — 2 grupos + final';
    if (n <= 8)  return '🏆 Liga todos vs todos — solo ida';
    if (n <= 12) return '🥊 2 Grupos + Semifinal + Final';
    return '🎯 3-4 Grupos + Playoff completo';
}

// ── Crear canales privados de pre-draft (solo ROL_JUGADOR) ────
async function crearCanalesPreDraft(guild) {
    const permsBase = [
        { id: guild.id,            deny:  [PermissionFlagsBits.ViewChannel] },
        { id: ROL_JUGADOR,         allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
                                   deny:  [PermissionFlagsBits.SendMessages] },
        { id: ROL_ADMIN_DISCORD,   allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
                                           PermissionFlagsBits.ReadMessageHistory] },
        { id: client.user.id,      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
                                           PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory,
                                           PermissionFlagsBits.EmbedLinks] }
    ];
    if (ADMIN_ID) permsBase.push({
        id:    ADMIN_ID,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
    });

    const defs = [
        { key: 'canal_votacion_precio', nombre: '🗳️-votacion-precio' },
        { key: 'canal_pagos',           nombre: '💳-pagos'            },
    ];
    const resultado = {};
    for (const def of defs) {
        try {
            const existId = db.prepare("SELECT value FROM settings WHERE key=?").get(def.key)?.value;
            if (existId) {
                try {
                    const ch = await guild.channels.fetch(existId);
                    await borrarMensajesCanal(ch);
                    resultado[def.key] = ch;
                    continue;
                } catch(e) { /* no existe, crear nuevo */ }
            }
            const ch = await guild.channels.create({
                name:                 def.nombre,
                type:                 0,
                parent:               CATEGORIA_DRAFT,
                permissionOverwrites: permsBase
            });
            db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run(def.key, ch.id);
            resultado[def.key] = ch;
            console.log(`✅ Canal pre-draft creado: ${def.nombre}`);
        } catch(e) {
            console.error(`Error creando canal ${def.nombre}:`, e.message);
        }
    }
    return resultado;
}

// ── Publicar formatos de competición en canal dedicado ────────
async function publicarFormatos(guild) {
    const existId = db.prepare("SELECT value FROM settings WHERE key='canal_formatos'").get()?.value;
    let ch;
    if (existId) {
        try {
            ch = await guild.channels.fetch(existId);
            await borrarMensajesCanal(ch);
        } catch(e) { ch = null; }
    }
    if (!ch) {
        ch = await guild.channels.create({
            name:   '📋-formatos',
            type:   0,
            parent: CATEGORIA_DRAFT,
            permissionOverwrites: [
                { id: guild.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
                                deny:  [PermissionFlagsBits.SendMessages] },
                { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
                                              PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory] }
            ]
        });
        db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('canal_formatos',?)").run(ch.id);
    }

    await ch.send({ embeds: [new EmbedBuilder()
        .setColor(0x00ffcc)
        .setTitle('🏆  FORMATOS DE COMPETICIÓN')
        .setDescription('El formato se determina automáticamente según el número de equipos inscritos.')
        .setFooter({ text: 'Clutch Draft · Sistema Swiss de emparejamientos' })] });

    await ch.send({ embeds: [new EmbedBuilder().setColor(0xa066ff).setTitle('⚡  COPA — ELIMINATORIAS · 4 Equipos')
        .addFields(
            { name: '🎯 Semifinales — Ida y Vuelta (Jornadas 1 y 2)', value: '▸ **Llave A:** Equipo 1 vs Equipo 4\n▸ **Llave B:** Equipo 2 vs Equipo 3\n▸ Jornada 1 → partidos de **ida**\n▸ Jornada 2 → partidos de **vuelta** (campos invertidos)\n▸ Pasa quien tenga mejor **global** (suma de los 2 partidos)\n▸ Empate en global → **3er partido a gol de oro** (el primero en marcar pasa)' },
            { name: '🏆 Final — Partido Único (Jornada 3)', value: '▸ Los dos ganadores de semifinales se enfrentan en **un solo partido**\n▸ Empate al 90' → **prórroga** · Si persiste → **penaltis**' },
            { name: '🏅 Resultado Final', value: '🥇 **1º** — Campeón\n🥈 **2º** — Subcampeón\n▪️ **3º–4º** — Eliminados en semifinales' }
        )] });

    await ch.send({ embeds: [new EmbedBuilder().setColor(0xf0c040).setTitle('✂️  CHAMPIONS CORTE DIRECTO — 6 Equipos')
        .addFields(
            { name: '📋 Fase de Liga — 3 o 4 Jornadas', value: '▸ Todos en **una sola tabla**. Sin grupos separados.\n▸ Emparejamientos Swiss: rivales de nivel similar.\n▸ **El Corte:** solo los *4 primeros* siguen compitiendo.\n▸ 5º y 6º quedan eliminados al terminar la liga.' },
            { name: '⚡ Fase Final', value: '▸ **Semi 1:** 1º vs 4º\n▸ **Semi 2:** 2º vs 3º\n▸ **Gran Final:** Ganador S1 vs Ganador S2', inline: true },
            { name: '📊 Corte', value: '🟢 **1º–4º** → Semis\n🔴 **5º–6º** → Eliminados en liga', inline: true }
        )] });

    await ch.send({ embeds: [new EmbedBuilder().setColor(0x3399ff).setTitle('⭐  NUEVO FORMATO CHAMPIONS — 8 Equipos')
        .addFields(
            { name: '📋 Fase de Liga — 3 Jornadas', value: '▸ Todos en una tabla única. Sin grupos.\n▸ **3 partidos** por equipo contra rivales distintos.\n▸ Sistema Swiss: los primeros vs primeros, últimos entre sí.\n▸ Top 2 se **saltan los cuartos** directamente a semis.' },
            { name: '📊 Clasificación', value: '🟢 **1º–2º** → Directo a **Semis**\n🟡 **3º–6º** → **Cuartos** (Play-offs)\n🔴 **7º–8º** → Eliminados', inline: true },
            { name: '⚡ Cuadro Final', value: '▸ Cuartos: 3º vs 6º · 4º vs 5º\n▸ Semis: 1º vs G.Cuarto · 2º vs G.Cuarto\n▸ **Final**', inline: true }
        )] });

    await ch.send({ embeds: [new EmbedBuilder().setColor(0x00ffcc).setTitle('🛡️  FORMATO CHAMPIONS — 10 Equipos')
        .addFields(
            { name: '📋 Fase de Liga — 3 Jornadas', value: '▸ Todos en **una tabla general única**.\n▸ 3 partidos por equipo, emparejados por Swiss.\n▸ Rivales cambian cada jornada según posición en tabla.\n▸ **Premio top 2:** clasifican directo a Semis sin Cuartos.' },
            { name: '📊 Clasificación', value: '🟢 **1º–2º** → Directo a **Semis**\n🟡 **3º–6º** → **Cuartos de Final**\n🔴 **7º–10º** → Eliminados', inline: true },
            { name: '⚡ Cuadro Final', value: '▸ Cuartos: 3º vs 6º · 4º vs 5º\n▸ Semis → **Final**', inline: true }
        )] });

    await ch.send({ embeds: [new EmbedBuilder().setColor(0xff6b6b).setTitle('👑  NUEVO CHAMPIONS MÁXIMO NIVEL — 12 Equipos')
        .addFields(
            { name: '📋 Fase de Liga — 4 Jornadas', value: '▸ Una sola tabla general para **los 12 equipos**.\n▸ 4 partidos por equipo. Cruces por nivel (Swiss).\n▸ Los 2-0 vs 2-0, los 1-1 entre sí, etc. Siempre competitivo.\n▸ Solo los **4 primeros** clasifican directo a Cuartos.' },
            { name: '📊 Clasificación — 3 Niveles', value: '🟢 **1º–4º** → Directo a **Cuartos**\n🟡 **5º–12º** → **Play-offs** (8 luchan por 4 plazas)' },
            { name: '⚡ Fase Eliminatoria', value: '▸ **Play-offs:** 5º vs 12º · 6º vs 11º · 7º vs 10º · 8º vs 9º\n▸ **Cuartos:** 4 ganadores Play-offs vs 4 mejores de liga\n▸ **Semis → Gran Final**' }
        )] });

    await ch.send({ embeds: [new EmbedBuilder().setColor(0xf0c040).setTitle('⚖️  CRITERIOS DE DESEMPATE')
        .setDescription('Se aplican en este orden estricto cuando dos o más equipos empatan en puntos:')
        .addFields({ name: 'Orden de aplicación', value: '**1.** Puntos acumulados\n**2.** Diferencia de goles (GF – GC)\n**3.** Goles a favor (GF)\n**4.** Resultado directo entre los empatados\n**5.** Goles a favor en el partido directo\n**6.** Sorteo (si todo lo anterior sigue igual)' })
        .setFooter({ text: 'El Staff tiene la decisión final en casos excepcionales.' })] });

    return ch;
}

// ── Crear canal público con lista de jugadores para el draft ──
async function publicarListaDraft(guild) {
    const posiciones = [
        { key: 'POR',  label: '🧤 PORTEROS',           color: 0x3399ff },
        { key: 'DFC',  label: '🛡️ DEFENSAS CENTRALES', color: 0xff4d4d },
        { key: 'CARR', label: '🏃 CARRILEROS',          color: 0xffcc00 },
        { key: 'MC',   label: '⚙️ MEDIOCENTROS',        color: 0xa066ff },
        { key: 'DC',   label: '⚡ DELANTEROS',          color: 0x00ffcc },
    ];

    // Reutilizar o crear canal
    const existId = db.prepare("SELECT value FROM settings WHERE key='canal_lista_draft'").get()?.value;
    let ch;
    if (existId) {
        try {
            ch = await guild.channels.fetch(existId);
            await borrarMensajesCanal(ch);
        } catch(e) { ch = null; }
    }
    if (!ch) {
        ch = await guild.channels.create({
            name:   '📋-lista-draft',
            type:   0,
            parent: CATEGORIA_DRAFT,
            permissionOverwrites: [
                { id: guild.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
                                deny:  [PermissionFlagsBits.SendMessages] },
                { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
                                              PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory] }
            ]
        });
        db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('canal_lista_draft',?)").run(ch.id);
    }

    const total = db.prepare("SELECT COUNT(*) as c FROM players").get()?.c || 0;
    await ch.send({ embeds: [new EmbedBuilder()
        .setTitle('📋 JUGADORES INSCRITOS PARA EL DRAFT')
        .setColor(0x00ffcc)
        .setDescription(`**${total} jugadores** confirmados para el draft.\nListado completo por posición:`)
        .setTimestamp()] });

    for (const pos of posiciones) {
        const jugadores = db.prepare("SELECT nombre, eafc_id, discord_id, telefono FROM players WHERE posicion=? ORDER BY nombre").all(pos.key);
        if (!jugadores.length) continue;
        const lista = jugadores.map((j, i) => {
            const mention = /^\d{17,19}$/.test(j.discord_id) ? `<@${j.discord_id}>` : j.nombre;
            const digits  = (j.telefono || '').replace(/\D/g, '');
            const waNum   = digits.length === 9 ? `34${digits}` : digits.length >= 10 ? digits : null;
            const waLink  = waNum ? ` · [📱 WhatsApp](https://wa.me/${waNum})` : '';
            const display = j.eafc_id || j.nombre;
            return `\`${String(i+1).padStart(2,'0')}\` **${display}** (${mention})${waLink}`;
        }).join('\n');
        await ch.send({ embeds: [new EmbedBuilder()
            .setTitle(`${pos.label} — ${jugadores.length} jugadores`)
            .setColor(pos.color)
            .setDescription(lista.slice(0, 4096))] });
    }
    return ch;
}

// ── Publicar lista de jugadores inscritos por posición ────────
async function publicarJugadoresInscritos(canal) {
    const posiciones = [
        { key: 'POR',  label: '🧤 PORTEROS',            color: 0x3399ff },
        { key: 'DFC',  label: '🛡️ DEFENSAS CENTRALES',  color: 0xff4d4d },
        { key: 'CARR', label: '🏃 CARRILEROS',           color: 0xffcc00 },
        { key: 'MC',   label: '⚙️ MEDIOCENTROS',         color: 0xa066ff },
        { key: 'DC',   label: '⚡ DELANTEROS',           color: 0x00ffcc },
    ];
    const total = db.prepare("SELECT COUNT(*) as c FROM players").get()?.c || 0;
    await canal.send({
        embeds: [new EmbedBuilder()
            .setTitle('👥 JUGADORES INSCRITOS')
            .setColor(0x00ffcc)
            .setDescription(`**${total} jugadores** confirmados para el draft.`)
            .setTimestamp()]
    });
    for (const pos of posiciones) {
        const jugadores = db.prepare("SELECT nombre, discord_id, eafc_id FROM players WHERE posicion=? ORDER BY nombre").all(pos.key);
        if (!jugadores.length) continue;
        const lista = jugadores.map((j, i) => `\`${String(i+1).padStart(2,'0')}\` ${j.eafc_id || j.nombre} — <@${j.discord_id}>`).join('\n');
        await canal.send({
            embeds: [new EmbedBuilder()
                .setTitle(`${pos.label} (${jugadores.length})`)
                .setColor(pos.color)
                .setDescription(lista.slice(0, 4096))]
        });
    }
}

// ── Publicar info detallada de pagos ──────────────────────────
async function publicarInfoPagos(canal) {
    const embedInfo = new EmbedBuilder()
        .setTitle('💳 CÓMO FUNCIONA EL PAGO')
        .setColor(0x3399ff)
        .setDescription('Lee con atención. El pago es **obligatorio** para ser capitán y participar en el draft.')
        .addFields(
            { name: '1️⃣ Precio', value: 'El precio se decide por votación entre todos los jugadores inscritos en el canal **🗳️-votacion-precio**.', inline: false },
            { name: '2️⃣ Método de pago', value: `Transferencia por **PayPal** al siguiente enlace:\n👉 [Pagar por PayPal](${PAYPAL_LINK})\n\nIncluye tu **nombre de Discord** en el concepto.`, inline: false },
            { name: '3️⃣ Confirmar pago', value: 'Una vez hayas pagado, vuelve a este canal y pulsa el botón **✅ He pagado**.\nEl admin revisará el pago y te asignará el rol **Capitán**.', inline: false },
            { name: '4️⃣ Rol Capitán', value: 'Al aprobar tu pago recibirás:\n• El rol 👑 **Capitán**\n• Acceso al **draft** para fichar jugadores\n• Un mensaje privado de confirmación', inline: false },
            { name: '⚠️ Importante', value: '• Solo los capitanes aprobados participan en el draft.\n• Si el admin rechaza tu pago, recibirás un aviso privado.\n• Cualquier duda, contacta directamente con el admin.', inline: false }
        )
        .setFooter({ text: 'Clutch Draft — Sistema de pagos' })
        .setTimestamp();
    await canal.send({ embeds: [embedInfo] });
}

async function anunciarInscripcionesAbiertas(guild) {
    try {
        const canal = await guild.channels.fetch(CANAL_ANUNCIOS_GRAL).catch(() => null);
        if (!canal) return;

        const embed = new EmbedBuilder()
            .setTitle('📝 ¡Las inscripciones están abiertas!')
            .setColor(0x00ffcc)
            .setDescription(
                '¡El próximo torneo **Clutch Draft** ya está en marcha!\n\n' +
                '✅ Dirígete al canal de inscripciones y rellena el formulario.\n' +
                '📋 Necesitarás tu **nombre**, **posición**, **teléfono** y **EA FC ID**.\n\n' +
                '> Las plazas son **limitadas** — ¡no te quedes fuera!'
            )
            .setImage('https://clutch-draft.duckdns.org/inscripciones.gif')
            .setFooter({ text: 'Clutch Draft · Inscripciones' })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('📝 Ir a inscripciones')
                .setStyle(ButtonStyle.Link)
                .setURL(`https://discord.com/channels/${guild.id}/${CANAL_INSCRIPCIONES}`)
        );

        await canal.send({ content: '@everyone', embeds: [embed], components: [row] });
    } catch(e) { console.error('Error anunciando inscripciones:', e.message); }
}

async function cerrarInscripciones() {
    const guild = client.guilds.cache.first();
    if (!guild) { console.error('cerrarInscripciones: guild no encontrado'); return; }

    // 1. Marcar inscripciones como cerradas y draft tipo pago
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('inscripciones_estado', 'cerrado')`).run();
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('draft_tipo', 'pago')`).run();
    notificarInscripciones('cerrar').catch(() => {});

    // 2. Deshabilitar el panel de inscripciones
    try {
        const chId  = db.prepare(`SELECT value FROM settings WHERE key='panel_ch_id'`).get()?.value;
        const msgId = db.prepare(`SELECT value FROM settings WHERE key='panel_msg_id'`).get()?.value;
        if (chId && msgId) {
            const ch  = await client.channels.fetch(chId);
            const msg = await ch.messages.fetch(msgId);
            const rowsDis = buildPanelRows().map(row => { row.components.forEach(btn => btn.setDisabled(true)); return row; });
            await msg.edit({ embeds: [buildPanelEmbed()], components: rowsDis });
        }
    } catch(e) { console.error('Error deshabilitando panel:', e.message); }

    // 3. Calcular equipos
    const totalJugadores = db.prepare(`SELECT COUNT(*) as c FROM players`).get()?.c || 0;
    const equiposMaximos = calcularEquiposMaximos();
    slotsCapitan = equiposMaximos;
    console.log(`cerrarInscripciones: ${totalJugadores} jugadores, ${equiposMaximos} equipos posibles`);

    // 4. Crear los tres canales privados (independiente del canal de anuncios)
    const canales = await crearCanalesPreDraft(guild);

    // 5. Votación de precio
    if (canales.canal_votacion_precio) {
        await lanzarVotacionPrecio(canales.canal_votacion_precio)
            .catch(e => console.error('Error lanzarVotacionPrecio:', e.message));
        const totalCapitanes = db.prepare(`SELECT COUNT(*) as c FROM teams`).get()?.c || 0;
        if (totalCapitanes < equiposMaximos) {
            await lanzarEncuestaCapitan(canales.canal_votacion_precio, equiposMaximos - totalCapitanes)
                .catch(e => console.error('Error lanzarEncuestaCapitan:', e.message));
        }
    }

    // 7. Canal 3: info de pagos
    if (canales.canal_pagos) {
        await publicarInfoPagos(canales.canal_pagos)
            .catch(e => console.error('Error publicarInfoPagos:', e.message));
    }

    // 8. Canal público con lista de jugadores para el draft
    await publicarListaDraft(guild)
        .catch(e => console.error('Error publicarListaDraft:', e.message));

    // 9. Canal público con los formatos de competición
    await publicarFormatos(guild)
        .catch(e => console.error('Error publicarFormatos:', e.message));

    // 9. Anuncio en canal de anuncios (opcional, no bloquea si falla)
    try {
        const canalAnuncios = await guild.channels.fetch(CANAL_ANUNCIOS);
        const embedCierre = new EmbedBuilder()
            .setTitle('🔒 INSCRIPCIONES CERRADAS')
            .setColor(0xff4d4d)
            .setDescription('Las inscripciones han cerrado.')
            .addFields(
                { name: '👥 Total inscritos',   value: `${totalJugadores} jugadores`, inline: true },
                { name: '🏟️ Equipos posibles', value: `${equiposMaximos} equipos`,   inline: true },
                { name: '📋 Formato',           value: formatoTorneo(equiposMaximos), inline: false }
            )
            .setFooter({ text: 'Clutch Draft System' })
            .setTimestamp();
        await canalAnuncios.send({ embeds: [embedCierre] });
        await canalAnuncios.send({
            content: `<@&${ROL_JUGADOR}>`,
            embeds: [new EmbedBuilder()
                .setTitle('📬 Canales privados disponibles')
                .setColor(0xa066ff)
                .setDescription('Se han creado canales exclusivos para jugadores inscritos:\n• 👥 **jugadores-inscritos** — lista completa por posición\n• 🗳️ **votacion-precio** — vota el precio de la capitanía\n• 💳 **pagos** — información y confirmación de pago')]
        });
    } catch(e) { console.warn('Canal de anuncios no accesible (no crítico):', e.message); }

}

async function lanzarVotacionPrecio(canal) {
    votosPrecios['10'].clear(); votosPrecios['15'].clear(); votosPrecios['20'].clear();
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('vote_precio_10').setLabel('10 €').setStyle(ButtonStyle.Secondary).setEmoji('💶'),
        new ButtonBuilder().setCustomId('vote_precio_15').setLabel('15 €').setStyle(ButtonStyle.Primary).setEmoji('💶'),
        new ButtonBuilder().setCustomId('vote_precio_20').setLabel('20 €').setStyle(ButtonStyle.Success).setEmoji('💶'),
    );
    const msg = await canal.send({ content: `<@&${ROL_JUGADOR}> ¡Vota el precio! Tienes **20 minutos**.`, embeds: [buildEmbedVotoPrecio()], components: [row] });
    msgVotoPrecio = msg;
    // Cierre automático desactivado — cerrar manualmente con !admin votacion cerrar
}

function buildEmbedVotoPrecio() {
    const v10 = votosPrecios['10'].size, v15 = votosPrecios['15'].size, v20 = votosPrecios['20'].size;
    const total = v10 + v15 + v20;
    const barra = (v) => {
        if (total === 0) return '░░░░░░░░░░ 0%';
        const pct = Math.round((v / total) * 10);
        return '█'.repeat(pct) + '░'.repeat(10 - pct) + ` ${Math.round((v / total) * 100)}%`;
    };
    return new EmbedBuilder()
        .setTitle('💰 VOTACIÓN — PRECIO DEL TORNEO')
        .setColor(0xffcc00)
        .setDescription('Solo jugadores inscritos pueden votar.')
        .addFields(
            { name: '💶 10 €', value: `${barra(v10)} (${v10} votos)`, inline: false },
            { name: '💶 15 €', value: `${barra(v15)} (${v15} votos)`, inline: false },
            { name: '💶 20 €', value: `${barra(v20)} (${v20} votos)`, inline: false },
            { name: '📊 Total', value: `${total}`, inline: true }
        )
        .setFooter({ text: '20 minutos · Clutch Draft' })
        .setTimestamp();
}

async function cerrarVotacionPrecio(canal) {
    const v10 = votosPrecios['10'].size, v15 = votosPrecios['15'].size, v20 = votosPrecios['20'].size;
    let ganador = '10';
    if (v15 >= v10 && v15 >= v20) ganador = '15';
    if (v20 > v15 && v20 > v10)  ganador = '20';
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('precio_torneo', ?)`).run(ganador);
    notificarPrecio(ganador).catch(() => {});
    if (msgVotoPrecio) {
        try {
            const rowDis = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('vote_precio_10').setLabel('10 €').setStyle(ButtonStyle.Secondary).setEmoji('💶').setDisabled(true),
                new ButtonBuilder().setCustomId('vote_precio_15').setLabel('15 €').setStyle(ButtonStyle.Primary).setEmoji('💶').setDisabled(true),
                new ButtonBuilder().setCustomId('vote_precio_20').setLabel('20 €').setStyle(ButtonStyle.Success).setEmoji('💶').setDisabled(true),
            );
            await msgVotoPrecio.edit({ components: [rowDis] });
        } catch(e) { /* ignorar */ }
    }
    const embedR = new EmbedBuilder()
        .setTitle('✅ RESULTADO — PRECIO DEL TORNEO')
        .setColor(0x00ffcc)
        .addFields(
            { name: '🏆 Precio decidido', value: `**${ganador} €** por equipo`, inline: true },
            { name: '💳 PayPal', value: `[Pagar aquí](${PAYPAL_LINK})`, inline: true },
            { name: '📊 Votos', value: `10€: ${v10} | 15€: ${v15} | 20€: ${v20}`, inline: false }
        )
        .setTimestamp();
    await canal.send({ embeds: [embedR] });

    // El panel de pago va al canal dedicado 💳-pagos (si existe), si no al mismo canal
    try {
        const canalPagosId = db.prepare("SELECT value FROM settings WHERE key='canal_pagos'").get()?.value;
        const canalPagos   = canalPagosId ? await canal.client.channels.fetch(canalPagosId).catch(() => null) : null;
        await lanzarPanelPago(canalPagos || canal, ganador);
    } catch(e) {
        await lanzarPanelPago(canal, ganador);
    }
}

async function lanzarPanelPago(canal, precio) {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirmar_pago').setLabel('✅ He pagado').setStyle(ButtonStyle.Success)
    );
    const embed = new EmbedBuilder()
        .setTitle('💳 CONFIRMACIÓN DE PAGO')
        .setColor(0x3399ff)
        .setDescription(`Capitanes: pagad **${precio} €** vía PayPal y luego pulsad el botón.\n[👉 Pagar por PayPal](${PAYPAL_LINK})`)
        .setTimestamp();
    await canal.send({ embeds: [embed], components: [row] });
}

async function lanzarCapitaniaDoble(guild) {
    const canalPagosId = db.prepare("SELECT value FROM settings WHERE key='canal_pagos'").get()?.value;
    if (!canalPagosId) return { ok: false, error: 'Canal de pagos no creado. Cierra inscripciones primero.' };
    const canal = await guild.channels.fetch(canalPagosId).catch(() => null);
    if (!canal) return { ok: false, error: 'No se encontró el canal 💳-pagos.' };

    const precio = db.prepare("SELECT value FROM settings WHERE key='precio_torneo'").get()?.value || '?';

    const embed = new EmbedBuilder()
        .setTitle('👥 CAPITANÍA DOBLE')
        .setColor(0xf0c040)
        .setDescription(
            `El admin ha habilitado la modalidad de **capitanía doble**.\n\n` +
            `En esta modalidad cada equipo tiene **2 capitanes**. ` +
            `Cada uno paga **${precio} €** por separado (el precio normal).\n\n` +
            `Si quieres ser el **segundo capitán** de un equipo existente, pulsa el botón de abajo, ` +
            `indica el nombre del capitán principal y, tras pagar, el admin te aprobará.`
        )
        .addFields(
            { name: '👑 Capitán principal', value: 'Ya aprobado — gestiona el equipo y el draft', inline: true },
            { name: '👑 Segundo capitán', value: `Paga ${precio} € · Se une al mismo equipo con los mismos derechos`, inline: true },
            { name: '💰 Coste total por equipo', value: `${precio} € × 2 personas = ${isNaN(parseInt(precio)) ? '?' : parseInt(precio)*2} €`, inline: false }
        )
        .setFooter({ text: 'Clutch Draft — Capitanía Doble' })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('solicitar_cap_doble')
            .setLabel('👥 Quiero ser segundo capitán')
            .setStyle(ButtonStyle.Primary)
    );
    await canal.send({ embeds: [embed], components: [row] });
    return { ok: true };
}

async function lanzarEncuestaCapitan(canal, slotsNecesarios) {
    candidatosCapitan.clear();
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('quiero_capitan').setLabel('👑 Quiero ser capitán').setStyle(ButtonStyle.Primary)
    );
    const embed = new EmbedBuilder()
        .setTitle('👑 ¿QUIERES SER CAPITÁN?')
        .setColor(0xa066ff)
        .setDescription(`Faltan **${slotsNecesarios}** capitán(es).\nSi quieres ser capitán, pulsa el botón.`)
        .addFields({ name: '🙋 Candidatos', value: '*Nadie de momento...*', inline: false })
        .setTimestamp();
    msgVotoCapitan = await canal.send({ content: `<@&${ROL_JUGADOR}>`, embeds: [embed], components: [row] });
}

async function actualizarEmbedCandidatos() {
    if (!msgVotoCapitan) return;
    try {
        const lista = candidatosCapitan.size > 0
            ? [...candidatosCapitan].map(id => `<@${id}>`).join('\n')
            : '*Nadie de momento...*';
        const embed = EmbedBuilder.from(msgVotoCapitan.embeds[0])
            .spliceFields(0, 1, { name: `🙋 Candidatos (${candidatosCapitan.size})`, value: lista, inline: false });
        await msgVotoCapitan.edit({ embeds: [embed] });
    } catch(e) { console.error('Error actualizando candidatos:', e.message); }
}

async function cerrarInscripcionesGratuito(guild) {
    if (!guild) { console.error('cerrarInscripcionesGratuito: guild no encontrado'); return; }

    // 1. Marcar inscripciones como cerradas y draft tipo gratuito
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('inscripciones_estado', 'cerrado')`).run();
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('draft_tipo', 'gratuito')`).run();
    notificarInscripciones('cerrar').catch(() => {});

    // 2. Deshabilitar panel de inscripciones
    try {
        const chId  = db.prepare(`SELECT value FROM settings WHERE key='panel_ch_id'`).get()?.value;
        const msgId = db.prepare(`SELECT value FROM settings WHERE key='panel_msg_id'`).get()?.value;
        if (chId && msgId) {
            const ch  = await client.channels.fetch(chId);
            const msg = await ch.messages.fetch(msgId);
            const rowsDis = buildPanelRows().map(row => { row.components.forEach(btn => btn.setDisabled(true)); return row; });
            await msg.edit({ embeds: [buildPanelEmbed()], components: rowsDis });
        }
    } catch(e) { console.error('Error deshabilitando panel:', e.message); }

    // 3. Calcular equipos
    const totalJugadores = db.prepare(`SELECT COUNT(*) as c FROM players`).get()?.c || 0;
    const equiposMaximos = calcularEquiposMaximos();
    console.log(`cerrarInscripcionesGratuito: ${totalJugadores} jugadores, ${equiposMaximos} equipos posibles`);

    const permsBase = [
        { id: guild.id,            deny:  [PermissionFlagsBits.ViewChannel] },
        { id: ROL_JUGADOR,         allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
                                   deny:  [PermissionFlagsBits.SendMessages] },
        { id: ROL_ADMIN_DISCORD,   allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
                                           PermissionFlagsBits.ReadMessageHistory] },
        { id: client.user.id,      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
                                           PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory,
                                           PermissionFlagsBits.EmbedLinks] }
    ];
    if (ADMIN_ID) permsBase.push({
        id:    ADMIN_ID,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
    });

    // 4. Canal jugadores-inscritos
    let canalInscritos = null;
    try {
        const existId = db.prepare("SELECT value FROM settings WHERE key='canal_jugadores_inscritos'").get()?.value;
        if (existId) {
            try {
                canalInscritos = await guild.channels.fetch(existId);
                await borrarMensajesCanal(canalInscritos);
            } catch { canalInscritos = null; }
        }
        if (!canalInscritos) {
            canalInscritos = await guild.channels.create({
                name: '👥-jugadores-inscritos',
                type: 0,
                parent: CATEGORIA_DRAFT,
                permissionOverwrites: permsBase
            });
            db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('canal_jugadores_inscritos',?)").run(canalInscritos.id);
        }
        await publicarJugadoresInscritos(canalInscritos);
    } catch(e) { console.error('Error creando canal jugadores-inscritos:', e.message); }

    // 5. Canal votacion-capitan con botones Sí/No
    try {
        const existId = db.prepare("SELECT value FROM settings WHERE key='canal_votacion_capitan'").get()?.value;
        let canalVotCap = null;
        if (existId) {
            try {
                canalVotCap = await guild.channels.fetch(existId);
                await borrarMensajesCanal(canalVotCap);
            } catch { canalVotCap = null; }
        }
        if (!canalVotCap) {
            const permsVotacion = [
                { id: guild.id,            deny:  [PermissionFlagsBits.ViewChannel] },
                { id: ROL_JUGADOR,         allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages] },
                { id: ROL_ADMIN_DISCORD,   allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                { id: client.user.id,      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks] }
            ];
            if (ADMIN_ID) permsVotacion.push({ id: ADMIN_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
            canalVotCap = await guild.channels.create({
                name: '🗳️-votacion-capitan',
                type: 0,
                parent: CATEGORIA_DRAFT,
                permissionOverwrites: permsVotacion
            });
            db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('canal_votacion_capitan',?)").run(canalVotCap.id);
        }

        // Limpiar candidatos de sesión anterior
        db.prepare(`DELETE FROM candidatos_capitan WHERE forzado = 0`).run();

        const rowVot = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('vot_capitan_gratis_si').setLabel('✅ Sí, quiero ser capitán').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('vot_capitan_gratis_no').setLabel('❌ No').setStyle(ButtonStyle.Danger),
        );
        const embedVot = new EmbedBuilder()
            .setTitle('👑 ¿QUIERES SER CAPITÁN?')
            .setColor(0xa066ff)
            .setDescription(
                '**Este es un draft gratuito.**\n\n' +
                'Si quieres ser candidato para ser capitán, pulsa **✅ Sí**.\n' +
                'Los capitanes se seleccionarán mediante la **Ruleta de Capitanes**.\n\n' +
                '> Solo los jugadores inscritos en el draft pueden votar.'
            )
            .addFields({ name: '🙋 Candidatos', value: '*Nadie de momento…*', inline: false })
            .setTimestamp();
        await canalVotCap.send({ content: `<@&${ROL_JUGADOR}>`, embeds: [embedVot], components: [rowVot] });
    } catch(e) { console.error('Error creando canal votacion-capitan:', e.message); }

    // 6. Canal público lista de jugadores para el draft
    await publicarListaDraft(guild).catch(e => console.error('Error publicarListaDraft:', e.message));

    // 7. Anuncio
    try {
        const canalAnuncios = await guild.channels.fetch(CANAL_ANUNCIOS);
        await canalAnuncios.send({
            embeds: [new EmbedBuilder()
                .setTitle('🔒 INSCRIPCIONES CERRADAS — DRAFT GRATUITO')
                .setColor(0xff4d4d)
                .setDescription('Las inscripciones han cerrado.\n\n🆓 Este draft es **gratuito** — no hay precio de capitanía.\n\nEntra al canal de votación y confirma si quieres ser capitán.')
                .addFields(
                    { name: '👥 Total inscritos',   value: `${totalJugadores} jugadores`, inline: true },
                    { name: '🏟️ Equipos posibles', value: `${equiposMaximos} equipos`,   inline: true },
                )
                .setFooter({ text: 'Clutch Draft System' })
                .setTimestamp()]
        });
    } catch(e) { console.warn('Canal de anuncios no accesible:', e.message); }

}

// Cron 23:00 desactivado — inscripciones se gestionan manualmente desde el panel de admin
// cron.schedule('0 23 * * *', () => { cerrarInscripciones(); }, { timezone: 'Europe/Madrid' });

// ══════════════════════════════════════════════════════════════
//  FASE 3 — TORNEO
// ══════════════════════════════════════════════════════════════
function _ligarRR(equipos) {
    const lista = [...equipos];
    if (lista.length % 2 !== 0) lista.push(null);
    const n = lista.length, jornadas = [];
    for (let r = 0; r < n - 1; r++) {
        const jornada = [];
        for (let i = 0; i < n / 2; i++) {
            const eq1 = lista[i], eq2 = lista[n - 1 - i];
            if (eq1 && eq2) jornada.push({ eq1, eq2 });
        }
        jornadas.push(jornada);
        lista.splice(1, 0, lista.pop());
    }
    return jornadas;
}

function generarCalendario(equipos) {
    const n = equipos.length;
    let jornadas = [];
    if (n === 4 || n === 8) {
        jornadas = _ligarRR(equipos);
    } else if (n <= 6) {
        const g1 = equipos.slice(0, Math.ceil(n / 2)), g2 = equipos.slice(Math.ceil(n / 2));
        const j1 = _ligarRR(g1).map(j => j.map(p => ({ ...p, grupo: 'A' })));
        const j2 = _ligarRR(g2).map(j => j.map(p => ({ ...p, grupo: 'B' })));
        const maxJ = Math.max(j1.length, j2.length);
        for (let i = 0; i < maxJ; i++) jornadas.push([...(j1[i] || []), ...(j2[i] || [])]);
        jornadas.push([{ eq1: 'Ganador Grupo A', eq2: 'Ganador Grupo B', esFinal: true }]);
    } else if (n <= 12) {
        const mid = Math.ceil(n / 2), g1 = equipos.slice(0, mid), g2 = equipos.slice(mid);
        const j1 = _ligarRR(g1).map(j => j.map(p => ({ ...p, grupo: 'A' })));
        const j2 = _ligarRR(g2).map(j => j.map(p => ({ ...p, grupo: 'B' })));
        const maxJ = Math.max(j1.length, j2.length);
        for (let i = 0; i < maxJ; i++) jornadas.push([...(j1[i] || []), ...(j2[i] || [])]);
        jornadas.push([
            { eq1: '1º Grupo A', eq2: '2º Grupo B', esSemi: true },
            { eq1: '1º Grupo B', eq2: '2º Grupo A', esSemi: true }
        ]);
        jornadas.push([{ eq1: 'Ganador SF1', eq2: 'Ganador SF2', esFinal: true }]);
    } else {
        jornadas = _ligarRR(equipos);
    }
    return jornadas;
}

// ── Crear canal de texto privado por partido ─────────────────
// ROBUSTO: si un ID de Discord no es miembro real (ej: bot de prueba),
// el canal se crea igualmente sin ese permiso individual.
// Co-capitanes: botón para que el capitán añada a un miembro adicional.
function etiquetaFase(jornada) {
    const totalLiga = parseInt(db.prepare("SELECT value FROM settings WHERE key='total_rondas_swiss'").get()?.value || '0');
    if (!totalLiga || jornada <= totalLiga) return { prefijo: 'j' + jornada, titulo: 'Jornada ' + jornada, esKO: false };
    const fases     = JSON.parse(db.prepare("SELECT value FROM settings WHERE key='fases_torneo'").get()?.value || '["liga"]');
    const offset    = jornada - totalLiga - 1;
    const fase      = fases[offset + 1] || fases[fases.length - 1] || 'final';
    const labels    = { playoffs: 'Play-offs', cuartos: 'Cuartos de Final', semis: 'Semifinales', final: 'Gran Final' };
    const prefijos  = { playoffs: 'playoffs', cuartos: 'cuartos', semis: 'semis', final: 'final' };
    return { prefijo: prefijos[fase] || fase, titulo: labels[fase] || fase, esKO: true };
}

async function crearCanalPartido(guild, matchId, jornada, eq1, eq2, cap1Id, cap2Id) {
    try {
        const { prefijo, titulo, esKO } = etiquetaFase(jornada);
        const nombre = (prefijo + '-' + eq1.slice(0, 8) + '-vs-' + eq2.slice(0, 8))
            .toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 32);

        const permisos = [
            { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        ];

        // Admin siempre
        if (ADMIN_ID) {
            try {
                await guild.members.fetch(ADMIN_ID);
                permisos.push({ id: ADMIN_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
            } catch(e) { console.warn(`Admin ${ADMIN_ID} no encontrado en el servidor.`); }
        }

        // Capitán 1
        if (cap1Id) {
            try {
                await guild.members.fetch(cap1Id);
                permisos.push({ id: cap1Id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
            } catch(e) {
                console.warn(`Cap1 ${cap1Id} (${eq1}) no es miembro real — canal creado sin permiso individual. (¿Prueba con bot?)`);
            }
        }
        // Capitán 2
        if (cap2Id) {
            try {
                await guild.members.fetch(cap2Id);
                permisos.push({ id: cap2Id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
            } catch(e) {
                console.warn(`Cap2 ${cap2Id} (${eq2}) no es miembro real — canal creado sin permiso individual. (¿Prueba con bot?)`);
            }
        }

        // Co-capitanes persistentes desde DB
        for (const capId of [cap1Id, cap2Id]) {
            if (!capId) continue;
            const cocaps = db.prepare("SELECT cocapitan_id FROM cocapitanes WHERE capitan_id=?").all(capId);
            for (const { cocapitan_id } of cocaps) {
                try {
                    await guild.members.fetch(cocapitan_id);
                    permisos.push({ id: cocapitan_id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
                } catch(e) { /* no está en el servidor */ }
            }
        }

        const canal = await guild.channels.create({
            name:   nombre,
            type:   0, // text
            parent: CATEGORIA_PARTIDOS,
            permissionOverwrites: permisos
        });

        const embed = new EmbedBuilder()
            .setTitle(`⚔️ ${titulo} — ${eq1} vs ${eq2}`)
            .setColor(esKO ? 0xf0c040 : 0xa066ff)
            .setDescription(
                'Este es el canal privado de vuestro partido.\n' +
                '**Ambos capitanes** deben reportar el resultado con el botón de abajo.\n' +
                'Si los dos resultados coinciden se registra automáticamente.\n' +
                'Si hay discrepancia, el admin decide.\n\n' +
                '> Para añadir co-capitán ve al canal **🤝-co-capitanes**.'
            )
            .addFields(
                { name: '🏠 Local',     value: cap1Id ? `<@${cap1Id}>` : eq1, inline: true },
                { name: '✈️ Visitante', value: cap2Id ? `<@${cap2Id}>` : eq2, inline: true },
                { name: esKO ? '🏆 Fase' : '📅 Jornada', value: titulo,       inline: true }
            )
            .setFooter({ text: `Match ID: ${matchId} · Clutch Draft` })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('reportar_' + matchId)
                .setLabel('📊 Reportar resultado')
                .setStyle(ButtonStyle.Primary)
        );

        const menciones = [
            cap1Id ? `<@${cap1Id}>` : eq1,
            cap2Id ? `<@${cap2Id}>` : eq2
        ].join(' ');

        await canal.send({ content: menciones, embeds: [embed], components: [row] });
        console.log(`✅ Canal partido creado: ${nombre} (ID: ${canal.id})`);

        return canal.id;
    } catch(e) {
        console.error('Error creando canal partido:', e.message, e.stack);
        return null;
    }
}

async function generarTorneo(equiposRows) {
    try {
        const guild = client.guilds.cache.first();
        if (!guild) return { ok: false, error: 'Guild no disponible' };

        const n      = equiposRows.length;
        const formato = getFormatoTorneo(n);

        // Guardar configuración de torneo
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('total_rondas_swiss', ?)").run(String(formato.rondasLiga));
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('jornada_actual', '1')").run();
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('fase_actual', 'liga')").run();
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('fases_torneo', ?)").run(JSON.stringify(formato.fases));

        const totalRondas = formato.rondasLiga;

        // ── Jornada 1: emparejamientos aleatorios (Swiss ronda 1) ──
        const { partidos, byeTeam } = emparejarSwiss(equiposRows, 1);
        const matchesCreados = [];

        // Inicializar clasificación PRIMERO (antes del BYE y los matches)
        // ON CONFLICT DO UPDATE normaliza equipo_nombre = capitan_username
        for (const eq of equiposRows) {
            db.prepare(`INSERT INTO clasificacion (capitan_id, equipo_nombre, puntos, pj, pg, pe, pp, gf, gc)
                        VALUES (?,?,0,0,0,0,0,0,0)
                        ON CONFLICT(capitan_id) DO UPDATE SET equipo_nombre=excluded.equipo_nombre,
                        puntos=0, pj=0, pg=0, pe=0, pp=0, gf=0, gc=0`).run(eq.capitan_id, eq.capitan_username);
        }

        for (const { eq1, eq2 } of partidos) {
            const r = db.prepare("INSERT INTO matches (jornada, equipo1, equipo2, estado) VALUES (?,?,?,'pendiente')")
                .run(1, eq1.capitan_username, eq2.capitan_username);
            const matchId = r.lastInsertRowid;
            const canalId = await crearCanalPartido(guild, matchId, 1, eq1.capitan_username, eq2.capitan_username, eq1.capitan_id, eq2.capitan_id);
            if (canalId) {
                db.prepare('UPDATE matches SET canal_discord=? WHERE id=?').run(canalId, matchId);
                canalesPartido[matchId] = canalId;
            }
            matchesCreados.push({ id: matchId, canalId });
        }

        // BYE en ronda 1 (después del init de clasificación para que los puntos no se reseteen)
        if (byeTeam) {
            db.prepare("INSERT INTO matches (jornada, equipo1, equipo2, estado, goles1, goles2) VALUES (?,?,?,'finalizado',3,0)")
                .run(1, byeTeam.capitan_username, 'BYE');
            db.prepare("UPDATE clasificacion SET puntos=puntos+3, pj=pj+1, pg=pg+1 WHERE capitan_id=?").run(byeTeam.capitan_id);
            console.log(`⚽ BYE asignado a ${byeTeam.capitan_username} en jornada 1.`);
        }

        // ── Anunciar Jornada 1 en el canal de calendario ──
        try {
            const canalCal = await guild.channels.fetch(CANAL_CALENDARIO);
            const msgsCal  = await canalCal.messages.fetch({ limit: 50 });
            if (msgsCal.size > 0) await canalCal.bulkDelete(msgsCal).catch(async () => {
                for (const [, msg] of msgsCal) await msg.delete().catch(() => {});
            });
            const formatoNombre = formato.fases.length > 1
                ? `${formato.rondasLiga}J de liga + ${formato.fases.slice(1).join(' + ').toUpperCase()}`
                : `${formato.rondasLiga} jornadas (liga completa)`;
            let bloque = `# 🏆 TORNEO CLUTCH — ${n} EQUIPOS\n*${formatoNombre} · Sistema Swiss*\n\n## ⚽ JORNADA 1\n`;
            for (const { eq1, eq2 } of partidos) bloque += `• **${eq1.capitan_username}** vs **${eq2.capitan_username}**\n`;
            if (byeTeam) bloque += `• **${byeTeam.capitan_username}** — *BYE (victoria automática)*\n`;
            const rowCalJ1 = new ActionRowBuilder().addComponents(
                botonWeb('Ver calendario en la web', '/torneo?tab=emparejamientos', '📅')
            );
            await canalCal.send({ content: bloque, components: [rowCalJ1] });
        } catch(e) { console.error('Error anunciando jornada 1:', e.message); }

        // Canal de co-capitanes persistente
        await crearCanalCocapitanes(guild);

        // Canales públicos de competición (crear ANTES de actualizar para que existan)
        await crearCanalesPublicosTorneo(guild);
        await actualizarCanalClasificacion(guild);   // ahora sí existen los canales pub
        await actualizarCanalEquiposPub(guild);
        await actualizarCanalResultadosPub(guild);
        await actualizarCanalRondasFinalesPub(guild);

        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('torneo_generado', ?)").run(new Date().toISOString());
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('torneo_inicio', ?)").run(new Date().toISOString());
        notificarTorneoGenerado().catch(() => {});

        // Crear canales de voz por equipo
        await crearCanalesVoz(equiposRows);

        return { ok: true, matches: matchesCreados.length, jornadas: totalRondas };
    } catch(e) {
        console.error('Error generando torneo:', e);
        return { ok: false, error: e.message };
    }
}

async function anunciarCalendario(guild, jornadas, jornadaBase, equiposRows) {
    try {
        const canal = await guild.channels.fetch(CANAL_CALENDARIO);
        // Borrar mensajes anteriores con fallback para mensajes >14 días
        try {
            const msgs = await canal.messages.fetch({ limit: 50 });
            if (msgs.size > 0) await canal.bulkDelete(msgs).catch(async () => {
                for (const [, msg] of msgs) await msg.delete().catch(() => {});
            });
        } catch(e) { /* ignorar */ }
        const rowCal = new ActionRowBuilder().addComponents(
            botonWeb('Ver calendario en la web', '/torneo?tab=emparejamientos', '📅')
        );
        let bloque = '# 📅 CALENDARIO DEL TORNEO\n\n';
        for (let j = 0; j < jornadas.length; j++) {
            const numJ = jornadaBase + j;
            bloque += `## Jornada ${numJ}\n`;
            for (const p of jornadas[j]) {
                const prefix = p.esFinal ? '🏆 FINAL: ' : p.esSemi ? '⚔️ Semifinal: ' : p.grupo ? `[Grupo ${p.grupo}] ` : '';
                bloque += `• ${prefix}${p.eq1} vs ${p.eq2}\n`;
            }
            bloque += '\n';
            if (bloque.length > 1700) { await canal.send(bloque); bloque = ''; }
        }
        if (bloque.trim()) await canal.send({ content: bloque, components: [rowCal] });
        else await canal.send({ components: [rowCal] });
        console.log('✅ Calendario publicado en Discord.');
    } catch(e) { console.error('Error anunciando calendario:', e.message); }
}

async function resolverCanalClasificacion(guild) {
    // 1. Intentar con el ID dinámico guardado en settings
    const pubChId = getCanalPub('canal_pub_clasificacion');
    if (pubChId) {
        const ch = await guild.channels.fetch(pubChId).catch(() => null);
        if (ch) return ch;
        // ID en DB obsoleto — limpiarlo
        db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('canal_pub_clasificacion','')").run();
    }
    // 2. Fallback: buscar por nombre en el servidor
    await guild.channels.fetch().catch(() => {});
    const porNombre = guild.channels.cache.find(c =>
        c.type === 0 && c.name.toLowerCase().includes('clasificaci')
    );
    if (porNombre) {
        // Guardar el ID encontrado para próximas llamadas
        db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('canal_pub_clasificacion',?)").run(porNombre.id);
        return porNombre;
    }
    // 3. Último recurso: probar el ID hardcodeado
    const hardcoded = await guild.channels.fetch(CANAL_CLASIFICACION).catch(() => null);
    if (hardcoded) return hardcoded;
    return null;
}

async function actualizarCanalClasificacion(guild) {
    try {
        const faseActual = db.prepare("SELECT value FROM settings WHERE key='fase_actual'").get()?.value || '';
        const congelada  = faseActual && faseActual !== 'liga'; // KO en curso → tabla congelada

        const canal = await resolverCanalClasificacion(guild);
        if (!canal) {
            console.warn('⚠️ Canal de clasificación no encontrado en ninguna fuente.');
            return;
        }

        // Limpiar mensajes del canal
        if (!congelada) {
            await borrarMensajesCanal(canal).catch(() => {});
        } else {
            const existentes = await canal.messages.fetch({ limit: 1 }).catch(() => null);
            if (existentes && existentes.size > 0) return;
        }

        const tabla = db.prepare(`
            SELECT c.*, COALESCE(NULLIF(t.nombre_equipo,''), c.equipo_nombre) AS display_nombre
            FROM clasificacion c
            LEFT JOIN teams t ON t.capitan_id = c.capitan_id
            ORDER BY c.puntos DESC, c.pg DESC, (c.gf-c.gc) DESC, c.gf DESC
        `).all();

        if (!tabla.length) {
            await canal.send('# 🏆 CLASIFICACIÓN\n\n*Pendiente — la tabla se publicará cuando comience el torneo.*').catch(() => {});
            return;
        }

        const encabezado = congelada ? '# 🏆 CLASIFICACIÓN — FASE DE LIGA (FINAL)\n' : '# 🏆 CLASIFICACIÓN\n';
        let txt = encabezado + '\n```\n';
        txt += '#   Equipo               PJ  PG  PE  PP  GF  GC  DIF PTS\n';
        txt += '─'.repeat(56) + '\n';
        tabla.forEach((eq, i) => {
            const dif    = eq.gf - eq.gc;
            const difStr = (dif > 0 ? '+' : '') + dif;
            const nombre = (eq.display_nombre || eq.equipo_nombre);
            txt += String(i + 1).padEnd(4) +
                   nombre.slice(0, 20).padEnd(22) +
                   String(eq.pj).padEnd(4) + String(eq.pg).padEnd(4) +
                   String(eq.pe).padEnd(4) + String(eq.pp).padEnd(4) +
                   String(eq.gf).padEnd(4) + String(eq.gc).padEnd(4) +
                   difStr.padEnd(5) + eq.puntos + '\n';
        });
        txt += congelada
            ? '```\n*Clasificación final de la fase de liga*'
            : '```\n*Actualizado: ' + new Date().toLocaleString('es-ES') + '*';

        const row = new ActionRowBuilder().addComponents(
            botonWeb('Ver clasificación en la web', '/torneo?tab=clasificacion', '📊')
        );
        await canal.send({ content: txt, components: [row] });
        console.log(`✅ Canal clasificación actualizado (${canal.id}).`);
    } catch(e) { console.error('❌ Error actualizando clasificación Discord:', e.message); }
}

// ══════════════════════════════════════════════════════════════
//  CANALES PÚBLICOS DEL TORNEO — COMPETICIÓN
// ══════════════════════════════════════════════════════════════
function getCanalPub(key) {
    return db.prepare("SELECT value FROM settings WHERE key=?").get(key)?.value || null;
}

async function borrarMensajesCanal(ch) {
    try {
        let ms = await ch.messages.fetch({ limit: 100 });
        while (ms.size > 0) {
            await ch.bulkDelete(ms).catch(async () => {
                for (const [, msg] of ms) await msg.delete().catch(() => {});
            });
            ms = await ch.messages.fetch({ limit: 100 });
            if (ms.size === 0) break;
        }
    } catch(e) { /* ignorar */ }
}

async function crearCanalesPublicosTorneo(guild) {
    const defs = [
        { key: 'canal_pub_equipos',         nombre: '📋-equipos'         },
        { key: 'canal_pub_clasificacion',    nombre: '📊-clasificacion'   },
        { key: 'canal_pub_resultados',       nombre: '⚔️-resultados'      },
        { key: 'canal_pub_rondas',           nombre: '🏆-rondas-finales'  },
    ];
    const permisos = [
        {
            // @everyone: solo lectura
            id:    guild.id,
            deny:  [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions],
            allow: [PermissionFlagsBits.ViewChannel,  PermissionFlagsBits.ReadMessageHistory]
        },
        {
            // Bot: puede escribir y gestionar mensajes en sus propios canales
            id:    client.user.id,
            allow: [
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ManageMessages,
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.EmbedLinks
            ]
        }
    ];
    for (const def of defs) {
        try {
            // Si ya existe y sigue en Discord, reutilizarlo
            const existenteId = getCanalPub(def.key);
            if (existenteId) {
                try {
                    const chExistente = await guild.channels.fetch(existenteId);
                    // Actualizar permisos del bot por si el canal fue creado antes de este fix
                    await chExistente.permissionOverwrites.edit(client.user.id, {
                        SendMessages: true, ManageMessages: true,
                        ViewChannel: true, ReadMessageHistory: true, EmbedLinks: true
                    }).catch(() => {});
                    continue;
                } catch(e) { /* no existe, crear nuevo */ }
            }
            const ch = await guild.channels.create({
                name:                 def.nombre,
                type:                 0,
                parent:               CATEGORIA_PARTIDOS,
                permissionOverwrites: permisos
            });
            db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(def.key, ch.id);
            console.log(`✅ Canal público creado: ${def.nombre} (${ch.id})`);
        } catch(e) {
            console.error(`Error creando canal público ${def.nombre}:`, e.message);
        }
    }
}

async function actualizarCanalEquiposPub(guild) {
    const chId = getCanalPub('canal_pub_equipos');
    if (!chId) return;
    try {
        const ch      = await guild.channels.fetch(chId);
        await borrarMensajesCanal(ch);
        const equipos = db.prepare('SELECT * FROM teams ORDER BY id').all();
        const rowEquipos = new ActionRowBuilder().addComponents(
            botonWeb('Ver equipos en la web', '/torneo?tab=equipos', '📋')
        );
        if (!equipos.length) { await ch.send({ content: '*No hay equipos aún.*', components: [rowEquipos] }); return; }
        for (const equipo of equipos) {
            const nombre    = equipo.nombre_equipo || equipo.capitan_username;
            const jugadores = db.prepare(`SELECT nombre, posicion, eafc_id, discord_id FROM players WHERE equipo=? ORDER BY posicion, nombre`).all(equipo.capitan_username);
            const lista     = jugadores.length
                ? jugadores.map(j => `\`${j.posicion.padEnd(4)}\` **${j.nombre}** · EA: \`${j.eafc_id || '⚠️ Sin ID'}\` · <@${j.discord_id}>`).join('\n')
                : '*Sin jugadores fichados aún.*';
            const embed = new EmbedBuilder()
                .setTitle(`👑 ${nombre.toUpperCase()}`)
                .setColor(0x00ffcc)
                .addFields(
                    { name: '🎖️ Capitán', value: `<@${equipo.capitan_id}>`, inline: true },
                    { name: `👥 Jugadores (${jugadores.length})`, value: lista.slice(0, 1024), inline: false }
                )
                .setFooter({ text: 'Clutch Draft · IDs para verificación de partidos' });
            if (equipo.logo_url) embed.setThumbnail(equipo.logo_url);
            await ch.send({ embeds: [embed] });
        }
        // Botón al final tras todos los equipos
        await ch.send({ components: [rowEquipos] });
        console.log('✅ Canal equipos público actualizado.');
    } catch(e) { console.error('Error actualizando canal equipos pub:', e.message); }
}

async function actualizarCanalResultadosPub(guild) {
    const chId = getCanalPub('canal_pub_resultados');
    if (!chId) return;
    try {
        const ch      = await guild.channels.fetch(chId);
        await borrarMensajesCanal(ch);
        const totalRondasLiga = parseInt(db.prepare("SELECT value FROM settings WHERE key='total_rondas_swiss'").get()?.value || '0');
        const partidos = totalRondasLiga > 0
            ? db.prepare("SELECT * FROM matches WHERE jornada <= ? ORDER BY jornada, id").all(totalRondasLiga)
            : db.prepare("SELECT * FROM matches ORDER BY jornada, id").all();
        const rowRes = new ActionRowBuilder().addComponents(
            botonWeb('Ver resultados en la web', '/torneo?tab=resultados', '⚔️')
        );
        if (!partidos.length) {
            await ch.send({ content: '# ⚔️ RESULTADOS\n*No hay partidos aún.*', components: [rowRes] });
            return;
        }
        let bloque  = '# ⚔️ RESULTADOS\n';
        let jActual = -1;
        for (const p of partidos) {
            if (p.jornada !== jActual) {
                if (bloque.length > 1700) { await ch.send(bloque); bloque = ''; }
                bloque += `\n## Jornada ${p.jornada}\n`;
                jActual = p.jornada;
            }
            const resultado = p.estado === 'finalizado'
                ? `✅ **${p.equipo1}** \`${p.goles1} - ${p.goles2}\` **${p.equipo2}**`
                : `⏳ ${p.equipo1} vs ${p.equipo2}`;
            bloque += `• ${resultado}\n`;
        }
        if (bloque.trim()) await ch.send({ content: bloque, components: [rowRes] });
        console.log('✅ Canal resultados público actualizado.');
    } catch(e) { console.error('Error actualizando canal resultados pub:', e.message); }
}

async function actualizarCanalRondasFinalesPub(guild) {
    const chId = getCanalPub('canal_pub_rondas');
    if (!chId) return;
    try {
        const ch            = await guild.channels.fetch(chId);
        await borrarMensajesCanal(ch);
        const totalRondasLiga = parseInt(db.prepare("SELECT value FROM settings WHERE key='total_rondas_swiss'").get()?.value || '0');
        const fasesTorneo     = JSON.parse(db.prepare("SELECT value FROM settings WHERE key='fases_torneo'").get()?.value || '["liga"]');
        const fasLabels       = { playoffs: '🎯 PLAY-OFFS', cuartos: '🏆 CUARTOS DE FINAL', semis: '⚔️ SEMIFINALES', final: '🏆 GRAN FINAL' };
        const rondas          = totalRondasLiga > 0
            ? db.prepare("SELECT * FROM matches WHERE jornada > ? ORDER BY jornada, id").all(totalRondasLiga)
            : [];
        const rowRondas = new ActionRowBuilder().addComponents(
            botonWeb('Ver rondas finales en la web', '/torneo?tab=rondas', '🏆')
        );
        if (!rondas.length) {
            await ch.send({ content: '# 🏆 RONDAS FINALES\n*Las rondas finales aparecerán aquí cuando la fase de liga haya concluido.*', components: [rowRondas] });
            return;
        }
        let txt = '# 🏆 RONDAS FINALES\n\n';
        let jornadaActual = -1;
        for (const p of rondas) {
            if (p.jornada !== jornadaActual) {
                const offset = p.jornada - totalRondasLiga;
                const fase   = fasesTorneo[offset] || 'ELIMINATORIA';
                txt += `\n**${fasLabels[fase] || fase.toUpperCase()}**\n`;
                jornadaActual = p.jornada;
            }
            const estado = p.estado === 'finalizado'
                ? `✅ **${p.equipo1}** \`${p.goles1} - ${p.goles2}\` **${p.equipo2}**`
                : `⏳ ${p.equipo1} vs ${p.equipo2} *(pendiente)*`;
            txt += `• ${estado}\n`;
        }
        await ch.send({ content: txt, components: [rowRondas] });
        console.log('✅ Canal rondas finales público actualizado.');
    } catch(e) { console.error('Error actualizando canal rondas finales pub:', e.message); }
}

// ══════════════════════════════════════════════════════════════
//  FORMATO DE TORNEO — DETECCIÓN AUTOMÁTICA
// ══════════════════════════════════════════════════════════════

function getFormatoTorneo(n) {
    if (n <= 4)  return { rondasLiga: Math.max(n - 1, 1), fases: ['liga'] };
    if (n <= 6)  return { rondasLiga: 4, fases: ['liga', 'semis', 'final'] };
    if (n <= 10) return { rondasLiga: 3, fases: ['liga', 'cuartos', 'semis', 'final'] };
    return { rondasLiga: 4, fases: ['liga', 'playoffs', 'cuartos', 'semis', 'final'] };
}

function getTablaOrdenada() {
    return db.prepare(`
        SELECT c.*, COALESCE(NULLIF(t.nombre_equipo,''), c.equipo_nombre) AS display_nombre
        FROM clasificacion c
        LEFT JOIN teams t ON t.capitan_id = c.capitan_id
        ORDER BY c.puntos DESC, c.pg DESC, (c.gf-c.gc) DESC, c.gf DESC
    `).all();
}

// ══════════════════════════════════════════════════════════════
//  SISTEMA SUIZO — EMPAREJAMIENTOS PROGRESIVOS
// ══════════════════════════════════════════════════════════════

function emparejarSwiss(equipos, jornada) {
    const historial = db.prepare("SELECT equipo1, equipo2 FROM matches WHERE jornada < ?").all(jornada);

    let sorted;
    if (jornada === 1) {
        // Ronda 1: aleatorio
        sorted = [...equipos].sort(() => Math.random() - 0.5);
    } else {
        // Ronda 2+: ordenar por puntos desc, desempate por diferencia de goles
        sorted = [...equipos].sort((a, b) => {
            const ca = db.prepare("SELECT puntos, gf, gc FROM clasificacion WHERE capitan_id=?").get(a.capitan_id) || { puntos: 0, gf: 0, gc: 0 };
            const cb = db.prepare("SELECT puntos, gf, gc FROM clasificacion WHERE capitan_id=?").get(b.capitan_id) || { puntos: 0, gf: 0, gc: 0 };
            if (cb.puntos !== ca.puntos) return cb.puntos - ca.puntos;
            return (cb.gf - cb.gc) - (ca.gf - ca.gc);
        });
    }

    const usados   = new Set();
    const partidos = [];
    let byeTeam    = null;

    for (let i = 0; i < sorted.length; i++) {
        if (usados.has(sorted[i].capitan_id)) continue;
        let pareado = false;

        // Intentar primero sin rematch
        for (let j = i + 1; j < sorted.length; j++) {
            if (usados.has(sorted[j].capitan_id)) continue;
            const yaJugaron = historial.some(p =>
                (p.equipo1 === sorted[i].capitan_username && p.equipo2 === sorted[j].capitan_username) ||
                (p.equipo1 === sorted[j].capitan_username && p.equipo2 === sorted[i].capitan_username)
            );
            if (!yaJugaron) {
                partidos.push({ eq1: sorted[i], eq2: sorted[j] });
                usados.add(sorted[i].capitan_id);
                usados.add(sorted[j].capitan_id);
                pareado = true;
                break;
            }
        }

        // Si no hay pairing sin rematch, permitir rematch
        if (!pareado) {
            for (let j = i + 1; j < sorted.length; j++) {
                if (usados.has(sorted[j].capitan_id)) continue;
                partidos.push({ eq1: sorted[i], eq2: sorted[j] });
                usados.add(sorted[i].capitan_id);
                usados.add(sorted[j].capitan_id);
                pareado = true;
                break;
            }
        }

        // Número impar: equipo sin rival → BYE
        if (!pareado) {
            byeTeam = sorted[i];
            usados.add(sorted[i].capitan_id);
        }
    }

    return { partidos, byeTeam };
}

async function cerrarJornada(guild, jornada) {
    const matchesConCanal = db.prepare(
        "SELECT id, canal_discord FROM matches WHERE jornada=? AND canal_discord IS NOT NULL AND canal_discord != ''"
    ).all(jornada);
    for (const m of matchesConCanal) {
        try {
            const ch = guild.channels.cache.get(m.canal_discord) || await guild.channels.fetch(m.canal_discord).catch(() => null);
            if (ch) await ch.delete();
        } catch(e) { /* ya borrado */ }
        delete canalesPartido[m.id];
        delete reportesPendientes[m.id];
    }
    console.log(`✅ Jornada ${jornada} cerrada: canales de partido eliminados.`);
}

let _generandoJornada = false; // Guard anti-doble ejecución

// Finalizar torneo: guardar historial, anunciar campeón, programar limpieza
async function finalizarTorneo(guild) {
    const historial = await guardarHistorial();
    if (!historial) return;
    // Actualizar canales antes de anunciar para que el resultado final ya esté visible
    await actualizarCanalRondasFinalesPub(guild).catch(() => {});
    await actualizarCanalResultadosPub(guild).catch(() => {});
    await anunciarCampeon(guild, historial.campeon, historial.subcampeon, historial.tabla);
    const finTs = new Date().toISOString();
    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('torneo_fin_ts',?)").run(finTs);
    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('discord_limpiado','')").run();
    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('datos_limpiados','')").run();
    try {
        const canalAnun = await guild.channels.fetch(CANAL_ANUNCIOS);
        await canalAnun.send(
            '⏳ **El torneo ha finalizado.**\n' +
            '• Los canales de Discord se borrarán automáticamente en **1 hora**.\n' +
            '• Los datos de la web se limpiarán en **2 horas**.\n' +
            '• El admin puede forzar la limpieza con `!limpiar todo`.'
        );
    } catch(e) { /* ignorar */ }
}

// Generar una fase de knockouts (cuartos, semis, final, playoffs)
async function generarFaseKnockout(guild, fase, jornada, jornada_anterior, prevFase) {
    const tabla    = getTablaOrdenada();
    const fasLabels = { playoffs: '🎯 PLAY-OFFS', cuartos: '🏆 CUARTOS DE FINAL', semis: '⚔️ SEMIFINALES', final: '🏆 GRAN FINAL' };
    let partidos   = [];

    if (fase === 'playoffs') {
        // 12 equipos: pos5-12 luchan por 4 plazas
        partidos = [
            { eq1: tabla[4]?.equipo_nombre, eq2: tabla[11]?.equipo_nombre },
            { eq1: tabla[5]?.equipo_nombre, eq2: tabla[10]?.equipo_nombre },
            { eq1: tabla[6]?.equipo_nombre, eq2: tabla[9]?.equipo_nombre },
            { eq1: tabla[7]?.equipo_nombre, eq2: tabla[8]?.equipo_nombre },
        ].filter(p => p.eq1 && p.eq2);

    } else if (fase === 'cuartos') {
        if (prevFase === 'playoffs') {
            // 12 equipos: 4 ganadores de playoffs vs top 4 (sembrado inverso)
            const res = db.prepare("SELECT * FROM matches WHERE jornada=? AND estado='finalizado' ORDER BY id").all(jornada_anterior);
            const w   = res.map(m => m.goles1 >= m.goles2 ? m.equipo1 : m.equipo2);
            partidos = [
                { eq1: tabla[0]?.equipo_nombre, eq2: w[3] },
                { eq1: tabla[1]?.equipo_nombre, eq2: w[2] },
                { eq1: tabla[2]?.equipo_nombre, eq2: w[1] },
                { eq1: tabla[3]?.equipo_nombre, eq2: w[0] },
            ].filter(p => p.eq1 && p.eq2);
        } else {
            // 8-10 equipos: pos3-6 (pos1 y pos2 tienen bye a semis)
            partidos = [
                { eq1: tabla[2]?.equipo_nombre, eq2: tabla[5]?.equipo_nombre },
                { eq1: tabla[3]?.equipo_nombre, eq2: tabla[4]?.equipo_nombre },
            ].filter(p => p.eq1 && p.eq2);
        }

    } else if (fase === 'semis') {
        if (prevFase === 'liga') {
            // 6 equipos: top 4 directamente a semis
            partidos = [
                { eq1: tabla[0]?.equipo_nombre, eq2: tabla[3]?.equipo_nombre },
                { eq1: tabla[1]?.equipo_nombre, eq2: tabla[2]?.equipo_nombre },
            ].filter(p => p.eq1 && p.eq2);
        } else {
            const res = db.prepare("SELECT * FROM matches WHERE jornada=? AND estado='finalizado' ORDER BY id").all(jornada_anterior);
            const w   = res.map(m => m.goles1 >= m.goles2 ? m.equipo1 : m.equipo2);
            if (w.length === 2) {
                // 8-10 equipos: pos1 y pos2 tienen bye; w[0]=ganador(3v6), w[1]=ganador(4v5)
                partidos = [
                    { eq1: tabla[0]?.equipo_nombre, eq2: w[1] },
                    { eq1: tabla[1]?.equipo_nombre, eq2: w[0] },
                ].filter(p => p.eq1 && p.eq2);
            } else if (w.length === 4) {
                // 12 equipos: 4 ganadores de cuartos
                partidos = [
                    { eq1: w[0], eq2: w[3] },
                    { eq1: w[1], eq2: w[2] },
                ].filter(p => p.eq1 && p.eq2);
            }
        }

    } else if (fase === 'final') {
        const res = db.prepare("SELECT * FROM matches WHERE jornada=? AND estado='finalizado' ORDER BY id").all(jornada_anterior);
        const w   = res.map(m => m.goles1 >= m.goles2 ? m.equipo1 : m.equipo2);
        if (w.length >= 2) partidos = [{ eq1: w[0], eq2: w[1] }];
    }

    if (!partidos.length) {
        console.error(`⚠️ No se pudieron generar partidos para fase ${fase}`);
        return;
    }

    // Crear partidos y canales en Discord
    for (const { eq1, eq2 } of partidos) {
        // Buscar capitan_id desde clasificacion (más fiable que teams para rondas KO)
        // Fallback a teams por si el equipo entró por BYE u otro camino
        const clasi1  = db.prepare("SELECT capitan_id FROM clasificacion WHERE equipo_nombre=?").get(eq1);
        const clasi2  = db.prepare("SELECT capitan_id FROM clasificacion WHERE equipo_nombre=?").get(eq2);
        const cap1Id  = clasi1?.capitan_id
            || db.prepare("SELECT capitan_id FROM teams WHERE capitan_username=?").get(eq1)?.capitan_id;
        const cap2Id  = clasi2?.capitan_id
            || db.prepare("SELECT capitan_id FROM teams WHERE capitan_username=?").get(eq2)?.capitan_id;
        const r     = db.prepare("INSERT INTO matches (jornada, equipo1, equipo2, estado) VALUES (?,?,?,'pendiente')")
            .run(jornada, eq1, eq2);
        const matchId = r.lastInsertRowid;
        const canalId = await crearCanalPartido(guild, matchId, jornada, eq1, eq2, cap1Id, cap2Id);
        if (canalId) {
            db.prepare('UPDATE matches SET canal_discord=? WHERE id=?').run(canalId, matchId);
            canalesPartido[matchId] = canalId;
        }
    }

    // Anunciar en calendario
    try {
        const canalCal = await guild.channels.fetch(CANAL_CALENDARIO);
        let bloque = `\n## ${fasLabels[fase] || fase.toUpperCase()} — Jornada ${jornada}\n`;
        for (const { eq1, eq2 } of partidos) bloque += `• **${eq1}** vs **${eq2}**\n`;
        const rowCalKO = new ActionRowBuilder().addComponents(
            botonWeb('Ver calendario en la web', '/torneo?tab=emparejamientos', '📅')
        );
        await canalCal.send({ content: bloque, components: [rowCalKO] });
    } catch(e) { /* ignorar */ }

    await actualizarCanalClasificacion(guild).catch(() => {});
    await actualizarCanalResultadosPub(guild).catch(() => {});
    await actualizarCanalRondasFinalesPub(guild).catch(() => {});
    await axios.post('http://localhost:3000/api/jornada-avanzada').catch(() => {});
    console.log(`✅ Fase ${fase} generada (jornada ${jornada}): ${partidos.length} partido(s).`);
}

async function generarSiguienteJornada(guild) {
    if (_generandoJornada) return;
    _generandoJornada = true;
    try {
        const jornadaActual   = parseInt(db.prepare("SELECT value FROM settings WHERE key='jornada_actual'").get()?.value || '1');
        const totalRondasLiga = parseInt(db.prepare("SELECT value FROM settings WHERE key='total_rondas_swiss'").get()?.value || '0');
        const faseActual      = db.prepare("SELECT value FROM settings WHERE key='fase_actual'").get()?.value || 'liga';
        const fasesTorneo     = JSON.parse(db.prepare("SELECT value FROM settings WHERE key='fases_torneo'").get()?.value || '["liga"]');
        const siguiente       = jornadaActual + 1;

        // Cerrar canales de la jornada que acaba de terminar
        await cerrarJornada(guild, jornadaActual);

        if (faseActual === 'liga' && siguiente <= totalRondasLiga) {
            // ── Siguiente ronda de liga (Swiss) ──────────────────────
            console.log(`⚽ Generando Jornada ${siguiente} (Swiss)...`);
            const equipos = db.prepare('SELECT * FROM teams ORDER BY id').all();
            const { partidos, byeTeam } = emparejarSwiss(equipos, siguiente);

            for (const { eq1, eq2 } of partidos) {
                const r = db.prepare("INSERT INTO matches (jornada, equipo1, equipo2, estado) VALUES (?,?,?,'pendiente')")
                    .run(siguiente, eq1.capitan_username, eq2.capitan_username);
                const matchId = r.lastInsertRowid;
                const canalId = await crearCanalPartido(guild, matchId, siguiente, eq1.capitan_username, eq2.capitan_username, eq1.capitan_id, eq2.capitan_id);
                if (canalId) {
                    db.prepare('UPDATE matches SET canal_discord=? WHERE id=?').run(canalId, matchId);
                    canalesPartido[matchId] = canalId;
                }
            }
            if (byeTeam) {
                db.prepare("INSERT INTO matches (jornada, equipo1, equipo2, estado, goles1, goles2) VALUES (?,?,?,'finalizado',3,0)")
                    .run(siguiente, byeTeam.capitan_username, 'BYE');
                db.prepare("UPDATE clasificacion SET puntos=puntos+3, pj=pj+1, pg=pg+1 WHERE capitan_id=?").run(byeTeam.capitan_id);
            }
            db.prepare("UPDATE settings SET value=? WHERE key='jornada_actual'").run(String(siguiente));

            try {
                const canalCal = await guild.channels.fetch(CANAL_CALENDARIO);
                let bloque = `\n## ⚽ JORNADA ${siguiente}\n`;
                for (const { eq1, eq2 } of partidos) bloque += `• **${eq1.capitan_username}** vs **${eq2.capitan_username}**\n`;
                if (byeTeam) bloque += `• **${byeTeam.capitan_username}** — *BYE (victoria automática)*\n`;
                const rowCalLiga = new ActionRowBuilder().addComponents(
                    botonWeb('Ver calendario en la web', '/torneo?tab=emparejamientos', '📅')
                );
                await canalCal.send({ content: bloque, components: [rowCalLiga] });
            } catch(e) { /* ignorar */ }

            await actualizarCanalClasificacion(guild).catch(() => {});
            await actualizarCanalResultadosPub(guild).catch(() => {});
            await axios.post('http://localhost:3000/api/jornada-avanzada').catch(() => {});
            console.log(`✅ Jornada ${siguiente} generada con ${partidos.length} partido(s).`);

        } else if (faseActual === 'final') {
            // ── Final jugada → finalizar torneo ──────────────────────
            console.log('🏆 Final completada. Finalizando torneo...');
            await finalizarTorneo(guild);

        } else {
            // ── Avanzar a la siguiente fase de knockout ───────────────
            const idxActual  = fasesTorneo.indexOf(faseActual);
            const siguienteFase = fasesTorneo[idxActual + 1];

            if (!siguienteFase) {
                console.log('🏆 No hay más fases. Finalizando torneo...');
                await finalizarTorneo(guild);
            } else {
                console.log(`🏆 Iniciando fase: ${siguienteFase} (jornada ${siguiente})`);
                await generarFaseKnockout(guild, siguienteFase, siguiente, jornadaActual, faseActual);
                db.prepare("UPDATE settings SET value=? WHERE key='fase_actual'").run(siguienteFase);
                db.prepare("UPDATE settings SET value=? WHERE key='jornada_actual'").run(String(siguiente));
            }
        }
    } catch(e) {
        console.error('Error generando siguiente jornada:', e.message);
    } finally {
        _generandoJornada = false;
    }
}

async function comprobarAvanceJornada(guild) {
    const torneoGenerado = db.prepare("SELECT value FROM settings WHERE key='torneo_generado'").get()?.value;
    if (!torneoGenerado) return;
    const finTs = db.prepare("SELECT value FROM settings WHERE key='torneo_fin_ts'").get()?.value;
    if (finTs) return; // Torneo ya finalizado
    const jornadaActual = parseInt(db.prepare("SELECT value FROM settings WHERE key='jornada_actual'").get()?.value || '1');
    const pendientes    = db.prepare("SELECT COUNT(*) as c FROM matches WHERE jornada=? AND estado='pendiente'").get(jornadaActual)?.c || 0;
    if (pendientes === 0) await generarSiguienteJornada(guild);
}

async function crearCanalCocapitanes(guild) {
    const existingId = db.prepare("SELECT value FROM settings WHERE key='canal_cocapitanes'").get()?.value;
    if (existingId) {
        try { await guild.channels.fetch(existingId); return existingId; } catch(e) { /* recrear */ }
    }
    const permisos = [
        {
            id:    guild.id,
            deny:  [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions],
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]
        }
    ];
    const ch = await guild.channels.create({
        name:                 '🤝-co-capitanes',
        type:                 0,
        parent:               CATEGORIA_PARTIDOS,
        permissionOverwrites: permisos
    });
    const embed = new EmbedBuilder()
        .setTitle('👥 GESTIÓN DE CO-CAPITANES')
        .setColor(0xa066ff)
        .setDescription(
            'Un **co-capitán** puede reportar resultados de partido en tu nombre.\n\n' +
            '**Solo necesitas añadirlo una vez.** Se aplicará automáticamente en todos los canales de partido de cada jornada.\n\n' +
            '▸ **➕ Añadir** — registra a tu co-capitán con su ID de Discord\n' +
            '▸ **➖ Quitar** — elimina al co-capitán actual\n' +
            '▸ **👁️ Ver** — consulta quién es tu co-capitán registrado'
        )
        .setFooter({ text: 'Clutch Draft · Solo capitanes registrados pueden gestionar co-capitanes' })
        .setTimestamp();
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('cocap_add').setLabel('➕ Añadir').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('cocap_remove').setLabel('➖ Quitar').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('cocap_view').setLabel('👁️ Ver').setStyle(ButtonStyle.Secondary),
        botonWeb('Ir al draft', '/draft', '🎮'),
    );
    await ch.send({ embeds: [embed], components: [row] });
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('canal_cocapitanes', ?)").run(ch.id);
    console.log(`✅ Canal co-capitanes creado (${ch.id})`);
    return ch.id;
}

async function guardarHistorial() {
    try {
        const tabla = db.prepare('SELECT * FROM clasificacion ORDER BY puntos DESC, pg DESC, gf DESC').all();
        if (!tabla.length) return null;
        const campeon    = tabla[0]?.equipo_nombre || 'N/A';
        const subcampeon = tabla[1]?.equipo_nombre || 'N/A';
        const nEquipos   = tabla.length;
        let formato = 'Liga';
        if (nEquipos <= 6) formato = '2 Grupos + Final';
        else if (nEquipos <= 12) formato = '2 Grupos + Semis + Final';
        const fechaInicio = db.prepare("SELECT value FROM settings WHERE key='torneo_inicio'").get()?.value || new Date().toISOString();
        const partidos = db.prepare(`SELECT * FROM matches ORDER BY jornada ASC, id ASC`).all();
        db.prepare(`INSERT INTO historial_torneos (fecha_inicio, fecha_fin, n_equipos, formato, campeon, subcampeon, clasificacion, partidos)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
            fechaInicio, new Date().toISOString(), nEquipos, formato, campeon, subcampeon,
            JSON.stringify(tabla), JSON.stringify(partidos)
        );
        console.log('✅ Historial guardado. Campeón:', campeon);
        return { campeon, subcampeon, tabla };
    } catch(e) { console.error('Error guardando historial:', e.message); return null; }
}

async function anunciarCampeon(guild, campeon, subcampeon, tabla) {
    try {
        const canal = await guild.channels.fetch(CANAL_ANUNCIOS);
        const podio = tabla.slice(0, 3).map((eq, i) => {
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉';
            return `${medal} **${eq.equipo_nombre}** — ${eq.puntos} pts`;
        }).join('\n');
        const embed = new EmbedBuilder()
            .setTitle('🏆 ¡TORNEO FINALIZADO!')
            .setColor(0xffd700)
            .setDescription(`**🥇 CAMPEÓN: ${campeon}**\n**🥈 Subcampeón: ${subcampeon}**`)
            .addFields({ name: '🏅 Podio', value: podio, inline: false })
            .setTimestamp();
        await canal.send({ content: `<@&${ROL_JUGADOR}> <@&${ROL_CAPITAN}>`, embeds: [embed] });
    } catch(e) { console.error('Error anunciando campeón:', e.message); }
}

async function comprobarFinTorneo() {
    // Fallback cron: comprueba si la jornada actual está completa y avanza si es necesario
    try {
        const torneoGenerado = db.prepare("SELECT value FROM settings WHERE key='torneo_generado'").get()?.value;
        if (!torneoGenerado) return;
        const jornadaActual = parseInt(db.prepare("SELECT value FROM settings WHERE key='jornada_actual'").get()?.value || '1');
        const pendientes    = db.prepare("SELECT COUNT(*) as c FROM matches WHERE jornada=? AND estado='pendiente'").get(jornadaActual)?.c || 0;
        if (pendientes === 0) {
            const guild = client.guilds.cache.first();
            if (guild) await generarSiguienteJornada(guild);
        }
    } catch(e) { console.error('Error en comprobarFinTorneo:', e.message); }
}

// Limpieza automática desactivada — gestionar manualmente desde el panel de admin
// cron.schedule('*/5 * * * *', async () => {
//     await comprobarFinTorneo();
//     await comprobarLimpiezaAutomatica();
// }, { timezone: 'Europe/Madrid' });

// ══════════════════════════════════════════════════════════════
//  LIMPIEZA EN DOS FASES (1h Discord · 2h Datos web)
// ══════════════════════════════════════════════════════════════

// FASE 1 — Borrar canales de Discord (partidos + públicos + texto)
async function limpiarDiscord(guild) {
    try {
        // 1a. Canales privados de partidos (en memoria)
        for (const [, canalId] of Object.entries(canalesPartido)) {
            try {
                const ch = guild.channels.cache.get(canalId) || await guild.channels.fetch(canalId).catch(() => null);
                if (ch) await ch.delete();
            } catch(e) { /* ya borrado */ }
        }
        // 1b. Residuales en CATEGORIA_PARTIDOS (incluye canales públicos)
        try {
            await guild.channels.fetch();
            const residuales = guild.channels.cache.filter(c => c.parentId === CATEGORIA_PARTIDOS && c.type === 0);
            for (const [, ch] of residuales) await ch.delete().catch(() => {});
        } catch(e) { /* ignorar */ }

        for (const k of Object.keys(canalesPartido))     delete canalesPartido[k];
        for (const k of Object.keys(reportesPendientes)) delete reportesPendientes[k];

        // Borrar canales de voz
        await borrarCanalesVoz();

        // 1c. Borrar canales pre-draft por ID guardado en settings
        const clavesPreDraft = ['canal_jugadores_inscritos','canal_votacion_precio','canal_pagos','canal_lista_draft','canal_formatos'];
        for (const clave of clavesPreDraft) {
            const chId = db.prepare("SELECT value FROM settings WHERE key=?").get(clave)?.value;
            if (chId) {
                try {
                    const ch = await guild.channels.fetch(chId).catch(() => null);
                    if (ch) await ch.delete();
                } catch(e) { /* ya borrado */ }
                db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,'')").run(clave);
            }
        }

        // Fallback: borrar por nombre en categoría DRAFT (por si el ID no estaba guardado)
        const nombresDinamicos = [
            'jugadores-inscritos', 'votacion-precio', 'pagos', 'lista-draft', 'formatos'
        ];
        await guild.channels.fetch();
        const dinamicos = guild.channels.cache.filter(c =>
            c.parentId === CATEGORIA_DRAFT &&
            c.type === 0 &&
            nombresDinamicos.some(n => c.name.includes(n))
        );
        for (const [, ch] of dinamicos) await ch.delete().catch(() => {});

        // Limpiar panel de inscripciones
        try {
            const chInsc = await guild.channels.fetch(CANAL_INSCRIPCIONES).catch(() => null);
            if (chInsc) await borrarMensajesCanal(chInsc);
            db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('panel_msg_id','')").run();
            db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('panel_ch_id','')").run();
        } catch(e) { /* ignorar */ }

        // 1d. Limpiar IDs de canales públicos en settings
        const clavesPub = ['canal_pub_equipos','canal_pub_clasificacion','canal_pub_resultados','canal_pub_rondas'];
        for (const clave of clavesPub) db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,'')").run(clave);

        // 1d. Limpiar mensajes de canales de texto permanentes
        const canalesALimpiar = [CANAL_CALENDARIO, CANAL_CLASIFICACION, CANAL_FICHAJES, CANAL_EQUIPOS_IDS, '1489289116968288506'];
        for (const chId of canalesALimpiar) {
            try {
                const ch = await guild.channels.fetch(chId);
                let ms = await ch.messages.fetch({ limit: 100 });
                while (ms.size > 0) {
                    await ch.bulkDelete(ms).catch(async () => {
                        for (const [, msg] of ms) await msg.delete().catch(() => {});
                    });
                    ms = await ch.messages.fetch({ limit: 100 });
                    if (ms.size === 0) break;
                }
            } catch(e) { /* ignorar */ }
        }

        // 1e. Quitar roles ROL_JUGADOR y ROL_CAPITAN a todos los miembros
        await quitarRolesDraft(guild);

        console.log('✅ Fase 1 completada: canales de Discord limpiados.');
    } catch(e) { console.error('Error en limpiarDiscord:', e.message); }
}

async function quitarRolesDraft(guild) {
    try {
        await guild.members.fetch();
        const miembros = guild.members.cache.filter(m =>
            m.roles.cache.has(ROL_JUGADOR) || m.roles.cache.has(ROL_CAPITAN)
        );
        let quitados = 0;
        for (const [, member] of miembros) {
            try {
                if (member.roles.cache.has(ROL_JUGADOR))  await member.roles.remove(ROL_JUGADOR).catch(() => {});
                if (member.roles.cache.has(ROL_CAPITAN))  await member.roles.remove(ROL_CAPITAN).catch(() => {});
                quitados++;
            } catch(e) { /* ignorar errores individuales */ }
        }
        console.log(`✅ Roles draft eliminados de ${quitados} miembro(s).`);
    } catch(e) { console.error('Error quitando roles draft:', e.message); }
}

// FASE 2 — Limpiar datos de la DB y notificar a la web
async function limpiarDatos() {
    try {
        db.prepare('DELETE FROM matches').run();
        db.prepare('DELETE FROM clasificacion').run();
        db.prepare('UPDATE players SET equipo=NULL').run();
        db.prepare('DELETE FROM picks').run();
        db.prepare('DELETE FROM teams').run();
        db.prepare('DELETE FROM cocapitanes').run();
        db.prepare("UPDATE settings SET value='1'       WHERE key='jornada_actual'").run();
        db.prepare("UPDATE settings SET value='cerrado' WHERE key='draft_estado'").run();
        db.prepare("UPDATE settings SET value=''        WHERE key='turno_actual'").run();
        db.prepare("UPDATE settings SET value='asc'     WHERE key='direccion_snake'").run();
        db.prepare("UPDATE settings SET value='1'       WHERE key='ronda_actual'").run();
        db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('torneo_generado','')").run();
        db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('total_rondas_swiss','')").run();
        db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('canal_cocapitanes','')").run();
        db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('torneo_fin_ts','')").run();
        db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('discord_limpiado','')").run();
        db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('datos_limpiados','')").run();
        db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('fase_actual','')").run();
        db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('fases_torneo','')").run();

        await axios.post('http://localhost:3000/api/torneo-limpiado').catch(() => {});
        console.log('✅ Fase 2 completada: datos limpiados y web notificada.');
    } catch(e) { console.error('Error en limpiarDatos:', e.message); }
}

// LIMPIEZA TOTAL INMEDIATA — para uso manual con !limpiar todo
async function limpiarTorneo() {
    try {
        const guild = client.guilds.cache.first();
        if (!guild) return;
        await limpiarDiscord(guild);
        await limpiarDatos();
        console.log('✅ Torneo limpiado completamente (manual).');
    } catch(e) { console.error('Error limpiando torneo:', e.message); }
}

// COMPROBACIÓN AUTOMÁTICA — se ejecuta en el cron cada 5 min
async function comprobarLimpiezaAutomatica() {
    try {
        const finTs = db.prepare("SELECT value FROM settings WHERE key='torneo_fin_ts'").get()?.value;
        if (!finTs) return;

        const minutosTranscurridos = (Date.now() - new Date(finTs).getTime()) / 60000;
        const guild = client.guilds.cache.first();
        if (!guild) return;

        const discordLimpiado = db.prepare("SELECT value FROM settings WHERE key='discord_limpiado'").get()?.value;
        const datosLimpiados  = db.prepare("SELECT value FROM settings WHERE key='datos_limpiados'").get()?.value;

        if (minutosTranscurridos >= 60 && !discordLimpiado) {
            console.log('⏰ 1h tras fin de torneo — limpiando Discord automáticamente...');
            await limpiarDiscord(guild);
            db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('discord_limpiado','1')").run();
        }

        if (minutosTranscurridos >= 120 && !datosLimpiados) {
            console.log('⏰ 2h tras fin de torneo — limpiando datos automáticamente...');
            await limpiarDatos();
            // limpiarDatos ya resetea torneo_fin_ts y datos_limpiados
        }
    } catch(e) { console.error('Error en comprobarLimpiezaAutomatica:', e.message); }
}

// ══════════════════════════════════════════════════════════════
//  EVENTOS — Ready, messageCreate
// ══════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════
//  NORMATIVA — publicar en canal dedicado
// ══════════════════════════════════════════════════════════════
async function publicarNormativa(guild) {
    try {
        const canal = await guild.channels.fetch(CANAL_NORMATIVA);

        // Limpiar mensajes anteriores
        await borrarMensajesCanal(canal);

        // ── 1. CABECERA ───────────────────────────────────────
        const embedCabecera = new EmbedBuilder()
            .setTitle('📜  REGLAMENTO OFICIAL — CLUTCH DRAFT')
            .setColor(0x00ffcc)
            .setDescription(
                '> Lee y respeta el reglamento.\n> **El Staff tiene la última palabra en cualquier decisión.**'
            )
            .setImage('https://cdn.discordapp.com/attachments/1256961086792405145/1491848145347543211/B7A31A1C-3702-4E63-A5FB-3F40AD10A185.png?ex=69d92f5b&is=69d7dddb&hm=93989c061e950505a98f845de4dd3f65b679b6143fb627285cbc48ab129d0ba6&')
            .setFooter({ text: 'Clutch Draft · Sistema de Competición' })
            .setTimestamp();
        await canal.send({ embeds: [embedCabecera] });

        // ── 2. RESTRICCIONES DE JUEGO — imagen estilos vetados ─
        const imgPath = require('path').join(__dirname, '../public/uploads/playstyles_banneados.png');
        if (fs.existsSync(imgPath)) {
            const adjunto = new AttachmentBuilder(imgPath, { name: 'playstyles_banneados.png' });
            const embedImg = new EmbedBuilder()
                .setTitle('🚫  ESTILOS DE JUEGO VETADOS')
                .setColor(0xff4d4d)
                .setDescription('Los siguientes **playstyles** están **completamente prohibidos** en todas las competiciones de Clutch Draft.')
                .setImage('attachment://playstyles_banneados.png');
            await canal.send({ embeds: [embedImg], files: [adjunto] });
        }

        // ── 3. RESTRICCIONES — alturas y DFC ─────────────────
        const embedRestricciones = new EmbedBuilder()
            .setTitle('⚠️  RESTRICCIONES DE JUEGO')
            .setColor(0xffcc00)
            .addFields(
                {
                    name: '📏  Reglamento de Alturas',
                    value: [
                        '```',
                        'DFC  (Centrales)     → máx. 187 cm  ❌',
                        'Otras posiciones     → máx. 182 cm  ⚠️',
                        'Portero              → máx. 192 cm  ✅',
                        '```',
                        '> Sobrepasar el límite conlleva **penalización como capitán**.',
                        '> Abuso detectado conlleva **partido perdido**.',
                        '> Es **obligatorio grabar siempre las alturas**.',
                    ].join('\n'),
                    inline: false,
                },
                {
                    name: '🛡️  Subida de los DFC en Partido',
                    value: 'Los defensas **no pueden subir al ataque de forma fija** hasta el **minuto 75**.\nLas subidas puntuales son permitidas, pero la táctica fija de ataque está **prohibida** antes de ese minuto.',
                    inline: false,
                }
            );
        await canal.send({ embeds: [embedRestricciones] });

        // ── 4. PROTOCOLO DE PARTIDO ───────────────────────────
        const embedProtocolo = new EmbedBuilder()
            .setTitle('📡  PROTOCOLO DE PARTIDO')
            .setColor(0x3399ff)
            .addFields(
                {
                    name: '🔌  Reinicios',
                    value: '**Salidas:** Solo **una vez** y antes del **minuto 10**.\nTras el minuto 10 se acaba con los que estén. No se repetirá el partido por desconexiones tardías.',
                    inline: false,
                },
                {
                    name: '👥  Reemplazo por Ausencia',
                    value: 'Si un jugador elegido **no se presenta**, el capitán debe avisar a la Administración.\nEl uso de jugadores fuera de lista es **excepcional** y requiere aprobación previa del Staff.',
                    inline: false,
                },
                {
                    name: '🚨  Cláusula Anti-Trol',
                    value: 'Si un jugador va a arbitraje por **"trollear"**, el capitán busca sustituto inmediato.\nDeben presentarse **pruebas** al Staff. El Staff evaluará y tomará la decisión final.',
                    inline: false,
                },
                {
                    name: '🪪  Verificación de IDs',
                    value: 'Si se confirma que el jugador inscrito está usando el ID correcto, **no se perderá el partido por errores de forma en el ID**.\nLa verificación es responsabilidad compartida entre el capitán y el Staff.',
                    inline: false,
                }
            );
        await canal.send({ embeds: [embedProtocolo] });

        // ── 5. REGLAS DEL DRAFT ───────────────────────────────
        const embedDraft = new EmbedBuilder()
            .setTitle('📋  REGLAS DEL DRAFT')
            .setColor(0xa066ff)
            .addFields(
                {
                    name: '🔀  Sistema Snake Draft',
                    value: 'El orden sigue el sistema **snake**: en rondas impares de 1 al último, en rondas pares al revés.\nCada capitán tiene **90 segundos** por turno. Si el tiempo expira, el turno se salta automáticamente.',
                    inline: false,
                },
                {
                    name: '✅  Límites de Plantilla',
                    value: [
                        '```',
                        'DC  (Delantero Centro)   → máx. 2',
                        'MC  (Mediocentro)         → máx. 3',
                        'CARR (Carrilero)          → máx. 2',
                        'DFC (Defensa Central)     → máx. 3',
                        'POR (Portero)             → máx. 1',
                        '```',
                        'No se pueden sobrepasar estos límites **bajo ningún concepto**.',
                    ].join('\n'),
                    inline: false,
                },
                {
                    name: '🔒  Cambio de Formación',
                    value: 'La formación solo puede modificarse mientras el draft está **cerrado**.\nUna vez abierto el draft, queda **bloqueada** hasta el siguiente período de cierre.',
                    inline: false,
                }
            );
        await canal.send({ embeds: [embedDraft] });

        // ── 6. AUTORIDAD ADMINISTRATIVA ───────────────────────
        const embedAdmin = new EmbedBuilder()
            .setTitle('⚖️  AUTORIDAD ADMINISTRATIVA')
            .setColor(0xf0c040)
            .addFields(
                {
                    name: '🔱  Criterio del Staff',
                    value: 'El criterio del Staff **prevalece sobre el texto escrito**.\n**¡La última palabra siempre es de los Admins!**\nCualquier situación no contemplada será resuelta por el Staff a su criterio.',
                    inline: false,
                },
                {
                    name: '🚫  Sanciones',
                    value: 'El incumplimiento puede conllevar:\n• **Advertencia**\n• **Pérdida de partido**\n• **Expulsión del torneo**\n• **Baneo permanente** de futuras ediciones\n\nLa gravedad la determina el Staff.',
                    inline: false,
                }
            );
        await canal.send({ embeds: [embedAdmin] });

        // ── 7. FORMATOS DE COMPETICIÓN ────────────────────────
        const embedFormatos = new EmbedBuilder()
            .setTitle('🏆  FORMATOS DE COMPETICIÓN')
            .setColor(0x00ffcc)
            .setDescription('El formato se determina **automáticamente** según el número de equipos participantes.')
            .addFields(
                {
                    name: '⚡  COPA — 4 Equipos  `(3 jornadas · 5 partidos)`',
                    value: '▸ Semis ida y vuelta (J1+J2) · Final partido único (J3)\n▸ Llave A: 1º vs 4º · Llave B: 2º vs 3º · Empate global → 3er partido a gol de oro',
                    inline: false,
                },
                {
                    name: '✂️  CHAMPIONS CORTE DIRECTO — 6 Equipos  `(3–4 jornadas)`',
                    value: '▸ Tabla única · Sistema Swiss · Solo los **4 primeros** continúan\n▸ 5º y 6º eliminados en liga\n▸ Fase final: Semi 1 (1º vs 4º) · Semi 2 (2º vs 3º) · **Gran Final**',
                    inline: false,
                },
                {
                    name: '⭐  NUEVO FORMATO CHAMPIONS — 8 Equipos  `(3 jornadas)`',
                    value: '▸ Tabla única · 1º–2º van directo a **Semis**\n▸ 3º–6º juegan **Cuartos** (3º vs 6º · 4º vs 5º)\n▸ 7º–8º eliminados',
                    inline: false,
                },
                {
                    name: '🛡️  FORMATO CHAMPIONS — 10 Equipos  `(3 jornadas)`',
                    value: '▸ Tabla única · 1º–2º directo a **Semis**\n▸ 3º–6º juegan **Cuartos** · 7º–10º eliminados',
                    inline: false,
                },
                {
                    name: '👑  NUEVO CHAMPIONS MÁXIMO NIVEL — 12 Equipos  `(4 jornadas)`',
                    value: '▸ 1º–4º directo a **Cuartos** · 5º–12º luchan en **Play-offs** (8 por 4 plazas)\n▸ Play-offs → Cuartos → Semis → **Gran Final**',
                    inline: false,
                }
            );
        await canal.send({ embeds: [embedFormatos] });

        // ── 8. CRITERIOS DE DESEMPATE ─────────────────────────
        const embedDesempate = new EmbedBuilder()
            .setTitle('⚖️  CRITERIOS DE DESEMPATE EN LIGA')
            .setColor(0xffcc00)
            .setDescription('Se aplican en este **orden estricto** cuando dos o más equipos empatan en puntos:')
            .addFields({
                name: 'Orden de aplicación',
                value: [
                    '`1.` Puntos acumulados',
                    '`2.` Diferencia de goles (GF – GC)',
                    '`3.` Goles a favor (GF)',
                    '`4.` Resultado directo entre los empatados',
                    '`5.` Goles a favor en el partido directo',
                    '`6.` Sorteo (si todo lo anterior sigue igual)',
                ].join('\n'),
                inline: false,
            })
            .setFooter({ text: 'El Staff tiene la decisión final en casos excepcionales.' });
        await canal.send({ embeds: [embedDesempate] });

        // ── 9. AVISO FINAL ────────────────────────────────────
        const embedAviso = new EmbedBuilder()
            .setColor(0x00ffcc)
            .setDescription(
                '> ℹ️ Al participar en el **Clutch Draft**, aceptas estas normas en su totalidad.\n' +
                '> El Staff se reserva el derecho de modificar el reglamento con previo aviso.\n' +
                '> **Ante cualquier duda, consulta con la administración antes de actuar.**'
            )
            .setFooter({ text: `Reglamento publicado · ${new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' })}` });
        await canal.send({ embeds: [embedAviso] });

        console.log('✅ Normativa publicada en canal #normativa.');
    } catch(e) { console.error('Error publicando normativa:', e.message); }
}

// ══════════════════════════════════════════════════════════════
//  PANEL DE ADMIN
// ══════════════════════════════════════════════════════════════
function buildAdminStatusEmbed() {
    const inscEstado   = db.prepare("SELECT value FROM settings WHERE key='inscripciones_estado'").get()?.value || 'abierto';
    const draftEstado  = db.prepare("SELECT value FROM settings WHERE key='draft_estado'").get()?.value || 'cerrado';
    const turno        = db.prepare("SELECT value FROM settings WHERE key='turno_actual'").get()?.value || '—';
    const torneoGen    = db.prepare("SELECT value FROM settings WHERE key='torneo_generado'").get()?.value;
    const faseActual   = db.prepare("SELECT value FROM settings WHERE key='fase_actual'").get()?.value || '—';
    const precio       = db.prepare("SELECT value FROM settings WHERE key='precio_torneo'").get()?.value || '—';
    const jornada      = db.prepare("SELECT value FROM settings WHERE key='jornada_actual'").get()?.value || '1';
    const nJugadores   = db.prepare("SELECT COUNT(*) as c FROM players").get()?.c || 0;
    const nEquipos     = db.prepare("SELECT COUNT(*) as c FROM teams").get()?.c || 0;
    const nPartidos    = db.prepare("SELECT COUNT(*) as c FROM matches WHERE estado='pendiente'").get()?.c || 0;

    const estadoInsc  = inscEstado  === 'abierto' ? '🟢 Abiertas'  : '🔴 Cerradas';
    const estadoDraft = draftEstado === 'abierto' ? '🟢 Abierto'   : '🔴 Cerrado';
    const estadoTorn  = torneoGen   ? `🟢 Generado (J${jornada} · ${faseActual || 'liga'})` : '⚪ No generado';

    return new EmbedBuilder()
        .setTitle('🛠️ PANEL DE ADMINISTRACIÓN — CLUTCH DRAFT')
        .setColor(0xa066ff)
        .addFields(
            { name: '📋 Inscripciones', value: estadoInsc,  inline: true },
            { name: '⚽ Draft',         value: estadoDraft, inline: true },
            { name: '🏆 Torneo',        value: estadoTorn,  inline: true },
            { name: '👥 Jugadores',     value: `${nJugadores}`, inline: true },
            { name: '🛡️ Equipos',      value: `${nEquipos}`,   inline: true },
            { name: '⚔️ Partidos pendientes', value: `${nPartidos}`, inline: true },
            { name: '💰 Precio votado', value: precio !== '—' ? `${precio} €` : '—', inline: true },
            { name: '🎯 Turno actual',  value: turno, inline: true },
        )
        .setFooter({ text: `Clutch Draft Admin · Actualizado ${new Date().toLocaleTimeString('es-ES')}` })
        .setTimestamp();
}

function buildAdminPanelBlocks() {
    // Bloque 1 — Inscripciones
    const horarioActual      = db.prepare(`SELECT value FROM settings WHERE key='horario_torneo'`).get()?.value || 'No definido';
    const fechaLimiteInsc    = db.prepare(`SELECT value FROM settings WHERE key='fecha_limite_inscripciones'`).get()?.value || 'No definida';
    const b1embed = new EmbedBuilder().setTitle('📋 INSCRIPCIONES').setColor(0x00ffcc)
        .setDescription(`Gestión del período de inscripción de jugadores.\n📅 Horario: **${horarioActual}**\n⏰ Fecha límite inscripciones: **${fechaLimiteInsc}**`);
    const b1rows = [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('admp_insc_abrir').setLabel('🟢 Abrir inscripciones').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('admp_insc_cerrar').setLabel('🔴 Cerrar inscripciones').setStyle(ButtonStyle.Danger),
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('admp_set_horario').setLabel('📅 Cambiar horario').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('admp_set_fecha_limite').setLabel('⏰ Fecha límite inscripciones').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('admp_set_tiempo_uh').setLabel('⏱️ Tiempo última hora').setStyle(ButtonStyle.Secondary),
        ),
    ];

    // Bloque 2 — Pagos & Votación
    const b2embed = new EmbedBuilder().setTitle('💰 PAGOS & VOTACIÓN').setColor(0xffcc00)
        .setDescription('Gestión de la votación de precio y paneles de pago.');
    const b2rows = [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('admp_vot_iniciar').setLabel('🗳️ Iniciar votación').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('admp_vot_cerrar').setLabel('⏹️ Cerrar votación').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('admp_cap_doble').setLabel('👥 Capitanía doble').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('admp_forzar_capitan').setLabel('👑 Forzar capitán').setStyle(ButtonStyle.Secondary),
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('admp_pago_10').setLabel('💶 Panel pago 10 €').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('admp_pago_15').setLabel('💶 Panel pago 15 €').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('admp_pago_20').setLabel('💶 Panel pago 20 €').setStyle(ButtonStyle.Secondary),
        ),
    ];

    // Bloque 2b — Capitanes Draft Gratuito
    const draftTipo        = db.prepare(`SELECT value FROM settings WHERE key='draft_tipo'`).get()?.value || '';
    const numEquiposManual = db.prepare(`SELECT value FROM settings WHERE key='num_equipos_manual'`).get()?.value || '';
    const formatoManual    = db.prepare(`SELECT value FROM settings WHERE key='formato_manual'`).get()?.value || '';
    const capsPorEquipo    = db.prepare(`SELECT value FROM settings WHERE key='caps_por_equipo'`).get()?.value || '1';
    const nCandidatos      = db.prepare(`SELECT COUNT(*) as c FROM candidatos_capitan WHERE confirmado=0`).get()?.c || 0;
    const nConfirmados     = db.prepare(`SELECT COUNT(*) as c FROM candidatos_capitan WHERE confirmado=1`).get()?.c || 0;
    const b2bEmbed = new EmbedBuilder().setTitle('🆓 DRAFT GRATUITO — CAPITANES').setColor(0xa066ff)
        .setDescription(
            `Tipo de draft actual: **${draftTipo || 'no definido'}**\n` +
            `Candidatos: **${nCandidatos}** | Confirmados: **${nConfirmados}**\n` +
            `Equipos: **${numEquiposManual || 'auto'}** | Formato: **${formatoManual || 'auto'}** | Caps/equipo: **${capsPorEquipo}**`
        );
    const b2brows = [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('admp_cap_gratis_forzar').setLabel('👑 Forzar capitán').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('admp_cap_gratis_quitar').setLabel('🗑️ Quitar candidato').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('admp_cap_gratis_config').setLabel('⚙️ Config equipos').setStyle(ButtonStyle.Secondary),
        ),
    ];

    // Bloque 3 — Draft
    const fechaDraft = db.prepare(`SELECT value FROM settings WHERE key='fecha_draft'`).get()?.value || 'No definida';
    const b3embed = new EmbedBuilder().setTitle('⚽ DRAFT').setColor(0x3399ff)
        .setDescription(`Control del draft de selección de jugadores.\n📆 Fecha del draft: **${fechaDraft}**`);
    const b3rows = [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('admp_draft_abrir').setLabel('🟢 Abrir draft').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('admp_draft_cerrar').setLabel('🔴 Cerrar draft').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('admp_set_fecha_draft').setLabel('📆 Cambiar fecha draft').setStyle(ButtonStyle.Secondary),
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('admp_draft_saltar').setLabel('⏭️ Saltar turno (pide confirmación)').setStyle(ButtonStyle.Secondary),
        ),
    ];

    // Bloque 4 — Torneo
    const b4embed = new EmbedBuilder().setTitle('🏆 TORNEO').setColor(0xf0c040)
        .setDescription('Generación y gestión del torneo.');
    const b4rows = [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('admp_torneo_generar').setLabel('⚙️ Generar torneo').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('admp_torneo_fase').setLabel('⏩ Forzar siguiente fase').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('admp_torneo_recalc').setLabel('🔄 Recalcular clasificación').setStyle(ButtonStyle.Secondary),
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('admp_clasi_discord').setLabel('📊 Actualizar clasificación Discord').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('admp_torneo_cerrar').setLabel('🏁 Cerrar torneo').setStyle(ButtonStyle.Danger),
        ),
    ];

    // Bloque 5 — Limpieza & Utilidades
    const b5embed = new EmbedBuilder().setTitle('🧹 LIMPIEZA & UTILIDADES').setColor(0xff4d4d)
        .setDescription('Limpieza de canales y acciones de mantenimiento.');
    const b5rows = [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('admp_limpiar_canales').setLabel('🗑️ Limpiar canales partido').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('admp_limpiar_texto').setLabel('📝 Limpiar canales texto').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('admp_recrear_canales').setLabel('🔧 Recrear canales partido').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('admp_formatos').setLabel('📋 Publicar formatos').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('admp_normativa').setLabel('📜 Publicar normativa').setStyle(ButtonStyle.Secondary),
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('admp_limpiar_todo').setLabel('💥 LIMPIAR TODO').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('admp_refresh').setLabel('🔄 Actualizar estado').setStyle(ButtonStyle.Success),
        ),
    ];

    // Bloque 5b — Canales de Partido
    const b5bembed = new EmbedBuilder().setTitle('📡 CANALES DE PARTIDO').setColor(0x3399ff)
        .setDescription('Gestión manual de canales de partido. Usa si algún canal no se creó bien o necesitas regenerarlo.');
    const b5brows = [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('admp_canal_lista').setLabel('📋 Ver partidos y canales').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('admp_canal_crear').setLabel('🔧 Crear/regenerar canal').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('admp_canal_borrar').setLabel('🗑️ Borrar canal').setStyle(ButtonStyle.Danger),
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('admp_canal_add_usuario').setLabel('👤 Añadir usuario a canal').setStyle(ButtonStyle.Secondary),
        ),
    ];

    // Bloque 6 — Testing & Simulación
    const b6embed = new EmbedBuilder().setTitle('🧪 TESTING & SIMULACIÓN').setColor(0x888888)
        .setDescription('Comandos para probar el flujo completo con equipos bot. Solo para pruebas, no usar en producción.');
    const b6rows = [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('admp_seed_10').setLabel('🗄️ Cargar seed 10 equipos').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('admp_test_inscripciones').setLabel('📋 Simular cierre inscripciones').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('admp_test_votos').setLabel('🗳️ Inyectar votos bot').setStyle(ButtonStyle.Secondary),
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('admp_test_pagos').setLabel('💳 Marcar bots como pagados').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('admp_draft_autocompletar').setLabel('⚡ Autocompletar draft bots').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('admp_torneo_simjornada').setLabel('🎲 Simular jornada aleatoria').setStyle(ButtonStyle.Secondary),
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('admp_borrar_bots').setLabel('🗑️ Borrar datos de prueba (bots)').setStyle(ButtonStyle.Danger),
        ),
    ];

    return [
        { embed: b1embed, rows: b1rows },
        { embed: b2embed, rows: b2rows },
        { embed: b2bEmbed, rows: b2brows },
        { embed: b3embed, rows: b3rows },
        { embed: b4embed, rows: b4rows },
        { embed: b5embed, rows: b5rows },
        { embed: b5bembed, rows: b5brows },
        { embed: b6embed, rows: b6rows },
    ];
}

async function publicarPanelAdmin(guild) {
    try {
        const canal = await guild.channels.fetch(CANAL_PANEL_ADMIN);

        // Borrar mensajes anteriores
        let msgs = await canal.messages.fetch({ limit: 100 });
        while (msgs.size > 0) {
            await canal.bulkDelete(msgs).catch(async () => {
                for (const [, m] of msgs) await m.delete().catch(() => {});
            });
            msgs = await canal.messages.fetch({ limit: 100 });
            if (msgs.size === 0) break;
        }

        // Publicar embed de estado
        const statusMsg = await canal.send({ embeds: [buildAdminStatusEmbed()] });
        db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('admin_panel_status_id',?)").run(statusMsg.id);

        // Publicar bloques
        const bloques = buildAdminPanelBlocks();
        const ids = [];
        for (const bloque of bloques) {
            const m = await canal.send({ embeds: [bloque.embed], components: bloque.rows });
            ids.push(m.id);
        }
        db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('admin_panel_msg_ids',?)").run(JSON.stringify(ids));
        console.log('✅ Panel de admin publicado.');
    } catch(e) { console.error('Error publicando panel admin:', e.message); }
}

async function refrescarStatusPanelAdmin(guild) {
    try {
        const canal    = await guild.channels.fetch(CANAL_PANEL_ADMIN).catch(() => null);
        if (!canal) return;
        const statusId = db.prepare("SELECT value FROM settings WHERE key='admin_panel_status_id'").get()?.value;
        if (!statusId) return;
        const msg = await canal.messages.fetch(statusId).catch(() => null);
        if (msg) await msg.edit({ embeds: [buildAdminStatusEmbed()] });
    } catch(e) { /* ignorar */ }
}

client.on('ready', () => {
    console.log(`✅ Bot conectado: ${client.user.tag}`);
    client.user.setActivity('⚽ Clutch Draft', { type: 3 });

    // Restaurar canalesPartido desde DB al reiniciar el bot
    try {
        const matches = db.prepare("SELECT id, canal_discord FROM matches WHERE canal_discord IS NOT NULL AND estado != 'finalizado'").all();
        for (const m of matches) canalesPartido[m.id] = m.canal_discord;
        console.log(`✅ Restaurados ${matches.length} canales de partido desde DB.`);
    } catch(e) { console.warn('No se pudieron restaurar canales de partido:', e.message); }

    // Poblar canal de clasificación y refrescar panel admin al arrancar
    setTimeout(async () => {
        const guild = client.guilds.cache.first();
        if (!guild) return;

        await actualizarCanalClasificacion(guild).catch(e =>
            console.warn('No se pudo actualizar clasificación al arrancar:', e.message)
        );
        await refrescarStatusPanelAdmin(guild).catch(e =>
            console.warn('No se pudo refrescar panel admin al arrancar:', e.message)
        );

        // Publicar normativa si el canal está vacío
        try {
            const canalNormas = await guild.channels.fetch(CANAL_NORMATIVA).catch(() => null);
            if (canalNormas) {
                const msgs = await canalNormas.messages.fetch({ limit: 1 });
                if (msgs.size === 0) {
                    await publicarNormativa(guild);
                    console.log('✅ Normativa publicada automáticamente (canal estaba vacío).');
                }
            }
        } catch(e) { console.warn('No se pudo verificar canal normativa:', e.message); }

    }, 5000); // 5s para que Discord termine de cachear canales
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    const content = message.content.trim();

    // ── !panel ──────────────────────────────────────────────
    if (content === '!panel') {
        const isAdmin = await esAdminDiscord(message.author.id);
        if (!isAdmin) {
            await message.reply('❌ Solo los admins pueden usar este comando.');
            message.delete().catch(() => {});
            return;
        }
        const embed = buildPanelEmbed();
        const rows  = buildPanelRows();
        const msg   = await message.channel.send({ embeds: [embed], components: rows });
        db.prepare(`UPDATE settings SET value=? WHERE key='panel_msg_id'`).run(msg.id);
        db.prepare(`UPDATE settings SET value=? WHERE key='panel_ch_id'`).run(message.channel.id);
        message.delete().catch(() => {});
        return;
    }

    // ── !limpiar [canales|fichajes|clasificacion|todo] ───────
    // Solo admins (superadmin o admins secundarios en DB)
    if (content.startsWith('!limpiar')) {
        const isAdmin = await esAdminDiscord(message.author.id);
        if (!isAdmin) {
            await message.reply({ content: '❌ Solo los admins pueden usar este comando.', ephemeral: false });
            return;
        }

        const arg = content.split(' ')[1]?.toLowerCase() || 'canales';
        const guild = message.guild;

        if (arg === 'canales' || arg === 'partidos') {
            // Borrar canales de partido en la categoría CATEGORIA_PARTIDOS
            let borrados = 0;
            const canalesCategoria = guild.channels.cache.filter(c => c.parentId === CATEGORIA_PARTIDOS && c.type === 0);
            for (const [, ch] of canalesCategoria) {
                await ch.delete().catch(() => {});
                borrados++;
            }
            for (const k of Object.keys(canalesPartido)) delete canalesPartido[k];
            await message.reply(`✅ ${borrados} canal(es) de partido borrados.`);
        } else if (arg === 'fichajes') {
            try {
                const ch = await guild.channels.fetch(CANAL_FICHAJES);
                let ms = await ch.messages.fetch({ limit: 100 });
                while (ms.size > 0) {
                    await ch.bulkDelete(ms).catch(async () => {
                        for (const [, msg] of ms) await msg.delete().catch(() => {});
                    });
                    ms = await ch.messages.fetch({ limit: 100 });
                    if (ms.size === 0) break;
                }
                await message.reply('✅ Canal de fichajes limpiado.');
            } catch(e) { await message.reply('❌ Error: ' + e.message); }
        } else if (arg === 'texto') {
            // Limpia todos los canales de texto del torneo (sin tocar la DB)
            const ids = [CANAL_CALENDARIO, CANAL_CLASIFICACION, CANAL_FICHAJES, CANAL_EQUIPOS_IDS];
            let ok = 0, fail = 0;
            for (const chId of ids) {
                try {
                    const ch = await guild.channels.fetch(chId);
                    let ms = await ch.messages.fetch({ limit: 100 });
                    while (ms.size > 0) {
                        await ch.bulkDelete(ms).catch(async () => {
                            for (const [, msg] of ms) await msg.delete().catch(() => {});
                        });
                        ms = await ch.messages.fetch({ limit: 100 });
                        if (ms.size === 0) break;
                    }
                    ok++;
                } catch(e) { fail++; console.error(`Error limpiando canal ${chId}:`, e.message); }
            }
            await message.reply(`✅ ${ok} canal(es) de texto limpiados${fail ? ` (${fail} con error).` : '.'}`);
        } else if (arg === 'clasificacion') {
            await actualizarCanalClasificacion(guild);
            await message.reply('✅ Clasificación actualizada.');
        } else if (arg === 'todo') {
            await limpiarTorneo();
            await message.reply('✅ Todo limpiado (canales + clasificación + partidos).');
        } else {
            await message.reply('Uso: `!limpiar [canales|fichajes|texto|clasificacion|todo]`\n• `canales` — borra canales de partido\n• `fichajes` — limpia canal de fichajes\n• `texto` — limpia todos los canales de texto (fichajes, equipos, clasificación, calendario)\n• `clasificacion` — actualiza el canal de clasificación\n• `todo` — limpieza completa (Discord + DB)');
        }
        message.delete().catch(() => {});
        return;
    }

    // ── !lista-partidos ─────────────────────────────────────
    if (content === '!lista-partidos') {
        const isAdmin = await esAdminDiscord(message.author.id);
        if (!isAdmin) return message.reply('❌ Solo los admins pueden usar este comando.');
        const matches = db.prepare(`SELECT id, jornada, equipo1, equipo2, estado, canal_discord FROM matches ORDER BY jornada, id`).all();
        if (!matches.length) { await message.reply('No hay partidos registrados.'); message.delete().catch(() => {}); return; }
        const lineas = matches.map(m => {
            const canal = m.canal_discord ? `<#${m.canal_discord}>` : '❌ sin canal';
            const estado = m.estado === 'finalizado' ? '✅' : m.estado === 'en_curso' ? '🟡' : '⏳';
            return `${estado} **ID ${m.id}** · J${m.jornada} · ${m.equipo1} vs ${m.equipo2} · ${canal}`;
        }).join('\n');
        await message.channel.send({ embeds: [new EmbedBuilder().setColor(0x00ffcc).setTitle('📋 Partidos registrados').setDescription(lineas).setFooter({ text: 'Usa !crear-canal <id> para regenerar un canal' })] });
        message.delete().catch(() => {});
        return;
    }

    // ── !crear-canal <match_id> ──────────────────────────────
    if (content.startsWith('!crear-canal')) {
        const isAdmin = await esAdminDiscord(message.author.id);
        if (!isAdmin) return message.reply('❌ Solo los admins pueden usar este comando.');
        const matchId = parseInt(content.split(' ')[1]);
        if (isNaN(matchId)) { await message.reply('Uso: `!crear-canal <match_id>`\nEjemplo: `!crear-canal 5`\nUsa `!lista-partidos` para ver los IDs.'); message.delete().catch(() => {}); return; }
        const match = db.prepare('SELECT * FROM matches WHERE id=?').get(matchId);
        if (!match) { await message.reply(`❌ No existe ningún partido con ID **${matchId}**.`); message.delete().catch(() => {}); return; }
        if (match.estado === 'finalizado') { await message.reply(`⚠️ El partido **ID ${matchId}** ya está finalizado. ¿Seguro que quieres recrear el canal? Usa \`!crear-canal ${matchId} forzar\` para confirmar.`); message.delete().catch(() => {}); return; }

        // Si ya tiene canal, borrarlo primero
        if (match.canal_discord) {
            try {
                const chViejo = await message.guild.channels.fetch(match.canal_discord).catch(() => null);
                if (chViejo) await chViejo.delete();
            } catch(e) { /* ya borrado */ }
        }

        const cap1Id = db.prepare('SELECT capitan_id FROM teams WHERE capitan_username=?').get(match.equipo1)?.capitan_id;
        const cap2Id = db.prepare('SELECT capitan_id FROM teams WHERE capitan_username=?').get(match.equipo2)?.capitan_id;
        const canalId = await crearCanalPartido(message.guild, matchId, match.jornada, match.equipo1, match.equipo2, cap1Id, cap2Id);

        if (canalId) {
            db.prepare('UPDATE matches SET canal_discord=? WHERE id=?').run(canalId, matchId);
            canalesPartido[matchId] = canalId;
            await message.reply(`✅ Canal creado para **ID ${matchId}** · ${match.equipo1} vs ${match.equipo2} → <#${canalId}>`);
        } else {
            await message.reply(`❌ Error al crear el canal para **ID ${matchId}**. Revisa los logs con \`pm2 logs clutch-bot\`.`);
        }
        message.delete().catch(() => {});
        return;
    }

    // ── !borrar-canal <match_id> ─────────────────────────────
    if (content.startsWith('!borrar-canal')) {
        const isAdmin = await esAdminDiscord(message.author.id);
        if (!isAdmin) return message.reply('❌ Solo los admins pueden usar este comando.');
        const matchId = parseInt(content.split(' ')[1]);
        if (isNaN(matchId)) { await message.reply('Uso: `!borrar-canal <match_id>`'); message.delete().catch(() => {}); return; }
        const match = db.prepare('SELECT * FROM matches WHERE id=?').get(matchId);
        if (!match || !match.canal_discord) { await message.reply(`❌ El partido **ID ${matchId}** no tiene canal asignado.`); message.delete().catch(() => {}); return; }
        try {
            const ch = await message.guild.channels.fetch(match.canal_discord).catch(() => null);
            if (ch) await ch.delete();
            db.prepare('UPDATE matches SET canal_discord=NULL WHERE id=?').run(matchId);
            delete canalesPartido[matchId];
            await message.reply(`✅ Canal del partido **ID ${matchId}** borrado.`);
        } catch(e) {
            await message.reply(`❌ Error al borrar el canal: ${e.message}`);
        }
        message.delete().catch(() => {});
        return;
    }

    // ── !twitch [add|remove|lista] ──────────────────────────
    if (content.startsWith('!twitch')) {
        const isAdmin = await esAdminDiscord(message.author.id);
        if (!isAdmin) {
            await message.reply('❌ Solo los admins pueden usar este comando.');
            return;
        }
        const parts = content.split(/\s+/);
        const sub   = parts[1]?.toLowerCase();
        const login = parts[2]?.toLowerCase();

        if (sub === 'add' && login) {
            const token = await getTwitchToken();
            if (!token) {
                await message.reply('❌ Credenciales de Twitch no configuradas. Rellena `TWITCH_CLIENT_ID` y `TWITCH_CLIENT_SECRET` en el `.env`.');
                return;
            }
            try {
                const r = await axios.get(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(login)}`, {
                    headers: { 'Client-ID': process.env.TWITCH_CLIENT_ID, 'Authorization': `Bearer ${token}` }
                });
                const user = r.data.data[0];
                if (!user) {
                    await message.reply(`❌ No existe ningún canal de Twitch con el nombre **${login}**.`);
                    return;
                }
                db.prepare('INSERT OR IGNORE INTO twitch_tracked (twitch_login, display_name, profile_image) VALUES (?, ?, ?)').run(user.login, user.display_name, user.profile_image_url || null);
                await message.reply(`✅ **${user.display_name}** añadido. Recibirás notificaciones en <#${CANAL_TWITCH_NOTIF}> cuando entre en directo.`);
            } catch(e) {
                await message.reply('❌ Error verificando el canal: ' + e.message);
            }
        } else if (sub === 'remove' && login) {
            const r = db.prepare('DELETE FROM twitch_tracked WHERE twitch_login=?').run(login);
            if (r.changes) {
                await message.reply(`✅ **${login}** eliminado de las notificaciones.`);
            } else {
                await message.reply(`❌ **${login}** no estaba en la lista.`);
            }
        } else if (sub === 'lista') {
            const streamers = db.prepare('SELECT display_name, twitch_login, is_live FROM twitch_tracked ORDER BY display_name').all();
            if (!streamers.length) {
                await message.reply('📋 No hay streamers configurados. Usa `!twitch add <login>` para añadir uno.');
                return;
            }
            const lista = streamers.map(s =>
                `${s.is_live ? '🔴' : '⚫'} **${s.display_name}** — twitch.tv/${s.twitch_login}`
            ).join('\n');
            const embed = new EmbedBuilder()
                .setTitle('📋 Streamers monitorizados')
                .setDescription(lista)
                .setColor(0x9146FF)
                .setFooter({ text: '🔴 En directo  |  ⚫ Offline  —  Comprobación cada 2 min' });
            await message.reply({ embeds: [embed] });
        } else {
            await message.reply(
                '**Comandos Twitch:**\n' +
                '`!twitch add <login>` — Añadir streamer a notificaciones\n' +
                '`!twitch remove <login>` — Quitar streamer\n' +
                '`!twitch lista` — Ver streamers configurados'
            );
        }
        message.delete().catch(() => {});
        return;
    }

    // ── !formatos ────────────────────────────────────────────
    if (content === '!formatos') {
        const isAdmin = await esAdminDiscord(message.author.id);
        if (!isAdmin) {
            await message.reply({ content: '❌ Solo los admins pueden usar este comando.' });
            return;
        }

        const guild = message.guild;
        await publicarFormatos(guild);
        message.delete().catch(() => {});
        await message.channel.send({ content: '✅ Formatos publicados.' }).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
        return;
    }

    // ══════════════════════════════════════════════════════════
    //  COMANDOS DE ADMINISTRACIÓN MANUAL
    //  Solo el superadmin (ADMIN_ID) puede usarlos
    // ══════════════════════════════════════════════════════════

    if (content.startsWith('!admin')) {
        if (message.author.id !== ADMIN_ID) {
            await message.reply('❌ Solo el superadmin puede usar `!admin`.');
            return;
        }
        const args = content.split(/\s+/);
        const sub  = args[1]?.toLowerCase();
        const par  = args[2]?.toLowerCase();
        const guild = message.guild;
        const canal = await guild.channels.fetch(CANAL_ANUNCIOS).catch(() => null);

        // ── !admin inscripciones [abrir|cerrar] ──────────────
        if (sub === 'inscripciones') {
            if (par === 'abrir') {
                db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('inscripciones_estado','abierto')`).run();
                notificarInscripciones('abrir').catch(() => {});
                // Publicar/actualizar panel en el canal de inscripciones
                try {
                    const chInsc = await guild.channels.fetch(CANAL_INSCRIPCIONES);
                    const chId  = db.prepare(`SELECT value FROM settings WHERE key='panel_ch_id'`).get()?.value;
                    const msgId = db.prepare(`SELECT value FROM settings WHERE key='panel_msg_id'`).get()?.value;
                    // Si el panel ya está en el canal de inscripciones, editarlo; si no, publicar nuevo
                    if (chId === CANAL_INSCRIPCIONES && msgId) {
                        try {
                            const msg = await chInsc.messages.fetch(msgId);
                            await msg.edit({ embeds: [buildPanelEmbed()], components: buildPanelRows() });
                        } catch(e) {
                            await borrarMensajesCanal(chInsc);
                            const msg = await chInsc.send({ embeds: [buildPanelEmbed()], components: buildPanelRows() });
                            db.prepare(`UPDATE settings SET value=? WHERE key='panel_msg_id'`).run(msg.id);
                            db.prepare(`UPDATE settings SET value=? WHERE key='panel_ch_id'`).run(chInsc.id);
                        }
                    } else {
                        await borrarMensajesCanal(chInsc);
                        const msg = await chInsc.send({ embeds: [buildPanelEmbed()], components: buildPanelRows() });
                        db.prepare(`UPDATE settings SET value=? WHERE key='panel_msg_id'`).run(msg.id);
                        db.prepare(`UPDATE settings SET value=? WHERE key='panel_ch_id'`).run(chInsc.id);
                    }
                } catch(e) { console.error('Error publicando panel inscripciones:', e.message); }
                await anunciarInscripcionesAbiertas(guild).catch(() => {});
                await message.reply('✅ Inscripciones **abiertas** y panel publicado en <#' + CANAL_INSCRIPCIONES + '>.');
            } else if (par === 'cerrar') {
                await cerrarInscripciones();
                await message.reply('✅ Inscripciones cerradas. Votación de precio iniciada en anuncios.');
            } else {
                await message.reply('Uso: `!admin inscripciones [abrir|cerrar]`');
            }

        // ── !admin votacion [iniciar|cerrar] ─────────────────
        } else if (sub === 'votacion') {
            if (!canal) return message.reply('❌ Canal de anuncios no encontrado.');
            if (par === 'iniciar') {
                await lanzarVotacionPrecio(canal);
                await message.reply('✅ Votación de precio iniciada en anuncios (20 min).');
            } else if (par === 'cerrar') {
                await cerrarVotacionPrecio(canal);
                await message.reply('✅ Votación cerrada. Resultado y panel de pago publicados.');
            } else {
                await message.reply('Uso: `!admin votacion [iniciar|cerrar]`');
            }

        // ── !admin pago [10|15|20] ────────────────────────────
        } else if (sub === 'pago') {
            if (!canal) return message.reply('❌ Canal de anuncios no encontrado.');
            const precio = ['10','15','20'].includes(par) ? par : null;
            if (!precio) return message.reply('Uso: `!admin pago [10|15|20]`');
            db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('precio_torneo',?)`).run(precio);
            notificarPrecio(precio).catch(() => {});
            await lanzarPanelPago(canal, precio);
            await message.reply(`✅ Panel de pago lanzado en anuncios (${precio}€).`);

        // ── !admin draft [abrir|cerrar|saltar] ───────────────
        } else if (sub === 'draft') {
            if (par === 'abrir') {
                try {
                    await axios.post('http://localhost:3000/api/bot/abrir-draft');
                    await message.reply('✅ Draft **abierto**.');
                } catch(e) { await message.reply(`❌ Error: ${e.message}`); }
            } else if (par === 'cerrar') {
                try {
                    await axios.post('http://localhost:3000/api/bot/cerrar-draft');
                    await message.reply('✅ Draft **cerrado**.');
                } catch(e) { await message.reply(`❌ Error: ${e.message}`); }
            } else if (par === 'saltar') {
                try {
                    await axios.post('http://localhost:3000/api/bot/saltar-turno');
                    await message.reply('✅ Turno saltado.');
                } catch(e) { await message.reply(`❌ Error: ${e.message}`); }
            } else {
                await message.reply('Uso: `!admin draft [abrir|cerrar|saltar]`');
            }

        // ── !admin torneo [generar|cerrar] ────────────────────
        } else if (sub === 'torneo') {
            if (par === 'generar') {
                const equipos = db.prepare('SELECT * FROM teams ORDER BY id').all();
                if (equipos.length < 2) return message.reply('❌ Necesitas al menos 2 equipos.');
                await message.reply(`⏳ Generando torneo con ${equipos.length} equipos...`);
                const resultado = await generarTorneo(equipos);
                if (resultado.ok) {
                    await message.reply(`✅ Torneo generado: ${resultado.matches} partidos · ${resultado.jornadas} jornadas.`);
                } else {
                    await message.reply(`❌ Error: ${resultado.error}`);
                }
            } else if (par === 'cerrar') {
                try {
                    await axios.post('http://localhost:3001/api/cerrar-torneo');
                    await message.reply('✅ Torneo cerrado. Campeón anunciado, limpieza iniciada.');
                } catch(e) { await message.reply(`❌ Error: ${e.message}`); }
            } else {
                await message.reply('Uso: `!admin torneo [generar|cerrar]`');
            }

        // ── !admin clasificacion ──────────────────────────────
        } else if (sub === 'clasificacion') {
            await actualizarCanalClasificacion(guild);
            await message.reply('✅ Canal clasificación actualizado.');

        // ── !admin capitania doble ────────────────────────────
        } else if (sub === 'capitania' && par === 'doble') {
            const resultado = await lanzarCapitaniaDoble(guild);
            if (resultado.ok) {
                await message.reply('✅ Panel de capitanía doble publicado en 💳-pagos.');
            } else {
                await message.reply(`❌ ${resultado.error}`);
            }

        // ── !admin normativa ──────────────────────────────────
        } else if (sub === 'normativa') {
            await message.reply('⏳ Publicando normativa...');
            await publicarNormativa(guild);
            await message.channel.send('✅ Normativa publicada en el canal correspondiente.');

        // ── !admin panel ──────────────────────────────────────
        } else if (sub === 'panel') {
            await publicarPanelAdmin(guild);
            await message.reply('✅ Panel de admin publicado/actualizado.');

        // ══ COMANDOS DE TESTING (solo superadmin) ══════════════

        // ── !admin test inscripciones ─────────────────────────
        // Simula el cierre de inscripciones: crea canales privados y lanza votación
        } else if (sub === 'test' && par === 'inscripciones') {
            await message.reply('⏳ Simulando cierre de inscripciones...');
            await cerrarInscripciones();
            await message.channel.send('✅ Inscripciones cerradas (simulado). Canales privados creados y votación lanzada.');

        // ── !admin test votos [v10] [v15] [v20] ───────────────
        // Inyecta votos bot en la votación de precio activa
        } else if (sub === 'test' && par === 'votos') {
            const v10 = parseInt(args[3]) || 4;
            const v15 = parseInt(args[4]) || 6;
            const v20 = parseInt(args[5]) || 3;
            // Inyectar IDs de bots en los sets de votos en memoria
            for (let i = 0; i < v10; i++) votosPrecios['10'].add(`BOT_VOTE_10_${i}`);
            for (let i = 0; i < v15; i++) votosPrecios['15'].add(`BOT_VOTE_15_${i}`);
            for (let i = 0; i < v20; i++) votosPrecios['20'].add(`BOT_VOTE_20_${i}`);
            // Actualizar el embed si hay mensaje activo
            if (msgVotoPrecio) {
                try { await msgVotoPrecio.edit({ embeds: [buildEmbedVotoPrecio()] }); } catch(e) {}
            }
            const total = v10 + v15 + v20;
            await message.reply(
                `✅ Inyectados **${total}** votos bot:\n` +
                `• 10 € → ${votosPrecios['10'].size} votos en total\n` +
                `• 15 € → ${votosPrecios['15'].size} votos en total\n` +
                `• 20 € → ${votosPrecios['20'].size} votos en total\n\n` +
                `Usa \`!admin votacion cerrar\` para ver el resultado.`
            );

        // ── !admin test pagos ─────────────────────────────────
        // Simula que todos los capitanes bot ya han pagado: les asigna ROL_CAPITAN
        // en Discord (si son miembros reales) o los registra directamente en teams
        } else if (sub === 'test' && par === 'pagos') {
            const equipos = db.prepare('SELECT * FROM teams ORDER BY id').all();
            let aprobados = 0, omitidos = 0;
            const precio = db.prepare("SELECT value FROM settings WHERE key='precio_torneo'").get()?.value || '?';

            for (const eq of equipos) {
                const esBot = !/^\d{17,19}$/.test(eq.capitan_id);
                if (!esBot) { omitidos++; continue; } // el admin real se aprueba manualmente

                // Solo insertar en teams si no está ya (los de seed ya están)
                db.prepare("INSERT OR IGNORE INTO teams (capitan_id, capitan_username) VALUES (?,?)").run(eq.capitan_id, eq.capitan_username);
                aprobados++;
            }
            await message.reply(
                `✅ **${aprobados}** capitanes bot marcados como pagados.\n` +
                `• ${omitidos} capitán(es) real(es) omitido(s) — apruébalos manualmente en el flujo normal.\n\n` +
                `> ⚠️ Los bots no tienen Discord real, así que no reciben el rol en Discord. Pero la DB está lista para generar el torneo.`
            );

        // ── !admin draft autocompletar ────────────────────────
        // Asigna jugadores libres a los equipos bot que les falten
        } else if (sub === 'draft' && par === 'autocompletar') {
            const draftAbierto = db.prepare("SELECT value FROM settings WHERE key='draft_estado'").get()?.value;
            if (draftAbierto !== 'abierto') {
                return message.reply('❌ El draft debe estar **abierto** para autocompletar. Usa `!admin draft abrir` primero.');
            }
            const equipos = db.prepare('SELECT * FROM teams ORDER BY id').all();
            let totalFichados = 0;
            const posLimites = { DC: 2, MC: 3, CARR: 2, DFC: 3, POR: 1 };

            for (const equipo of equipos) {
                // Solo los equipos bot (IDs que no son Discord IDs reales de 17-18 dígitos)
                const esBot = !/^\d{17,19}$/.test(equipo.capitan_id);
                if (!esBot) continue;

                for (const [pos, limite] of Object.entries(posLimites)) {
                    const yaFichados = db.prepare(
                        "SELECT COUNT(*) as c FROM players WHERE equipo=? AND posicion=?"
                    ).get(equipo.capitan_username, pos)?.c || 0;
                    const faltan = limite - yaFichados;
                    if (faltan <= 0) continue;

                    const libres = db.prepare(
                        "SELECT * FROM players WHERE equipo IS NULL AND posicion=? ORDER BY RANDOM() LIMIT ?"
                    ).all(pos, faltan);

                    for (const jugador of libres) {
                        db.prepare("UPDATE players SET equipo=? WHERE discord_id=?")
                            .run(equipo.capitan_username, jugador.discord_id);
                        db.prepare("INSERT INTO picks (ronda, capitan, jugador_id) VALUES (?,?,?)")
                            .run(1, equipo.capitan_id, jugador.discord_id);
                        totalFichados++;
                    }
                }
            }
            // Cerrar draft si todos los equipos están completos
            const libresRestantes = db.prepare("SELECT COUNT(*) as c FROM players WHERE equipo IS NULL").get()?.c || 0;
            await message.reply(`✅ Autocompletado: **${totalFichados}** jugadores asignados a equipos bot.\n> Jugadores libres restantes: ${libresRestantes}`);
            await axios.post(`${WEB}/api/bot/cerrar-draft`).catch(() => {});
            await notificarDatosActualizados('⚡ Draft autocompletado con equipos bot.').catch(() => {});

        // ── !admin torneo simjornada ──────────────────────────
        // Reporta todos los partidos pendientes de la jornada actual con marcadores aleatorios
        } else if (sub === 'torneo' && par === 'simjornada') {
            const torneoGen = db.prepare("SELECT value FROM settings WHERE key='torneo_generado'").get()?.value;
            if (!torneoGen) return message.reply('❌ No hay torneo generado. Genera el torneo primero.');

            const jornada = parseInt(db.prepare("SELECT value FROM settings WHERE key='jornada_actual'").get()?.value || '1');
            const pendientes = db.prepare("SELECT * FROM matches WHERE jornada=? AND estado='pendiente'").all(jornada);
            if (!pendientes.length) return message.reply(`⚠️ No hay partidos pendientes en la jornada ${jornada}.`);

            let simulados = 0;
            for (const m of pendientes) {
                const g1 = Math.floor(Math.random() * 5);
                const g2 = Math.floor(Math.random() * 5);
                try {
                    await axios.post('http://localhost:3000/api/resultado-confirmado', {
                        match_id: m.id, goles1: g1, goles2: g2
                    });
                    simulados++;
                } catch(e) { console.error(`Error simulando partido ${m.id}:`, e.message); }
            }
            await message.reply(`✅ Jornada **${jornada}** simulada: ${simulados}/${pendientes.length} partidos reportados.\nEl sistema avanzará automáticamente a la siguiente jornada/fase.`);
            // Forzar comprobación inmediata
            await comprobarAvanceJornada(guild).catch(() => {});

        // ── !admin seed [10] ──────────────────────────────────
        // Carga datos de prueba directamente sin tocar la terminal
        } else if (sub === 'seed') {
            const n = par || '10';
            if (n !== '10') return message.reply('Por ahora solo `!admin seed 10` está disponible.');

            // Limpiar datos actuales
            db.prepare('DELETE FROM picks').run();
            db.prepare('DELETE FROM players').run();
            db.prepare('DELETE FROM teams').run();
            db.prepare('DELETE FROM clasificacion').run();
            db.prepare("UPDATE settings SET value='cerrado' WHERE key='draft_estado'").run();
            db.prepare("UPDATE settings SET value='' WHERE key='turno_actual'").run();
            db.prepare("UPDATE settings SET value='asc' WHERE key='direccion_snake'").run();
            db.prepare("UPDATE settings SET value='1' WHERE key='ronda_actual'").run();
            db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('torneo_generado','')").run();
            db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('torneo_fin_ts','')").run();

            // Tu equipo real (del .env ADMIN_ID)
            const adminUser = await client.users.fetch(ADMIN_ID).catch(() => null);
            const adminName = adminUser?.username || 'Admin';

            const caps = [
                { id: ADMIN_ID,     username: adminName },
                { id: 'BOT_CAP_001', username: 'BotCapitan1'  },
                { id: 'BOT_CAP_002', username: 'BotCapitan2'  },
                { id: 'BOT_CAP_003', username: 'BotCapitan3'  },
                { id: 'BOT_CAP_004', username: 'BotCapitan4'  },
                { id: 'BOT_CAP_005', username: 'BotCapitan5'  },
                { id: 'BOT_CAP_006', username: 'BotCapitan6'  },
                { id: 'BOT_CAP_007', username: 'BotCapitan7'  },
                { id: 'BOT_CAP_008', username: 'BotCapitan8'  },
                { id: 'BOT_CAP_009', username: 'BotCapitan9'  },
            ];
            const nombres_equipos = ['Los Cracks','Galácticos','Los Titanes','Dream Team','Thunder FC','Los Invictos','Elite Squad','Phoenix FC','Los Fenómenos','Underdogs FC'];

            for (let i = 0; i < caps.length; i++) {
                db.prepare("INSERT OR IGNORE INTO teams (capitan_id,capitan_username,nombre_equipo) VALUES (?,?,?)")
                    .run(caps[i].id, caps[i].username, nombres_equipos[i]);
                db.prepare("INSERT OR IGNORE INTO clasificacion (capitan_id,equipo_nombre) VALUES (?,?)")
                    .run(caps[i].id, caps[i].username);
            }

            // 110 jugadores bot
            const seed_players = [
                ...['Lewandowski','Benzema','Haaland','Kane','Mbappe','Osimhen','Vlahovic','Darwin','Lukaku','Giroud',
                   'Firmino','Lautaro','Morata','Dovbyk','Immobile','Werner','Isak','Sorloth','Dembele','Gnabry']
                    .map((n,i) => [`P_DC_${String(i+1).padStart(3,'0')}`, n+' Bot', 'DC']),
                ...['Modric','De Bruyne','Kroos','Camavinga','Bellingham','Pedri','Gavi','Valverde','Enzo','Caicedo',
                   'Veiga','Zubimendi','Tchouameni','Kovacic','Fernandes','Kimmich','Rice','Mac Allister','Gravenberch','Guler',
                   'Reijnders','Wirtz','Musiala','Nkunku','Saka','Palmer','Odegaard','Olmo','Diaz','Yamal']
                    .map((n,i) => [`P_MC_${String(i+1).padStart(3,'0')}`, n+' Bot', 'MC']),
                ...['Cancelo','Alexander','Theo','Cucurella','Mendy','Hakimi','Trent','Grimaldo','Dest','Dodo',
                   'Pedro Porro','Frimpong','Maatsen','Ben Yedder','Araujo','Trippier','Dumfries','Castagne','Henrichs','Mazzocchi']
                    .map((n,i) => [`P_CA_${String(i+1).padStart(3,'0')}`, n+' Bot', 'CARR']),
                ...['Van Dijk','Militao','Rudiger','Alaba','Konate','Bastoni','Gvardiol','Laporte','Skriniar','Marquinhos',
                   'Saliba','Timber','Dias','Upamecano','Bremer','Carvajal','Acerbi','Pavard','Kounde','White',
                   'Tomori','Lovren','Diallo','Danso','Le Normand','Scalvini','Quenda','Vallejo','Hummels','Boateng']
                    .map((n,i) => [`P_DF_${String(i+1).padStart(3,'0')}`, n+' Bot', 'DFC']),
                ...['Courtois','Alisson','Ter Stegen','Ederson','Oblak','Onana','Flekken','Raya','Vlachodimos','Szczesny']
                    .map((n,i) => [`P_PO_${String(i+1).padStart(3,'0')}`, n+' Bot', 'POR']),
            ];
            for (const [id, nombre, pos] of seed_players) {
                db.prepare("INSERT OR IGNORE INTO players (discord_id,nombre,posicion,telefono,eafc_id) VALUES (?,?,?,?,?)")
                    .run(id, nombre, pos, '600000000', id.replace('_',''));
            }

            await refrescarWeb().catch(() => {});
            await notificarDatosActualizados('🗄️ Seed 10 equipos cargado.').catch(() => {});
            await message.reply([
                `✅ **Seed 10 equipos cargado:**`,
                `• 10 capitanes (tú + 9 bots)`,
                `• 110 jugadores bot`,
                ``,
                `**Flujo de prueba:**`,
                `\`1.\` \`!admin draft abrir\` — abre el draft`,
                `\`2.\` Elige tus jugadores en la web (tu turno)`,
                `\`3.\` \`!admin draft autocompletar\` — asigna jugadores a los 9 bots`,
                `\`4.\` En el panel → **Generar torneo**`,
                `\`5.\` \`!admin torneo simjornada\` — simula jornada con marcadores aleatorios`,
                `\`6.\` Repite el paso 5 hasta que el torneo acabe`,
            ].join('\n'));

        // ── !admin limpiar canal <id_o_mención> ──────────────
        } else if (sub === 'crear-canal-web') {
            const CATEGORIA_WEB = '1489288783252820151';
            const WEB_URL = 'https://clutch-draft.duckdns.org';
            await message.reply('⏳ Creando canal de la web...');
            // Crear o reusar canal existente
            let chWeb;
            const existente = guild.channels.cache.find(c => c.name === '🌐-clutch-web' && c.parentId === CATEGORIA_WEB);
            if (existente) {
                chWeb = existente;
                await borrarMensajesCanal(chWeb);
            } else {
                chWeb = await guild.channels.create({
                    name: '🌐-clutch-web',
                    type: 0,
                    parent: CATEGORIA_WEB,
                    topic: 'Información sobre la plataforma web de Clutch Draft',
                    permissionOverwrites: [
                        { id: guild.roles.everyone, allow: ['ViewChannel', 'ReadMessageHistory'], deny: ['SendMessages'] }
                    ]
                });
            }
            // Embed principal
            const embedInfo = new EmbedBuilder()
                .setTitle('🌐 CLUTCH DRAFT — PLATAFORMA WEB')
                .setColor(0x00ffcc)
                .setDescription(
                    '### La experiencia completa del torneo, en tu navegador.\n\n' +
                    'La web de Clutch Draft es el centro de mando del torneo. Desde aquí puedes ' +
                    'seguir en tiempo real todo lo que pasa: el draft en vivo, la clasificación, los ' +
                    'partidos, los directos de Twitch y mucho más.\n\n' +
                    '> 🔗 Accede con tu cuenta de **Discord** — sin registro adicional.'
                )
                .addFields(
                    {
                        name: '📋 ¿Qué puedes hacer en la web?',
                        value: [
                            '**⚽ Draft en vivo** — Sigue cada pick del draft en tiempo real con el campo visual de tu equipo',
                            '**🏆 Clasificación** — Tabla actualizada automáticamente tras cada partido',
                            '**📅 Partidos** — Resultados, próximos encuentros y fixture completo del torneo',
                            '**📺 Directo** — Stream oficial integrado con Twitch y partidos en curso',
                            '**🥇 Hall of Fame** — Historial completo de todas las ediciones y campeones',
                            '**📜 Normas** — Reglamento completo del torneo siempre disponible',
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: '🔒 ¿Cómo entro?',
                        value: '1. Pulsa el botón **Ir a la web** de abajo\n2. Haz clic en **Iniciar sesión con Discord**\n3. Autoriza la aplicación\n4. ¡Listo! Ya tienes acceso completo',
                        inline: false
                    },
                    {
                        name: '⚡ Actualizaciones en tiempo real',
                        value: 'La web usa WebSockets — los datos se actualizan solos sin necesidad de recargar la página.',
                        inline: false
                    }
                )
                .setImage('https://clutch-draft.duckdns.org/inscripciones.gif')
                .setFooter({ text: 'Clutch Draft · clutch-draft.duckdns.org' })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel('🌐 Ir a la web')
                    .setStyle(ButtonStyle.Link)
                    .setURL(WEB_URL),
                new ButtonBuilder()
                    .setLabel('⚽ Ver el Draft')
                    .setStyle(ButtonStyle.Link)
                    .setURL(`${WEB_URL}/draft`),
                new ButtonBuilder()
                    .setLabel('🏆 Clasificación')
                    .setStyle(ButtonStyle.Link)
                    .setURL(`${WEB_URL}/torneo`),
                new ButtonBuilder()
                    .setLabel('📺 Directo')
                    .setStyle(ButtonStyle.Link)
                    .setURL(`${WEB_URL}/directo`)
            );

            await chWeb.send({ embeds: [embedInfo], components: [row] });
            await message.channel.send(`✅ Canal <#${chWeb.id}> creado/actualizado correctamente.`);

        } else if (sub === 'limpiar' && par === 'canal') {
            // Acepta ID directa o #mención (<#123...>)
            const rawId = args[3] || '';
            const canalId = rawId.replace(/[<#>]/g, '').trim();
            if (!canalId) return message.reply('Uso: `!admin limpiar canal <id_canal>`');
            let chTarget;
            try {
                chTarget = await guild.channels.fetch(canalId);
            } catch(e) {
                return message.reply(`❌ Canal no encontrado: \`${canalId}\``);
            }
            await message.reply(`🧹 Borrando mensajes de <#${chTarget.id}>…`);
            await borrarMensajesCanal(chTarget);
            await message.channel.send(`✅ Canal <#${chTarget.id}> limpiado.`);

        // ── !admin ayuda ──────────────────────────────────────
        } else {
            await message.reply([
                '📋 **Comandos de administración manual:**',
                '`!admin inscripciones abrir` — Reabre inscripciones y rehabilita el panel',
                '`!admin inscripciones cerrar` — Cierra inscripciones e inicia votación de precio',
                '`!admin votacion iniciar` — Lanza votación de precio manualmente',
                '`!admin votacion cerrar` — Cierra la votación y publica resultado + panel de pago',
                '`!admin pago 10|15|20` — Lanza panel de pago con el precio indicado',
                '`!admin capitania doble` — Publica el panel de capitanía doble en 💳-pagos',
                '`!admin draft abrir` — Abre el draft',
                '`!admin draft cerrar` — Cierra el draft',
                '`!admin draft saltar` — Salta el turno actual',
                '`!admin test inscripciones` — [TEST] Simula cierre de inscripciones (crea canales + votación)',
                '`!admin test votos 4 6 3` — [TEST] Inyecta votos bot (4×10€ 6×15€ 3×20€)',
                '`!admin test pagos` — [TEST] Marca todos los capitanes bot como pagados en la DB',
                '`!admin draft autocompletar` — [TEST] Asigna jugadores libres a equipos bot',
                '`!admin torneo generar` — Genera el torneo con los equipos actuales',
                '`!admin torneo simjornada` — [TEST] Simula todos los partidos pendientes con marcadores aleatorios',
                '`!admin torneo cerrar` — Cierra el torneo y anuncia campeón',
                '`!admin clasificacion` — Fuerza actualización del canal de clasificación',
                '`!admin normativa` — Republica la normativa completa en el canal #normativa',
                '`!admin panel` — Publica/actualiza el panel de admin en el canal dedicado',
                '`!admin seed 10` — [TEST] Carga 10 equipos y 110 jugadores bot para pruebas',
                '`!admin limpiar canal <id>` — Borra todos los mensajes de un canal específico',
                '`!admin crear-canal-web` — Crea/actualiza el canal 🌐-clutch-web con info de la plataforma',
            ].join('\n'));
        }

        message.delete().catch(() => {});
        return;
    }
});

// ══════════════════════════════════════════════════════════════
//  INTERACCIONES
// ══════════════════════════════════════════════════════════════
client.on('interactionCreate', async (interaction) => {

    // ── Salir del draft ──────────────────────────────────────
    if (interaction.isButton() && interaction.customId === 'leave_draft') {
        const jugador = db.prepare(`SELECT * FROM players WHERE discord_id=?`).get(interaction.user.id);
        if (!jugador) return interaction.reply({ content: '❌ No estás inscrito.', ephemeral: true });
        db.prepare(`DELETE FROM players WHERE discord_id=?`).run(interaction.user.id);
        try {
            const member = await interaction.guild.members.fetch(interaction.user.id);
            await member.roles.remove(ROL_JUGADOR);
        } catch(e) { console.error('Error quitando rol:', e.message); }
        await refrescarWeb();
        actualizarPanelDiscord().catch(() => {});
        axios.post('http://localhost:3001/api/actualizar-lista-draft').catch(() => {});
        axios.post('http://localhost:3001/api/actualizar-jugadores-inscritos').catch(() => {});
        const embed = buildPanelEmbed();
        await interaction.update({ embeds: [embed], components: buildPanelRows() });
        return;
    }

    // ── Ver mi inscripción ────────────────────────────────────
    if (interaction.isButton() && interaction.customId === 'ver_inscripcion') {
        const jugador = db.prepare(`SELECT * FROM players WHERE discord_id=?`).get(interaction.user.id);
        if (!jugador) {
            return interaction.reply({
                content: '❌ **No estás inscrito** en el draft.\nPulsa uno de los botones de posición para inscribirte.',
                ephemeral: true
            });
        }
        const iconPos = { DC: '🟢', CARR: '🟡', MC: '🟣', DFC: '🔴', POR: '🔵' };
        const embed = new EmbedBuilder()
            .setTitle('🔍 Tu inscripción')
            .setColor(0x00ffcc)
            .addFields(
                { name: '👤 Nombre',    value: jugador.nombre,                        inline: true },
                { name: '📌 Posición',  value: `${iconPos[jugador.posicion] || ''} **${jugador.posicion}**`, inline: true },
                { name: '📱 Teléfono',  value: jugador.telefono || '*No indicado*',   inline: true },
                { name: '🎮 EA FC ID',  value: jugador.eafc_id  || '*No indicado*',   inline: true },
                { name: '🏠 Equipo',    value: jugador.equipo   || '*Sin equipo aún*', inline: true }
            )
            .setFooter({ text: 'Solo tú puedes ver este mensaje' });
        return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // ── Votar precio ─────────────────────────────────────────
    if (interaction.isButton() && interaction.customId.startsWith('vote_precio_')) {
        const precio = interaction.customId.split('_')[2];
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!member.roles.cache.has(ROL_JUGADOR))
            return interaction.reply({ content: '❌ Solo jugadores inscritos pueden votar.', ephemeral: true });
        for (const p of ['10', '15', '20']) votosPrecios[p].delete(interaction.user.id);
        votosPrecios[precio].add(interaction.user.id);
        try { await msgVotoPrecio.edit({ embeds: [buildEmbedVotoPrecio()] }); } catch(e) { /* ignorar */ }
        return interaction.reply({ content: `✅ Voto registrado: **${precio} €**.`, ephemeral: true });
    }

    // ── Quiero ser capitán ───────────────────────────────────
    if (interaction.isButton() && interaction.customId === 'quiero_capitan') {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!member.roles.cache.has(ROL_JUGADOR))
            return interaction.reply({ content: '❌ Solo jugadores inscritos.', ephemeral: true });
        if (member.roles.cache.has(ROL_CAPITAN))
            return interaction.reply({ content: '👑 Ya eres capitán.', ephemeral: true });
        if (candidatosCapitan.has(interaction.user.id)) {
            candidatosCapitan.delete(interaction.user.id);
            await actualizarEmbedCandidatos();
            return interaction.reply({ content: '↩️ Candidatura retirada.', ephemeral: true });
        }
        candidatosCapitan.add(interaction.user.id);
        await actualizarEmbedCandidatos();
        return interaction.reply({ content: '👑 ¡Candidatura registrada!', ephemeral: true });
    }

    // ── Votación capitán gratuito (Sí / No) ─────────────────
    if (interaction.isButton() && (interaction.customId === 'vot_capitan_gratis_si' || interaction.customId === 'vot_capitan_gratis_no')) {
        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        if (!member || !member.roles.cache.has(ROL_JUGADOR))
            return interaction.reply({ content: '❌ Solo jugadores inscritos pueden votar.', ephemeral: true });

        const userId = interaction.user.id;
        const yaEsCandidato = db.prepare(`SELECT 1 FROM candidatos_capitan WHERE discord_id=?`).get(userId);

        if (interaction.customId === 'vot_capitan_gratis_si') {
            if (yaEsCandidato)
                return interaction.reply({ content: '👑 Ya estás en la lista de candidatos.', ephemeral: true });
            const playerRow = db.prepare(`SELECT nombre, eafc_id FROM players WHERE discord_id=?`).get(userId);
            if (!playerRow)
                return interaction.reply({ content: '❌ No estás inscrito en el draft.', ephemeral: true });
            db.prepare(`INSERT OR REPLACE INTO candidatos_capitan (discord_id, nombre, eafc_id, forzado, confirmado) VALUES (?, ?, ?, 0, 0)`)
                .run(userId, playerRow.nombre, playerRow.eafc_id || null);
        } else {
            if (yaEsCandidato && !db.prepare(`SELECT forzado FROM candidatos_capitan WHERE discord_id=?`).get(userId)?.forzado) {
                db.prepare(`DELETE FROM candidatos_capitan WHERE discord_id=? AND forzado=0`).run(userId);
            }
        }

        // Actualizar embed de votacion-capitan
        try {
            const canalId = db.prepare(`SELECT value FROM settings WHERE key='canal_votacion_capitan'`).get()?.value;
            if (canalId) {
                const canal = await client.channels.fetch(canalId);
                const msgs  = await canal.messages.fetch({ limit: 10 });
                const msgVot = msgs.find(m => m.author.id === client.user.id && m.embeds.length && m.embeds[0].title?.includes('CAPITÁN'));
                if (msgVot) {
                    const candidatos = db.prepare(`SELECT discord_id FROM candidatos_capitan WHERE confirmado=0`).all();
                    const lista = candidatos.length
                        ? candidatos.map(c => `<@${c.discord_id}>`).join('\n')
                        : '*Nadie de momento…*';
                    const nuevoEmbed = EmbedBuilder.from(msgVot.embeds[0])
                        .spliceFields(0, 1, { name: `🙋 Candidatos (${candidatos.length})`, value: lista, inline: false });
                    await msgVot.edit({ embeds: [nuevoEmbed] });
                }
            }
        } catch(e) { console.error('Error actualizando embed candidatos gratis:', e.message); }

        const resp = interaction.customId === 'vot_capitan_gratis_si'
            ? '👑 ¡Candidatura registrada! Aparecerás en la Ruleta de Capitanes.'
            : '↩️ Respondiste que no quieres ser capitán.';
        return interaction.reply({ content: resp, ephemeral: true });
    }

    // ── Confirmar pago ───────────────────────────────────────
    if (interaction.isButton() && interaction.customId === 'confirmar_pago') {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!member.roles.cache.has(ROL_JUGADOR))
            return interaction.reply({ content: '❌ Solo jugadores inscritos.', ephemeral: true });
        if (member.roles.cache.has(ROL_CAPITAN))
            return interaction.reply({ content: '✅ Ya tienes el rol Capitán.', ephemeral: true });
        const precio = db.prepare(`SELECT value FROM settings WHERE key='precio_torneo'`).get()?.value || '?';
        try {
            const admin = await client.users.fetch(ADMIN_ID);
            const embedAdmin = new EmbedBuilder()
                .setTitle('💳 CONFIRMACIÓN DE PAGO PENDIENTE')
                .setColor(0xffcc00)
                .setDescription(`**${interaction.user.username}** dice haber pagado **${precio} €**.`)
                .addFields(
                    { name: '👤 Usuario', value: `<@${interaction.user.id}> (${interaction.user.id})`, inline: false },
                    { name: '💰 Precio', value: `${precio} €`, inline: true },
                )
                .setThumbnail(interaction.user.displayAvatarURL())
                .setTimestamp();
            const rowAdmin = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`aprobar_capitan_${interaction.user.id}`).setLabel('✅ Aprobar').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`rechazar_capitan_${interaction.user.id}`).setLabel('❌ Rechazar').setStyle(ButtonStyle.Danger)
            );
            await admin.send({ embeds: [embedAdmin], components: [rowAdmin] });
        } catch(e) { console.error('Error enviando DM al admin:', e.message); }
        return interaction.reply({ content: '✅ Confirmación enviada al admin.', ephemeral: true });
    }

    // ── Admin: aprobar pago ──────────────────────────────────
    if (interaction.isButton() && interaction.customId.startsWith('aprobar_capitan_')) {
        if (interaction.user.id !== ADMIN_ID) return interaction.reply({ content: '❌ No autorizado.', ephemeral: true });
        const targetId = interaction.customId.split('_')[2];
        try {
            const guild  = client.guilds.cache.first();
            const member = await guild.members.fetch(targetId);
            await member.roles.add(ROL_CAPITAN);

            const yaCapitan   = db.prepare(`SELECT * FROM teams WHERE capitan_id=?`).get(targetId);
            const numEquipos  = parseInt(db.prepare(`SELECT value FROM settings WHERE key='num_equipos_manual'`).get()?.value || '0');
            const totalEquipos= db.prepare(`SELECT COUNT(*) as c FROM teams`).get().c;
            const yaCandidato = db.prepare(`SELECT discord_id FROM candidatos_capitan WHERE discord_id=?`).get(targetId);

            // Si hay límite de equipos y ya está lleno → añadir a candidatos para la Ruleta
            const mandarARuleta = numEquipos > 0 && totalEquipos >= numEquipos && !yaCapitan;

            if (mandarARuleta) {
                if (!yaCandidato) {
                    const eafc = db.prepare(`SELECT eafc_id FROM players WHERE discord_id=?`).get(targetId)?.eafc_id || null;
                    db.prepare(`INSERT OR IGNORE INTO candidatos_capitan (discord_id, nombre, eafc_id, forzado) VALUES (?,?,?,1)`)
                        .run(targetId, member.user.username, eafc);
                }
                try { await member.send(`👑 ¡Pago confirmado! Hay más capitanes que slots disponibles — serás elegido mediante la **Ruleta de Capitanes**. ¡Mucha suerte!`); } catch(e) {}
                const rowDone = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('done').setLabel(`🎡 En ruleta: ${member.user.username}`).setStyle(ButtonStyle.Primary).setDisabled(true)
                );
                await interaction.update({ components: [rowDone] });
            } else {
                if (!yaCapitan) {
                    db.prepare(`INSERT OR IGNORE INTO teams (capitan_id, capitan_username) VALUES (?,?)`).run(targetId, member.user.username);
                    db.prepare(`INSERT OR IGNORE INTO clasificacion (capitan_id, equipo_nombre) VALUES (?,?)`).run(targetId, member.user.username);
                }
                try { await member.send('👑 ¡Tu pago ha sido confirmado! Ya tienes el rol **Capitán**.'); } catch(e) {}
                const rowDone = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('done').setLabel(`✅ Aprobado: ${member.user.username}`).setStyle(ButtonStyle.Success).setDisabled(true)
                );
                await interaction.update({ components: [rowDone] });
            }
        } catch(e) {
            console.error('Error aprobando capitán:', e.message);
            await interaction.reply({ content: `❌ Error: ${e.message}`, ephemeral: true });
        }
        return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('rechazar_capitan_')) {
        if (interaction.user.id !== ADMIN_ID) return interaction.reply({ content: '❌ No autorizado.', ephemeral: true });
        const targetId = interaction.customId.split('_')[2];
        try {
            const guild  = client.guilds.cache.first();
            const member = await guild.members.fetch(targetId);
            try { await member.send('❌ Tu confirmación de pago ha sido rechazada.'); } catch(e) { /* DMs cerrados */ }
            const rowDone = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('done').setLabel(`❌ Rechazado: ${member.user.username}`).setStyle(ButtonStyle.Danger).setDisabled(true)
            );
            await interaction.update({ components: [rowDone] });
        } catch(e) { console.error('Error rechazando capitán:', e.message); }
        return;
    }

    // ── Solicitar ser segundo capitán (capitanía doble) ──────
    if (interaction.isButton() && interaction.customId === 'solicitar_cap_doble') {
        // Comprobar que no es ya capitán
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (member.roles.cache.has(ROL_CAPITAN))
            return interaction.reply({ content: '❌ Ya eres capitán de un equipo.', ephemeral: true });
        if (!member.roles.cache.has(ROL_JUGADOR))
            return interaction.reply({ content: '❌ Solo jugadores inscritos pueden solicitar esto.', ephemeral: true });
        // Comprobar que no está ya asignado como cap2 en algún equipo
        const yaAsignado = db.prepare(`SELECT capitan_username FROM teams WHERE capitan2_id=?`).get(interaction.user.id);
        if (yaAsignado)
            return interaction.reply({ content: `✅ Ya estás asignado como segundo capitán del equipo de **${yaAsignado.capitan_username}**.`, ephemeral: true });

        // Modal para que indique quién es el capitán principal
        const modal = new ModalBuilder()
            .setCustomId('modal_cap_doble')
            .setTitle('Segundo capitán — Capitanía doble');
        const inputCapitan = new TextInputBuilder()
            .setCustomId('capitan_principal')
            .setLabel('Nombre Discord del capitán principal')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Ej: K1NGxBAROU')
            .setRequired(true)
            .setMinLength(2)
            .setMaxLength(40);
        modal.addComponents(new ActionRowBuilder().addComponents(inputCapitan));
        await interaction.showModal(modal);
        return;
    }

    // ── Modal cap doble — confirmar equipo y notificar admin ─
    if (interaction.isModalSubmit() && interaction.customId === 'modal_set_horario') {
        const horario = interaction.fields.getTextInputValue('horario_input').trim();
        db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('horario_torneo',?)`).run(horario);
        // Actualizar el panel de inscripciones si está publicado
        try {
            const chInsc = await client.channels.fetch(CANAL_INSCRIPCIONES).catch(() => null);
            const msgId  = db.prepare(`SELECT value FROM settings WHERE key='panel_msg_id'`).get()?.value;
            if (chInsc && msgId) {
                const msg = await chInsc.messages.fetch(msgId).catch(() => null);
                if (msg) await msg.edit({ embeds: [buildPanelEmbed()], components: buildPanelRows() });
            }
        } catch(e) { /* ignorar */ }
        await interaction.reply({ content: `✅ Horario actualizado: **${horario}**\nEl panel de inscripciones se ha actualizado automáticamente.`, ephemeral: true });
        return;
    }

    // ── Modal fecha límite inscripciones ────────────────────────
    if (interaction.isModalSubmit() && interaction.customId === 'modal_set_fecha_limite') {
        const fecha = interaction.fields.getTextInputValue('fecha_limite_input').trim();
        db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('fecha_limite_inscripciones',?)`).run(fecha);
        try {
            const chInsc = await client.channels.fetch(CANAL_INSCRIPCIONES).catch(() => null);
            const msgId  = db.prepare(`SELECT value FROM settings WHERE key='panel_msg_id'`).get()?.value;
            if (chInsc && msgId) {
                const msg = await chInsc.messages.fetch(msgId).catch(() => null);
                if (msg) await msg.edit({ embeds: [buildPanelEmbed()], components: buildPanelRows() });
            }
        } catch(e) { /* ignorar */ }
        await interaction.reply({ content: `✅ Fecha límite de inscripciones: **${fecha}**\nEl panel de inscripciones se ha actualizado.`, ephemeral: true });
        return;
    }

    // ── Modal tiempo última hora ─────────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId === 'modal_set_tiempo_uh') {
        const raw = interaction.fields.getTextInputValue('tiempo_uh_input').trim();
        const mins = parseInt(raw);
        if (isNaN(mins) || mins < 6 || mins > 120) {
            await interaction.reply({ content: '❌ Valor inválido. Introduce un número entre 6 y 120 minutos.', ephemeral: true });
            return;
        }
        db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('tiempo_ultima_hora',?)`).run(String(mins));
        await interaction.reply({ content: `✅ Tiempo de inscripciones de última hora: **${mins} minutos**.\nSe aplicará en el próximo cierre de inscripciones.`, ephemeral: true });
        return;
    }

    // ── Modal fecha del draft ────────────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId === 'modal_set_fecha_draft') {
        const fecha = interaction.fields.getTextInputValue('fecha_draft_input').trim();
        db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('fecha_draft',?)`).run(fecha);
        // Actualizar el panel de inscripciones si está publicado
        try {
            const chInsc = await client.channels.fetch(CANAL_INSCRIPCIONES).catch(() => null);
            const msgId  = db.prepare(`SELECT value FROM settings WHERE key='panel_msg_id'`).get()?.value;
            if (chInsc && msgId) {
                const msg = await chInsc.messages.fetch(msgId).catch(() => null);
                if (msg) await msg.edit({ embeds: [buildPanelEmbed()], components: buildPanelRows() });
            }
        } catch(e) { /* ignorar */ }
        await interaction.reply({ content: `✅ Fecha del draft actualizada: **${fecha}**\nEl panel de inscripciones se ha actualizado automáticamente.`, ephemeral: true });
        return;
    }

    // ── Modal forzar capitán manualmente ────────────────────────
    if (interaction.isModalSubmit() && interaction.customId === 'modal_forzar_capitan') {
        await interaction.deferReply({ ephemeral: true });
        const guild = interaction.guild;

        let rawId = interaction.fields.getTextInputValue('fc_user_id').trim();
        const mentionMatch = rawId.match(/^<@!?(\d+)>$/);
        if (mentionMatch) rawId = mentionMatch[1];

        const nombreEquipoInput = interaction.fields.getTextInputValue('fc_nombre_equipo').trim();
        const posInput = interaction.fields.getTextInputValue('fc_posicion').trim().toUpperCase();
        const POSICIONES_VALIDAS = ['DC', 'MC', 'DFC', 'CARR', 'POR'];
        const posicion = POSICIONES_VALIDAS.includes(posInput) ? posInput : 'DC';

        let member;
        try {
            member = await guild.members.fetch(rawId);
        } catch(e) {
            return interaction.editReply({ content: `❌ No se encontró ningún usuario con ID \`${rawId}\`. Verifica el ID o la mención.` });
        }

        const yaCapitan = db.prepare('SELECT capitan_username, nombre_equipo FROM teams WHERE capitan_id=?').get(member.id);
        if (yaCapitan) {
            return interaction.editReply({ content: `⚠️ **${member.user.username}** ya es capitán del equipo **${yaCapitan.nombre_equipo || yaCapitan.capitan_username}**.` });
        }

        try { await member.roles.add(ROL_CAPITAN); } catch(e) {
            return interaction.editReply({ content: `❌ No pude asignar el rol Capitán: ${e.message}` });
        }

        const nombreEquipo = nombreEquipoInput || member.user.username;

        // Crear entrada en players si no existe
        db.prepare(`INSERT OR IGNORE INTO players (discord_id, nombre, posicion) VALUES (?, ?, ?)`)
            .run(member.id, member.user.username, posicion);

        // Crear entrada en teams
        db.prepare(`INSERT OR IGNORE INTO teams (capitan_id, capitan_username, nombre_equipo) VALUES (?, ?, ?)`)
            .run(member.id, member.user.username, nombreEquipo);

        await interaction.editReply({
            content: `✅ **${member.user.username}** registrado como capitán.\n` +
                     `👑 Equipo: **${nombreEquipo}** · Posición: **${posicion}**\n` +
                     `Rol Capitán asignado correctamente.`
        });
        await refrescarWeb().catch(() => {});
        return;
    }

    // ── Modal forzar candidato gratuito ─────────────────────────
    if (interaction.isModalSubmit() && interaction.customId === 'modal_cap_gratis_forzar') {
        await interaction.deferReply({ ephemeral: true });
        const rawId = interaction.fields.getTextInputValue('cgf_user_id').trim().replace(/^<@!?(\d+)>$/, '$1');
        let member;
        try { member = await interaction.guild.members.fetch(rawId); } catch {
            return interaction.editReply({ content: `❌ No se encontró ningún usuario con ID \`${rawId}\`.` });
        }
        const playerRow = db.prepare(`SELECT nombre, eafc_id FROM players WHERE discord_id=?`).get(member.id);
        if (!playerRow)
            return interaction.editReply({ content: `❌ **${member.user.username}** no está inscrito en el draft.` });
        db.prepare(`INSERT OR REPLACE INTO candidatos_capitan (discord_id, nombre, eafc_id, forzado, confirmado) VALUES (?, ?, ?, 1, 0)`)
            .run(member.id, playerRow.nombre, playerRow.eafc_id || null);
        await interaction.editReply({ content: `✅ **${member.user.username}** añadido a la Ruleta de Capitanes (forzado).` });
        await actualizarPanelDiscord().catch(() => {});
        return;
    }

    // ── Modal quitar candidato gratuito ─────────────────────────
    if (interaction.isModalSubmit() && interaction.customId === 'modal_cap_gratis_quitar') {
        await interaction.deferReply({ ephemeral: true });
        const rawId = interaction.fields.getTextInputValue('cgq_user_id').trim().replace(/^<@!?(\d+)>$/, '$1');
        const candidato = db.prepare(`SELECT nombre FROM candidatos_capitan WHERE discord_id=?`).get(rawId);
        if (!candidato)
            return interaction.editReply({ content: `❌ No hay ningún candidato con ID \`${rawId}\`.` });
        db.prepare(`DELETE FROM candidatos_capitan WHERE discord_id=?`).run(rawId);
        await interaction.editReply({ content: `✅ **${candidato.nombre}** eliminado de la Ruleta de Capitanes.` });
        await actualizarPanelDiscord().catch(() => {});
        return;
    }

    // ── Modal config draft gratuito ──────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId === 'modal_cap_gratis_config') {
        await interaction.deferReply({ ephemeral: true });
        const numEq  = interaction.fields.getTextInputValue('cgc_num_equipos').trim();
        const fmt    = interaction.fields.getTextInputValue('cgc_formato').trim();
        const caps   = interaction.fields.getTextInputValue('cgc_caps').trim();
        if (numEq)  db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('num_equipos_manual',?)`).run(numEq);
        if (fmt)    db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('formato_manual',?)`).run(fmt);
        if (caps === '1' || caps === '2')
            db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('caps_por_equipo',?)`).run(caps);
        await interaction.editReply({ content: `✅ Configuración guardada:\n• Equipos: **${numEq || 'sin cambio'}**\n• Formato: **${fmt || 'sin cambio'}**\n• Caps/equipo: **${caps || 'sin cambio'}**` });
        await actualizarPanelDiscord().catch(() => {});
        return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'modal_cap_doble') {
        await interaction.deferReply({ ephemeral: true });
        const nombreCapitan = interaction.fields.getTextInputValue('capitan_principal').trim();
        const equipo = db.prepare(`SELECT * FROM teams WHERE capitan_username=?`).get(nombreCapitan);
        if (!equipo)
            return interaction.editReply({ content: `❌ No existe ningún equipo cuyo capitán sea **${nombreCapitan}**. Comprueba el nombre exacto.` });
        if (equipo.capitan2_id)
            return interaction.editReply({ content: `❌ El equipo de **${nombreCapitan}** ya tiene un segundo capitán asignado.` });

        const precio = db.prepare("SELECT value FROM settings WHERE key='precio_torneo'").get()?.value || '?';
        try {
            const admin = await client.users.fetch(ADMIN_ID);
            const embedAdmin = new EmbedBuilder()
                .setTitle('👥 SOLICITUD — SEGUNDO CAPITÁN')
                .setColor(0xf0c040)
                .setDescription(`**${interaction.user.username}** quiere ser el segundo capitán del equipo de **${nombreCapitan}**.`)
                .addFields(
                    { name: '👤 Solicitante',       value: `<@${interaction.user.id}> (${interaction.user.id})`, inline: false },
                    { name: '👑 Capitán principal', value: `**${nombreCapitan}** (equipo: ${equipo.nombre_equipo || nombreCapitan})`, inline: false },
                    { name: '💰 Precio a pagar',    value: `${precio} €`, inline: true }
                )
                .setThumbnail(interaction.user.displayAvatarURL())
                .setTimestamp();
            const rowAdmin = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`aprobar_cap2_${interaction.user.id}_${equipo.capitan_id}`)
                    .setLabel('✅ Aprobar')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`rechazar_cap2_${interaction.user.id}`)
                    .setLabel('❌ Rechazar')
                    .setStyle(ButtonStyle.Danger)
            );
            await admin.send({ embeds: [embedAdmin], components: [rowAdmin] });
        } catch(e) { console.error('Error enviando DM admin cap2:', e.message); }
        return interaction.editReply({ content: `✅ Solicitud enviada al admin. Cuando confirmes el pago de **${precio} €** y el admin lo apruebe, tendrás el rol Capitán.` });
    }

    // ── Admin: aprobar segundo capitán ───────────────────────
    if (interaction.isButton() && interaction.customId.startsWith('aprobar_cap2_')) {
        if (interaction.user.id !== ADMIN_ID)
            return interaction.reply({ content: '❌ No autorizado.', ephemeral: true });
        const parts      = interaction.customId.split('_');
        // formato: aprobar_cap2_<userId>_<equipoCapitanId>
        const targetId   = parts[2];
        const cap1Id     = parts[3];
        try {
            const guild  = client.guilds.cache.first();
            const member = await guild.members.fetch(targetId);
            await member.roles.add(ROL_CAPITAN);
            db.prepare(`UPDATE teams SET capitan2_id=?, capitan2_username=? WHERE capitan_id=?`)
                .run(targetId, member.user.username, cap1Id);
            // Auto-registrar cap2 como co-capitán para que tenga permisos en canales de partido y pueda reportar resultados
            db.prepare(`INSERT OR IGNORE INTO cocapitanes (capitan_id, cocapitan_id) VALUES (?, ?)`)
                .run(cap1Id, targetId);
            try { await member.send('👑 ¡Aprobado! Eres el **segundo capitán** de tu equipo. Ya tienes el rol Capitán.'); } catch(e) {}
            const rowDone = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('done').setLabel(`✅ Cap2 aprobado: ${member.user.username}`).setStyle(ButtonStyle.Success).setDisabled(true)
            );
            await interaction.update({ components: [rowDone] });
        } catch(e) {
            console.error('Error aprobando cap2:', e.message);
            await interaction.reply({ content: `❌ Error: ${e.message}`, ephemeral: true });
        }
        return;
    }

    // ── Admin: rechazar segundo capitán ──────────────────────
    if (interaction.isButton() && interaction.customId.startsWith('rechazar_cap2_')) {
        if (interaction.user.id !== ADMIN_ID)
            return interaction.reply({ content: '❌ No autorizado.', ephemeral: true });
        const targetId = interaction.customId.replace('rechazar_cap2_', '');
        try {
            const guild  = client.guilds.cache.first();
            const member = await guild.members.fetch(targetId).catch(() => null);
            if (member) {
                try { await member.send('❌ Tu solicitud de segundo capitán ha sido rechazada.'); } catch(e) {}
            }
            const rowDone = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('done').setLabel(`❌ Cap2 rechazado: ${member?.user.username ?? targetId}`).setStyle(ButtonStyle.Danger).setDisabled(true)
            );
            await interaction.update({ components: [rowDone] });
        } catch(e) { console.error('Error rechazando cap2:', e.message); }
        return;
    }

    // ── Botón posición → modal inscripción ───────────────────
    if (interaction.isButton() && interaction.customId.startsWith('join_')) {
        const posicion = interaction.customId.split('_')[1];
        const yaInscrito = db.prepare(`SELECT posicion FROM players WHERE discord_id=?`).get(interaction.user.id);
        if (yaInscrito && yaInscrito.posicion === posicion)
            return interaction.reply({ content: `✅ Ya estás inscrito como **${posicion}**.`, ephemeral: true });
        const modal = new ModalBuilder().setCustomId(`modal_${posicion}`).setTitle(`Inscripción como ${posicion}`);
        const phoneInput = new TextInputBuilder().setCustomId('telefono').setLabel('WhatsApp (si no eres de España añade +XX)').setStyle(TextInputStyle.Short).setPlaceholder('España: 600000000 · Otro país: +44791...').setRequired(true).setMinLength(6).setMaxLength(20);
        const eafcInput  = new TextInputBuilder().setCustomId('eafc_id').setLabel('ID exacta de EA FC (ej: Mizrra#1234)').setStyle(TextInputStyle.Short).setPlaceholder('TuNombre#1234').setRequired(true).setMinLength(3).setMaxLength(30);
        modal.addComponents(new ActionRowBuilder().addComponents(phoneInput), new ActionRowBuilder().addComponents(eafcInput));
        await interaction.showModal(modal);
        return;
    }

    // ── Modal: crear canal de partido ────────────────────────
    if (interaction.isModalSubmit() && interaction.customId === 'modal_canal_crear') {
        await interaction.deferReply({ ephemeral: true });
        const guild = interaction.guild;
        const matchId = parseInt(interaction.fields.getTextInputValue('cc_match_id').trim());
        const partido = db.prepare('SELECT * FROM matches WHERE id=?').get(matchId);
        if (!partido) return interaction.editReply({ content: `❌ No existe ningún partido con ID \`${matchId}\`.` });

        // Borrar canal anterior si existe
        if (partido.canal_discord) {
            const canalViejo = guild.channels.cache.get(partido.canal_discord);
            if (canalViejo) await canalViejo.delete().catch(() => {});
            db.prepare('UPDATE matches SET canal_discord=NULL WHERE id=?').run(matchId);
            delete canalesPartido[matchId];
        }

        const eq1row = db.prepare('SELECT capitan_id FROM teams WHERE capitan_username=?').get(partido.equipo1);
        const eq2row = db.prepare('SELECT capitan_id FROM teams WHERE capitan_username=?').get(partido.equipo2);
        const canalId = await crearCanalPartido(guild, matchId, partido.jornada, partido.equipo1, partido.equipo2, eq1row?.capitan_id, eq2row?.capitan_id);
        if (canalId) {
            db.prepare('UPDATE matches SET canal_discord=? WHERE id=?').run(canalId, matchId);
            canalesPartido[matchId] = canalId;
            return interaction.editReply({ content: `✅ Canal creado: <#${canalId}> para el partido **[${matchId}]** ${partido.equipo1} vs ${partido.equipo2}.` });
        } else {
            return interaction.editReply({ content: `❌ Error al crear el canal para el partido \`${matchId}\`.` });
        }
    }

    // ── Modal: borrar canal de partido ───────────────────────
    if (interaction.isModalSubmit() && interaction.customId === 'modal_canal_borrar') {
        await interaction.deferReply({ ephemeral: true });
        const guild = interaction.guild;
        const matchId = parseInt(interaction.fields.getTextInputValue('cb_match_id').trim());
        const partido = db.prepare('SELECT * FROM matches WHERE id=?').get(matchId);
        if (!partido) return interaction.editReply({ content: `❌ No existe ningún partido con ID \`${matchId}\`.` });
        if (!partido.canal_discord) return interaction.editReply({ content: `⚠️ El partido \`${matchId}\` no tiene canal de Discord asignado.` });

        const canal = guild.channels.cache.get(partido.canal_discord);
        if (canal) {
            await canal.delete().catch(e => console.warn('Error borrando canal:', e.message));
        }
        db.prepare('UPDATE matches SET canal_discord=NULL WHERE id=?').run(matchId);
        delete canalesPartido[matchId];
        return interaction.editReply({ content: `✅ Canal del partido **[${matchId}]** ${partido.equipo1} vs ${partido.equipo2} eliminado.` });
    }

    // ── Modal: añadir usuario a canal de partido ─────────────
    if (interaction.isModalSubmit() && interaction.customId === 'modal_canal_add_usuario') {
        await interaction.deferReply({ ephemeral: true });
        const guild = interaction.guild;
        const matchId = parseInt(interaction.fields.getTextInputValue('cau_match_id').trim());
        let rawUserId = interaction.fields.getTextInputValue('cau_user_id').trim();
        const mentionMatch = rawUserId.match(/^<@!?(\d+)>$/);
        if (mentionMatch) rawUserId = mentionMatch[1];

        const partido = db.prepare('SELECT * FROM matches WHERE id=?').get(matchId);
        if (!partido) return interaction.editReply({ content: `❌ No existe ningún partido con ID \`${matchId}\`.` });
        if (!partido.canal_discord) return interaction.editReply({ content: `⚠️ El partido \`${matchId}\` no tiene canal de Discord asignado. Créalo primero.` });

        const canal = guild.channels.cache.get(partido.canal_discord);
        if (!canal) return interaction.editReply({ content: `❌ No se encontró el canal en Discord (puede haber sido borrado). Usa **Crear canal** para regenerarlo.` });

        let member;
        try {
            member = await guild.members.fetch(rawUserId);
        } catch(e) {
            return interaction.editReply({ content: `❌ No se encontró ningún miembro con ID \`${rawUserId}\`.` });
        }

        await canal.permissionOverwrites.create(member, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
        });
        return interaction.editReply({ content: `✅ **${member.user.username}** añadido al canal <#${partido.canal_discord}> del partido **[${matchId}]** ${partido.equipo1} vs ${partido.equipo2}.` });
    }

    // ── Modal inscripción ─────────────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_')) {
        const posicion = interaction.customId.split('_')[1];
        const telefono = interaction.fields.getTextInputValue('telefono');
        const eafc_id  = interaction.fields.getTextInputValue('eafc_id');
        const foto     = interaction.user.displayAvatarURL({ extension: 'png', size: 512 });
        db.prepare(`INSERT INTO players (discord_id, nombre, posicion, telefono, eafc_id, foto) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(discord_id) DO UPDATE SET posicion=excluded.posicion, telefono=excluded.telefono, eafc_id=excluded.eafc_id, foto=excluded.foto`)
            .run(interaction.user.id, interaction.user.username, posicion, telefono, eafc_id, foto);
        try {
            const member = await interaction.guild.members.fetch(interaction.user.id);
            await member.roles.add(ROL_JUGADOR);
        } catch(e) { console.error('Error asignando rol:', e.message); }
        await notificarInscripcion(interaction.user.id, interaction.user.username, eafc_id, posicion);
        await interaction.reply({ content: `✅ ¡Inscrito como **${posicion}**!`, ephemeral: true });

        // DM con las restricciones de la normativa
        try {
            const embedNormas = new EmbedBuilder()
                .setColor(0xff4d4d)
                .setTitle('⚠️ Restricciones de Clutch Draft — Léelas antes de jugar')
                .setDescription('Te has inscrito correctamente. Antes de que empiece el draft, asegúrate de cumplir con estas normas. **El incumplimiento puede suponer tu descalificación.**')
                .addFields(
                    {
                        name: '📏 Límites de altura por posición',
                        value: '🔴 **DFC (Centrales)** — máx. **187 cm**\n🟡 **Otras posiciones** — máx. **182 cm**\n🟢 **Portero** — máx. **192 cm**\n\n> Sobrepasar el límite conlleva penalización al capitán. El abuso reiterado supone partido perdido. **Debes grabar siempre las alturas.**',
                        inline: false
                    },
                    {
                        name: '🚫 Estilos de juego baneados',
                        value: 'Los PlayStyles de la imagen de abajo están **completamente prohibidos** en todas las competiciones.',
                        inline: false
                    },
                    {
                        name: '🛡️ Subida de defensas',
                        value: 'Los DFC **no pueden subir al ataque de forma fija** hasta el minuto **75**. Las subidas puntuales están permitidas.',
                        inline: false
                    },
                    {
                        name: '📋 Protocolo de partido',
                        value: '▸ Solo **un reinicio** y antes del **minuto 10**.\n▸ Si un jugador no se presenta, avisa al Staff.\n▸ Cualquier jugador fuera de lista requiere aprobación previa.',
                        inline: false
                    }
                )
                .setImage('https://clutch-draft.duckdns.org/uploads/playstyles_banneados.png')
                .setFooter({ text: 'Clutch Draft · Si no cumples la normativa, no podrás participar.' })
                .setTimestamp();

            await interaction.user.send({ embeds: [embedNormas] });
        } catch(e) { /* DMs desactivados */ }
        return;
    }

    // ── Botones globales de co-capitán ────────────────────────
    if (interaction.isButton() && interaction.customId === 'cocap_add') {
        const equipo = db.prepare("SELECT * FROM teams WHERE capitan_id=?").get(interaction.user.id);
        if (!equipo) return interaction.reply({ content: '❌ Solo los capitanes registrados pueden añadir co-capitanes.', ephemeral: true });

        const jugadores = db.prepare(
            "SELECT discord_id, nombre, posicion, equipo FROM players WHERE discord_id != ? ORDER BY nombre"
        ).all(interaction.user.id);
        if (!jugadores.length)
            return interaction.reply({ content: '⚠️ No hay jugadores apuntados al draft.', ephemeral: true });

        const opciones = jugadores.slice(0, 25).map(j => ({
            label:       j.nombre.slice(0, 100),
            description: `${j.posicion}${j.equipo ? ` · ${j.equipo}` : ' · Sin equipo'}`.slice(0, 100),
            value:       j.discord_id
        }));

        const select = new StringSelectMenuBuilder()
            .setCustomId('cocap_select')
            .setPlaceholder('Selecciona un jugador como co-capitán...')
            .addOptions(opciones);

        return interaction.reply({
            content:    '👥 Selecciona al jugador que será tu co-capitán:',
            components: [new ActionRowBuilder().addComponents(select)],
            ephemeral:  true
        });
    }

    if (interaction.isButton() && interaction.customId === 'cocap_remove') {
        const equipo = db.prepare("SELECT * FROM teams WHERE capitan_id=?").get(interaction.user.id);
        if (!equipo) return interaction.reply({ content: '❌ No eres capitán registrado.', ephemeral: true });
        const cocaps = db.prepare("SELECT cocapitan_id FROM cocapitanes WHERE capitan_id=?").all(interaction.user.id);
        if (!cocaps.length) return interaction.reply({ content: '⚠️ No tienes ningún co-capitán registrado.', ephemeral: true });
        db.prepare("DELETE FROM cocapitanes WHERE capitan_id=?").run(interaction.user.id);
        return interaction.reply({ content: '✅ Co-capitán(es) eliminado(s).', ephemeral: true });
    }

    if (interaction.isButton() && interaction.customId === 'cocap_view') {
        const equipo = db.prepare("SELECT * FROM teams WHERE capitan_id=?").get(interaction.user.id);
        if (!equipo) return interaction.reply({ content: '❌ No eres capitán registrado.', ephemeral: true });
        const cocaps = db.prepare("SELECT cocapitan_id FROM cocapitanes WHERE capitan_id=?").all(interaction.user.id);
        if (!cocaps.length) return interaction.reply({ content: '👥 No tienes co-capitán registrado.', ephemeral: true });
        return interaction.reply({ content: `👥 Tu(s) co-capitán(es): ${cocaps.map(c => `<@${c.cocapitan_id}>`).join(', ')}`, ephemeral: true });
    }

    // ── Select menu: elegir co-capitán del desplegable ───────
    if (interaction.isStringSelectMenu() && interaction.customId === 'cocap_select') {
        const equipo = db.prepare("SELECT * FROM teams WHERE capitan_id=?").get(interaction.user.id);
        if (!equipo) return interaction.update({ content: '❌ No eres capitán registrado.', components: [] });

        const selectedId = interaction.values[0];

        // Buscar al miembro en el servidor para enviar el DM
        let member;
        try { member = await interaction.guild.members.fetch(selectedId); } catch(e) { /* no está */ }

        const jugador      = db.prepare("SELECT nombre FROM players WHERE discord_id=?").get(selectedId);
        const nombreMostrar = member?.user.username || jugador?.nombre || selectedId;
        const nombreEquipo  = equipo.nombre_equipo || equipo.capitan_username;

        const inviteEmbed = new EmbedBuilder()
            .setTitle('🤝 Invitación de Co-Capitán')
            .setColor(0xa066ff)
            .setDescription(
                `**${interaction.user.username}** (capitán de **${nombreEquipo}**) te invita a ser su co-capitán en Clutch Draft.\n\n` +
                `Si aceptas, tendrás acceso a los canales privados de partido del equipo.`
            )
            .setFooter({ text: 'Esta invitación expira en 24 horas' });

        const rowInvite = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`cocap_aceptar_${interaction.user.id}_${selectedId}`).setLabel('✅ Aceptar').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`cocap_rechazar_${interaction.user.id}_${selectedId}`).setLabel('❌ Rechazar').setStyle(ButtonStyle.Danger)
        );

        if (!member) {
            return interaction.update({ content: `❌ **${nombreMostrar}** no está en el servidor Discord.`, components: [] });
        }
        try {
            await member.send({ embeds: [inviteEmbed], components: [rowInvite] });
            return interaction.update({
                content:    `✅ Invitación enviada a **${nombreMostrar}** por DM. Cuando acepte, quedará registrado como co-capitán.`,
                components: []
            });
        } catch(e) {
            return interaction.update({
                content:    `❌ No se pudo enviar DM a **${nombreMostrar}**. Puede tener los mensajes directos desactivados.`,
                components: []
            });
        }
    }

    // ── Aceptar invitación de co-capitán ────────────────────
    if (interaction.isButton() && interaction.customId.startsWith('cocap_aceptar_')) {
        const parts = interaction.customId.split('_');
        // cocap_aceptar_CAPITANID_INVITADOID
        const capitanId  = parts[2];
        const invitadoId = parts[3];
        // Solo el invitado puede aceptar
        if (interaction.user.id !== invitadoId)
            return interaction.reply({ content: '❌ Esta invitación no es para ti.', ephemeral: true });

        const guild = interaction.guild || client.guilds.cache.first();
        if (!guild) return interaction.reply({ content: '❌ Error al obtener el servidor.', ephemeral: true });

        const equipo = db.prepare("SELECT * FROM teams WHERE capitan_id=?").get(capitanId);
        if (!equipo) return interaction.reply({ content: '❌ El capitán ya no está registrado.', ephemeral: true });

        db.prepare("INSERT OR REPLACE INTO cocapitanes (capitan_id, cocapitan_id) VALUES (?, ?)").run(capitanId, invitadoId);

        // Añadir permisos en canales activos del equipo
        const activos = db.prepare(
            "SELECT canal_discord FROM matches WHERE (equipo1=? OR equipo2=?) AND estado='pendiente' AND canal_discord IS NOT NULL AND canal_discord != ''"
        ).all(equipo.capitan_username, equipo.capitan_username);
        for (const { canal_discord } of activos) {
            try {
                const ch = await guild.channels.fetch(canal_discord);
                await ch.permissionOverwrites.edit(invitadoId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
            } catch(e) { /* ignorar */ }
        }

        // Notificar al capitán por DM
        try {
            const capitan = await client.users.fetch(capitanId);
            await capitan.send(`✅ **${interaction.user.username}** ha aceptado ser tu co-capitán en **${equipo.nombre_equipo || equipo.capitan_username}**.`);
        } catch(e) { /* DMs bloqueados */ }

        // Editar el mensaje del DM para deshabilitar botones
        if (interaction.channel?.isDMBased()) {
            await interaction.update({ content: `✅ Has aceptado ser co-capitán de **${equipo.capitan_username}**.`, embeds: [], components: [] });
        } else {
            await interaction.reply({ content: `✅ Has aceptado ser co-capitán de **${equipo.capitan_username}**.`, ephemeral: true });
        }
        return;
    }

    // ── Rechazar invitación de co-capitán ───────────────────
    if (interaction.isButton() && interaction.customId.startsWith('cocap_rechazar_')) {
        const parts = interaction.customId.split('_');
        const capitanId  = parts[2];
        const invitadoId = parts[3];
        if (interaction.user.id !== invitadoId)
            return interaction.reply({ content: '❌ Esta invitación no es para ti.', ephemeral: true });

        // Notificar al capitán
        try {
            const capitan = await client.users.fetch(capitanId);
            const equipo  = db.prepare("SELECT * FROM teams WHERE capitan_id=?").get(capitanId);
            await capitan.send(`❌ **${interaction.user.username}** ha rechazado ser tu co-capitán${equipo ? ` en **${equipo.nombre_equipo || equipo.capitan_username}**` : ''}.`);
        } catch(e) { /* DMs bloqueados */ }

        if (interaction.channel?.isDMBased()) {
            await interaction.update({ content: `❌ Has rechazado la invitación de co-capitán.`, embeds: [], components: [] });
        } else {
            await interaction.reply({ content: `❌ Has rechazado la invitación.`, ephemeral: true });
        }
        return;
    }

    // ── Botón reportar resultado ─────────────────────────────
    if (interaction.isButton() && interaction.customId.startsWith('reportar_')) {
        const matchId = interaction.customId.split('_')[1];
        const match   = db.prepare('SELECT * FROM matches WHERE id=?').get(matchId);
        if (!match) return interaction.reply({ content: '❌ Partido no encontrado.', ephemeral: true });

        // Checks síncronos únicamente (no guild.members.fetch — hay que responder en <3s)
        const esAdminRapido = interaction.user.id === ADMIN_ID ||
            !!db.prepare('SELECT id FROM admins WHERE discord_id=?').get(interaction.user.id);
        const esCapitan1 = db.prepare("SELECT 1 FROM teams WHERE capitan_username=? AND capitan_id=?").get(match.equipo1, interaction.user.id);
        const esCapitan2 = db.prepare("SELECT 1 FROM teams WHERE capitan_username=? AND capitan_id=?").get(match.equipo2, interaction.user.id);
        const cap1row    = db.prepare("SELECT capitan_id FROM teams WHERE capitan_username=?").get(match.equipo1);
        const cap2row    = db.prepare("SELECT capitan_id FROM teams WHERE capitan_username=?").get(match.equipo2);
        const esCocap    =
            (cap1row && db.prepare("SELECT 1 FROM cocapitanes WHERE capitan_id=? AND cocapitan_id=?").get(cap1row.capitan_id, interaction.user.id)) ||
            (cap2row && db.prepare("SELECT 1 FROM cocapitanes WHERE capitan_id=? AND cocapitan_id=?").get(cap2row.capitan_id, interaction.user.id));

        if (!esAdminRapido && !esCapitan1 && !esCapitan2 && !esCocap)
            return interaction.reply({ content: '❌ Solo los capitanes (o co-capitanes) de este partido pueden reportar.', ephemeral: true });
        if (match.estado === 'finalizado')
            return interaction.reply({ content: '✅ Este partido ya está finalizado.', ephemeral: true });

        // Títulos truncados al límite de Discord (45 chars)
        const tituloModal  = `${match.equipo1} vs ${match.equipo2}`.slice(0, 45);
        const labelLocal   = `Goles ${match.equipo1}`.slice(0, 45);
        const labelVisit   = `Goles ${match.equipo2}`.slice(0, 45);
        const modal = new ModalBuilder().setCustomId(`resultado_modal_${matchId}`).setTitle(tituloModal);
        const g1Input = new TextInputBuilder().setCustomId('goles_local').setLabel(labelLocal).setStyle(TextInputStyle.Short).setPlaceholder('0').setRequired(true).setMinLength(1).setMaxLength(2);
        const g2Input = new TextInputBuilder().setCustomId('goles_visitante').setLabel(labelVisit).setStyle(TextInputStyle.Short).setPlaceholder('0').setRequired(true).setMinLength(1).setMaxLength(2);
        modal.addComponents(new ActionRowBuilder().addComponents(g1Input), new ActionRowBuilder().addComponents(g2Input));
        await interaction.showModal(modal);
        return;
    }

    // ── Modal resultado ───────────────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId.startsWith('resultado_modal_')) {
        // Defer inmediato — las operaciones siguientes pueden tardar >3s y Discord mataría la interacción
        await interaction.deferReply({ ephemeral: true });

        const matchId = interaction.customId.split('_')[2];
        const match   = db.prepare('SELECT * FROM matches WHERE id=?').get(matchId);
        if (!match) return interaction.editReply({ content: '❌ Partido no encontrado.' });

        const g1 = parseInt(interaction.fields.getTextInputValue('goles_local'));
        const g2 = parseInt(interaction.fields.getTextInputValue('goles_visitante'));
        if (isNaN(g1) || isNaN(g2) || g1 < 0 || g2 < 0)
            return interaction.editReply({ content: '❌ Introduce números válidos (0 o mayor).' });

        if (match.estado === 'finalizado')
            return interaction.editReply({ content: '✅ Este partido ya estaba finalizado.' });

        // ── Admin: confirmar directamente sin esperar al otro capitán ──
        const esAdminReporte = await esAdminDiscord(interaction.user.id);
        if (esAdminReporte) {
            try {
                await axios.post('http://localhost:3000/api/resultado-confirmado', { match_id: matchId, goles1: g1, goles2: g2 });
            } catch(e) { console.error('Error llamando resultado-confirmado (admin):', e.message); }
            delete reportesPendientes[matchId];
            if (match.canal_discord) {
                try {
                    const ch = await client.channels.fetch(match.canal_discord);
                    await ch.send({ embeds: [new EmbedBuilder()
                        .setTitle('✅ RESULTADO REGISTRADO POR ADMIN')
                        .setColor(0xf0c040)
                        .addFields(
                            { name: '🏠 ' + match.equipo1, value: String(g1), inline: true },
                            { name: '✈️ ' + match.equipo2, value: String(g2), inline: true }
                        )
                        .setDescription('Resultado registrado directamente por el administrador.')
                        .setTimestamp()
                    ]});
                } catch(e) { /* canal puede no existir */ }
            }
            const guildAdmin = client.guilds.cache.first();
            if (guildAdmin) {
                await actualizarCanalClasificacion(guildAdmin).catch(() => {});
                await actualizarCanalResultadosPub(guildAdmin).catch(() => {});
                await actualizarCanalRondasFinalesPub(guildAdmin).catch(() => {});
                await comprobarAvanceJornada(guildAdmin).catch(() => {});
            }
            return interaction.editReply({ content: `✅ Resultado registrado: **${match.equipo1} ${g1} - ${g2} ${match.equipo2}**` });
        }

        // Determinar qué equipo representa quien reporta (capitán o co-capitán)
        const esCapitan1 = db.prepare("SELECT 1 FROM teams WHERE capitan_username=? AND capitan_id=?").get(match.equipo1, interaction.user.id);
        let rolReportando;
        if (esCapitan1) {
            rolReportando = match.equipo1;
        } else {
            const esCapitan2 = db.prepare("SELECT 1 FROM teams WHERE capitan_username=? AND capitan_id=?").get(match.equipo2, interaction.user.id);
            if (esCapitan2) {
                rolReportando = match.equipo2;
            } else {
                // Co-capitán: determinar equipo vía DB de cocapitanes
                const cap1rowR   = db.prepare("SELECT capitan_id FROM teams WHERE capitan_username=?").get(match.equipo1);
                const esCocapEq1 = cap1rowR && db.prepare("SELECT 1 FROM cocapitanes WHERE capitan_id=? AND cocapitan_id=?").get(cap1rowR.capitan_id, interaction.user.id);
                rolReportando = esCocapEq1 ? match.equipo1 : match.equipo2;
            }
        }

        if (!reportesPendientes[matchId]) reportesPendientes[matchId] = {};
        reportesPendientes[matchId][rolReportando] = { g1, g2 };

        const reportes = reportesPendientes[matchId];
        const r1 = reportes[match.equipo1];
        const r2 = reportes[match.equipo2];

        if (r1 && r2) {
            if (r1.g1 === r2.g1 && r1.g2 === r2.g2) {
                // ✅ Ambos coinciden
                try {
                    await axios.post('http://localhost:3000/api/resultado-confirmado', { match_id: matchId, goles1: g1, goles2: g2 });
                } catch(e) { console.error('Error llamando resultado-confirmado:', e.message); }
                delete reportesPendientes[matchId];

                if (match.canal_discord) {
                    try {
                        const ch = await client.channels.fetch(match.canal_discord);
                        await ch.send({ embeds: [new EmbedBuilder()
                            .setTitle('✅ RESULTADO CONFIRMADO')
                            .setColor(0x00ffcc)
                            .addFields(
                                { name: '🏠 ' + match.equipo1, value: String(g1), inline: true },
                                { name: '✈️ ' + match.equipo2, value: String(g2), inline: true }
                            )
                            .setDescription('Ambos capitanes han confirmado el resultado. La clasificación se actualiza automáticamente.')
                            .setTimestamp()
                        ]});
                    } catch(e) { /* canal puede estar borrado */ }
                }
                const guild = client.guilds.cache.first();
                if (guild) {
                    await actualizarCanalClasificacion(guild).catch(() => {});
                    await actualizarCanalResultadosPub(guild).catch(() => {});
                    await actualizarCanalRondasFinalesPub(guild).catch(() => {});
                    await comprobarAvanceJornada(guild).catch(() => {});
                }
                return interaction.editReply({ content: '✅ ¡Resultado confirmado! La clasificación se ha actualizado.' });
            } else {
                // ⚠️ Conflicto — avisar al admin por DM y por canal de anuncios
                const embedConflicto = new EmbedBuilder()
                    .setTitle('⚠️ CONFLICTO DE RESULTADO')
                    .setColor(0xff4d4d)
                    .setDescription('Los capitanes reportaron resultados **distintos**. Se requiere revisión.')
                    .addFields(
                        { name: match.equipo1 + ' reporta', value: `${r1.g1} - ${r1.g2}`, inline: true },
                        { name: match.equipo2 + ' reporta', value: `${r2.g1} - ${r2.g2}`, inline: true },
                        { name: '🔗 Canal', value: match.canal_discord ? `<#${match.canal_discord}>` : 'N/A', inline: false },
                        { name: 'Match ID', value: String(matchId), inline: true }
                    )
                    .setTimestamp();
                try {
                    const admin = await client.users.fetch(ADMIN_ID);
                    await admin.send({ embeds: [embedConflicto] });
                } catch(e) { /* DMs bloqueados */ }
                try {
                    const guild = client.guilds.cache.first();
                    if (guild) {
                        const canalAnuncios = await guild.channels.fetch(CANAL_ANUNCIOS);
                        await canalAnuncios.send({ content: `<@${ADMIN_ID}> ⚠️ Conflicto de resultado`, embeds: [embedConflicto] });
                    }
                } catch(e) { /* ignorar */ }
                return interaction.editReply({ content: '⚠️ Tu resultado difiere del otro capitán. El admin ha sido notificado.' });
            }
        } else {
            return interaction.editReply({ content: `⏳ Resultado registrado (**${g1}-${g2}**). Esperando al otro capitán para confirmar.` });
        }
    }

    // ══════════════════════════════════════════════════════════
    //  PANEL DE ADMIN — BOTONES admp_*
    // ══════════════════════════════════════════════════════════
    if (interaction.isButton() && interaction.customId.startsWith('admp_')) {
        const esAdmin = await esAdminDiscord(interaction.user.id);
        if (!esAdmin)
            return interaction.reply({ content: '❌ Solo los administradores pueden usar el panel.', ephemeral: true });

        const guild = interaction.guild;
        const id = interaction.customId;

        // Botones que abren modal: NO se puede deferReply antes de showModal
        if (id === 'admp_set_fecha_limite') {
            const actual = db.prepare(`SELECT value FROM settings WHERE key='fecha_limite_inscripciones'`).get()?.value || '';
            const modal = new ModalBuilder().setCustomId('modal_set_fecha_limite').setTitle('⏰ Fecha límite de inscripciones');
            modal.addComponents(new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('fecha_limite_input')
                    .setLabel('Fecha y hora límite')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('ej: Viernes 25 de abril a las 23:59h')
                    .setValue(actual).setMaxLength(100).setRequired(true)
            ));
            await interaction.showModal(modal);
            return;
        }
        if (id === 'admp_set_horario') {
            const horarioActual = db.prepare(`SELECT value FROM settings WHERE key='horario_torneo'`).get()?.value || '';
            const modal = new ModalBuilder().setCustomId('modal_set_horario').setTitle('📅 Cambiar horario del torneo');
            modal.addComponents(new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('horario_input').setLabel('Horario (ej: Sábados 19:00h — 21:00h)')
                    .setStyle(TextInputStyle.Short).setPlaceholder('Sábados 19:00h — 21:00h')
                    .setValue(horarioActual).setMaxLength(100).setRequired(true)
            ));
            await interaction.showModal(modal);
            return;
        }
        if (id === 'admp_set_fecha_draft') {
            const fechaActual = db.prepare(`SELECT value FROM settings WHERE key='fecha_draft'`).get()?.value || '';
            const modal = new ModalBuilder().setCustomId('modal_set_fecha_draft').setTitle('📆 Cambiar fecha del draft');
            modal.addComponents(new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('fecha_draft_input').setLabel('Fecha del draft')
                    .setStyle(TextInputStyle.Short).setPlaceholder('ej: Sábado 26 de abril a las 21:00h')
                    .setValue(fechaActual).setMaxLength(100).setRequired(true)
            ));
            await interaction.showModal(modal);
            return;
        }
        if (id === 'admp_set_tiempo_uh') {
            const actual = db.prepare(`SELECT value FROM settings WHERE key='tiempo_ultima_hora'`).get()?.value || '30';
            const modal = new ModalBuilder().setCustomId('modal_set_tiempo_uh').setTitle('⏱️ Tiempo inscripciones última hora');
            modal.addComponents(new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('tiempo_uh_input')
                    .setLabel('Minutos (mín. 6, máx. 120)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('ej: 30')
                    .setValue(actual).setMinLength(1).setMaxLength(3).setRequired(true)
            ));
            await interaction.showModal(modal);
            return;
        }
        if (id === 'admp_forzar_capitan') {
            const modal = new ModalBuilder().setCustomId('modal_forzar_capitan').setTitle('👑 Forzar capitán manualmente');
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('fc_user_id').setLabel('ID de Discord o @mención del usuario')
                        .setStyle(TextInputStyle.Short).setPlaceholder('123456789012345678 o @usuario').setRequired(true).setMaxLength(100)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('fc_nombre_equipo').setLabel('Nombre del equipo (opcional)')
                        .setStyle(TextInputStyle.Short).setPlaceholder('Deja vacío para usar el nombre de usuario').setRequired(false).setMaxLength(50)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('fc_posicion').setLabel('Posición del capitán (DC, MC, DFC, CARR, POR)')
                        .setStyle(TextInputStyle.Short).setPlaceholder('DC').setRequired(false).setMaxLength(4)
                )
            );
            await interaction.showModal(modal);
            return;
        }

        if (id === 'admp_cap_gratis_forzar') {
            const modal = new ModalBuilder().setCustomId('modal_cap_gratis_forzar').setTitle('👑 Añadir candidato a Ruleta');
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('cgf_user_id').setLabel('Discord ID del jugador')
                        .setStyle(TextInputStyle.Short).setPlaceholder('123456789012345678').setRequired(true).setMaxLength(30)
                )
            );
            await interaction.showModal(modal);
            return;
        }

        if (id === 'admp_cap_gratis_quitar') {
            const modal = new ModalBuilder().setCustomId('modal_cap_gratis_quitar').setTitle('🗑️ Quitar candidato de Ruleta');
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('cgq_user_id').setLabel('Discord ID del candidato a quitar')
                        .setStyle(TextInputStyle.Short).setPlaceholder('123456789012345678').setRequired(true).setMaxLength(30)
                )
            );
            await interaction.showModal(modal);
            return;
        }

        if (id === 'admp_cap_gratis_config') {
            const modal = new ModalBuilder().setCustomId('modal_cap_gratis_config').setTitle('⚙️ Config Draft Gratuito');
            const curEq  = db.prepare(`SELECT value FROM settings WHERE key='num_equipos_manual'`).get()?.value || '';
            const curFmt = db.prepare(`SELECT value FROM settings WHERE key='formato_manual'`).get()?.value || '';
            const curCap = db.prepare(`SELECT value FROM settings WHERE key='caps_por_equipo'`).get()?.value || '1';
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('cgc_num_equipos').setLabel('Número de equipos')
                        .setStyle(TextInputStyle.Short).setPlaceholder('ej: 8').setRequired(false).setMaxLength(3).setValue(curEq)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('cgc_formato').setLabel('Formato (liga/champions6/champions8/etc.)')
                        .setStyle(TextInputStyle.Short).setPlaceholder('ej: champions8').setRequired(false).setMaxLength(30).setValue(curFmt)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('cgc_caps').setLabel('Capitanes por equipo (1 o 2)')
                        .setStyle(TextInputStyle.Short).setPlaceholder('1').setRequired(false).setMaxLength(1).setValue(curCap)
                )
            );
            await interaction.showModal(modal);
            return;
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            // ── Inscripciones ──────────────────────────────────────
            if (id === 'admp_insc_abrir') {
                db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('inscripciones_estado','abierto')").run();
                notificarInscripciones('abrir').catch(() => {});
                try {
                    const chInsc = await guild.channels.fetch(CANAL_INSCRIPCIONES);
                    const chId  = db.prepare("SELECT value FROM settings WHERE key='panel_ch_id'").get()?.value;
                    const msgId = db.prepare("SELECT value FROM settings WHERE key='panel_msg_id'").get()?.value;
                    if (chId === CANAL_INSCRIPCIONES && msgId) {
                        try {
                            const msg = await chInsc.messages.fetch(msgId);
                            await msg.edit({ embeds: [buildPanelEmbed()], components: buildPanelRows() });
                        } catch(e) {
                            await borrarMensajesCanal(chInsc);
                            const msg = await chInsc.send({ embeds: [buildPanelEmbed()], components: buildPanelRows() });
                            db.prepare("UPDATE settings SET value=? WHERE key='panel_msg_id'").run(msg.id);
                            db.prepare("UPDATE settings SET value=? WHERE key='panel_ch_id'").run(chInsc.id);
                        }
                    } else {
                        await borrarMensajesCanal(chInsc);
                        const msg = await chInsc.send({ embeds: [buildPanelEmbed()], components: buildPanelRows() });
                        db.prepare("UPDATE settings SET value=? WHERE key='panel_msg_id'").run(msg.id);
                        db.prepare("UPDATE settings SET value=? WHERE key='panel_ch_id'").run(chInsc.id);
                    }
                } catch(e) { console.error('Error publicando panel inscripciones:', e.message); }
                await anunciarInscripcionesAbiertas(guild).catch(() => {});
                await interaction.editReply({ content: '✅ Inscripciones **abiertas** y panel publicado en <#' + CANAL_INSCRIPCIONES + '>.' });

            } else if (id === 'admp_insc_cerrar') {
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('admp_tipo_pago').setLabel('💰 Draft de pago').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('admp_tipo_gratuito').setLabel('🆓 Draft gratuito').setStyle(ButtonStyle.Success),
                );
                await interaction.editReply({
                    content: '**¿Qué tipo de draft es este?**\n\n💰 **Draft de pago** — votación de precio, canal de pagos\n🆓 **Draft gratuito** — solo lista de jugadores y votación de capitán',
                    components: [row]
                });

            } else if (id === 'admp_tipo_pago') {
                await interaction.editReply({ content: '⏳ Cerrando inscripciones (pago)…', components: [] });
                await cerrarInscripciones();
                await interaction.editReply({ content: '✅ Inscripciones cerradas (pago). Canales privados creados y votación de precio iniciada.' });

            } else if (id === 'admp_tipo_gratuito') {
                await interaction.editReply({ content: '⏳ Cerrando inscripciones (gratuito)…', components: [] });
                await cerrarInscripcionesGratuito(guild);
                await interaction.editReply({ content: '✅ Inscripciones cerradas (gratuito). Canal de jugadores y votación de capitán creados.' });

            // ── Votación / Pagos ───────────────────────────────────
            } else if (id === 'admp_vot_iniciar') {
                const canalVotId  = db.prepare("SELECT value FROM settings WHERE key='canal_votacion_precio'").get()?.value;
                const canalVot    = canalVotId ? await guild.channels.fetch(canalVotId).catch(() => null) : null;
                const canalAnu    = await guild.channels.fetch(CANAL_ANUNCIOS).catch(() => null);
                const canalTarget = canalVot || canalAnu;
                if (!canalTarget) return interaction.editReply({ content: '❌ No se encontró el canal de votación ni de anuncios.' });
                await lanzarVotacionPrecio(canalTarget);
                await interaction.editReply({ content: '✅ Votación de precio iniciada (20 min).' });

            } else if (id === 'admp_vot_cerrar') {
                const canalVotId  = db.prepare("SELECT value FROM settings WHERE key='canal_votacion_precio'").get()?.value;
                const canalVot    = canalVotId ? await guild.channels.fetch(canalVotId).catch(() => null) : null;
                const canalAnu    = await guild.channels.fetch(CANAL_ANUNCIOS).catch(() => null);
                const canalTarget = canalVot || canalAnu;
                if (!canalTarget) return interaction.editReply({ content: '❌ No se encontró el canal.' });
                await cerrarVotacionPrecio(canalTarget);
                await interaction.editReply({ content: '✅ Votación cerrada. Resultado y panel de pago publicados.' });

            } else if (id === 'admp_cap_doble') {
                const resultado = await lanzarCapitaniaDoble(guild);
                if (resultado.ok) await interaction.editReply({ content: '✅ Panel de capitanía doble publicado en 💳-pagos.' });
                else              await interaction.editReply({ content: `❌ ${resultado.error}` });

            } else if (id === 'admp_pago_10' || id === 'admp_pago_15' || id === 'admp_pago_20') {
                const precio       = id.split('_')[2];
                db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('precio_torneo',?)").run(precio);
                notificarPrecio(precio).catch(() => {});
                const canalPagosId = db.prepare("SELECT value FROM settings WHERE key='canal_pagos'").get()?.value;
                const canalPagos   = canalPagosId ? await guild.channels.fetch(canalPagosId).catch(() => null) : null;
                const canalAnu     = await guild.channels.fetch(CANAL_ANUNCIOS).catch(() => null);
                await lanzarPanelPago(canalPagos || canalAnu, precio);
                await interaction.editReply({ content: `✅ Panel de pago (${precio} €) publicado.` });

            // ── Draft ──────────────────────────────────────────────
            } else if (id === 'admp_draft_abrir') {
                await axios.post('http://localhost:3000/api/bot/abrir-draft');
                await interaction.editReply({ content: '✅ Draft **abierto**.' });

            } else if (id === 'admp_draft_cerrar') {
                await axios.post('http://localhost:3000/api/bot/cerrar-draft');
                await interaction.editReply({ content: '✅ Draft **cerrado**.' });

            } else if (id === 'admp_draft_saltar') {
                const turnoActual = db.prepare(`SELECT value FROM settings WHERE key='turno_actual'`).get()?.value || '?';
                await interaction.editReply({
                    content: `⚠️ **¿Confirmas saltar el turno de \`${turnoActual}\`?**\nSi fue un error, usa "Cancelar".`,
                    components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('admp_draft_saltar_confirmar').setLabel('⏭️ Sí, saltar').setStyle(ButtonStyle.Danger),
                        new ButtonBuilder().setCustomId('admp_draft_saltar_cancelar').setLabel('❌ Cancelar').setStyle(ButtonStyle.Secondary),
                    )]
                });

            } else if (id === 'admp_draft_saltar_confirmar') {
                await axios.post('http://localhost:3000/api/bot/saltar-turno');
                await interaction.editReply({ content: '✅ Turno saltado.', components: [] });

            } else if (id === 'admp_draft_saltar_cancelar') {
                await interaction.editReply({ content: '❌ Cancelado — el turno no se saltó.', components: [] });

            // ── Torneo ─────────────────────────────────────────────
            } else if (id === 'admp_torneo_generar') {
                const equipos = db.prepare('SELECT * FROM teams ORDER BY id').all();
                if (equipos.length < 2) return interaction.editReply({ content: '❌ Necesitas al menos 2 equipos.' });
                const resultado = await generarTorneo(equipos);
                if (resultado.ok) await interaction.editReply({ content: `✅ Torneo generado: ${resultado.matches} partidos · ${resultado.jornadas} jornadas.` });
                else              await interaction.editReply({ content: `❌ Error: ${resultado.error}` });

            } else if (id === 'admp_torneo_fase') {
                const torneoGen = db.prepare("SELECT value FROM settings WHERE key='torneo_generado'").get()?.value;
                if (!torneoGen) return interaction.editReply({ content: '❌ No hay torneo generado.' });
                await generarSiguienteJornada(guild);
                await interaction.editReply({ content: '✅ Siguiente jornada/fase generada.' });

            } else if (id === 'admp_torneo_recalc') {
                // Recalcular desde cero usando partidos finalizados
                const equiposClas = db.prepare('SELECT capitan_id FROM clasificacion').all();
                for (const eq of equiposClas) {
                    db.prepare("UPDATE clasificacion SET puntos=0,pj=0,pg=0,pe=0,pp=0,gf=0,gc=0 WHERE capitan_id=?").run(eq.capitan_id);
                }
                const partidosFin = db.prepare("SELECT * FROM matches WHERE estado='finalizado'").all();
                for (const p of partidosFin) {
                    const g1 = p.goles1, g2 = p.goles2;
                    if (p.equipo2 === 'BYE') {
                        db.prepare("UPDATE clasificacion SET puntos=puntos+3,pj=pj+1,pg=pg+1,gf=gf+? WHERE equipo_nombre=?").run(g1, p.equipo1);
                        continue;
                    }
                    const eq1c = db.prepare("SELECT capitan_id FROM clasificacion WHERE equipo_nombre=?").get(p.equipo1);
                    const eq2c = db.prepare("SELECT capitan_id FROM clasificacion WHERE equipo_nombre=?").get(p.equipo2);
                    if (!eq1c || !eq2c) continue;
                    db.prepare("UPDATE clasificacion SET pj=pj+1,gf=gf+?,gc=gc+? WHERE capitan_id=?").run(g1, g2, eq1c.capitan_id);
                    db.prepare("UPDATE clasificacion SET pj=pj+1,gf=gf+?,gc=gc+? WHERE capitan_id=?").run(g2, g1, eq2c.capitan_id);
                    if (g1 > g2) {
                        db.prepare("UPDATE clasificacion SET puntos=puntos+3,pg=pg+1 WHERE capitan_id=?").run(eq1c.capitan_id);
                        db.prepare("UPDATE clasificacion SET pp=pp+1 WHERE capitan_id=?").run(eq2c.capitan_id);
                    } else if (g2 > g1) {
                        db.prepare("UPDATE clasificacion SET puntos=puntos+3,pg=pg+1 WHERE capitan_id=?").run(eq2c.capitan_id);
                        db.prepare("UPDATE clasificacion SET pp=pp+1 WHERE capitan_id=?").run(eq1c.capitan_id);
                    } else {
                        db.prepare("UPDATE clasificacion SET puntos=puntos+1,pe=pe+1 WHERE capitan_id=?").run(eq1c.capitan_id);
                        db.prepare("UPDATE clasificacion SET puntos=puntos+1,pe=pe+1 WHERE capitan_id=?").run(eq2c.capitan_id);
                    }
                }
                await actualizarCanalClasificacion(guild);
                await interaction.editReply({ content: '✅ Clasificación recalculada desde cero y Discord actualizado.' });

            } else if (id === 'admp_clasi_discord') {
                await actualizarCanalClasificacion(guild);
                await interaction.editReply({ content: '✅ Canal de clasificación de Discord actualizado.' });

            } else if (id === 'admp_torneo_cerrar') {
                try {
                    await axios.post('http://localhost:3001/api/cerrar-torneo');
                    await interaction.editReply({ content: '✅ Torneo cerrado. Campeón anunciado, limpieza en curso.' });
                } catch(e) {
                    await interaction.editReply({ content: `❌ Error al cerrar torneo: ${e.message}` });
                }

            // ── Limpieza & Utilidades ──────────────────────────────
            } else if (id === 'admp_limpiar_canales') {
                let borrados = 0;
                const canalesCategoria = guild.channels.cache.filter(c => c.parentId === CATEGORIA_PARTIDOS && c.type === 0);
                for (const [, ch] of canalesCategoria) { await ch.delete().catch(() => {}); borrados++; }
                for (const k of Object.keys(canalesPartido)) delete canalesPartido[k];
                await interaction.editReply({ content: `✅ ${borrados} canal(es) de partido borrados.` });

            } else if (id === 'admp_limpiar_texto') {
                const idsTexto = [CANAL_CALENDARIO, CANAL_CLASIFICACION, CANAL_FICHAJES, CANAL_EQUIPOS_IDS];
                let ok = 0;
                for (const chId of idsTexto) {
                    try { const ch = await guild.channels.fetch(chId); await borrarMensajesCanal(ch); ok++; } catch(e) { /* ignorar */ }
                }
                await interaction.editReply({ content: `✅ ${ok} canal(es) de texto limpiados.` });

            } else if (id === 'admp_recrear_canales') {
                // Recrear canales para partidos pendientes sin canal Discord
                const sinCanal = db.prepare("SELECT * FROM matches WHERE estado='pendiente' AND (canal_discord IS NULL OR canal_discord='')").all();
                let recreados = 0;
                for (const m of sinCanal) {
                    const eq1row = db.prepare("SELECT capitan_id FROM teams WHERE capitan_username=?").get(m.equipo1);
                    const eq2row = db.prepare("SELECT capitan_id FROM teams WHERE capitan_username=?").get(m.equipo2);
                    const canalId = await crearCanalPartido(guild, m.id, m.jornada, m.equipo1, m.equipo2, eq1row?.capitan_id, eq2row?.capitan_id);
                    if (canalId) {
                        db.prepare('UPDATE matches SET canal_discord=? WHERE id=?').run(canalId, m.id);
                        canalesPartido[m.id] = canalId;
                        recreados++;
                    }
                }
                await interaction.editReply({ content: `✅ ${recreados} canal(es) de partido recreados.` });

            } else if (id === 'admp_normativa') {
                await publicarNormativa(guild);
                await interaction.editReply({ content: '✅ Normativa publicada en el canal 📜-normativa.' });

            } else if (id === 'admp_formatos') {
                await publicarFormatos(guild);
                await interaction.editReply({ content: '✅ Formatos publicados en el canal `📋-formatos` (categoría Draft).' });

            } else if (id === 'admp_limpiar_todo') {
                // Paso de confirmación antes de destruir todo
                const rowConfirm = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('admp_limpiar_todo_confirm').setLabel('💥 SÍ, LIMPIAR TODO').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId('admp_limpiar_todo_cancel').setLabel('❌ Cancelar').setStyle(ButtonStyle.Secondary)
                );
                await interaction.editReply({
                    content: '⚠️ **¿Estás seguro?** Esto borrará **todos los datos** (partidos, equipos, clasificación) y los canales de Discord del torneo. **Esta acción es irreversible.**',
                    components: [rowConfirm]
                });
                return; // no refrescar el panel todavía

            } else if (id === 'admp_limpiar_todo_confirm') {
                await limpiarTorneo();
                await interaction.editReply({ content: '✅ Limpieza completa realizada. Datos y canales borrados.', components: [] });

            } else if (id === 'admp_limpiar_todo_cancel') {
                await interaction.editReply({ content: '↩️ Operación cancelada.', components: [] });

            // ── Testing & Simulación ───────────────────────────────
            } else if (id === 'admp_seed_10') {
                // Confirmación antes de borrar todo
                const rowConfirm = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('admp_seed_10_confirm').setLabel('🗄️ Sí, cargar seed').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId('admp_limpiar_todo_cancel').setLabel('❌ Cancelar').setStyle(ButtonStyle.Secondary)
                );
                await interaction.editReply({
                    content: '⚠️ Esto **borrará todos los datos actuales** (jugadores, equipos, partidos) y cargará 10 equipos + 110 jugadores bot. ¿Continuar?',
                    components: [rowConfirm]
                });
                return;

            } else if (id === 'admp_seed_10_confirm') {
                db.prepare('DELETE FROM picks').run();
                db.prepare('DELETE FROM players').run();
                db.prepare('DELETE FROM teams').run();
                db.prepare('DELETE FROM clasificacion').run();
                db.prepare("UPDATE settings SET value='cerrado' WHERE key='draft_estado'").run();
                db.prepare("UPDATE settings SET value='' WHERE key='turno_actual'").run();
                db.prepare("UPDATE settings SET value='asc' WHERE key='direccion_snake'").run();
                db.prepare("UPDATE settings SET value='1' WHERE key='ronda_actual'").run();
                db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('torneo_generado','')").run();
                db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('torneo_fin_ts','')").run();

                const adminUser = await client.users.fetch(ADMIN_ID).catch(() => null);
                const adminName = adminUser?.username || 'Admin';
                const caps = [
                    { id: ADMIN_ID,      username: adminName,     eq: 'Los Cracks'    },
                    { id: 'BOT_CAP_001', username: 'BotCapitan1', eq: 'Galácticos'    },
                    { id: 'BOT_CAP_002', username: 'BotCapitan2', eq: 'Los Titanes'   },
                    { id: 'BOT_CAP_003', username: 'BotCapitan3', eq: 'Dream Team'    },
                    { id: 'BOT_CAP_004', username: 'BotCapitan4', eq: 'Thunder FC'    },
                    { id: 'BOT_CAP_005', username: 'BotCapitan5', eq: 'Los Invictos'  },
                    { id: 'BOT_CAP_006', username: 'BotCapitan6', eq: 'Elite Squad'   },
                    { id: 'BOT_CAP_007', username: 'BotCapitan7', eq: 'Phoenix FC'    },
                    { id: 'BOT_CAP_008', username: 'BotCapitan8', eq: 'Los Fenómenos' },
                    { id: 'BOT_CAP_009', username: 'BotCapitan9', eq: 'Underdogs FC'  },
                ];
                for (const c of caps) {
                    db.prepare("INSERT OR IGNORE INTO teams (capitan_id,capitan_username,nombre_equipo) VALUES (?,?,?)").run(c.id, c.username, c.eq);
                    db.prepare("INSERT OR IGNORE INTO clasificacion (capitan_id,equipo_nombre) VALUES (?,?)").run(c.id, c.username);
                }
                const seedPlayers = [
                    ...['Lewandowski','Benzema','Haaland','Kane','Mbappe','Osimhen','Vlahovic','Darwin','Lukaku','Giroud','Firmino','Lautaro','Morata','Dovbyk','Immobile','Werner','Isak','Sorloth','Dembele','Gnabry']
                        .map((n,i) => [`P_DC_${String(i+1).padStart(3,'0')}`, n+' Bot', 'DC']),
                    ...['Modric','De Bruyne','Kroos','Camavinga','Bellingham','Pedri','Gavi','Valverde','Enzo','Caicedo','Veiga','Zubimendi','Tchouameni','Kovacic','Fernandes','Kimmich','Rice','Mac Allister','Gravenberch','Guler','Reijnders','Wirtz','Musiala','Nkunku','Saka','Palmer','Odegaard','Olmo','Diaz','Yamal']
                        .map((n,i) => [`P_MC_${String(i+1).padStart(3,'0')}`, n+' Bot', 'MC']),
                    ...['Cancelo','Alexander','Theo','Cucurella','Mendy','Hakimi','Trent','Grimaldo','Dest','Dodo','Pedro Porro','Frimpong','Maatsen','Ben Yedder','Araujo','Trippier','Dumfries','Castagne','Henrichs','Mazzocchi']
                        .map((n,i) => [`P_CA_${String(i+1).padStart(3,'0')}`, n+' Bot', 'CARR']),
                    ...['Van Dijk','Militao','Rudiger','Alaba','Konate','Bastoni','Gvardiol','Laporte','Skriniar','Marquinhos','Saliba','Timber','Dias','Upamecano','Bremer','Carvajal','Acerbi','Pavard','Kounde','White','Tomori','Lovren','Diallo','Danso','Le Normand','Scalvini','Quenda','Vallejo','Hummels','Boateng']
                        .map((n,i) => [`P_DF_${String(i+1).padStart(3,'0')}`, n+' Bot', 'DFC']),
                    ...['Courtois','Alisson','Ter Stegen','Ederson','Oblak','Onana','Flekken','Raya','Vlachodimos','Szczesny']
                        .map((n,i) => [`P_PO_${String(i+1).padStart(3,'0')}`, n+' Bot', 'POR']),
                ];
                for (const [pid, nombre, pos] of seedPlayers) {
                    db.prepare("INSERT OR IGNORE INTO players (discord_id,nombre,posicion,telefono,eafc_id) VALUES (?,?,?,?,?)").run(pid, nombre, pos, '600000000', pid.replace(/_/g,''));
                }
                await refrescarWeb().catch(() => {});
                await notificarDatosActualizados('🗄️ Seed 10 equipos cargado.').catch(() => {});
                await interaction.editReply({ content: '✅ Seed cargado: **10 equipos** + **110 jugadores bot**.\n\nSiguiente paso: **🟢 Abrir inscripciones** o **📋 Simular cierre inscripciones**.', components: [] });

            } else if (id === 'admp_borrar_bots') {
                const rowConfirm = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('admp_borrar_bots_confirm').setLabel('🗑️ Sí, borrar datos de prueba').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId('admp_limpiar_todo_cancel').setLabel('❌ Cancelar').setStyle(ButtonStyle.Secondary)
                );
                await interaction.editReply({
                    content: '⚠️ Esto borrará todos los **jugadores bot** (`P_DC_*`, `P_MC_*`, etc.) y los **equipos bot** (`BOT_CAP_*`) junto con sus picks y clasificación. Los jugadores y equipos reales **no se tocan**.',
                    components: [rowConfirm]
                });
                return;

            } else if (id === 'admp_borrar_bots_confirm') {
                const picksBot  = db.prepare("DELETE FROM picks  WHERE capitan LIKE 'BOT_CAP_%'").run();
                const clasBot   = db.prepare("DELETE FROM clasificacion WHERE capitan_id LIKE 'BOT_CAP_%'").run();
                const teamsBot  = db.prepare("DELETE FROM teams WHERE capitan_id LIKE 'BOT_CAP_%'").run();
                const playersBot = db.prepare("DELETE FROM players WHERE discord_id LIKE 'P_%'").run();
                // Liberar jugadores reales que estuvieran en equipos bot
                db.prepare("UPDATE players SET equipo=NULL WHERE equipo IN (SELECT capitan_username FROM teams WHERE capitan_id LIKE 'BOT_CAP_%')").run();
                await refrescarWeb().catch(() => {});
                await notificarDatosActualizados('🗑️ Datos de prueba borrados.').catch(() => {});
                await interaction.editReply({
                    content: `✅ Datos de prueba eliminados:\n• **${playersBot.changes}** jugadores bot\n• **${teamsBot.changes}** equipos bot\n• **${clasBot.changes}** entradas de clasificación\n• **${picksBot.changes}** picks`,
                    components: []
                });

            } else if (id === 'admp_test_inscripciones') {
                db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('inscripciones_estado','cerrado')").run();
                notificarInscripciones('cerrar').catch(() => {});

                const canalesTest = await crearCanalesPreDraft(guild);
                const errores = [];

                if (canalesTest.canal_votacion_precio) {
                    await lanzarVotacionPrecio(canalesTest.canal_votacion_precio).catch(e => errores.push('votacion: ' + e.message));
                } else errores.push('No se pudo crear canal votacion-precio');

                if (canalesTest.canal_pagos) {
                    await publicarInfoPagos(canalesTest.canal_pagos).catch(e => errores.push('pagos: ' + e.message));
                } else errores.push('No se pudo crear canal pagos');

                await publicarListaDraft(guild).catch(e => errores.push('lista-draft: ' + e.message));

                const resumen = errores.length
                    ? `⚠️ Completado con errores:\n${errores.map(e => `• ${e}`).join('\n')}`
                    : '✅ Inscripciones cerradas (simulado).\n• Canal `📋-lista-draft` → lista de jugadores por posición\n• Canal `🗳️-votacion-precio` → votación lanzada\n• Canal `💳-pagos` → info de pagos';
                await interaction.editReply({ content: resumen });

            } else if (id === 'admp_test_votos') {
                // Inyectar votos bot: 4 para 10€, 6 para 15€, 3 para 20€
                for (let i = 0; i < 4; i++) votosPrecios['10'].add(`BOT_VOTE_10_${i}`);
                for (let i = 0; i < 6; i++) votosPrecios['15'].add(`BOT_VOTE_15_${i}`);
                for (let i = 0; i < 3; i++) votosPrecios['20'].add(`BOT_VOTE_20_${i}`);
                if (msgVotoPrecio) {
                    try { await msgVotoPrecio.edit({ embeds: [buildEmbedVotoPrecio()] }); } catch(e) {}
                }
                await interaction.editReply({
                    content: `✅ Votos bot inyectados:\n` +
                        `• **10 €** → ${votosPrecios['10'].size} votos\n` +
                        `• **15 €** → ${votosPrecios['15'].size} votos\n` +
                        `• **20 €** → ${votosPrecios['20'].size} votos\n\n` +
                        `Usa **⏹️ Cerrar votación** para ver el resultado.`
                });

            } else if (id === 'admp_test_pagos') {
                const equiposTodos = db.prepare('SELECT * FROM teams ORDER BY id').all();
                let aprobados = 0;
                for (const eq of equiposTodos) {
                    if (!/^\d{17,19}$/.test(eq.capitan_id)) aprobados++;
                }
                await interaction.editReply({
                    content: `✅ **${aprobados}** capitán(es) bot marcados como pagados en la DB.\n` +
                        `Los capitanes reales deben pasar por el flujo normal (botón **✅ He pagado** + aprobación).`
                });

            } else if (id === 'admp_draft_autocompletar') {
                // Para testing no exigimos que el draft esté abierto — asignamos directamente en DB
                const equiposBot = db.prepare('SELECT * FROM teams ORDER BY id').all();
                const posLimites = { DC: 2, MC: 3, CARR: 2, DFC: 3, POR: 1 };
                let totalFichados = 0;
                for (const eq of equiposBot) {
                    if (/^\d{17,19}$/.test(eq.capitan_id)) continue; // saltar capitanes reales
                    for (const [pos, limite] of Object.entries(posLimites)) {
                        const yaFichados = db.prepare("SELECT COUNT(*) as c FROM players WHERE equipo=? AND posicion=?").get(eq.capitan_username, pos)?.c || 0;
                        const faltan = limite - yaFichados;
                        if (faltan <= 0) continue;
                        const libres = db.prepare("SELECT * FROM players WHERE equipo IS NULL AND posicion=? ORDER BY RANDOM() LIMIT ?").all(pos, faltan);
                        for (const j of libres) {
                            db.prepare("UPDATE players SET equipo=? WHERE discord_id=?").run(eq.capitan_username, j.discord_id);
                            db.prepare("INSERT INTO picks (ronda, capitan, jugador_id) VALUES (?,?,?)").run(1, eq.capitan_id, j.discord_id);
                            totalFichados++;
                        }
                    }
                }
                const libresRestantes = db.prepare("SELECT COUNT(*) as c FROM players WHERE equipo IS NULL").get()?.c || 0;
                await axios.post(`${WEB}/api/bot/cerrar-draft`).catch(() => {});
                await notificarDatosActualizados('⚡ Draft autocompletado con equipos bot.').catch(() => {});
                await interaction.editReply({
                    content: `✅ **${totalFichados}** jugadores asignados a equipos bot. Draft cerrado.\n` +
                        `> Jugadores sin equipo: ${libresRestantes}\n\n` +
                        `Siguiente paso: **⚙️ Generar torneo**.`
                });

            } else if (id === 'admp_torneo_simjornada') {
                const torneoGenCheck = db.prepare("SELECT value FROM settings WHERE key='torneo_generado'").get()?.value;
                if (!torneoGenCheck) return interaction.editReply({ content: '❌ No hay torneo generado. Usa **⚙️ Generar torneo** primero.' });
                const jornadaCheck = parseInt(db.prepare("SELECT value FROM settings WHERE key='jornada_actual'").get()?.value || '1');
                const pendientesCheck = db.prepare("SELECT * FROM matches WHERE jornada=? AND estado='pendiente'").all(jornadaCheck);
                if (!pendientesCheck.length) return interaction.editReply({ content: `⚠️ No hay partidos pendientes en la jornada ${jornadaCheck}. El torneo puede haber terminado.` });
                let simulados = 0;
                for (const m of pendientesCheck) {
                    const g1 = Math.floor(Math.random() * 5);
                    const g2 = Math.floor(Math.random() * 5);
                    await axios.post('http://localhost:3000/api/resultado-confirmado', { match_id: m.id, goles1: g1, goles2: g2 }).catch(() => {});
                    simulados++;
                }
                await comprobarAvanceJornada(guild).catch(() => {});
                await interaction.editReply({
                    content: `✅ Jornada **${jornadaCheck}** simulada: **${simulados}** partidos con marcadores aleatorios.\nEl sistema avanza automáticamente a la siguiente jornada/fase.`
                });

            } else if (id === 'admp_refresh') {
                await refrescarStatusPanelAdmin(guild);
                await interaction.editReply({ content: '✅ Estado del panel actualizado.' });

            // ── Canales de Partido ─────────────────────────────────
            } else if (id === 'admp_canal_lista') {
                const todosPartidos = db.prepare("SELECT id, jornada, equipo1, equipo2, estado, canal_discord FROM matches ORDER BY jornada, id").all();
                if (!todosPartidos.length) {
                    await interaction.editReply({ content: '⚠️ No hay partidos generados todavía.' });
                } else {
                    const lines = todosPartidos.map(m => {
                        const canalInfo = m.canal_discord ? `✅ <#${m.canal_discord}>` : '❌ Sin canal';
                        return `**[${m.id}]** J${m.jornada} · ${m.equipo1} vs ${m.equipo2} · ${m.estado} · ${canalInfo}`;
                    });
                    const embed = new EmbedBuilder()
                        .setTitle('📡 Lista de Partidos y Canales')
                        .setColor(0x3399ff)
                        .setDescription(lines.join('\n').slice(0, 4000));
                    await interaction.editReply({ embeds: [embed] });
                }

            } else if (id === 'admp_canal_crear') {
                const modal = new ModalBuilder()
                    .setCustomId('modal_canal_crear')
                    .setTitle('Crear canal de partido');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('cc_match_id').setLabel('ID del partido (ej: 1)').setStyle(TextInputStyle.Short).setRequired(true)
                    )
                );
                await interaction.showModal(modal);
                return;

            } else if (id === 'admp_canal_borrar') {
                const modal = new ModalBuilder()
                    .setCustomId('modal_canal_borrar')
                    .setTitle('Borrar canal de partido');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('cb_match_id').setLabel('ID del partido (ej: 1)').setStyle(TextInputStyle.Short).setRequired(true)
                    )
                );
                await interaction.showModal(modal);
                return;

            } else if (id === 'admp_canal_add_usuario') {
                const modal = new ModalBuilder()
                    .setCustomId('modal_canal_add_usuario')
                    .setTitle('Añadir usuario a canal de partido');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('cau_match_id').setLabel('ID del partido (ej: 1)').setStyle(TextInputStyle.Short).setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('cau_user_id').setLabel('Discord ID del usuario').setStyle(TextInputStyle.Short).setRequired(true)
                    )
                );
                await interaction.showModal(modal);
                return;
            }

        } catch(e) {
            console.error('Error en handler panel admin:', e.message);
            try { await interaction.editReply({ content: `❌ Error: ${e.message}` }); } catch(_) {}
        }

        // Refrescar el embed de estado tras cada acción del panel
        refrescarStatusPanelAdmin(guild).catch(() => {});
        return;
    }
});

// ══════════════════════════════════════════════════════════════
//  CANALES DE VOZ
// ══════════════════════════════════════════════════════════════
async function crearCanalesVoz(teams) {
    try {
        const guild = client.guilds.cache.first();
        if (!guild) return;
        canalesVoz = [];

        // Solo participantes del torneo + admins pueden ver los canales de voz
        const permisosVoz = [
            { id: guild.id,           deny:  [PermissionFlagsBits.ViewChannel] },
            { id: ROL_JUGADOR,        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] },
            { id: ROL_CAPITAN,        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] },
            { id: ROL_ADMIN_DISCORD,  allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.MoveMembers] },
        ];
        if (ADMIN_ID) permisosVoz.push({ id: ADMIN_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.MoveMembers] });

        const canales = await Promise.all(teams.map(team => {
            const nombre = team.nombre_equipo || team.capitan_username;
            return guild.channels.create({ name: `🎮 ${nombre}`, type: 2, parent: CATEGORIA_ID, permissionOverwrites: permisosVoz });
        }));
        canalesVoz = canales.map(c => c.id);
    } catch(e) { console.error('Error creando canales de voz:', e.message); }
}

async function borrarCanalesVoz() {
    try {
        const guild = client.guilds.cache.first();
        if (!guild) return;
        const vocales = guild.channels.cache.filter(c => c.type === 2 && c.parentId === CATEGORIA_ID);
        for (const [, ch] of vocales) await ch.delete().catch(() => {});
        canalesVoz = [];
    } catch(e) { console.error('Error borrando canales de voz:', e.message); }
}

async function renombrarCanalVoz(capitan_username, nombre_equipo) {
    try {
        const guild = client.guilds.cache.first();
        if (!guild) return;
        const canal = guild.channels.cache.find(c => c.type === 2 && c.parentId === CATEGORIA_ID && c.name.toLowerCase().includes(capitan_username.toLowerCase()));
        if (canal) await canal.setName(`🎮 ${nombre_equipo}`);
    } catch(e) { console.error('Error renombrando canal de voz:', e.message); }
}

async function generarCanalEquiposIds() {
    try {
        const guild = client.guilds.cache.first();
        if (!guild) return;
        const teams = db.prepare(`SELECT * FROM teams ORDER BY id`).all();
        if (!teams.length) return;
        let mensaje = `# 📋 EQUIPOS E IDs EA FC\n\n`;
        for (const team of teams) {
            const nombre    = team.nombre_equipo || team.capitan_username;
            const jugadores = db.prepare(`SELECT nombre, posicion, eafc_id, telefono FROM players WHERE equipo=? ORDER BY posicion`).all(team.capitan_username);
            mensaje += `## 👑 ${nombre.toUpperCase()} (Cap: ${team.capitan_username})\n`;
            if (!jugadores.length) { mensaje += `*Sin jugadores fichados aún*\n\n`; }
            else {
                for (const j of jugadores) mensaje += `• **${j.posicion}** | ${j.nombre} — \`${j.eafc_id || '⚠️ Sin ID'}\`\n`;
                mensaje += '\n';
            }
        }
        const canal   = await guild.channels.fetch(CANAL_EQUIPOS_IDS);
        const mensajes = await canal.messages.fetch({ limit: 100 });
        await canal.bulkDelete(mensajes).catch(() => {});
        await canal.send(mensaje);
        console.log('✅ Canal equipos-ids actualizado.');
    } catch(e) { console.error('Error generando canal equipos-ids:', e.message); }
}

// ══════════════════════════════════════════════════════════════
//  BIENVENIDAS
// ══════════════════════════════════════════════════════════════
client.on('guildMemberAdd', async (member) => {
    try {
        const canal = await member.guild.channels.fetch(CANAL_BIENVENIDA_ID);
        if (!canal) return;
        const embed = new EmbedBuilder()
            .setTitle('⚽ ¡BIENVENIDO A CLUTCH DRAFT!')
            .setDescription(`¡Bienvenido/a al vestuario, ${member}!\n\nRevisa los canales de información para estar al tanto de los próximos Drafts.`)
            .setColor(0x00ffcc)
            .setThumbnail(member.user.displayAvatarURL({ forceStatic: false }))
            .setImage('https://cdn.discordapp.com/attachments/1256961086792405145/1492511486302748682/BANNER-BLUELOCK-2-1536x559.png?ex=69db9923&is=69da47a3&hm=6b930ab94036b0cfacef31bd704105fdfde564c58a9826009fc252a4e997ab59&.png')
            .setFooter({ text: `Miembro número ${member.guild.memberCount}` })
            .setTimestamp();
        await canal.send({ content: `¡Bienvenido ${member}!`, embeds: [embed] });
    } catch(e) { console.error('Error en bienvenida:', e.message); }
});

// ══════════════════════════════════════════════════════════════
//  SYNC ROL CAPITÁN ↔ WEB
// ══════════════════════════════════════════════════════════════
client.on('guildMemberUpdate', async (oldMember, newMember) => {
    const teníaRol = oldMember.roles.cache.has(ROL_CAPITAN);
    const tieneRol = newMember.roles.cache.has(ROL_CAPITAN);
    if (teníaRol === tieneRol) return;

    if (!teníaRol && tieneRol) {
        // Admin dio el rol → crear equipo en web
        await axios.post('http://localhost:3000/api/bot/capitan-add', {
            discord_id: newMember.id,
            username:   newMember.user.username
        }).catch(e => console.error('[capitan-add]', e.message));
    } else {
        // Admin quitó el rol → eliminar equipo de la web
        await axios.post('http://localhost:3000/api/bot/capitan-remove', {
            discord_id: newMember.id
        }).catch(e => console.error('[capitan-remove]', e.message));
    }
});

// ══════════════════════════════════════════════════════════════
//  ALERTAS DE STREAM
// ══════════════════════════════════════════════════════════════
client.on('presenceUpdate', async (oldPresence, newPresence) => {
    if (!newPresence || !newPresence.user || newPresence.user.bot) return;
    const autorizados = [ID_DISCORD_BAROU, ID_DISCORD_Z3US];
    if (!autorizados.includes(newPresence.userId)) return;
    const activity    = newPresence.activities.find(act => act.type === 1);
    const wasStreaming = oldPresence?.activities.some(act => act.type === 1);
    if (activity && !wasStreaming) {
        try {
            const canal = await newPresence.guild.channels.fetch(CANAL_STREAMS_ID);
            if (!canal) return;
            const embed = new EmbedBuilder()
                .setTitle('🎥 ¡DIRECTO ENCENDIDO EN CLUTCH DRAFT!')
                .setDescription(`**${newPresence.user.username}** ha iniciado directo.\n\n> **${activity.details || '¡Vente al directo!'}**`)
                .setURL(activity.url)
                .setColor(0x6441a5)
                .setThumbnail(newPresence.user.displayAvatarURL({ dynamic: true }))
                .setTimestamp();
            await canal.send({ content: `¡@everyone! **${newPresence.user.username}** está en vivo: ${activity.url}`, embeds: [embed] });
        } catch(e) { console.error('Error al enviar mensaje de stream:', e.message); }
    }
});

// ══════════════════════════════════════════════════════════════
//  MINI SERVIDOR HTTP (webhook desde server.js)
// ══════════════════════════════════════════════════════════════
botApp.post('/api/actualizar-panel-inscripciones', (req, res) => {
    actualizarPanelDiscord().catch(() => {});
    res.sendStatus(200);
});
botApp.post('/api/actualizar-lista-draft', (req, res) => {
    const guild = client.guilds.cache.first();
    if (guild) publicarListaDraft(guild).catch(e => console.error('[lista-draft]', e.message));
    res.sendStatus(200);
});
botApp.post('/api/fichaje', (req, res) => {
    const { capitan, jugador, discord, posicion, telefono } = req.body;
    enviarFichaje(capitan, jugador, discord, posicion, telefono);
    res.sendStatus(200);
});
botApp.post('/api/crear-canales', (req, res) => {
    const { teams } = req.body;
    crearCanalesVoz(teams);
    res.sendStatus(200);
});
botApp.post('/api/borrar-canales', (req, res) => {
    borrarCanalesVoz();
    res.sendStatus(200);
});
botApp.post('/api/renombrar-canal', (req, res) => {
    const { capitan_username, nombre_equipo } = req.body;
    renombrarCanalVoz(capitan_username, nombre_equipo);
    res.sendStatus(200);
});
botApp.post('/api/generar-equipos-ids', (req, res) => {
    const guild = client.guilds.cache.first();
    generarCanalEquiposIds();
    if (guild) actualizarCanalEquiposPub(guild).catch(() => {});
    res.sendStatus(200);
});
botApp.post('/api/generar-torneo', async (req, res) => {
    const equipos = db.prepare('SELECT * FROM teams ORDER BY id').all();
    if (equipos.length < 2) return res.status(400).json({ error: 'Necesitas al menos 2 equipos' });
    const resultado = await generarTorneo(equipos);
    res.json(resultado);
});
botApp.post('/api/cerrar-torneo', async (req, res) => {
    try {
        const historial = await guardarHistorial();
        const guild     = client.guilds.cache.first();
        if (guild && historial) {
            await anunciarCampeon(guild, historial.campeon, historial.subcampeon, historial.tabla);
        }
        // Limpieza diferida: 1h Discord · 2h datos (igual que fin automático)
        const finTs = new Date().toISOString();
        db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('torneo_fin_ts',?)").run(finTs);
        db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('discord_limpiado','')").run();
        db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('datos_limpiados','')").run();
        if (guild) {
            try {
                const canalAnun = await guild.channels.fetch(CANAL_ANUNCIOS);
                await canalAnun.send(
                    '⏳ **El torneo ha sido cerrado por el admin.**\n' +
                    '• Los canales de Discord se borrarán automáticamente en **1 hora**.\n' +
                    '• Los datos de la web se limpiarán en **2 horas**.\n' +
                    '• Para limpiar ahora: `!limpiar todo`.'
                );
            } catch(e) { /* ignorar */ }
        }
        res.sendStatus(200);
    } catch(e) { console.error('Error cerrando torneo:', e.message); res.sendStatus(500); }
});
botApp.post('/api/limpiar-torneo', async (req, res) => {
    await limpiarTorneo();
    res.sendStatus(200);
});
botApp.post('/api/actualizar-equipos', async (req, res) => {
    try {
        const guild = client.guilds.cache.first();
        if (guild) {
            await actualizarCanalEquiposPub(guild).catch(() => {});
            await generarCanalEquiposIds().catch(() => {});
        }
        res.sendStatus(200);
    } catch(e) { res.sendStatus(500); }
});

botApp.post('/api/actualizar-resultados', async (req, res) => {
    try {
        const guild = client.guilds.cache.first();
        if (guild) {
            await actualizarCanalResultadosPub(guild).catch(() => {});
            await actualizarCanalRondasFinalesPub(guild).catch(() => {});
        }
        res.sendStatus(200);
    } catch(e) { res.sendStatus(500); }
});

botApp.post('/api/actualizar-clasificacion', async (req, res) => {
    try {
        const guild = client.guilds.cache.first();
        if (!guild) return res.sendStatus(500);
        await actualizarCanalClasificacion(guild);
        res.sendStatus(200);
    } catch(e) { res.sendStatus(500); }
});
botApp.post('/api/cerrar-inscripciones', (req, res) => {
    cerrarInscripciones();
    res.sendStatus(200);
});

// Asignar ROL_JUGADOR en Discord al añadir un jugador de última hora
botApp.post('/api/asignar-rol-jugador', async (req, res) => {
    const { discord_id } = req.body;
    if (!discord_id) return res.status(400).json({ error: 'Falta discord_id' });
    try {
        const guild  = client.guilds.cache.first();
        const member = await guild.members.fetch(discord_id);
        if (!member.roles.cache.has(ROL_JUGADOR)) {
            await member.roles.add(ROL_JUGADOR);
        }
        res.json({ ok: true });
    } catch(e) {
        console.error('[asignar-rol-jugador]', e.message);
        res.status(500).json({ error: e.message });
    }
});

// Actualizar el canal jugadores-inscritos con los datos actuales
botApp.post('/api/actualizar-jugadores-inscritos', async (req, res) => {
    try {
        const guild   = client.guilds.cache.first();
        const canalId = db.prepare("SELECT value FROM settings WHERE key='canal_jugadores_inscritos'").get()?.value;
        if (!canalId) return res.status(404).json({ error: 'Canal jugadores-inscritos no creado' });
        const canal = await guild.channels.fetch(canalId);
        await borrarMensajesCanal(canal);
        await publicarJugadoresInscritos(canal);
        res.json({ ok: true });
    } catch(e) {
        console.error('[actualizar-jugadores-inscritos]', e.message);
        res.status(500).json({ error: e.message });
    }
});

// Cerrar la votación de capitán (deshabilitar botones) cuando admin define equipos/formato
botApp.post('/api/cerrar-votacion-capitan', async (req, res) => {
    try {
        const guild   = client.guilds.cache.first();
        const canalId = db.prepare("SELECT value FROM settings WHERE key='canal_votacion_capitan'").get()?.value;
        if (!canalId) return res.json({ ok: true, skipped: true });
        const canal = await guild.channels.fetch(canalId);
        const msgs  = await canal.messages.fetch({ limit: 20 });
        const msgVot = msgs.find(m => m.author.id === client.user.id && m.embeds.length && m.embeds[0].title?.includes('CAPITÁN'));
        if (msgVot) {
            const rowDis = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('vot_capitan_gratis_si').setLabel('✅ Sí, quiero ser capitán').setStyle(ButtonStyle.Success).setDisabled(true),
                new ButtonBuilder().setCustomId('vot_capitan_gratis_no').setLabel('❌ No').setStyle(ButtonStyle.Danger).setDisabled(true),
            );
            const candidatos = db.prepare(`SELECT discord_id FROM candidatos_capitan WHERE confirmado=0`).all();
            const lista = candidatos.length
                ? candidatos.map(c => `<@${c.discord_id}>`).join('\n')
                : '*Nadie se apuntó.*';
            const nuevoEmbed = EmbedBuilder.from(msgVot.embeds[0])
                .setColor(0x555555)
                .setTitle('👑 VOTACIÓN CAPITÁN — CERRADA')
                .setDescription('La configuración del torneo ya está definida.\n\n> La votación está cerrada — ya no se aceptan nuevos candidatos.')
                .spliceFields(0, 1, { name: `🙋 Candidatos finales (${candidatos.length})`, value: lista, inline: false });
            await msgVot.edit({ embeds: [nuevoEmbed], components: [rowDis] });
        }
        res.json({ ok: true });
    } catch(e) {
        console.error('[cerrar-votacion-capitan]', e.message);
        res.status(500).json({ error: e.message });
    }
});

botApp.post('/api/forzar-candidato-capitan', (req, res) => {
    const { discord_id, nombre, eafc_id } = req.body;
    if (!discord_id || !nombre) return res.status(400).json({ error: 'Faltan datos' });
    db.prepare(`INSERT OR REPLACE INTO candidatos_capitan (discord_id, nombre, eafc_id, forzado, confirmado) VALUES (?, ?, ?, 1, 0)`)
        .run(discord_id, nombre, eafc_id || null);
    res.json({ ok: true });
});

botApp.post('/api/quitar-candidato-capitan', (req, res) => {
    const { discord_id } = req.body;
    if (!discord_id) return res.status(400).json({ error: 'Falta discord_id' });
    db.prepare(`DELETE FROM candidatos_capitan WHERE discord_id=?`).run(discord_id);
    res.json({ ok: true });
});
botApp.post('/api/cerrar-votacion-precio', async (req, res) => {
    try {
        const guild = client.guilds.cache.first();
        const canal = await guild.channels.fetch(CANAL_ANUNCIOS);
        await cerrarVotacionPrecio(canal);
        res.sendStatus(200);
    } catch(e) { console.error(e); res.sendStatus(500); }
});

// ── Recrear canales de partido que no tienen canal asignado ──
botApp.post('/api/recrear-canales-partido', async (req, res) => {
    try {
        const guild = client.guilds.cache.first();
        if (!guild) return res.status(500).json({ error: 'Guild no disponible' });
        const matches = db.prepare(`
            SELECT m.*, t1.capitan_id as cap1_id, t2.capitan_id as cap2_id
            FROM matches m
            LEFT JOIN teams t1 ON t1.capitan_username = m.equipo1
            LEFT JOIN teams t2 ON t2.capitan_username = m.equipo2
            WHERE m.estado != 'finalizado'
              AND (m.canal_discord IS NULL OR m.canal_discord = '')
        `).all();
        let creados = 0;
        for (const m of matches) {
            const canalId = await crearCanalPartido(guild, m.id, m.jornada, m.equipo1, m.equipo2, m.cap1_id, m.cap2_id);
            if (canalId) {
                db.prepare('UPDATE matches SET canal_discord=? WHERE id=?').run(canalId, m.id);
                canalesPartido[m.id] = canalId;
                creados++;
            }
        }
        res.json({ ok: true, creados });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

botApp.post('/api/comprobar-avance-jornada', async (req, res) => {
    try {
        const guild = client.guilds.cache.first();
        if (guild) await comprobarAvanceJornada(guild);
        res.sendStatus(200);
    } catch(e) { res.sendStatus(500); }
});

botApp.post('/api/forzar-siguiente-fase', async (req, res) => {
    try {
        const guild = client.guilds.cache.first();
        if (!guild) return res.status(500).json({ error: 'Guild no disponible' });
        await generarSiguienteJornada(guild);
        res.sendStatus(200);
    } catch(e) { res.status(500).json({ error: e.message }); }
});

botApp.post('/api/orden-draft-confirmado', async (req, res) => {
    res.sendStatus(200);
    try {
        const { orden } = req.body; // [{ username, nombre }]
        if (!orden?.length) return;
        const guild = client.guilds.cache.first();
        if (!guild) return;
        const canal = guild.channels.cache.get('1489289116968288506');
        if (!canal) return;
        const desc = orden.map((t, i) => `**${i + 1}.** ${t.nombre}  *(${t.username})*`).join('\n');
        const embed = new EmbedBuilder()
            .setTitle('🎡 Orden de picks del Draft')
            .setColor(0x00ffcc)
            .setDescription(desc)
            .setTimestamp()
            .setFooter({ text: 'Clutch Draft · Ruleta de orden' });
        await canal.send({ embeds: [embed] }).catch(() => {});
    } catch(e) { console.error('orden-draft-confirmado error:', e); }
});

// Comprobación de admin para el servidor web (superadmin | DB | rol Discord)
botApp.get('/api/es-admin/:userId', async (req, res) => {
    try {
        const esAdmin = await esAdminDiscord(req.params.userId);
        res.json({ esAdmin });
    } catch(e) {
        res.json({ esAdmin: false });
    }
});

// ══════════════════════════════════════════════════════════════
//  TWITCH — Notificaciones de directo
// ══════════════════════════════════════════════════════════════

const CANAL_TWITCH_NOTIF = '1489289082629783592';

let _twitchToken        = null;
let _twitchTokenExpires = 0;

async function getTwitchToken() {
    if (_twitchToken && Date.now() < _twitchTokenExpires) return _twitchToken;
    const cid = process.env.TWITCH_CLIENT_ID;
    const cs  = process.env.TWITCH_CLIENT_SECRET;
    if (!cid || !cs) return null;
    try {
        const r = await axios.post('https://id.twitch.tv/oauth2/token', null, {
            params: { client_id: cid, client_secret: cs, grant_type: 'client_credentials' }
        });
        _twitchToken        = r.data.access_token;
        _twitchTokenExpires = Date.now() + (r.data.expires_in - 300) * 1000;
        return _twitchToken;
    } catch(e) {
        console.error('[Twitch] Error obteniendo token:', e.message);
        return null;
    }
}

async function comprobarTwitchStreams() {
    const streamers = db.prepare('SELECT twitch_login, is_live FROM twitch_tracked').all();
    if (!streamers.length) return;
    const token = await getTwitchToken();
    if (!token) return;

    const cid    = process.env.TWITCH_CLIENT_ID;
    const params = streamers.map(s => `user_login=${encodeURIComponent(s.twitch_login)}`).join('&');
    try {
        const r = await axios.get(`https://api.twitch.tv/helix/streams?${params}`, {
            headers: { 'Client-ID': cid, 'Authorization': `Bearer ${token}` }
        });
        const liveNow = new Map(r.data.data.map(s => [s.user_login.toLowerCase(), s]));

        for (const streamer of streamers) {
            const login    = streamer.twitch_login.toLowerCase();
            const wasLive  = streamer.is_live === 1;
            const stream   = liveNow.get(login);

            if (stream && !wasLive) {
                db.prepare(`UPDATE twitch_tracked SET is_live=1, stream_id=?,
                    stream_title=?, stream_game=?, stream_viewers=?, stream_thumbnail=?
                    WHERE twitch_login=?`)
                    .run(stream.id, stream.title || '', stream.game_name || '',
                         stream.viewer_count || 0,
                         (stream.thumbnail_url || '').replace('{width}','440').replace('{height}','248'),
                         streamer.twitch_login);
                await enviarNotificacionTwitch(stream).catch(e => console.error('[Twitch] Notif error:', e.message));
            } else if (stream && wasLive) {
                // Actualizar datos mientras sigue en directo
                db.prepare(`UPDATE twitch_tracked SET stream_title=?, stream_game=?, stream_viewers=?, stream_thumbnail=? WHERE twitch_login=?`)
                    .run(stream.title || '', stream.game_name || '', stream.viewer_count || 0,
                         (stream.thumbnail_url || '').replace('{width}','440').replace('{height}','248'),
                         streamer.twitch_login);
            } else if (!stream && wasLive) {
                // Marcar offline pero conservar datos del último directo
                db.prepare(`UPDATE twitch_tracked SET is_live=0, stream_id=NULL,
                    stream_viewers=0, last_live_at=datetime('now') WHERE twitch_login=?`)
                    .run(streamer.twitch_login);
            }
        }
    } catch(e) {
        if (e.response?.status === 401) _twitchToken = null;
        console.error('[Twitch] Error comprobando streams:', e.message);
    }
}

async function enviarNotificacionTwitch(stream) {
    const canal = await client.channels.fetch(CANAL_TWITCH_NOTIF);
    const thumb = (stream.thumbnail_url || '')
        .replace('{width}', '440').replace('{height}', '248');
    const embed = new EmbedBuilder()
        .setColor(0x9146FF)
        .setAuthor({ name: 'Twitch · En directo', iconURL: 'https://static.twitchcdn.net/assets/favicon-32-e29e246c157142c1372f.png' })
        .setTitle(`🔴 ${stream.user_name} está en DIRECTO`)
        .setURL(`https://www.twitch.tv/${stream.user_login}`)
        .setDescription(`**${stream.title || 'Sin título'}**`)
        .addFields(
            { name: '🎮 Juego',         value: stream.game_name || 'Desconocido', inline: true },
            { name: '👁️ Espectadores',  value: String(stream.viewer_count),       inline: true },
            { name: '🔗 Ver directo',   value: `[twitch.tv/${stream.user_login}](https://www.twitch.tv/${stream.user_login})`, inline: false }
        )
        .setTimestamp()
        .setFooter({ text: 'Clutch Draft · Twitch Live' });
    if (thumb) embed.setImage(thumb);
    await canal.send({ content: `@here 🔴 **${stream.user_name}** acaba de empezar a streamear!`, embeds: [embed] });
}

// Comprobación cada 2 minutos
cron.schedule('*/2 * * * *', async () => {
    await comprobarTwitchStreams();
});

botApp.post('/api/dar-rol-capitan', async (req, res) => {
    try {
        const { discord_id } = req.body;
        if (!discord_id) return res.status(400).json({ error: 'discord_id requerido' });
        const guild = client.guilds.cache.first();
        const member = await guild.members.fetch(discord_id);
        if (!member.roles.cache.has(ROL_CAPITAN)) await member.roles.add(ROL_CAPITAN);
        res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

botApp.post('/api/quitar-rol-capitan', async (req, res) => {
    try {
        const { discord_id } = req.body;
        if (!discord_id) return res.status(400).json({ error: 'discord_id requerido' });
        const guild = client.guilds.cache.first();
        const member = await guild.members.fetch(discord_id);
        if (member.roles.cache.has(ROL_CAPITAN)) await member.roles.remove(ROL_CAPITAN);
        res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

botApp.post('/api/dar-rol-capitanes', async (req, res) => {
    try {
        const { discord_ids } = req.body;
        if (!Array.isArray(discord_ids)) return res.status(400).json({ error: 'discord_ids debe ser array' });
        const guild = client.guilds.cache.first();
        for (const id of discord_ids) {
            try {
                const member = await guild.members.fetch(id);
                if (!member.roles.cache.has(ROL_CAPITAN))
                    await member.roles.add(ROL_CAPITAN);
            } catch(e) { console.error(`[dar-rol-capitanes] ${id}:`, e.message); }
        }
        res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

botApp.post('/api/notificar-turno-saltado', async (req, res) => {
    try {
        const { capitan } = req.body;
        if (!ADMIN_ID) return res.status(400).json({ error: 'ADMIN_ID no configurado' });
        const adminUser = await client.users.fetch(ADMIN_ID);
        await adminUser.send({
            embeds: [new EmbedBuilder()
                .setColor(0xff4444)
                .setTitle('⚠️ Turno saltado automáticamente')
                .setDescription(`El turno de **${capitan}** expiró y fue saltado por el sistema.\n\nSi fue un error, ve al panel de admin y usa **Forzar turno** para volver a **${capitan}**.`)
                .setTimestamp()
                .setFooter({ text: 'Clutch Draft · Alerta de draft' })
            ]
        });
        res.json({ ok: true });
    } catch(e) {
        console.error('[notificar-turno-saltado]', e.message);
        res.status(500).json({ error: e.message });
    }
});

botApp.listen(3001, () => { console.log('Bot webhook escuchando en puerto 3001'); });

client.login(process.env.DISCORD_TOKEN);

module.exports = client;
