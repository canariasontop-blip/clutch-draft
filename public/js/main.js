/**
 * public/js/main.js
 * Cliente de sockets — escucha eventos del servidor y actualiza el DOM.
 * NO gestiona el timer ni el turno en /draft — eso lo hace draft.ejs directamente.
 */

const socket = io();
// Exponer el socket para que draft.ejs pueda reutilizarlo sin crear una segunda conexión
window.__clutchSocket__ = socket;

// ══════════════════════════════════════════════════════
//  ESTADO LOCAL
// ══════════════════════════════════════════════════════
const State = {
    turnoActual: '',
    draftEstado: 'cerrado',
    miNombre:    window.__CLUTCH__?.username || '',
    esCapitan:   window.__CLUTCH__?.esCapitan || false,
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

// ══════════════════════════════════════════════════════
//  TOAST NOTIFICATIONS
// ══════════════════════════════════════════════════════
function toast(msg, type = 'info') {
    let container = $('#toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = `
            position: fixed; top: 80px; right: 20px; z-index: 9999;
            display: flex; flex-direction: column; gap: 8px; pointer-events: none;
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
        background: ${c.bg}; border: 1px solid ${c.border}; border-radius: 12px;
        padding: 12px 18px; color: #fff; font-size: 0.85rem; font-weight: 600;
        font-family: 'Segoe UI', sans-serif; backdrop-filter: blur(20px);
        box-shadow: 0 8px 24px rgba(0,0,0,0.4); transform: translateX(120%);
        transition: transform 0.3s cubic-bezier(0.34,1.56,0.64,1);
        max-width: 300px; pointer-events: auto;
    `;
    el.textContent = `${c.icon} ${msg}`;
    container.appendChild(el);

    requestAnimationFrame(() => requestAnimationFrame(() => {
        el.style.transform = 'translateX(0)';
    }));
    setTimeout(() => {
        el.style.transform = 'translateX(120%)';
        setTimeout(() => el.remove(), 300);
    }, 3500);
}

// ══════════════════════════════════════════════════════
//  TURN BANNER — solo para páginas que NO son /draft
//  En /draft lo gestiona draft.ejs directamente
// ══════════════════════════════════════════════════════
function updateTurnBannerExterno(turno) {
    State.turnoActual = turno;
    // Solo actualizar elementos del hub/otras páginas
    const turnoLive    = $('#turno-live');
    const turnoSidebar = $('#turno-sidebar');
    if (turnoLive)    turnoLive.textContent    = turno;
    if (turnoSidebar) turnoSidebar.textContent = turno;
}

// ══════════════════════════════════════════════════════
//  QUITAR JUGADOR DE LA LISTA (sin recargar)
// ══════════════════════════════════════════════════════
function removePlayerCard(playerId) {
    const card = $(`[data-id="${playerId}"]`);
    if (!card) return;
    card.style.transition = 'all 0.4s ease';
    card.style.transform  = 'scale(0.8)';
    card.style.opacity    = '0';
    setTimeout(() => {
        card.remove();
        const visible = $$('#players-grid .player-card:not([style*="display: none"])').length;
        setText('#count', visible);
    }, 400);
}

// ══════════════════════════════════════════════════════
//  EVENTOS DEL SERVIDOR
// ══════════════════════════════════════════════════════

// Estado inicial al conectar — en /draft lo maneja draft.ejs, aquí solo hub/otras
socket.on('init', (data) => {
    // Si estamos en /draft, draft.ejs tiene su propio socket y su propio handler
    // Solo actuamos aquí para otras páginas
    if (window.location.pathname !== '/draft') {
        if (data.turno) updateTurnBannerExterno(data.turno);
    }
});

// Timer tick — SOLO lo maneja draft.ejs via window.__updateTimer__
// main.js NO toca el #timer para no sobreescribir las clases del turn-pill
socket.on('timer_tick', (data) => {
    if (window.__updateTimer__ && data?.segundos !== undefined) {
        window.__updateTimer__(data.segundos);
    }
});

// Nuevo jugador inscrito desde Discord
socket.on('nuevo-jugador', (data) => {
    toast('Nuevo jugador inscrito en Discord', 'info');
    if (window.location.pathname === '/draft') {
        setTimeout(() => location.reload(), 1200);
    }
    if (data && window.location.pathname === '/hub') {
        const sJ = document.getElementById('stat-jugadores');
        const sF = document.getElementById('stat-fichados');
        const sE = document.getElementById('stat-equipos');
        const sD = document.getElementById('stat-disponibles');
        if (sJ) sJ.textContent = data.totalJugadores;
        if (sF) sF.textContent = data.totalFichados;
        if (sE) sE.textContent = data.totalEquipos;
        if (sD) sD.textContent = data.totalJugadores - data.totalFichados;
    }
});

// Fichaje realizado
socket.on('nuevo-fichaje', (data) => {
    if (!data) return;

    // Actualizar turno en hub/otras páginas
    if (data.turno) updateTurnBannerExterno(data.turno);

    // Quitar jugador de la lista visual
    if (data.jugadorId) removePlayerCard(data.jugadorId);

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
});

// Draft abierto
socket.on('draft-abierto', () => {
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
    if (data?.equipo1) toast(`${data.equipo1} ${data.goles1} - ${data.goles2} ${data.equipo2}`, 'success');
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
    if (btn) btn.classList.add('active');
    history.replaceState(null, '', '#tab-' + name);
};

// Auto-activate tab from URL hash on load
document.addEventListener('DOMContentLoaded', function() {
    const hash = window.location.hash;
    if (hash && hash.startsWith('#tab-')) {
        const name = hash.slice(5);
        const tab  = document.getElementById('tab-' + name);
        if (tab) {
            $$('.tab-content').forEach(t => t.classList.remove('active'));
            $$('.tab-btn').forEach(b  => b.classList.remove('active'));
            tab.classList.add('active');
            const btn = Array.from($$('.tab-btn')).find(b => b.getAttribute('onclick') && b.getAttribute('onclick').includes("'" + name + "'"));
            if (btn) btn.classList.add('active');
        }
    }
});

window.filtrarJugadores = function(val) {
    $$('#tabla-jugadores tbody tr').forEach(r => {
        r.style.display = r.textContent.toLowerCase().includes(val.toLowerCase()) ? '' : 'none';
    });
};
