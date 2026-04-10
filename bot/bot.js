/**
 * bot/bot.js
 * Bot de Discord para Clutch Draft
 * ─────────────────────────────────────────────────────────
 * Funciones:
 *   !panel  → Panel de inscripción con botones por posición
 *   Modales → Registro de jugador (posición + teléfono)
 *   Salir   → Borrarse de la lista
 *   Sync    → Avisa a la web vía HTTP en cada cambio
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const axios = require('axios');
const cron  = require('node-cron');
const {
    Client, GatewayIntentBits,
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
    EmbedBuilder, ModalBuilder,
    TextInputBuilder, TextInputStyle
} = require('discord.js');

// DB compartida con el servidor web (mismo archivo .db)
const db = require('../database/db');
const express   = require('express');
const botApp    = express();
botApp.use(express.json());

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

const POSICIONES = ['DC', 'CARR', 'MC', 'DFC', 'POR'];
const COLORES_POS = { DC: 0x00ffcc, CARR: 0xffcc00, MC: 0xa066ff, DFC: 0xff4d4d, POR: 0x3399ff };
const LIMITES = { DC: 2, MC: 3, CARR: 2, DFC: 3, POR: 1 };
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
const CANAL_ANUNCIOS      = '1489295624733069352';
const CANAL_CALENDARIO    = '1489289235189207070';
const CANAL_CLASIFICACION = '1489289295448641748';
const CATEGORIA_PARTIDOS  = '1489289188099620966';
const ROL_JUGADOR        = '1489295627153051728';
const ROL_CAPITAN        = '1489295091498745957';
const PAYPAL_LINK        = 'https://paypal.me/Mizrraiim';
const ADMIN_ID           = process.env.ADMIN_ID;

// ── Estado Fase 2 en memoria ────────────────────────────────
// ── Estado Fase 3 en memoria ────────────────────────────────
// canalesPartido: { matchId → channelId }
const canalesPartido = {};
// reportesPendientes: { matchId → { cap1username: {g1,g2}, cap2username: {g1,g2} } }
const reportesPendientes = {};
// Votos de precio: { '10': Set<userId>, '15': Set<userId>, '20': Set<userId> }
const votosPrecios   = { '10': new Set(), '15': new Set(), '20': new Set() };
// Candidatos a capitán: Set<userId> que han pulsado "Quiero ser capitán"
const candidatosCapitan = new Set();
// IDs de mensajes de votación activos para editarlos
let msgVotoPrecio   = null;
let msgVotoCapitan  = null;
// Slots de capitán disponibles (se calcula al cerrar inscripciones)
let slotsCapitan    = 0;

// ── Avisar a la web para actualizar en tiempo real ─────────
async function refrescarWeb() {
    try {
        await axios.post(`${process.env.WEB_URL || 'http://localhost:3000'}/api/nuevo-jugador`);
    } catch {
        // La web puede no estar corriendo en desarrollo, no es crítico
    }
}

// ── Contar jugadores por posición ──────────────────────────
function contarPorPosicion() {
    const conteo = {};
    for (const pos of POSICIONES) {
        const row = db.prepare(`SELECT COUNT(*) as c FROM players WHERE posicion=? AND equipo IS NULL`).get(pos);
        conteo[pos] = row?.c || 0;
    }
    return conteo;
}

// ── Construir el embed del panel ───────────────────────────
function buildPanelEmbed() {
    const conteo = contarPorPosicion();
    const total  = db.prepare(`SELECT COUNT(*) as c FROM players`).get()?.c || 0;

    // Lista de jugadores disponibles
    const jugadores = db.prepare(
        `SELECT discord_id, nombre, posicion, telefono FROM players ORDER BY posicion, nombre`
    ).all();

    const lista = jugadores.length
        ? jugadores.map(p => {
            const tel = p.telefono ? ` | 📱 \`${p.telefono}\`` : '';
            return `**${p.posicion}** · <@${p.discord_id}>${tel}`;
        }).join('\n')
        : '*No hay jugadores inscritos aún.*';

    const embed = new EmbedBuilder()
        .setTitle('⚽ CLUTCH DRAFT — INSCRIPCIONES')
        .setDescription('Selecciona tu posición para inscribirte en el draft.\nSi ya estás inscrito, puedes salirte con el botón rojo.')
        .setColor(0x00ffcc)
        .addFields(
            {
                name: '📊 Jugadores por posición',
                value: POSICIONES.map(p =>
                    `\`${p.padEnd(4)}\` ${conteo[p]}/${LIMITES[p] * 10} jugadores`
                ).join('\n'),
                inline: true
            },
            {
                name: `👥 Total inscritos: ${total}`,
                value: lista.length > 1000 ? lista.slice(0, 997) + '...' : lista,
                inline: false
            }
        )
        .setFooter({ text: 'Clutch Draft System' })
        .setImage('https://cdn.discordapp.com/attachments/1256961086792405145/1491848145347543211/B7A31A1C-3702-4E63-A5FB-3F40AD10A185.png?ex=69d92f5b&is=69d7dddb&hm=93989c061e950505a98f845de4dd3f65b679b6143fb627285cbc48ab129d0ba6&')
        .setTimestamp();

    return embed;
}

// ── Botones del panel ──────────────────────────────────────
function buildPanelRows() {
    const colores = {
        DC:   ButtonStyle.Primary,
        CARR: ButtonStyle.Success,
        MC:   ButtonStyle.Secondary,
        DFC:  ButtonStyle.Danger,
        POR:  ButtonStyle.Primary,
    };

    const row1 = new ActionRowBuilder().addComponents(
        ...POSICIONES.map(pos =>
            new ButtonBuilder()
                .setCustomId(`join_${pos}`)
                .setLabel(pos)
                .setStyle(colores[pos] || ButtonStyle.Secondary)
        )
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('leave_draft')
            .setLabel('❌ Salirse del draft')
            .setStyle(ButtonStyle.Danger)
    );

    return [row1, row2];
}

// ══════════════════════════════════════════════════════════
//  EVENTOS
// ══════════════════════════════════════════════════════════
async function enviarFichaje(capitan, jugador, posicion, telefono) {
    try {
        const canal = await client.channels.fetch(CANAL_FICHAJES);
        const hora  = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

const idx = contadorImagenes[posicion] % IMAGENES_POS[posicion].length;
contadorImagenes[posicion]++;

const embed = new EmbedBuilder()
    .setTitle('⚡ FICHAJE CONFIRMADO')
    .setColor(COLORES_POS[posicion] || 0x00ffcc)
    .addFields(
        { name: '👑 Capitán', value: capitan, inline: true },
        { name: '⚽ Jugador', value: jugador, inline: true },
        { name: '📌 Posición', value: posicion, inline: true },
        { name: '📱 Teléfono', value: telefono || 'No disponible', inline: true },
        { name: '🕐 Hora', value: hora, inline: true }
    )
    .setImage(IMAGENES_POS[posicion][idx]) // 👈 PEGADO
    .setFooter({ text: 'Clutch Draft System' })
    .setTimestamp();

// En el embed:
        await canal.send({ embeds: [embed] });
    } catch(e) {
        console.error('Error enviando fichaje:', e.message);
    }
}
// ══════════════════════════════════════════════════════════
//  FASE 2 — CIERRE INSCRIPCIONES, PRECIO, CAPITANES, PAGOS
// ══════════════════════════════════════════════════════════

// ── Calcular equipos posibles según jugadores inscritos ────
// Cada equipo necesita: DC:2, MC:3, CARR:2, DFC:3, POR:1 = 11 jugadores
function calcularEquiposMaximos() {
    const conteo = {};
    for (const pos of POSICIONES) {
        const row = db.prepare(`SELECT COUNT(*) as c FROM players WHERE posicion=?`).get(pos);
        conteo[pos] = row?.c || 0;
    }
    // Máximo equipos que se pueden formar con los jugadores disponibles por posición
    return Math.min(
        Math.floor(conteo['DC']   / LIMITES['DC']),
        Math.floor(conteo['MC']   / LIMITES['MC']),
        Math.floor(conteo['CARR'] / LIMITES['CARR']),
        Math.floor(conteo['DFC']  / LIMITES['DFC']),
        Math.floor(conteo['POR']  / LIMITES['POR'])
    );
}

// ── Formato de torneo según nº equipos ────────────────────
function formatoTorneo(n) {
    if (n <= 0)  return '❌ No hay suficientes jugadores.';
    if (n === 4) return '🏆 Liga todos vs todos — solo ida';
    if (n <= 6)  return '⚡ Relámpago — 2 grupos + final';
    if (n <= 8)  return '🏆 Liga todos vs todos — solo ida';
    if (n <= 12) return '🥊 2 Grupos + Semifinal + Final';
    return '🎯 3-4 Grupos + Playoff completo';
}

// ── Cerrar inscripciones y lanzar votaciones ───────────────
async function cerrarInscripciones() {
    try {
        const guild = client.guilds.cache.first();
        if (!guild) return;

        const canal = await guild.channels.fetch(CANAL_ANUNCIOS);

        // 1. Marcar inscripciones como cerradas en settings
        db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('inscripciones_estado', 'cerrado')`).run();

        // Actualizar panel — deshabilitar botones
        try {
            const chId  = db.prepare(`SELECT value FROM settings WHERE key='panel_ch_id'`).get()?.value;
            const msgId = db.prepare(`SELECT value FROM settings WHERE key='panel_msg_id'`).get()?.value;
            if (chId && msgId) {
                const ch  = await client.channels.fetch(chId);
                const msg = await ch.messages.fetch(msgId);
                // Deshabilitar todos los botones
                const rowsDeshabilitadas = buildPanelRows().map(row => {
                    row.components.forEach(btn => btn.setDisabled(true));
                    return row;
                });
                await msg.edit({
                    embeds: [buildPanelEmbed()],
                    components: rowsDeshabilitadas
                });
            }
        } catch(e) { console.error('Error deshabilitando panel:', e.message); }

        // 2. Contar jugadores y calcular equipos posibles
        const totalJugadores = db.prepare(`SELECT COUNT(*) as c FROM players`).get()?.c || 0;
        const equiposMaximos = calcularEquiposMaximos();
        slotsCapitan = equiposMaximos;

        // 3. Anuncio de cierre
        const embedCierre = new EmbedBuilder()
            .setTitle('🔒 INSCRIPCIONES CERRADAS')
            .setColor(0xff4d4d)
            .setDescription(`Las inscripciones han cerrado automáticamente.`)
            .addFields(
                { name: '👥 Total inscritos', value: `${totalJugadores} jugadores`, inline: true },
                { name: '🏟️ Equipos posibles', value: `${equiposMaximos} equipos`, inline: true },
                { name: '📋 Formato', value: formatoTorneo(equiposMaximos), inline: false }
            )
            .setFooter({ text: 'Clutch Draft System' })
            .setTimestamp();

        await canal.send({ embeds: [embedCierre] });

        if (equiposMaximos < 2) {
            await canal.send('❌ No hay suficientes jugadores para formar equipos. El torneo no puede celebrarse.');
            return;
        }

        // 4. Lanzar votación de precio (20 min)
        await lanzarVotacionPrecio(canal);

        // 5. Si hay más jugadores que slots → lanzar encuesta de capitanes
        const totalCapitanes = db.prepare(`SELECT COUNT(*) as c FROM teams`).get()?.c || 0;
        if (totalCapitanes < equiposMaximos) {
            await lanzarEncuestaCapitan(canal, equiposMaximos - totalCapitanes);
        }

    } catch(e) {
        console.error('Error cerrando inscripciones:', e.message);
    }
}

// ── Votación de precio ─────────────────────────────────────
async function lanzarVotacionPrecio(canal) {
    // Resetear votos
    votosPrecios['10'].clear();
    votosPrecios['15'].clear();
    votosPrecios['20'].clear();

    const embed = buildEmbedVotoPrecio();
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('vote_precio_10').setLabel('10 €').setStyle(ButtonStyle.Secondary).setEmoji('💶'),
        new ButtonBuilder().setCustomId('vote_precio_15').setLabel('15 €').setStyle(ButtonStyle.Primary).setEmoji('💶'),
        new ButtonBuilder().setCustomId('vote_precio_20').setLabel('20 €').setStyle(ButtonStyle.Success).setEmoji('💶'),
    );

    const msg = await canal.send({
        content: `<@&${ROL_JUGADOR}> ¡Vota el precio del torneo! Tienes **20 minutos**.`,
        embeds: [embed],
        components: [row]
    });
    msgVotoPrecio = msg;

    // Cerrar votación automáticamente en 20 minutos
    setTimeout(() => cerrarVotacionPrecio(canal), 20 * 60 * 1000);
}

function buildEmbedVotoPrecio() {
    const v10 = votosPrecios['10'].size;
    const v15 = votosPrecios['15'].size;
    const v20 = votosPrecios['20'].size;
    const total = v10 + v15 + v20;

    const barra = (v) => {
        if (total === 0) return '░░░░░░░░░░ 0%';
        const pct = Math.round((v / total) * 10);
        return '█'.repeat(pct) + '░'.repeat(10 - pct) + ` ${Math.round((v / total) * 100)}%`;
    };

    return new EmbedBuilder()
        .setTitle('💰 VOTACIÓN — PRECIO DEL TORNEO')
        .setColor(0xffcc00)
        .setDescription('Solo los jugadores inscritos pueden votar. Un voto por persona.')
        .addFields(
            { name: '💶 10 €', value: `${barra(v10)} (${v10} votos)`, inline: false },
            { name: '💶 15 €', value: `${barra(v15)} (${v15} votos)`, inline: false },
            { name: '💶 20 €', value: `${barra(v20)} (${v20} votos)`, inline: false },
            { name: '📊 Total votantes', value: `${total}`, inline: true }
        )
        .setFooter({ text: 'La votación dura 20 minutos · Clutch Draft' })
        .setTimestamp();
}

async function cerrarVotacionPrecio(canal) {
    const v10 = votosPrecios['10'].size;
    const v15 = votosPrecios['15'].size;
    const v20 = votosPrecios['20'].size;

    let ganador = '10';
    if (v15 >= v10 && v15 >= v20) ganador = '15';
    if (v20 > v15 && v20 > v10)  ganador = '20';

    // Guardar precio ganador en settings
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('precio_torneo', ?)`).run(ganador);

    // Deshabilitar botones del mensaje de votación
    if (msgVotoPrecio) {
        try {
            const rowDisabled = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('vote_precio_10').setLabel('10 €').setStyle(ButtonStyle.Secondary).setEmoji('💶').setDisabled(true),
                new ButtonBuilder().setCustomId('vote_precio_15').setLabel('15 €').setStyle(ButtonStyle.Primary).setEmoji('💶').setDisabled(true),
                new ButtonBuilder().setCustomId('vote_precio_20').setLabel('20 €').setStyle(ButtonStyle.Success).setEmoji('💶').setDisabled(true),
            );
            await msgVotoPrecio.edit({ components: [rowDisabled] });
        } catch(e) { console.error('Error deshabilitando botones precio:', e.message); }
    }

    const embedResultado = new EmbedBuilder()
        .setTitle('✅ RESULTADO — PRECIO DEL TORNEO')
        .setColor(0x00ffcc)
        .addFields(
            { name: '🏆 Precio decidido', value: `**${ganador} €** por equipo`, inline: true },
            { name: '💳 PayPal', value: `[Pagar aquí](${PAYPAL_LINK})`, inline: true },
            { name: '📊 Votos', value: `10€: ${v10} | 15€: ${v15} | 20€: ${v20}`, inline: false },
            { name: '⚠️ Importante', value: `Los **capitanes** deben pagar y confirmar con el botón de abajo.\nEl admin verificará cada pago antes de asignar el rol.`, inline: false }
        )
        .setFooter({ text: 'Clutch Draft System' })
        .setTimestamp();

    await canal.send({ embeds: [embedResultado] });

    // Enviar panel de confirmación de pago para capitanes
    await lanzarPanelPago(canal, ganador);
}

// ── Panel de confirmación de pago ──────────────────────────
async function lanzarPanelPago(canal, precio) {
    const embed = new EmbedBuilder()
        .setTitle('💳 CONFIRMACIÓN DE PAGO')
        .setColor(0x3399ff)
        .setDescription(
            `Capitanes: pagad **${precio} €** vía PayPal y luego pulsad el botón.\n` +
            `El admin confirmará el pago y recibiréis el rol **Capitán**.\n\n` +
            `[👉 Pagar por PayPal](${PAYPAL_LINK})`
        )
        .setFooter({ text: 'Solo capitanes confirmados podrán participar en el draft' })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('confirmar_pago')
            .setLabel('✅ He pagado')
            .setStyle(ButtonStyle.Success)
    );

    await canal.send({ embeds: [embed], components: [row] });
}

// ── Encuesta de candidatos a capitán ──────────────────────
async function lanzarEncuestaCapitan(canal, slotsNecesarios) {
    candidatosCapitan.clear();

    const embed = new EmbedBuilder()
        .setTitle('👑 ¿QUIERES SER CAPITÁN?')
        .setColor(0xa066ff)
        .setDescription(
            `Faltan **${slotsNecesarios}** capitán(es) para completar los equipos.\n` +
            `Si quieres ser capitán, pulsa el botón. El admin decidirá quién lo es.\n\n` +
            `⚠️ Ser capitán implica **pagar la inscripción** (precio decidido por votación).`
        )
        .addFields({ name: '🙋 Candidatos', value: '*Nadie de momento...*', inline: false })
        .setFooter({ text: 'Tiempo limitado · Clutch Draft' })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('quiero_capitan')
            .setLabel('👑 Quiero ser capitán')
            .setStyle(ButtonStyle.Primary)
    );

    msgVotoCapitan = await canal.send({
        content: `<@&${ROL_JUGADOR}>`,
        embeds: [embed],
        components: [row]
    });
}

// ── Construir embed de candidatos actualizado ──────────────
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

// ── CRON — cierre automático a las 23:00 ──────────────────
cron.schedule('0 23 * * *', () => {
    console.log('⏰ Cron 23:00 — cerrando inscripciones...');
    cerrarInscripciones();
}, { timezone: 'Europe/Madrid' });


// ══════════════════════════════════════════════════════════
//  FASE 3 — TORNEO, CANALES PRIVADOS, REPORTE DE RESULTADOS
// ══════════════════════════════════════════════════════════

// ── Round-robin (algoritmo de rotación) ───────────────────
function _ligarRR(equipos) {
    const lista = [...equipos];
    if (lista.length % 2 !== 0) lista.push(null);
    const n = lista.length;
    const jornadas = [];
    for (let r = 0; r < n - 1; r++) {
        const jornada = [];
        for (let i = 0; i < n / 2; i++) {
            const eq1 = lista[i];
            const eq2 = lista[n - 1 - i];
            if (eq1 && eq2) jornada.push({ eq1, eq2 });
        }
        jornadas.push(jornada);
        lista.splice(1, 0, lista.pop());
    }
    return jornadas;
}

// ── Generar calendario según nº equipos ───────────────────
function generarCalendario(equipos) {
    const n = equipos.length;
    let jornadas = [];

    if (n === 4 || n === 8) {
        jornadas = _ligarRR(equipos);
    } else if (n <= 6) {
        const g1 = equipos.slice(0, Math.ceil(n / 2));
        const g2 = equipos.slice(Math.ceil(n / 2));
        const j1 = _ligarRR(g1).map(j => j.map(p => ({ ...p, grupo: 'A' })));
        const j2 = _ligarRR(g2).map(j => j.map(p => ({ ...p, grupo: 'B' })));
        const maxJ = Math.max(j1.length, j2.length);
        for (let i = 0; i < maxJ; i++) {
            jornadas.push([...(j1[i] || []), ...(j2[i] || [])]);
        }
        jornadas.push([{ eq1: 'Ganador Grupo A', eq2: 'Ganador Grupo B', esFinal: true }]);
    } else if (n <= 12) {
        const mid = Math.ceil(n / 2);
        const g1 = equipos.slice(0, mid);
        const g2 = equipos.slice(mid);
        const j1 = _ligarRR(g1).map(j => j.map(p => ({ ...p, grupo: 'A' })));
        const j2 = _ligarRR(g2).map(j => j.map(p => ({ ...p, grupo: 'B' })));
        const maxJ = Math.max(j1.length, j2.length);
        for (let i = 0; i < maxJ; i++) {
            jornadas.push([...(j1[i] || []), ...(j2[i] || [])]);
        }
        jornadas.push([
            { eq1: '1\u00ba Grupo A', eq2: '2\u00ba Grupo B', esSemi: true },
            { eq1: '1\u00ba Grupo B', eq2: '2\u00ba Grupo A', esSemi: true }
        ]);
        jornadas.push([{ eq1: 'Ganador SF1', eq2: 'Ganador SF2', esFinal: true }]);
    } else {
        jornadas = _ligarRR(equipos);
    }
    return jornadas;
}

// ── Crear canal de texto privado por partido ───────────────
async function crearCanalPartido(guild, matchId, jornada, eq1, eq2, cap1Id, cap2Id) {
    try {
        const nombre = ('j' + jornada + '-' + eq1.slice(0, 8) + '-vs-' + eq2.slice(0, 8))
            .toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 32);

        const permisos = [
            { id: guild.id, deny: ['ViewChannel'] },
            { id: ADMIN_ID, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] }
        ];
        if (cap1Id) permisos.push({ id: cap1Id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] });
        if (cap2Id) permisos.push({ id: cap2Id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] });

        const canal = await guild.channels.create({
            name: nombre,
            type: 0,
            parent: CATEGORIA_PARTIDOS,
            permissionOverwrites: permisos
        });

        // Embed de bienvenida con botón de reporte
        const embed = new EmbedBuilder()
            .setTitle('⚔️ J' + jornada + ' — ' + eq1 + ' vs ' + eq2)
            .setColor(0xa066ff)
            .setDescription(
                'Este es el canal privado de vuestro partido.\n' +
                'Cuando terminéis, **ambos capitanes** deben reportar el resultado con el botón de abajo.\n' +
                'Si los dos resultados coinciden se registra automáticamente.\n' +
                'Si hay discrepancia, el admin decide.'
            )
            .addFields(
                { name: '🏠 Local', value: cap1Id ? '<@' + cap1Id + '>' : eq1, inline: true },
                { name: '✈️ Visitante', value: cap2Id ? '<@' + cap2Id + '>' : eq2, inline: true },
                { name: '📅 Jornada', value: String(jornada), inline: true }
            )
            .setFooter({ text: 'Match ID: ' + matchId + ' · Clutch Draft' })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('reportar_' + matchId)
                .setLabel('📊 Reportar resultado')
                .setStyle(ButtonStyle.Primary)
        );

        const menciones = [
            cap1Id ? '<@' + cap1Id + '>' : eq1,
            cap2Id ? '<@' + cap2Id + '>' : eq2
        ].join(' ');

        await canal.send({ content: menciones, embeds: [embed], components: [row] });
        console.log('✅ Canal partido creado: ' + nombre);
        return canal.id;
    } catch(e) {
        console.error('Error creando canal partido:', e.message);
        return null;
    }
}

// ── Generar torneo completo ────────────────────────────────
async function generarTorneo(equiposRows) {
    try {
        const guild = client.guilds.cache.first();
        if (!guild) return { ok: false, error: 'Guild no disponible' };

        const nombres = equiposRows.map(e => e.capitan_username);
        const jornadas = generarCalendario(nombres);
        const jornadaBase = parseInt(
            db.prepare("SELECT value FROM settings WHERE key='jornada_actual'").get()?.value || '1'
        );

        const matchesCreados = [];

        for (let j = 0; j < jornadas.length; j++) {
            const numJornada = jornadaBase + j;
            for (const partido of jornadas[j]) {
                if (partido.esFinal || partido.esSemi) {
                    const r = db.prepare(
                        "INSERT INTO matches (jornada, equipo1, equipo2, estado) VALUES (?,?,?,'pendiente')"
                    ).run(numJornada, partido.eq1, partido.eq2);
                    matchesCreados.push({ id: r.lastInsertRowid, placeholder: true });
                } else {
                    const r = db.prepare(
                        "INSERT INTO matches (jornada, equipo1, equipo2, estado) VALUES (?,?,?,'pendiente')"
                    ).run(numJornada, partido.eq1, partido.eq2);
                    const matchId = r.lastInsertRowid;

                    const cap1 = equiposRows.find(e => e.capitan_username === partido.eq1);
                    const cap2 = equiposRows.find(e => e.capitan_username === partido.eq2);

                    const canalId = await crearCanalPartido(
                        guild, matchId, numJornada,
                        partido.eq1, partido.eq2,
                        cap1?.capitan_id, cap2?.capitan_id
                    );
                    if (canalId) {
                        db.prepare('UPDATE matches SET canal_discord=? WHERE id=?').run(canalId, matchId);
                        canalesPartido[matchId] = canalId;
                    }
                    matchesCreados.push({ id: matchId, canalId });
                }
            }
        }

        await anunciarCalendario(guild, jornadas, jornadaBase, equiposRows);
        await actualizarCanalClasificacion(guild);

        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('torneo_generado', ?)").run(
            new Date().toISOString()
        );
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('torneo_inicio', ?)").run(
            new Date().toISOString()
        );

        return { ok: true, matches: matchesCreados.length, jornadas: jornadas.length };
    } catch(e) {
        console.error('Error generando torneo:', e);
        return { ok: false, error: e.message };
    }
}

// ── Anunciar calendario en Discord ────────────────────────
async function anunciarCalendario(guild, jornadas, jornadaBase, equiposRows) {
    try {
        const canal = await guild.channels.fetch(CANAL_CALENDARIO);
        const msgs  = await canal.messages.fetch({ limit: 50 });
        await canal.bulkDelete(msgs).catch(() => {});

        let bloque = '# \uD83D\uDCC5 CALENDARIO DEL TORNEO\n\n';

        for (let j = 0; j < jornadas.length; j++) {
            const numJ = jornadaBase + j;
            bloque += '## Jornada ' + numJ + '\n';
            for (const p of jornadas[j]) {
                const prefix = p.esFinal ? '\uD83C\uDFC6 FINAL: ' : p.esSemi ? '\u2694\uFE0F Semifinal: ' : p.grupo ? ('[Grupo ' + p.grupo + '] ') : '';
                bloque += '\u2022 ' + prefix + p.eq1 + ' vs ' + p.eq2 + '\n';
            }
            bloque += '\n';
            if (bloque.length > 1700) {
                await canal.send(bloque);
                bloque = '';
            }
        }
        if (bloque.trim()) await canal.send(bloque);
    } catch(e) {
        console.error('Error anunciando calendario:', e.message);
    }
}

// ── Actualizar canal de clasificación ─────────────────────
async function actualizarCanalClasificacion(guild) {
    try {
        const canal = await guild.channels.fetch(CANAL_CLASIFICACION);
        const tabla = db.prepare(
            'SELECT * FROM clasificacion ORDER BY puntos DESC, pg DESC, gf DESC'
        ).all();
        if (!tabla.length) return;

        const msgs = await canal.messages.fetch({ limit: 10 });
        await canal.bulkDelete(msgs).catch(() => {});

        let txt = '# \uD83C\uDFC6 CLASIFICACI\u00d3N\n\n```\n';
        txt += '#   Equipo             PJ  PG  PE  PP  GF  GC  DIF PTS\n';
        txt += '\u2500'.repeat(54) + '\n';
        tabla.forEach((eq, i) => {
            const dif = eq.gf - eq.gc;
            const difStr = (dif > 0 ? '+' : '') + dif;
            txt += String(i + 1).padEnd(4) +
                   eq.equipo_nombre.slice(0, 18).padEnd(20) +
                   String(eq.pj).padEnd(4) +
                   String(eq.pg).padEnd(4) +
                   String(eq.pe).padEnd(4) +
                   String(eq.pp).padEnd(4) +
                   String(eq.gf).padEnd(4) +
                   String(eq.gc).padEnd(4) +
                   difStr.padEnd(4) +
                   eq.puntos + '\n';
        });
        txt += '```\n*Actualizado: ' + new Date().toLocaleString('es-ES') + '*';
        await canal.send(txt);
    } catch(e) {
        console.error('Error actualizando clasificaci\u00f3n Discord:', e.message);
    }
}

// ── Limpiar torneo ─────────────────────────────────────────
// ── Guardar historial del torneo ──────────────────────────
async function guardarHistorial() {
    try {
        const tabla = db.prepare(
            'SELECT * FROM clasificacion ORDER BY puntos DESC, pg DESC, gf DESC'
        ).all();
        if (!tabla.length) return;

        const campeon    = tabla[0]?.equipo_nombre || 'N/A';
        const subcampeon = tabla[1]?.equipo_nombre || 'N/A';
        const nEquipos   = tabla.length;

        // Formato según nº equipos
        let formato = 'Liga';
        if (nEquipos <= 6)       formato = '2 Grupos + Final';
        else if (nEquipos <= 12) formato = '2 Grupos + Semis + Final';

        const fechaInicio = db.prepare(
            "SELECT value FROM settings WHERE key='torneo_inicio'"
        ).get()?.value || new Date().toISOString();

        db.prepare(`
            INSERT INTO historial_torneos
                (fecha_inicio, fecha_fin, n_equipos, formato, campeon, subcampeon, clasificacion)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
            fechaInicio,
            new Date().toISOString(),
            nEquipos,
            formato,
            campeon,
            subcampeon,
            JSON.stringify(tabla)
        );

        console.log('✅ Historial del torneo guardado. Campeón:', campeon);
        return { campeon, subcampeon, tabla };
    } catch(e) {
        console.error('Error guardando historial:', e.message);
        return null;
    }
}

// ── Anunciar campeón en Discord ────────────────────────────
async function anunciarCampeon(guild, campeon, subcampeon, tabla) {
    try {
        const canal = await guild.channels.fetch(CANAL_ANUNCIOS);

        const podio = tabla.slice(0, 3).map((eq, i) => {
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉';
            return `${medal} **${eq.equipo_nombre}** — ${eq.puntos} pts (${eq.pg}V ${eq.pe}E ${eq.pp}D)`;
        }).join('\n');

        const embed = new EmbedBuilder()
            .setTitle('🏆 ¡TORNEO FINALIZADO!')
            .setColor(0xffd700)
            .setDescription(
                `El torneo ha concluido. ¡Enhorabuena a todos los participantes!

` +
                `**🥇 CAMPEÓN: ${campeon}**
` +
                `**🥈 Subcampeón: ${subcampeon}**`
            )
            .addFields(
                { name: '🏅 Podio', value: podio, inline: false },
                { name: '📊 Clasificación completa', value: 'Disponible en la web → /clasificacion', inline: false }
            )
            .setFooter({ text: 'Clutch Draft System · Historial guardado' })
            .setTimestamp();

        await canal.send({ content: `<@&${ROL_JUGADOR}> <@&${ROL_CAPITAN}>`, embeds: [embed] });
    } catch(e) {
        console.error('Error anunciando campeón:', e.message);
    }
}

// ── Comprobar si el torneo ha finalizado ───────────────────
async function comprobarFinTorneo() {
    try {
        // Solo actuar si hay torneo activo
        const torneoGenerado = db.prepare(
            "SELECT value FROM settings WHERE key='torneo_generado'"
        ).get()?.value;
        if (!torneoGenerado) return;

        // Contar partidos totales y finalizados (excluir placeholders de finales)
        const total      = db.prepare(
            "SELECT COUNT(*) as c FROM matches WHERE equipo1 NOT LIKE '%Grupo%' AND equipo1 NOT LIKE 'Ganador%'"
        ).get()?.c || 0;
        const finalizados = db.prepare(
            "SELECT COUNT(*) as c FROM matches WHERE estado='finalizado'"
        ).get()?.c || 0;

        if (total === 0 || finalizados < total) return;

        // Todos finalizados — cerrar torneo
        console.log('🏆 Todos los partidos finalizados. Cerrando torneo...');

        const historial = await guardarHistorial();
        if (!historial) return;

        const guild = client.guilds.cache.first();
        if (guild) {
            await anunciarCampeon(guild, historial.campeon, historial.subcampeon, historial.tabla);
            // Esperar 5 segundos para que el anuncio se vea antes de limpiar
            await new Promise(r => setTimeout(r, 5000));
            await limpiarTorneo();
        }

        // Avisar a la web para que recargue clasificación
        await axios.post('http://localhost:3000/api/nuevo-jugador').catch(() => {});

    } catch(e) {
        console.error('Error en comprobarFinTorneo:', e.message);
    }
}

// ── CRON — comprobar fin de torneo cada 5 minutos ─────────
cron.schedule('*/5 * * * *', () => {
    comprobarFinTorneo();
}, { timezone: 'Europe/Madrid' });

async function limpiarTorneo() {
    try {
        const guild = client.guilds.cache.first();
        if (!guild) return;

        // Borrar canales privados de partidos
        for (const [, canalId] of Object.entries(canalesPartido)) {
            try {
                const ch = guild.channels.cache.get(canalId);
                if (ch) await ch.delete();
            } catch(e) { /* ya borrado */ }
        }
        for (const k of Object.keys(canalesPartido)) delete canalesPartido[k];
        for (const k of Object.keys(reportesPendientes)) delete reportesPendientes[k];

        // Limpiar canales de calendario y clasificación
        for (const chId of [CANAL_CALENDARIO, CANAL_CLASIFICACION]) {
            try {
                const ch  = await guild.channels.fetch(chId);
                const ms  = await ch.messages.fetch({ limit: 50 });
                await ch.bulkDelete(ms).catch(() => {});
            } catch(e) {}
        }

        // Limpiar DB
        db.prepare('DELETE FROM matches').run();
        db.prepare('UPDATE clasificacion SET puntos=0,pj=0,pg=0,pe=0,pp=0,gf=0,gc=0').run();
        db.prepare("UPDATE settings SET value='1' WHERE key='jornada_actual'").run();
        db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('torneo_generado','')").run();

        console.log('✅ Torneo limpiado.');
    } catch(e) {
        console.error('Error limpiando torneo:', e.message);
    }
}

client.on('ready', () => {
    console.log(`✅ Bot conectado: ${client.user.tag}`);
    client.user.setActivity('⚽ Clutch Draft', { type: 3 }); // "Watching"
});

// Comando !panel
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.content.trim() !== '!panel') return;

    // Solo admin o canal correcto (puedes añadir más validaciones)
    const embed = buildPanelEmbed();
    const rows  = buildPanelRows();
    const msg   = await message.channel.send({ embeds: [embed], components: rows });

    // Guardar IDs del panel para actualizarlo después
    db.prepare(`UPDATE settings SET value=? WHERE key='panel_msg_id'`).run(msg.id);
    db.prepare(`UPDATE settings SET value=? WHERE key='panel_ch_id'`).run(message.channel.id);
    message.delete().catch(() => {});
});

// Interacciones (botones + modales)
client.on('interactionCreate', async (interaction) => {

    // ── SALIR DEL DRAFT ───────────────────────────────────
    if (interaction.isButton() && interaction.customId === 'leave_draft') {
    const jugador = db.prepare(`SELECT * FROM players WHERE discord_id=?`).get(interaction.user.id);

    if (!jugador) {
        return interaction.reply({ content: '❌ No estás inscrito.', ephemeral: true });
    }

    db.prepare(`DELETE FROM players WHERE discord_id=?`).run(interaction.user.id);

    // Quitar rol Jugador
    try {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        await member.roles.remove(ROL_JUGADOR);
        console.log(`✅ Rol Jugador quitado a ${interaction.user.username}`);
    } catch(e) {
        console.error('Error quitando rol:', e.message);
    }

    await refrescarWeb();

    const embed = buildPanelEmbed();
    await interaction.update({ embeds: [embed], components: buildPanelRows() });
    return;
}

    // ── VOTAR PRECIO ──────────────────────────────────────
    if (interaction.isButton() && interaction.customId.startsWith('vote_precio_')) {
        const precio = interaction.customId.split('_')[2]; // '10', '15' o '20'

        // Solo pueden votar jugadores inscritos (tienen ROL_JUGADOR)
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!member.roles.cache.has(ROL_JUGADOR)) {
            return interaction.reply({ content: '❌ Solo pueden votar los jugadores inscritos.', ephemeral: true });
        }

        // Quitar voto anterior si lo tenía
        for (const p of ['10', '15', '20']) votosPrecios[p].delete(interaction.user.id);
        // Registrar nuevo voto
        votosPrecios[precio].add(interaction.user.id);

        // Actualizar embed en tiempo real
        try {
            await msgVotoPrecio.edit({ embeds: [buildEmbedVotoPrecio()] });
        } catch(e) { /* puede fallar si ya se cerró */ }

        return interaction.reply({
            content: `✅ Voto registrado: **${precio} €**. Puedes cambiar tu voto antes de que cierre.`,
            ephemeral: true
        });
    }

    // ── QUIERO SER CAPITÁN ────────────────────────────────
    if (interaction.isButton() && interaction.customId === 'quiero_capitan') {
        const member = await interaction.guild.members.fetch(interaction.user.id);

        // Solo jugadores inscritos
        if (!member.roles.cache.has(ROL_JUGADOR)) {
            return interaction.reply({ content: '❌ Solo pueden apuntarse jugadores inscritos.', ephemeral: true });
        }
        // No puede ser ya capitán
        if (member.roles.cache.has(ROL_CAPITAN)) {
            return interaction.reply({ content: '👑 Ya eres capitán.', ephemeral: true });
        }

        if (candidatosCapitan.has(interaction.user.id)) {
            candidatosCapitan.delete(interaction.user.id);
            await actualizarEmbedCandidatos();
            return interaction.reply({ content: '↩️ Has retirado tu candidatura.', ephemeral: true });
        }

        candidatosCapitan.add(interaction.user.id);
        await actualizarEmbedCandidatos();
        return interaction.reply({
            content: `👑 ¡Candidatura registrada! El admin confirmará quién será capitán.`,
            ephemeral: true
        });
    }

    // ── CONFIRMAR PAGO ────────────────────────────────────
    if (interaction.isButton() && interaction.customId === 'confirmar_pago') {
        const member = await interaction.guild.members.fetch(interaction.user.id);

        // Debe ser jugador inscrito
        if (!member.roles.cache.has(ROL_JUGADOR)) {
            return interaction.reply({ content: '❌ Solo jugadores inscritos pueden confirmar pago.', ephemeral: true });
        }
        // Ya tiene rol capitán
        if (member.roles.cache.has(ROL_CAPITAN)) {
            return interaction.reply({ content: '✅ Ya tienes el rol Capitán confirmado.', ephemeral: true });
        }

        const precio = db.prepare(`SELECT value FROM settings WHERE key='precio_torneo'`).get()?.value || '?';

        // Avisar al admin por DM
        try {
            const admin = await client.users.fetch(ADMIN_ID);
            const embedAdmin = new EmbedBuilder()
                .setTitle('💳 CONFIRMACIÓN DE PAGO PENDIENTE')
                .setColor(0xffcc00)
                .setDescription(`**${interaction.user.username}** dice haber pagado **${precio} €**.`)
                .addFields(
                    { name: '👤 Usuario', value: `<@${interaction.user.id}> (${interaction.user.id})`, inline: false },
                    { name: '💰 Precio', value: `${precio} €`, inline: true },
                    { name: '🔗 PayPal', value: PAYPAL_LINK, inline: true },
                )
                .setThumbnail(interaction.user.displayAvatarURL())
                .setFooter({ text: 'Usa /admin o el panel web para asignar el rol Capitán' })
                .setTimestamp();

            const rowAdmin = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`aprobar_capitan_${interaction.user.id}`)
                    .setLabel('✅ Aprobar — asignar rol Capitán')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`rechazar_capitan_${interaction.user.id}`)
                    .setLabel('❌ Rechazar')
                    .setStyle(ButtonStyle.Danger)
            );

            await admin.send({ embeds: [embedAdmin], components: [rowAdmin] });
        } catch(e) {
            console.error('Error enviando DM al admin:', e.message);
        }

        return interaction.reply({
            content: `✅ Confirmación enviada al admin. En breve recibirás el rol **Capitán** si el pago es correcto.`,
            ephemeral: true
        });
    }

    // ── ADMIN: APROBAR O RECHAZAR PAGO (DM) ───────────────
    if (interaction.isButton() && interaction.customId.startsWith('aprobar_capitan_')) {
        if (interaction.user.id !== ADMIN_ID) return interaction.reply({ content: '❌ No autorizado.', ephemeral: true });

        const targetId = interaction.customId.split('_')[2];
        try {
            const guild  = client.guilds.cache.first();
            const member = await guild.members.fetch(targetId);

            // Asignar rol Capitán
            await member.roles.add(ROL_CAPITAN);

            // Registrar como capitán en la DB si no existe
            const yaCapitan = db.prepare(`SELECT * FROM teams WHERE capitan_id=?`).get(targetId);
            if (!yaCapitan) {
                db.prepare(`INSERT OR IGNORE INTO teams (capitan_id, capitan_username) VALUES (?,?)`).run(
                    targetId, member.user.username
                );
                db.prepare(`INSERT OR IGNORE INTO clasificacion (capitan_id, equipo_nombre) VALUES (?,?)`).run(
                    targetId, member.user.username
                );
            }

            // Notificar al usuario
            try {
                await member.send(`👑 ¡Tu pago ha sido confirmado! Ya tienes el rol **Capitán** en Clutch Draft. ¡Prepárate para el draft!`);
            } catch(e) { /* DMs cerrados */ }

            // Actualizar botones del DM del admin
            const rowDone = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('done')
                    .setLabel(`✅ Aprobado: ${member.user.username}`)
                    .setStyle(ButtonStyle.Success)
                    .setDisabled(true)
            );
            await interaction.update({ components: [rowDone] });

            console.log(`✅ Rol Capitán asignado a ${member.user.username}`);
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

            // Notificar al usuario
            try {
                await member.send(`❌ Tu confirmación de pago ha sido rechazada. Contacta con el admin si crees que es un error.`);
            } catch(e) { /* DMs cerrados */ }

            const rowDone = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('done')
                    .setLabel(`❌ Rechazado: ${member.user.username}`)
                    .setStyle(ButtonStyle.Danger)
                    .setDisabled(true)
            );
            await interaction.update({ components: [rowDone] });
        } catch(e) {
            console.error('Error rechazando capitán:', e.message);
        }
        return;
    }

    // ── BOTÓN DE POSICIÓN → Abrir modal ──────────────────
    if (interaction.isButton() && interaction.customId.startsWith('join_')) {
        const posicion = interaction.customId.split('_')[1];

        // Si ya está inscrito en esa posición, no abrir modal
        const yaInscrito = db.prepare(`SELECT posicion FROM players WHERE discord_id=?`).get(interaction.user.id);
        if (yaInscrito && yaInscrito.posicion === posicion) {
            return interaction.reply({
                content: `✅ Ya estás inscrito como **${posicion}**. Usa el botón rojo si quieres salirte.`,
                ephemeral: true
            });
        }

        const modal = new ModalBuilder()
    .setCustomId(`modal_${posicion}`)
    .setTitle(`Inscripción como ${posicion}`);

const phoneInput = new TextInputBuilder()
    .setCustomId('telefono')
    .setLabel('WhatsApp / Teléfono')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('+34 600 000 000')
    .setRequired(true)
    .setMinLength(6)
    .setMaxLength(20);

const eafcInput = new TextInputBuilder()
    .setCustomId('eafc_id')
    .setLabel('ID exacta de EA FC (ej: Mizrra#1234)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('TuNombre#1234')
    .setRequired(true)
    .setMinLength(3)
    .setMaxLength(30);

modal.addComponents(
    new ActionRowBuilder().addComponents(phoneInput),
    new ActionRowBuilder().addComponents(eafcInput)
);
await interaction.showModal(modal);
        return;
    }

    // ── MODAL SUBMIT → Registrar jugador ─────────────────
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_')) {
    const posicion = interaction.customId.split('_')[1];
    const telefono = interaction.fields.getTextInputValue('telefono');
    const eafc_id  = interaction.fields.getTextInputValue('eafc_id');
    const foto     = interaction.user.displayAvatarURL({ extension: 'png', size: 512 });

    db.prepare(`
        INSERT INTO players (discord_id, nombre, posicion, telefono, eafc_id, foto)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(discord_id) DO UPDATE SET
            posicion  = excluded.posicion,
            telefono  = excluded.telefono,
            eafc_id   = excluded.eafc_id,
            foto      = excluded.foto
    `).run(interaction.user.id, interaction.user.username, posicion, telefono, eafc_id, foto);

    // Asignar rol Jugador automáticamente
    try {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        await member.roles.add('1489295627153051728');
        console.log(`✅ Rol Jugador asignado a ${interaction.user.username}`);
    } catch(e) {
        console.error('Error asignando rol:', e.message);
    }

        await refrescarWeb();

        // Actualizar embed del panel
        try {
            const chId  = db.prepare(`SELECT value FROM settings WHERE key='panel_ch_id'`).get()?.value;
            const msgId = db.prepare(`SELECT value FROM settings WHERE key='panel_msg_id'`).get()?.value;
            if (chId && msgId) {
                const ch  = await client.channels.fetch(chId);
                const msg = await ch.messages.fetch(msgId);
                await msg.edit({ embeds: [buildPanelEmbed()], components: buildPanelRows() });
            }
        } catch (e) {
            console.error('No se pudo actualizar el panel:', e.message);
        }

        await interaction.reply({
            content: `✅ ¡Inscrito como **${posicion}**! Revisa la web para ver la lista completa.`,
            ephemeral: true
        });
    }

    // ══════════════════════════════════════════════════════
    //  FASE 3 — REPORTAR RESULTADO (botón → modal)
    // ══════════════════════════════════════════════════════

    // ── BOTÓN: Reportar resultado ─────────────────────────
    if (interaction.isButton() && interaction.customId.startsWith('reportar_')) {
        const matchId = interaction.customId.split('_')[1];
        const match   = db.prepare('SELECT * FROM matches WHERE id=?').get(matchId);
        if (!match) return interaction.reply({ content: '❌ Partido no encontrado.', ephemeral: true });

        // Solo los capitanes de ese partido pueden reportar
        const esCapitan1 = db.prepare("SELECT * FROM teams WHERE capitan_username=? AND capitan_id=?")
            .get(match.equipo1, interaction.user.id);
        const esCapitan2 = db.prepare("SELECT * FROM teams WHERE capitan_username=? AND capitan_id=?")
            .get(match.equipo2, interaction.user.id);

        if (!esCapitan1 && !esCapitan2) {
            return interaction.reply({ content: '❌ Solo los capitanes de este partido pueden reportar el resultado.', ephemeral: true });
        }
        if (match.estado === 'finalizado') {
            return interaction.reply({ content: '✅ Este partido ya está finalizado.', ephemeral: true });
        }

        const modal = new ModalBuilder()
            .setCustomId(`resultado_modal_${matchId}`)
            .setTitle(`Resultado: ${match.equipo1} vs ${match.equipo2}`);

        const golesLocalInput = new TextInputBuilder()
            .setCustomId('goles_local')
            .setLabel(`Goles de ${match.equipo1} (local)`)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('0')
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(2);

        const golesVisitanteInput = new TextInputBuilder()
            .setCustomId('goles_visitante')
            .setLabel(`Goles de ${match.equipo2} (visitante)`)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('0')
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(2);

        modal.addComponents(
            new ActionRowBuilder().addComponents(golesLocalInput),
            new ActionRowBuilder().addComponents(golesVisitanteInput)
        );

        await interaction.showModal(modal);
        return;
    }

    // ── MODAL SUBMIT: Procesar resultado reportado ─────────
    if (interaction.isModalSubmit() && interaction.customId.startsWith('resultado_modal_')) {
        const matchId = interaction.customId.split('_')[2];
        const match   = db.prepare('SELECT * FROM matches WHERE id=?').get(matchId);
        if (!match) return interaction.reply({ content: '❌ Partido no encontrado.', ephemeral: true });

        const g1Raw = interaction.fields.getTextInputValue('goles_local');
        const g2Raw = interaction.fields.getTextInputValue('goles_visitante');
        const g1    = parseInt(g1Raw);
        const g2    = parseInt(g2Raw);

        if (isNaN(g1) || isNaN(g2) || g1 < 0 || g2 < 0) {
            return interaction.reply({ content: '❌ Introduce números válidos (0 o mayor).', ephemeral: true });
        }

        const esCapitan1 = db.prepare("SELECT capitan_username FROM teams WHERE capitan_username=? AND capitan_id=?")
            .get(match.equipo1, interaction.user.id);

        const rolReportando = esCapitan1 ? match.equipo1 : match.equipo2;

        // Guardar reporte en memoria
        if (!reportesPendientes[matchId]) reportesPendientes[matchId] = {};
        reportesPendientes[matchId][rolReportando] = { g1, g2 };

        const reportes = reportesPendientes[matchId];
        const keysReportadas = Object.keys(reportes);

        // ¿Han reportado los dos?
        if (keysReportadas.length >= 2) {
            const r1 = reportes[match.equipo1];
            const r2 = reportes[match.equipo2];

            if (r1 && r2 && r1.g1 === r2.g1 && r1.g2 === r2.g2) {
                // ✅ Coinciden — registrar automáticamente
                try {
                    await axios.post('http://localhost:3000/api/resultado-confirmado', {
                        match_id: matchId,
                        goles1:   g1,
                        goles2:   g2
                    });
                } catch(e) { console.error('Error llamando resultado-confirmado:', e.message); }

                delete reportesPendientes[matchId];

                // Actualizar embed del canal con resultado final
                try {
                    const ch = await client.channels.fetch(match.canal_discord);
                    const embedFin = new EmbedBuilder()
                        .setTitle('✅ RESULTADO CONFIRMADO')
                        .setColor(0x00ffcc)
                        .addFields(
                            { name: '🏠 ' + match.equipo1, value: String(g1), inline: true },
                            { name: '✈️ ' + match.equipo2, value: String(g2), inline: true }
                        )
                        .setDescription('Ambos capitanes han confirmado el resultado.')
                        .setTimestamp();
                    await ch.send({ embeds: [embedFin] });
                    // Actualizar clasificación Discord
                    const guild = client.guilds.cache.first();
                    if (guild) await actualizarCanalClasificacion(guild);
                } catch(e) { /* canal puede estar borrado */ }

                return interaction.reply({
                    content: '✅ ¡Resultado confirmado y registrado automáticamente!',
                    ephemeral: true
                });

            } else {
                // ⚠️ Discrepancia — avisar al admin
                try {
                    const admin = await client.users.fetch(ADMIN_ID);
                    const embedConflicto = new EmbedBuilder()
                        .setTitle('⚠️ CONFLICTO DE RESULTADO')
                        .setColor(0xff4d4d)
                        .setDescription('Los dos capitanes han reportado resultados distintos. Necesitas arbitrar.')
                        .addFields(
                            { name: '🏠 ' + match.equipo1 + ' reporta', value: (r1 ? r1.g1 + ' - ' + r1.g2 : '⏳ pendiente'), inline: true },
                            { name: '✈️ ' + match.equipo2 + ' reporta', value: (r2 ? r2.g1 + ' - ' + r2.g2 : '⏳ pendiente'), inline: true },
                            { name: '🔗 Canal', value: match.canal_discord ? '<#' + match.canal_discord + '>' : 'N/A', inline: false }
                        )
                        .addFields(
                            { name: 'Match ID', value: String(matchId), inline: true },
                            { name: 'Partido', value: match.equipo1 + ' vs ' + match.equipo2, inline: true }
                        )
                        .setFooter({ text: 'Usa el panel admin para registrar el resultado correcto' })
                        .setTimestamp();
                    await admin.send({ embeds: [embedConflicto] });
                } catch(e) { console.error('Error enviando DM conflicto al admin:', e.message); }

                return interaction.reply({
                    content: '⚠️ Tu resultado difiere del otro capitán. El admin ha sido notificado para arbitrar.',
                    ephemeral: true
                });
            }
        } else {
            // Solo ha reportado uno — esperar al otro
            await interaction.reply({
                content: '⏳ Resultado registrado (**' + g1 + ' - ' + g2 + '**). Esperando que el otro capitán confirme.',
                ephemeral: true
            });
        }
        return;
    }

});

// Exportar función para usar desde server.js
// Mini servidor para recibir avisos del servidor web
const CATEGORIA_ID = '1489288382289805445';

// Guardar IDs de canales creados para borrarlos después
let canalesVoz = [];

// ── Crear canales de voz para cada equipo ─────────────────
async function crearCanalesVoz(teams) {
    try {
        const guild = client.guilds.cache.first();
        if (!guild) return;

        canalesVoz = []; // Limpiar lista anterior

        for (const team of teams) {
            const nombre = team.nombre_equipo || team.capitan_username;
            const canal  = await guild.channels.create({
                name:   `🎮 ${nombre}`,
                type:   2, // Voice channel
                parent: CATEGORIA_ID,
                permissionOverwrites: []
            });
            canalesVoz.push(canal.id);
            console.log(`✅ Canal de voz creado: ${nombre}`);
        }
    } catch(e) {
        console.error('Error creando canales:', e.message);
    }
}

// ── Borrar canales de voz ──────────────────────────────────
async function borrarCanalesVoz() {
    try {
        const guild = client.guilds.cache.first();
        if (!guild) return;

        for (const canalId of canalesVoz) {
            const canal = guild.channels.cache.get(canalId);
            if (canal) await canal.delete();
        }
        canalesVoz = [];
        console.log('✅ Canales de voz borrados.');
    } catch(e) {
        console.error('Error borrando canales:', e.message);
    }
}

// ── Renombrar canal de voz de un equipo ───────────────────
async function renombrarCanalVoz(capitan_username, nombre_equipo) {
    try {
        const guild = client.guilds.cache.first();
        if (!guild) return;

        // Buscar el canal que corresponde a este capitán
        const canal = guild.channels.cache.find(c =>
            c.type === 2 &&
            c.parentId === CATEGORIA_ID &&
            c.name.toLowerCase().includes(capitan_username.toLowerCase())
        );

        if (canal) {
            await canal.setName(`🎮 ${nombre_equipo}`);
            console.log(`✅ Canal renombrado a: ${nombre_equipo}`);
        }
    } catch(e) {
        console.error('Error renombrando canal:', e.message);
    }
}

// ── Mini servidor para recibir avisos del servidor web ────
botApp.post('/api/fichaje', (req, res) => {
    const { capitan, jugador, posicion, telefono } = req.body;
    enviarFichaje(capitan, jugador, posicion, telefono);
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

botApp.listen(3001, () => {
    console.log('✅ Bot API escuchando en puerto 3001');
});

botApp.post('/api/generar-equipos-ids', (req, res) => {
    generarCanalEquiposIds();
    res.sendStatus(200);
});

// Fase 3: generar torneo completo
botApp.post('/api/generar-torneo', async (req, res) => {
    const equipos = db.prepare('SELECT * FROM teams ORDER BY id').all();
    if (equipos.length < 2) return res.status(400).json({ error: 'Necesitas al menos 2 equipos' });
    const resultado = await generarTorneo(equipos);
    res.json(resultado);
});

// Fase 3: cerrar torneo manualmente (guardar historial + anunciar + limpiar)
botApp.post('/api/cerrar-torneo', async (req, res) => {
    try {
        const historial = await guardarHistorial();
        const guild = client.guilds.cache.first();
        if (guild && historial) {
            await anunciarCampeon(guild, historial.campeon, historial.subcampeon, historial.tabla);
            await new Promise(r => setTimeout(r, 3000));
        }
        await limpiarTorneo();
        res.sendStatus(200);
    } catch(e) {
        console.error('Error cerrando torneo:', e.message);
        res.sendStatus(500);
    }
});

// Fase 3: limpiar torneo (canales + DB)
botApp.post('/api/limpiar-torneo', async (req, res) => {
    await limpiarTorneo();
    res.sendStatus(200);
});

// Fase 3: actualizar clasificación en Discord manualmente
botApp.post('/api/actualizar-clasificacion', async (req, res) => {
    try {
        const guild = client.guilds.cache.first();
        if (!guild) return res.sendStatus(500);
        await actualizarCanalClasificacion(guild);
        res.sendStatus(200);
    } catch(e) { res.sendStatus(500); }
});

// Fase 2: cerrar inscripciones manualmente desde el panel admin
botApp.post('/api/cerrar-inscripciones', (req, res) => {
    cerrarInscripciones();
    res.sendStatus(200);
});

// Fase 2: forzar cierre de votación de precio desde el panel admin
botApp.post('/api/cerrar-votacion-precio', async (req, res) => {
    try {
        const guild = client.guilds.cache.first();
        const canal = await guild.channels.fetch(CANAL_ANUNCIOS);
        await cerrarVotacionPrecio(canal);
        res.sendStatus(200);
    } catch(e) {
        console.error(e);
        res.sendStatus(500);
    }
});
// ── Generar canal equipos-ids al terminar el draft ─────────
async function generarCanalEquiposIds() {
    try {
        const guild = client.guilds.cache.first();
        if (!guild) return;

        // Obtener todos los equipos con sus jugadores
        const teams = db.prepare(`SELECT * FROM teams ORDER BY id`).all();
        if (!teams.length) return;

        let mensaje = `# 📋 EQUIPOS E IDs EA FC\n\n`;

        for (const team of teams) {
            const nombre = team.nombre_equipo || team.capitan_username;
            const jugadores = db.prepare(`
                SELECT nombre, posicion, eafc_id, telefono 
                FROM players 
                WHERE equipo = ? 
                ORDER BY posicion
            `).all(team.capitan_username);

            mensaje += `## 👑 ${nombre.toUpperCase()} (Cap: ${team.capitan_username})\n`;

            if (jugadores.length === 0) {
                mensaje += `*Sin jugadores fichados aún*\n\n`;
            } else {
                for (const j of jugadores) {
                    const eafc = j.eafc_id || '⚠️ Sin ID';
                    mensaje += `• **${j.posicion}** | ${j.nombre} — \`${eafc}\`\n`;
                }
                mensaje += '\n';
            }
        }

        const canal = await guild.channels.fetch(CANAL_EQUIPOS_IDS);
        
        // Borrar mensajes anteriores del canal
        const mensajes = await canal.messages.fetch({ limit: 100 });
        await canal.bulkDelete(mensajes).catch(() => {});

        // Enviar el nuevo mensaje
        await canal.send(mensaje);
        console.log('✅ Canal equipos-ids actualizado.');

    } catch(e) {
        console.error('Error generando canal equipos-ids:', e.message);
    }
}
client.login(process.env.DISCORD_TOKEN);

module.exports = client;