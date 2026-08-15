/* =========================================================
   CAPICUA25 - Cliente
   Todo el estado del juego real vive en el servidor.
   Este archivo solo dibuja lo que el servidor manda y envía
   las acciones del jugador (jugar ficha, pasar, chat...).
   ========================================================= */

function $(id) { return document.getElementById(id); }
function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $(id).classList.add("active");
}
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 2200);
}

// ---------- Estado local mínimo ----------
let me = null; // usuario autenticado (o null)
let selectedTileIdx = null;
let lastState = null;
let socket = null;

// ---------- Autenticación ----------
async function loadMe() {
  const res = await fetch("/api/me");
  const data = await res.json();
  me = data.authenticated ? data.user : null;

  if (!data.googleConfigured) {
    toast("El servidor aún no tiene configuradas las credenciales de Google (ver README.md)");
  }
  renderUserBox();
}

function renderUserBox() {
  const box = $("userBox");
  const btnIn = $("btnIngresar");
  if (me) {
    box.classList.remove("hidden");
    btnIn.classList.add("hidden");
    box.innerHTML = `
      ${me.avatar ? `<img src="${me.avatar}" alt="">` : "👤"}
      <div>
        <div class="uname">${escapeHtml(me.name)}</div>
        <div class="ustats">${me.wins}V · ${me.gamesPlayed}J</div>
      </div>
      <button id="btnLogout">Salir</button>
    `;
    $("btnLogout").onclick = () => { window.location.href = "/auth/logout"; };
  } else {
    box.classList.add("hidden");
    btnIn.classList.remove("hidden");
  }
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

$("btnIngresar").onclick = () => { window.location.href = "/auth/google"; };

// mensajes tras el redirect de OAuth
const params = new URLSearchParams(window.location.search);
if (params.get("login") === "error") toast("No se pudo iniciar sesión con Google. Intenta de nuevo.");
if (params.get("login") === "not_configured") toast("Google OAuth no está configurado en el servidor todavía.");
if (params.get("login") === "ok") toast("¡Sesión iniciada!");
if (params.has("login")) window.history.replaceState({}, "", window.location.pathname);

// ---------- Navegación ----------
document.querySelectorAll(".nav-item").forEach((item) => {
  item.onclick = () => {
    document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
    item.classList.add("active");
    if (item.dataset.nav === "jugar") { $("rankingPanel").classList.add("hidden"); }
    if (item.dataset.nav === "inicio") { showScreen("screen-home"); $("rankingPanel").classList.add("hidden"); }
    if (item.dataset.nav === "ranking") { showRanking(); }
  };
});
document.querySelectorAll("[data-nav='ranking']").forEach(el => el.addEventListener("click", showRanking));

async function showRanking() {
  showScreen("screen-home");
  const res = await fetch("/api/ranking");
  const data = await res.json();
  const panel = $("rankingPanel");
  panel.classList.remove("hidden");
  $("rankingList").innerHTML = data.ranking.length
    ? data.ranking.map((u, i) => `<div class="rank-row"><span>#${i+1} ${escapeHtml(u.name)}</span><span>${u.wins}V / ${u.gamesPlayed}J</span></div>`).join("")
    : "<div class='rank-row'>Todavía no hay partidas jugadas.</div>";
}

// ---------- Cola / iniciar partida ----------
$("btnJugar").onclick = () => {
  if (!me) { toast("Inicia sesión con Google para jugar."); return; }
  ensureSocket();
  const rivals = $("selRivals").value;
  if (rivals === "bots") {
    socket.emit("queue:play_bots");
  } else {
    socket.emit("queue:join_online");
    $("queueStatus").classList.remove("hidden");
    $("queueStatus").innerHTML = "Buscando 3 rivales... (1/4)<br><button id='btnCancelQueue'>Cancelar</button>";
    $("btnCancelQueue").onclick = () => { socket.emit("queue:leave"); $("queueStatus").classList.add("hidden"); };
  }
};

// ---------- Socket.IO ----------
function ensureSocket() {
  if (socket) return;
  socket = io();

  socket.on("queue:status", ({ count, needed }) => {
    $("queueStatus").classList.remove("hidden");
    $("queueStatus").innerHTML = `Buscando rivales... (${count}/${needed})<br><button id='btnCancelQueue'>Cancelar</button>`;
    $("btnCancelQueue").onclick = () => { socket.emit("queue:leave"); $("queueStatus").classList.add("hidden"); };
  });

  socket.on("error_msg", (msg) => toast(msg));

  socket.on("game:state", (state) => {
    $("queueStatus").classList.add("hidden");
    lastState = state;
    selectedTileIdx = null;
    showScreen("screen-game");
    render(state);
  });

  socket.on("game:round_over", (info) => {
    const overlay = $("roundOverlay");
    $("roundTitle").textContent = info.gameOver
      ? (info.youWon ? "🏆 ¡Ganaste la partida!" : `🏆 ${info.winnerName} gana la partida`)
      : `${info.winnerName} gana la ronda`;
    $("roundDesc").textContent =
      (info.reason === "domino" ? 'Hizo "capicúa" y cerró el juego. ' : "Tablero bloqueado, tenía la mano más baja. ") +
      `Suma ${info.points} puntos` + (info.gameOver ? ". ¡Partida finalizada!" : " y la partida continúa.");
    $("btnCloseRoundOverlay").textContent = info.gameOver ? "Volver al inicio" : "Continuar";
    overlay.classList.remove("hidden");
    overlay._gameOver = info.gameOver;
  });

  socket.on("chat:message", ({ name, text }) => {
    const box = $("chatMessages");
    const div = document.createElement("div");
    div.className = "cm";
    div.innerHTML = `<b>${escapeHtml(name)}:</b> ${escapeHtml(text)}`;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  });

  socket.on("connect_error", () => toast("No se pudo conectar al servidor de juego."));
}

$("btnCloseRoundOverlay").onclick = () => {
  const overlay = $("roundOverlay");
  overlay.classList.add("hidden");
  if (overlay._gameOver) showScreen("screen-home");
};

$("btnMenu").onclick = () => {
  showScreen("screen-home");
};

// ---------- Render del tablero ----------
function pipsHTML(n) {
  return `<div class="pips p${n}">` + Array(n).fill('<div class="pip"></div>').join("") + "</div>";
}
function tileFaceHTML(a, b, vertical) {
  const cls = vertical ? "dt v" : "dt h";
  return `<div class="${cls}"><div class="half">${pipsHTML(a)}</div><div class="half">${pipsHTML(b)}</div></div>`;
}

function render(state) {
  $("gameId").textContent = state.roomId;
  $("modeLabel").textContent = (state.mode === "bots" ? "Vs. CPU" : "En línea") + " · Ronda " + state.round;
  $("hudModeBadge").textContent = state.mode === "bots" ? "VS CPU" : "EN VIVO";
  $("hudLevel").textContent = "Ronda " + state.round;

  // tablero
  const zone = $("boardZone");
  zone.innerHTML = "";
  state.board.forEach((t) => {
    const wrap = document.createElement("div");
    wrap.innerHTML = tileFaceHTML(t.a, t.b, t.double);
    zone.appendChild(wrap.firstChild);
  });

  // asientos: 0=tú(abajo), 1=izquierda, 2=arriba, 3=derecha
  state.seats.forEach((seat, i) => {
    const badge = $("badge-" + i);
    const nameEl = badge.querySelector(".pname");
    const avatarEl = badge.querySelector(".avatar");
    nameEl.textContent = i === 0 ? "Tú" : (seat ? seat.name : "-");
    avatarEl.innerHTML = seat && seat.avatar ? `<img src="${seat.avatar}">` : "👤";
    $("score-" + i).textContent = state.scores[i];
    badge.classList.toggle("turn", state.turn === i);

    if (i !== 0) {
      const handEl = $("hand-" + i);
      handEl.innerHTML = "";
      const count = seat ? seat.handCount : 0;
      for (let k = 0; k < count; k++) {
        const back = document.createElement("div");
        back.className = "tile-back";
        handEl.appendChild(back);
      }
    }
  });

  // tu mano
  const handEl = $("hand-0");
  handEl.innerHTML = "";
  state.yourHand.forEach((t, i) => {
    const wrap = document.createElement("div");
    wrap.innerHTML = tileFaceHTML(t[0], t[1], true);
    const dtEl = wrap.firstChild;
    if (state.validMoves.includes(i)) dtEl.classList.add("playable");
    if (selectedTileIdx === i) dtEl.classList.add("selected");
    dtEl.onclick = () => {
      if (state.turn !== state.yourIndex) { toast("Espera tu turno"); return; }
      if (!state.validMoves.includes(i)) { toast("Esa ficha no encaja en el tablero"); return; }
      selectedTileIdx = selectedTileIdx === i ? null : i;
      render(state);
    };
    handEl.appendChild(dtEl);
  });

  // turno / botones
  const yourTurn = state.turn === state.yourIndex;
  const seatName = state.seats[state.turn] ? (state.turn === state.yourIndex ? "Tú" : state.seats[state.turn].name) : "-";
  $("turnIndicator").innerHTML = `<span class="turn-dot"></span> TURNO DE ${escapeHtml(seatName)}`;
  $("btnPasar").disabled = !(yourTurn && state.validMoves.length === 0);
  $("btnJugarTile").disabled = !(yourTurn && selectedTileIdx !== null);
}

$("btnJugarTile").onclick = () => {
  if (selectedTileIdx === null) return;
  socket.emit("game:play", { tileIdx: selectedTileIdx });
  selectedTileIdx = null;
};
$("btnPasar").onclick = () => socket.emit("game:pass");

$("btnAyuda").onclick = () => toast("Encaja tus fichas en cualquiera de los dos extremos del tablero.");
$("btnPuntos").onclick = () => toast("Puntos: " + (lastState ? lastState.scores.join(" / ") : "-"));

// ---------- Chat ----------
$("btnChat").onclick = () => $("chatPanel").classList.toggle("hidden");
$("btnChatSend").onclick = sendChat;
$("chatInput").addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });
function sendChat() {
  const input = $("chatInput");
  const text = input.value.trim();
  if (!text || !socket) return;
  socket.emit("chat:message", { text });
  input.value = "";
}

// ---------- Init ----------
loadMe();
