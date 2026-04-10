/**
 * public/js/main.js
 * Cliente de sockets — escucha todos los eventos del servidor
 * y actualiza el DOM sin recargar la página.
 */

const socket = io();

// ══════════════════════════════════════════════════════
//  ESTADO LOCAL
// ══════════════════════════════════════════════════════
const State = {
    turnoActual:    '',
    draftEstado:    'cerrado',
    timerVal:       0,
    timerInterval:  null,
    miNombre:       window.__CLUTCH__?.username || '',
    esCapitan:      window.__CLUTCH__?.esCapitan || false,
};

// ══════════════════════════════════════════════════════
//  HELPERS DOM
// ══════════════════════════════════════════════════════
function $(sel)  { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function setText(sel, txt) {
    const el = $(sel);
    if (el) el.textContent = txt;
}

function setHTML(sel, html) {
    const el = $(sel);
    if (el) el.innerHTML = html;
}

// ══════════════════════════════════════════════════════
//  TIMER
// ══════════════════════════════════════════════════════
function startTimer(val) {
    clearInterval(State.timerInterval);
    State.timerVal = val;
    renderTimer();

    State.timerInterval = setInterval(() => {
        State.timerVal--;
        renderTimer();
        if (State.timerVal <= 0) clearInterval(State.timerInterval);
    }, 1000);
}

function renderTimer() {
    const el = $('#timer');
    if (!el) return;

    el.textContent = State.timerVal;
    el.className   = 'timer-display';

    if (State.timerVal <= 10)      el.classList.add('danger');
    else if (State.timerVal <= 30) el.classList.add('warning');
}

// ══════════════════════════════════════════════════════
//  TURN BANNER
// ══════════════════════════════════════════════════════
function updateTurnBanner(turno) {
    State.turnoActual = turno;

    const banner   = $('#turn-banner');
    const nombreEl = $('#turn-nombre');
    const badgeEl  = $('#turn-badge');

    if (!banner) return;

    if (nombreEl) nombreEl.textContent = turno;

    const esMio = turno === State.miNombre;
    banner.className = 'turn-banner' + (esMio ? ' mi-turno' : '');

    if (badgeEl) {
        badgeEl.textContent = esMio ? '⚡ ES TU TURNO' : '';
        badgeEl.style.display = esMio ? '' : 'none';
    }

    // Resaltar en la lista de orden
    $$('.order-item').forEach(el => {
        const nombre = el.dataset.capitan;
        el.className = 'order-item ' + (nombre === turno ? 'activo' : 'otro');
        const arrow = el.querySelector('.order-arrow');
        if (arrow) arrow.style.display = nombre === turno ? '' : 'none';
    });
}

// ══════════════════════════════════════════════════════
//  QUITAR JUGADOR DE LA LISTA (sin recargar)
// ══════════════════════════════════════════════════════
function removePlayerCard(playerId) {
    const card = $(`[data-id="${playerId}"]`);
    if (!card) return;

    // Animación de salida
    card.style.transition = 'all 0.4s ease';
    card.style.transform  = 'scale(0.8)';
    card.style.opacity    = '0';

    setTimeout(() => {
        card.remove();
        updatePlayerCount();
    }, 400);
}

function updatePlayerCount() {
    const visible = $$('#players-grid .player-card:not([style*="display: none"])').length;
    setText('#count', visible);
}

// ══════════════════════════════════════════════════════
//  AÑADIR FICHAJE AL PANEL "MI EQUIPO" (sin recargar)
// ══════════════════════════════════════════════════════
function addToMyTeam(data) {
    // Buscar el primer slot vacío de esa posición
    const slots = $$('.pos-slot');
    for (const slot of slots) {
        if (slot.dataset.pos === data.posicion && slot.classList.contains('empty')) {
            slot.classList.remove('empty');
            slot.classList.add('filled');

            const nombreEl = slot.querySelector('.slot-nombre');
            const vacioEl  = slot.querySelector('.slot-vacio');

            if (vacioEl)   vacioEl.style.display   = 'none';
            if (nombreEl) {
                nombreEl.textContent    = data.jugador;
                nombreEl.style.display  = '';
            }

            // Pequeña animación de entrada
            slot.style.transition  = 'all 0.3s';
            slot.style.background  = 'rgba(0,255,204,0.12)';
            setTimeout(() => { slot.style.background = ''; }, 1000);

            break;
        }
    }

    // Actualizar conteo de posición
    const conteoEl = $(`#conteo-${data.posicion}`);
    if (conteoEl) {
        const parts = conteoEl.textContent.split('/');
        if (parts.length === 2) {
            const nuevo = parseInt(parts[0]) + 1;
            conteoEl.textContent = `${nuevo}/${parts[1]}`;
            if (nuevo >= parseInt(parts[1])) conteoEl.classList.add('limite-full');
        }
    }
}

// ══════════════════════════════════════════════════════
//  TOAST NOTIFICATIONS
// ══════════════════════════════════════════════════════
function toast(msg, type = 'info') {
    // Crear contenedor si no existe
    let container = $('#toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = `
            position: fixed;
            top: 80px;
            right: 20px;
            z-index: 9999;
            display: flex;
            flex-direction: column;
            gap: 8px;
            pointer-events: none;
        `;
        document.body.appendChild(container);
    }

    const colors = {
        info:    { bg: '#0f0f14', border: 'rgba(0,255,204,0.4)',  icon: '⚽' },
        success: { bg: '#0a1a12', border: 'rgba(46,204,113,0.4)', icon: '✅' },
        warning: { bg: '#1a1500', border: 'rgba(255,204,0,0.4)',  icon: '⚡' },
        danger:  { bg: '#1a0a0a', border: 'rgba(255,77,77,0.4)',  icon: '❌' },
    };
    const c = colors[type] || colors.info;

    const el = document.createElement('div');
    el.style.cssText = `
        background: ${c.bg};
        border: 1px solid ${c.border};
        border-radius: 12px;
        padding: 12px 18px;
        color: #fff;
        font-size: 0.85rem;
        font-weight: 600;
        font-family: 'Segoe UI', sans-serif;
        backdrop-filter: blur(20px);
        box-shadow: 0 8px 24px rgba(0,0,0,0.4);
        transform: translateX(120%);
        transition: transform 0.3s cubic-bezier(0.34,1.56,0.64,1);
        max-width: 300px;
        pointer-events: auto;
    `;
    el.textContent = `${c.icon} ${msg}`;
    container.appendChild(el);

    // Animar entrada
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            el.style.transform = 'translateX(0)';
        });
    });

    // Animar salida y eliminar
    setTimeout(() => {
        el.style.transform = 'translateX(120%)';
        setTimeout(() => el.remove(), 300);
    }, 3500);
}

// ══════════════════════════════════════════════════════
//  EVENTOS DEL SERVIDOR
// ══════════════════════════════════════════════════════

// Estado inicial al conectar
socket.on('init', (data) => {
    if (data.timer !== undefined) startTimer(data.timer);
    if (data.turno)  updateTurnBanner(data.turno);
});

// Timer tick
socket.on('timer-update', (val) => {
    State.timerVal = val;
    renderTimer();
    // Sincronizar el intervalo local cuando sea necesario
    if (Math.abs(val - State.timerVal) > 2) startTimer(val);
});

// Nuevo jugador inscrito desde Discord
socket.on('nuevo-jugador', () => {
    toast('Nuevo jugador inscrito en Discord', 'info');
    // Recargar solo si estamos en la página de draft
    if (window.location.pathname === '/draft') {
        setTimeout(() => location.reload(), 1200);
    }
});

// Fichaje realizado
socket.on('nuevo-fichaje', (data) => {
    if (!data) return;

    // Actualizar turno
    if (data.turno) {
        updateTurnBanner(data.turno);
        startTimer(data.timer || 90);
    }

    // Quitar jugador de la lista visual
    if (data.jugadorId) removePlayerCard(data.jugadorId);

    // Si es mi equipo → añadir al panel izquierdo
    if (data.capitan === State.miNombre && data.jugadorId) {
        addToMyTeam(data);
    }

    // Toast
    if (data.capitan && data.jugador) {
        const esMio = data.capitan === State.miNombre;
        toast(
            esMio
                ? `✅ Fichaste a ${data.jugador} (${data.posicion})`
                : `${data.capitan} fichó a ${data.jugador} (${data.posicion})`,
            esMio ? 'success' : 'info'
        );
    }

    // Actualizar turno en el hub si estamos ahí
    const turnoLive = $('#turno-live');
    if (turnoLive && data.turno) turnoLive.textContent = data.turno;
});

// Draft abierto
socket.on('draft-abierto', (data) => {
    toast('🚀 ¡El draft ha comenzado!', 'success');
    setTimeout(() => location.reload(), 1500);
});

// Draft cerrado
socket.on('draft-cerrado', () => {
    toast('🔒 El draft ha sido cerrado', 'warning');
    setTimeout(() => location.reload(), 1500);
});

// Torneo generado
socket.on('torneo-generado', () => {
    toast('🏆 ¡Torneo generado! Revisa Discord.', 'success');
    if (window.location.pathname === '/clasificacion') {
        setTimeout(() => location.reload(), 1500);
    }
});

// Resultado de partido
socket.on('resultado', (data) => {
    toast(`${data.equipo1} ${data.goles1} - ${data.goles2} ${data.equipo2}`, 'success');
    if (window.location.pathname === '/clasificacion') {
        setTimeout(() => location.reload(), 1000);
    }
});

// Actividad (admin log)
socket.on('activity', (msg) => {
    const log = $('#log-box');
    if (!log) return;
    const now   = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerHTML = `<span>[${now}]</span> ${msg}`;
    log.prepend(entry);
});

// ══════════════════════════════════════════════════════
//  FUNCIÓN PICK (llamada desde draft.ejs)
// ══════════════════════════════════════════════════════
window.fichar = async function(playerId, nombre) {
    if (!confirm(`¿Fichar a ${nombre}?`)) return;

    const btn = $(`[data-id="${playerId}"] .btn-pick`);
    if (btn) { btn.textContent = '...'; btn.disabled = true; }

    try {
        const res = await fetch('/pick', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ player_id: playerId })
        });

        if (!res.ok) {
            const msg = await res.text();
            toast(msg, 'danger');
            if (btn) { btn.textContent = '⚡ FICHAR'; btn.disabled = false; }
        }
        // Si fue OK, el socket 'nuevo-fichaje' actualiza todo
    } catch(e) {
        toast('Error de conexión', 'danger');
        if (btn) { btn.textContent = '⚡ FICHAR'; btn.disabled = false; }
    }
};

// ══════════════════════════════════════════════════════
//  FILTROS DE JUGADORES (draft.ejs)
// ══════════════════════════════════════════════════════
let _filtroActivo = 'TODOS';
let _busqueda     = '';

window.filtrar = function(pos, btn) {
    _filtroActivo = pos;
    $$('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    _renderCards();
};

window.buscar = function(val) {
    _busqueda = val.toLowerCase();
    _renderCards();
};

function _renderCards() {
    let visible = 0;
    $$('.player-card').forEach(c => {
        const okPos = _filtroActivo === 'TODOS' || c.dataset.pos === _filtroActivo;
        const okBus = !_busqueda || c.dataset.nombre.includes(_busqueda);
        const show  = okPos && okBus;
        c.style.display = show ? '' : 'none';
        if (show) visible++;
    });
    setText('#count', visible);
}

// ══════════════════════════════════════════════════════
//  TABS (admin.ejs)
// ══════════════════════════════════════════════════════
window.showTab = function(name, btn) {
    $$('.tab-content').forEach(t => t.classList.remove('active'));
    $$('.tab-btn').forEach(b  => b.classList.remove('active'));
    const tab = $(`#tab-${name}`);
    if (tab) tab.classList.add('active');
    btn.classList.add('active');
};

window.filtrarJugadores = function(val) {
    $$('#tabla-jugadores tbody tr').forEach(r => {
        r.style.display = r.textContent.toLowerCase().includes(val.toLowerCase()) ? '' : 'none';
    });
};