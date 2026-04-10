/**
 * public/js/app.js
 * ─────────────────────────────────────────────────────────────────
 * Cliente de tiempo real para Clutch Draft
 * Sin location.reload(). Todo actualiza el DOM dinámicamente.
 * ─────────────────────────────────────────────────────────────────
 */

const socket = io({ transports: ['websocket', 'polling'] });

// ════════════════════════════════════════════════════════════════
//  ESTADO LOCAL (espejo del servidor)
// ════════════════════════════════════════════════════════════════
const state = {
    turno:         window.__INIT__?.turno  || '',
    draftEstado:   window.__INIT__?.estado || 'cerrado',
    timer:         window.__INIT__?.timer  || 90,
    esMiTurno:     false,
    miNombre:      window.__INIT__?.miNombre || '',
    timerInterval: null,
};

// ════════════════════════════════════════════════════════════════
//  TOAST NOTIFICATIONS
// ════════════════════════════════════════════════════════════════
function toast(msg, type = 'info', duration = 4000) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = `
            position: fixed; bottom: 24px; right: 24px;
            display: flex; flex-direction: column-reverse; gap: 10px;
            z-index: 9999; pointer-events: none;
        `;
        document.body.appendChild(container);
    }

    const colors = {
        success: { bg: 'rgba(0,255,204,0.12)',  border: 'rgba(0,255,204,0.4)',  icon: '✅' },
        error:   { bg: 'rgba(255,77,77,0.12)',   border: 'rgba(255,77,77,0.4)',   icon: '❌' },
        warning: { bg: 'rgba(255,204,0,0.12)',   border: 'rgba(255,204,0,0.4)',   icon: '⚠️' },
        info:    { bg: 'rgba(160,102,255,0.12)', border: 'rgba(160,102,255,0.4)', icon: 'ℹ️' },
        pick:    { bg: 'rgba(0,255,204,0.15)',   border: 'rgba(0,255,204,0.6)',   icon: '⚽' },
    };

    const c = colors[type] || colors.info;
    const t = document.createElement('div');
    t.style.cssText = `
        background: ${c.bg};
        border: 1px solid ${c.border};
        border-radius: 12px;
        padding: 14px 18px;
        color: #fff;
        font-size: 0.88rem;
        font-weight: 600;
        font-family: 'Segoe UI', sans-serif;
        max-width: 320px;
        pointer-events: all;
        backdrop-filter: blur(20px);
        box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        display: flex;
        align-items: center;
        gap: 10px;
        opacity: 0;
        transform: translateX(30px);
        transition: all 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
    `;
    t.innerHTML = `<span style="font-size:1.1rem">${c.icon}</span><span>${msg}</span>`;
    container.appendChild(t);

    // Animación entrada
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            t.style.opacity = '1';
            t.style.transform = 'translateX(0)';
        });
    });

    // Salida
    const remove = () => {
        t.style.opacity = '0';
        t.style.transform = 'translateX(30px)';
        setTimeout(() => t.remove(), 350);
    };
    const timer = setTimeout(remove, duration);
    t.onclick = () => { clearTimeout(timer); remove(); };
}

// ════════════════════════════════════════════════════════════════
//  ANIMACIÓN FIFA — card volando al centro de la pantalla
// ════════════════════════════════════════════════════════════════
function showFifaCard(jugador, posicion, capitan) {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.75);
        z-index: 8000;
        display: flex; align-items: center; justify-content: center;
        opacity: 0; transition: opacity 0.3s;
        backdrop-filter: blur(8px);
    `;

    const posColors = {
        DC:   '#00ffcc', MC: '#a066ff',
        CARR: '#ffcc00', DFC: '#ff4d4d', POR: '#3399ff'
    };
    const color = posColors[posicion] || '#00ffcc';

    overlay.innerHTML = `
        <div style="
            background: linear-gradient(135deg, #0f0f14 0%, #1a1a2e 100%);
            border: 2px solid ${color};
            border-radius: 24px;
            padding: 48px 56px;
            text-align: center;
            transform: scale(0.5) rotateY(90deg);
            transition: transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
            box-shadow: 0 0 60px ${color}40, 0 30px 80px rgba(0,0,0,0.8);
            min-width: 280px;
        " id="fifa-inner">
            <div style="
                font-size: 3rem;
                font-weight: 900;
                color: ${color};
                font-family: 'Courier New', monospace;
                letter-spacing: 4px;
                margin-bottom: 8px;
                text-shadow: 0 0 30px ${color};
            ">${posicion}</div>
            <div style="
                font-size: 1.6rem;
                font-weight: 900;
                color: #fff;
                margin-bottom: 12px;
                letter-spacing: 1px;
            ">${jugador}</div>
            <div style="
                font-size: 0.75rem;
                color: #555;
                text-transform: uppercase;
                letter-spacing: 3px;
            ">FICHADO POR</div>
            <div style="
                font-size: 1rem;
                font-weight: 700;
                color: ${color};
                margin-top: 4px;
            ">${capitan}</div>
            <div style="
                margin-top: 24px;
                font-size: 0.7rem;
                color: #333;
                letter-spacing: 2px;
            ">Toca para cerrar</div>
        </div>
    `;

    document.body.appendChild(overlay);

    // Animación entrada
    requestAnimationFrame(() => {
        overlay.style.opacity = '1';
        requestAnimationFrame(() => {
            const inner = document.getElementById('fifa-inner');
            if (inner) inner.style.transform = 'scale(1) rotateY(0deg)';
        });
    });

    // Cerrar al hacer clic o tras 4 segundos
    const close = () => {
        overlay.style.opacity = '0';
        setTimeout(() => overlay.remove(), 300);
    };
    overlay.onclick = close;
    setTimeout(close, 4000);
}

// ════════════════════════════════════════════════════════════════
//  TIMER
// ════════════════════════════════════════════════════════════════
function startTimer(val) {
    clearInterval(state.timerInterval);
    state.timer = val;
    renderTimer();

    state.timerInterval = setInterval(() => {
        state.timer = Math.max(0, state.timer - 1);
        renderTimer();
    }, 1000);
}

function renderTimer() {
    const el = document.getElementById('timer');
    if (!el) return;

    el.textContent = state.timer;
    el.className = 'timer-display';
    if (state.timer <= 10) el.classList.add('danger');
    else if (state.timer <= 30) el.classList.add('warning');

    // Pulso en últimos 5 segundos
    if (state.timer <= 5 && state.timer > 0) {
        el.animate([
            { transform: 'scale(1)' },
            { transform: 'scale(1.15)' },
            { transform: 'scale(1)' }
        ], { duration: 400, easing: 'ease-in-out' });
    }
}

// ════════════════════════════════════════════════════════════════
//  ACTUALIZAR TURNO EN EL DOM (sin recargar)
// ════════════════════════════════════════════════════════════════
function updateTurnoBanner(nuevoTurno) {
    state.turno   = nuevoTurno;
    state.esMiTurno = nuevoTurno === state.miNombre && state.draftEstado === 'abierto';

    // Nombre del turno
    const nombreEl = document.getElementById('turn-nombre');
    if (nombreEl) {
        nombreEl.textContent = nuevoTurno;
        nombreEl.animate([
            { opacity: 0, transform: 'translateY(-8px)' },
            { opacity: 1, transform: 'translateY(0)' }
        ], { duration: 400, easing: 'ease-out' });
    }

    // Badge "ES TU TURNO"
    const badgeEl = document.getElementById('mi-turno-badge');
    if (badgeEl) {
        badgeEl.style.display = state.esMiTurno ? 'block' : 'none';
    }

    // Clase del banner
    const banner = document.getElementById('turn-banner');
    if (banner) {
        banner.classList.toggle('mi-turno', state.esMiTurno);
    }

    // Orden snake — highlight
    document.querySelectorAll('.order-item').forEach(item => {
        const esActivo = item.dataset.capitan === nuevoTurno;
        item.classList.toggle('activo', esActivo);
        item.classList.toggle('otro', !esActivo);
        const arrow = item.querySelector('.order-arrow');
        if (arrow) arrow.style.display = esActivo ? 'inline' : 'none';
    });

    // Botones de pick — mostrar/ocultar
    document.querySelectorAll('.btn-pick').forEach(btn => {
        btn.style.display = state.esMiTurno ? 'block' : 'none';
    });
    document.querySelectorAll('.player-card').forEach(card => {
        card.classList.toggle('mi-turno-pick', state.esMiTurno);
    });
}

// ════════════════════════════════════════════════════════════════
//  ACTUALIZAR LISTA DE JUGADORES (sin recargar)
// ════════════════════════════════════════════════════════════════
function removePlayerCard(playerId) {
    const card = document.querySelector(`[data-player-id="${playerId}"]`);
    if (!card) return;

    // Animación salida tipo FIFA
    card.style.transition = 'all 0.4s cubic-bezier(0.4, 0, 1, 1)';
    card.style.transform  = 'scale(0.8) rotateZ(5deg)';
    card.style.opacity    = '0';
    card.style.filter     = 'blur(4px)';

    setTimeout(() => {
        card.remove();
        // Actualizar contador
        const countEl = document.getElementById('count');
        if (countEl) countEl.textContent = document.querySelectorAll('.player-card').length;
    }, 400);
}

function addPlayerToTeam(nombre, posicion) {
    // Buscar el slot vacío correcto en el panel del equipo
    const slots = document.querySelectorAll(`.pos-slot[data-pos="${posicion}"]`);
    for (const slot of slots) {
        if (slot.classList.contains('vacio')) {
            slot.classList.remove('vacio');
            slot.classList.add('filled');
            const nombreEl = slot.querySelector('.slot-nombre');
            if (nombreEl) {
                nombreEl.textContent = nombre;
                nombreEl.className = 'slot-nombre';
            }
            // Animación entrada en el slot
            slot.animate([
                { background: 'rgba(0,255,204,0.2)', transform: 'scale(1.03)' },
                { background: 'rgba(0,255,204,0.04)', transform: 'scale(1)' }
            ], { duration: 600, easing: 'ease-out' });
            break;
        }
    }

    // Actualizar contador de posición
    const contEl = document.getElementById(`cont-${posicion}`);
    if (contEl) {
        const parts = contEl.textContent.split('/');
        const nuevo = parseInt(parts[0]) + 1;
        const max   = parseInt(parts[1]);
        contEl.textContent = `${nuevo}/${max}`;
        if (nuevo >= max) contEl.classList.add('limite-full');
    }
}

// ════════════════════════════════════════════════════════════════
//  AÑADIR JUGADOR AL PANEL (cuando alguien se inscribe por Discord)
// ════════════════════════════════════════════════════════════════
async function fetchAndAddPlayer(playerId) {
    try {
        const res  = await fetch(`/api/jugador/${playerId}`);
        if (!res.ok) return;
        const data = await res.json();
        renderPlayerCard(data);
    } catch { /* silencioso */ }
}

function renderPlayerCard(j) {
    const grid = document.getElementById('players-grid');
    if (!grid) return;

    // Evitar duplicados
    if (document.querySelector(`[data-player-id="${j.discord_id}"]`)) return;

    const posColors = { DC:'#00ffcc', MC:'#a066ff', CARR:'#ffcc00', DFC:'#ff4d4d', POR:'#3399ff' };
    const color = posColors[j.posicion] || '#00ffcc';

    const div = document.createElement('div');
    div.className = 'player-card' + (state.esMiTurno ? ' mi-turno-pick' : '');
    div.dataset.pos      = j.posicion;
    div.dataset.nombre   = j.nombre.toLowerCase();
    div.dataset.playerId = j.discord_id;
    div.style.opacity    = '0';
    div.style.transform  = 'scale(0.8) translateY(10px)';
    div.style.transition = 'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';

    div.innerHTML = `
        <img src="${j.foto || 'https://cdn.discordapp.com/embed/avatars/0.png'}"
             class="player-foto" alt="">
        <div class="player-nombre">${j.nombre}</div>
        <span class="pos-badge-sm pos-${j.posicion} player-pos">${j.posicion}</span>
        ${j.telefono ? `<div class="player-tel"><i class="fab fa-whatsapp"></i>${j.telefono}</div>` : ''}
        ${state.esMiTurno ? `<button class="btn-pick" onclick="fichar('${j.discord_id}', '${j.nombre}')">⚡ FICHAR</button>` : ''}
    `;

    if (state.esMiTurno) {
        div.onclick = () => fichar(j.discord_id, j.nombre);
    }

    grid.appendChild(div);

    // Animación entrada
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            div.style.opacity   = '1';
            div.style.transform = 'scale(1) translateY(0)';
        });
    });

    // Actualizar contador
    const countEl = document.getElementById('count');
    if (countEl) countEl.textContent = document.querySelectorAll('.player-card').length;
}

// ════════════════════════════════════════════════════════════════
//  ACTUALIZAR ÚLTIMOS FICHAJES (hub)
// ════════════════════════════════════════════════════════════════
function addFichajeToFeed(capitan, jugador, posicion) {
    const feed = document.getElementById('fichajes-feed');
    if (!feed) return;

    const posColors = { DC:'#00ffcc', MC:'#a066ff', CARR:'#ffcc00', DFC:'#ff4d4d', POR:'#3399ff' };

    const item = document.createElement('div');
    item.className = 'fichaje-item';
    item.style.cssText = 'opacity:0; transform:translateX(-10px); transition:all 0.35s ease;';
    item.innerHTML = `
        <span class="pos-badge pos-${posicion}" style="color:${posColors[posicion]}">${posicion}</span>
        <div class="fichaje-info">
            <div class="fichaje-nombre">${jugador}</div>
            <div class="fichaje-equipo">→ ${capitan}</div>
        </div>
    `;

    // Insertar al principio
    feed.insertBefore(item, feed.firstChild);

    // Animar entrada
    requestAnimationFrame(() => requestAnimationFrame(() => {
        item.style.opacity   = '1';
        item.style.transform = 'translateX(0)';
    }));

    // Máximo 5 items
    const items = feed.querySelectorAll('.fichaje-item');
    if (items.length > 5) {
        const last = items[items.length - 1];
        last.style.opacity = '0';
        setTimeout(() => last.remove(), 300);
    }
}

// ════════════════════════════════════════════════════════════════
//  ACTUALIZAR STATS DEL HUB (sin recargar)
// ════════════════════════════════════════════════════════════════
async function refreshHubStats() {
    try {
        const res  = await fetch('/api/stats');
        if (!res.ok) return;
        const data = await res.json();

        const update = (id, val) => {
            const el = document.getElementById(id);
            if (!el || el.textContent === String(val)) return;
            el.animate([
                { transform: 'scale(1.3)', color: '#00ffcc' },
                { transform: 'scale(1)',   color: 'var(--primary)' }
            ], { duration: 400 });
            el.textContent = val;
        };

        update('stat-fichados',   data.fichados);
        update('stat-disponibles', data.disponibles);
        update('stat-jugadores',  data.jugadores);
    } catch { /* silencioso */ }
}

// ════════════════════════════════════════════════════════════════
//  SOCKET EVENTS
// ════════════════════════════════════════════════════════════════

// Estado inicial al conectar
socket.on('init', (data) => {
    state.draftEstado = data.estado;
    state.turno       = data.turno;
    if (data.estado === 'abierto') {
        startTimer(data.timer);
        updateTurnoBanner(data.turno);
    }
});

// Timer
socket.on('timer-update', (val) => {
    state.timer = val;
    renderTimer();
    if (val === 0) clearInterval(state.timerInterval);
});

// Nuevo fichaje: el momento más importante
socket.on('nuevo-fichaje', (data) => {
    if (!data) return;

    // 1. Quitar card del jugador fichado
    if (data.jugadorId) removePlayerCard(data.jugadorId);

    // 2. Añadir al panel del equipo (si es mi jugador)
    if (data.jugador && data.posicion && data.capitan === state.miNombre) {
        addPlayerToTeam(data.jugador, data.posicion);
    }

    // 3. Animación FIFA
    if (data.jugador && data.posicion && data.capitan) {
        showFifaCard(data.jugador, data.posicion, data.capitan);
        toast(`${data.capitan} ficha a <b>${data.jugador}</b>`, 'pick', 5000);
    }

    // 4. Actualizar turno
    if (data.turno) {
        updateTurnoBanner(data.turno);
        startTimer(data.timer || 90);

        if (data.turno === state.miNombre) {
            toast('⚡ ¡Es tu turno! Tienes ' + (data.timer || 90) + ' segundos.', 'success', 6000);
        }
    }

    // 5. Actualizar feed del hub
    if (data.jugador && data.posicion && data.capitan) {
        addFichajeToFeed(data.capitan, data.jugador, data.posicion);
    }

    // 6. Actualizar stats
    refreshHubStats();
});

// Nuevo jugador inscrito desde Discord
socket.on('nuevo-jugador', (data) => {
    if (data?.jugador) {
        renderPlayerCard(data.jugador);
        toast(`${data.jugador.nombre} se ha inscrito como ${data.jugador.posicion}`, 'info');
    } else {
        // Sin datos específicos, refrescar stats al menos
        refreshHubStats();
    }
});

// Draft abierto
socket.on('draft-abierto', (data) => {
    state.draftEstado = 'abierto';
    state.turno       = data?.turno || '';

    // Actualizar banner de draft cerrado → abierto
    const cerradoEl = document.getElementById('draft-cerrado-banner');
    if (cerradoEl) cerradoEl.style.display = 'none';

    const banner = document.getElementById('turn-banner');
    if (banner) {
        banner.style.display = 'flex';
        banner.animate([
            { opacity: 0, transform: 'translateY(-10px)' },
            { opacity: 1, transform: 'translateY(0)' }
        ], { duration: 500, easing: 'ease-out' });
    }

    updateTurnoBanner(data?.turno || '');
    startTimer(data?.timer || 90);

    toast('🚀 ¡El draft ha comenzado!', 'success', 6000);
});

// Draft cerrado
socket.on('draft-cerrado', () => {
    state.draftEstado = 'cerrado';
    clearInterval(state.timerInterval);

    const banner = document.getElementById('turn-banner');
    if (banner) {
        banner.style.opacity = '0.3';
        banner.style.filter  = 'grayscale(1)';
    }

    toast('🔒 El draft ha sido cerrado.', 'warning');
});

// Actividad (para el log del admin)
socket.on('activity', (msg) => {
    const log = document.getElementById('log-box');
    if (!log) return;
    const now   = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerHTML = `<span>[${now}]</span> ${msg}`;
    log.prepend(entry);
});

// Resultado de partido
socket.on('resultado', (data) => {
    toast(`⚽ ${data.equipo1} ${data.goles1} - ${data.goles2} ${data.equipo2}`, 'success', 6000);
    // Actualizar la fila del partido en clasificacion
    updateMatchRow(data);
});

function updateMatchRow(data) {
    const row = document.querySelector(`[data-match-id="${data.match_id}"]`);
    if (!row) return;
    const scoreEl = row.querySelector('.match-score');
    if (scoreEl) {
        scoreEl.textContent = `${data.goles1} - ${data.goles2}`;
        scoreEl.className   = 'match-score done';
    }
    const dotEl = row.querySelector('.estado-dot');
    if (dotEl) {
        dotEl.className = 'estado-dot finalizado';
    }
}

// ════════════════════════════════════════════════════════════════
//  FICHAR — Fetch sin redirect
// ════════════════════════════════════════════════════════════════
async function fichar(playerId, nombre) {
    if (!confirm(`¿Fichar a ${nombre}?`)) return;

    const btn = document.querySelector(`[data-player-id="${playerId}"] .btn-pick`);
    if (btn) { btn.textContent = '...'; btn.disabled = true; }

    try {
        const res = await fetch('/pick', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ player_id: playerId })
        });

        if (!res.ok) {
            const msg = await res.text();
            toast('Error: ' + msg, 'error');
            if (btn) { btn.textContent = '⚡ FICHAR'; btn.disabled = false; }
        }
        // Si fue bien, el socket 'nuevo-fichaje' hará el resto
    } catch {
        toast('Error de conexión', 'error');
        if (btn) { btn.textContent = '⚡ FICHAR'; btn.disabled = false; }
    }
}

// ════════════════════════════════════════════════════════════════
//  FILTROS DE JUGADORES
// ════════════════════════════════════════════════════════════════
let filtroActivo = 'TODOS';
let textoBusqueda = '';

function filtrar(pos, btn) {
    filtroActivo = pos;
    document.querySelectorAll('.filter-btn').forEach(b => {
        b.classList.remove('active');
    });
    btn.classList.add('active');
    aplicarFiltros();
}

function buscar(val) {
    textoBusqueda = val.toLowerCase();
    aplicarFiltros();
}

function aplicarFiltros() {
    let visible = 0;
    document.querySelectorAll('.player-card').forEach(card => {
        const okPos  = filtroActivo === 'TODOS' || card.dataset.pos === filtroActivo;
        const okText = !textoBusqueda || card.dataset.nombre?.includes(textoBusqueda);
        const show   = okPos && okText;
        card.style.display = show ? '' : 'none';
        if (show) visible++;
    });
    const countEl = document.getElementById('count');
    if (countEl) countEl.textContent = visible;
}

// ════════════════════════════════════════════════════════════════
//  INIT al cargar la página
// ════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    // Si el draft está abierto, arrancar timer local
    if (state.draftEstado === 'abierto') {
        startTimer(state.timer);
        updateTurnoBanner(state.turno);
    }

    // Notificación de bienvenida si es el turno del usuario
    if (state.esMiTurno) {
        setTimeout(() => toast('⚡ ¡Es tu turno ahora!', 'success', 5000), 1000);
    }
});