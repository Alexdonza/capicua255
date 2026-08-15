require("dotenv").config();

const path = require("path");
const express = require("express");
const session = require("express-session");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const http = require("http");
const { Server } = require("socket.io");
const sharedSession = require("express-socket.io-session");

const db = require("./db");
const engine = require("./game/engine");

const PORT = process.env.PORT || 3000;
const TARGET_SCORE = 200;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ---------- Sesión (compartida entre Express y Socket.IO) ----------
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || "capicua25-cambia-este-secreto",
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 días
    secure: process.env.NODE_ENV === "production", // requiere HTTPS en producción
  },
});

app.set("trust proxy", 1); // necesario detrás de Render/Railway/Heroku para cookies "secure"
app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

io.use(sharedSession(sessionMiddleware, { autoSave: true }));

// ---------- Passport / Google OAuth ----------
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
  const user = db.findUserById(id);
  done(null, user || null);
});

const googleConfigured = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

if (googleConfigured) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.528876048489-5e9gt5jrga4rvasmn806gkl7g6s9678j.apps.googleusercontent.com ,
        clientSecret: process.env.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,
        callbackURL: process.env.https:/resultadosrdenvivo.com/auth/google/callback || "https://resultadosrdenvivo.com/auth/google/callback",
      },
      (accessToken, refreshToken, profile, done) => {
        try {
          const user = db.findOrCreateGoogleUser(profile);
          done(null, user);
        } catch (err) {
          done(err);
        }
      }
    )
  );
} else {
  console.warn(
    "⚠️  Faltan GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET en tu archivo .env.\n" +
      "   El login con Google no funcionará hasta que los configures (ver README.md)."
  );
}

app.get("/auth/google", (req, res, next) => {
  if (!googleConfigured) {
    return res.redirect("/?login=not_configured");
  }
  passport.authenticate("google", { scope: ["profile", "email"] })(req, res, next);
});

app.get(
  "/auth/google/callback",
  (req, res, next) => {
    if (!googleConfigured) return res.redirect("/?login=not_configured");
    next();
  },
  passport.authenticate("google", { failureRedirect: "/?login=error" }),
  (req, res) => res.redirect("/?login=ok")
);

app.get("/auth/logout", (req, res) => {
  req.logout(() => res.redirect("/"));
});

app.get("/api/me", (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    res.json({ authenticated: true, user: db.publicUser(req.user), googleConfigured });
  } else {
    res.json({ authenticated: false, googleConfigured });
  }
});

app.get("/api/ranking", (req, res) => {
  res.json({ ranking: db.topRanking(20) });
});

// ==================================================================
//  SALAS Y PARTIDAS EN VIVO
// ==================================================================
const queue = []; // cola de emparejamiento para "en línea": {socketId, user}
const rooms = new Map();
let roomCounter = 1;

function makeRoom(mode, seats) {
  const id = "R" + roomCounter++;
  const room = {
    id,
    mode, // 'bots' | 'online'
    seats, // 4 x {socketId, name, avatar, isBot, userId}
    scores: [0, 0, 0, 0],
    round: 1,
    state: engine.dealNewRound(),
  };
  rooms.set(id, room);
  return room;
}

function seatIndexBySocket(room, socketId) {
  return room.seats.findIndex((s) => s && s.socketId === socketId);
}

function publicStateFor(room, seatIdx) {
  return {
    roomId: room.id,
    mode: room.mode,
    round: room.round,
    targetScore: TARGET_SCORE,
    scores: room.scores,
    turn: room.state.turn,
    board: room.state.board,
    leftEnd: room.state.leftEnd,
    rightEnd: room.state.rightEnd,
    seats: room.seats.map((s, i) =>
      s
        ? { name: s.name, avatar: s.avatar, isBot: !!s.isBot, handCount: room.state.hands[i].length }
        : null
    ),
    yourIndex: seatIdx,
    yourHand: seatIdx >= 0 ? room.state.hands[seatIdx] : [],
    validMoves:
      seatIdx >= 0 ? engine.validMoves(room.state.hands[seatIdx], room.state.leftEnd, room.state.rightEnd) : [],
  };
}

function broadcastRoom(room) {
  room.seats.forEach((s, i) => {
    if (s && !s.isBot && s.socketId) {
      io.to(s.socketId).emit("game:state", publicStateFor(room, i));
    }
  });
}

function checkRoundEnd(room) {
  const emptyIdx = room.state.hands.findIndex((h) => h.length === 0);
  if (emptyIdx !== -1) {
    endRound(room, emptyIdx, "domino");
    return true;
  }
  if (room.state.passCount >= 4) {
    let winner = 0;
    let best = Infinity;
    for (let p = 0; p < 4; p++) {
      const s = engine.handSum(room.state.hands[p]);
      if (s < best) {
        best = s;
        winner = p;
      }
    }
    endRound(room, winner, "bloqueo");
    return true;
  }
  return false;
}

function endRound(room, winnerIdx, reason) {
  let pts = 0;
  for (let p = 0; p < 4; p++) if (p !== winnerIdx) pts += engine.handSum(room.state.hands[p]);
  room.scores[winnerIdx] += pts;
  const gameOver = room.scores[winnerIdx] >= TARGET_SCORE;

  room.seats.forEach((s, i) => {
    if (s && !s.isBot && s.socketId) {
      io.to(s.socketId).emit("game:round_over", {
        winnerIdx,
        winnerName: room.seats[winnerIdx].name,
        reason,
        points: pts,
        scores: room.scores,
        gameOver,
        youWon: i === winnerIdx,
      });
    }
  });

  if (gameOver) {
    room.seats.forEach((s, i) => {
      if (s && !s.isBot && s.userId) {
        db.recordGameResult(s.userId, i === winnerIdx, room.scores[i]);
      }
    });
    setTimeout(() => rooms.delete(room.id), 60000);
  } else {
    setTimeout(() => {
      if (!rooms.has(room.id)) return;
      room.round++;
      room.state = engine.dealNewRound();
      broadcastRoom(room);
      advanceBots(room);
    }, 4000);
  }
}

function nextTurn(room) {
  room.state.turn = (room.state.turn + 1) % 4;
}

// Nota: esta función NUNCA transmite el estado por sí misma cuando le toca
// a un humano — quien llama a advanceBots() es responsable de haber hecho
// broadcastRoom(room) justo antes. Esto evita transmitir el mismo estado
// dos veces (lo que podía causar que el cliente reenviara una jugada).
function advanceBots(room) {
  if (!rooms.has(room.id)) return;
  const current = room.seats[room.state.turn];
  if (!current || !current.isBot) return; // le toca a un humano, ya se transmitió
  setTimeout(() => {
    if (!rooms.has(room.id)) return;
    const idx = room.state.turn;
    const hand = room.state.hands[idx];
    const mv = engine.cpuChoose(hand, room.state.leftEnd, room.state.rightEnd);
    if (mv.pass) {
      room.state.passCount++;
    } else {
      engine.applyPlay(room.state, idx, mv.tileIdx);
    }
    if (checkRoundEnd(room)) return;
    nextTurn(room);
    broadcastRoom(room);
    advanceBots(room);
  }, 900);
}

function startRoom(room) {
  broadcastRoom(room);
  advanceBots(room);
}

function botSeat(n) {
  return { socketId: null, name: `Jugador ${n} (CPU)`, avatar: null, isBot: true, userId: null };
}

io.on("connection", (socket) => {
  const sess = socket.handshake.session;
  const passportUserId = sess && sess.passport ? sess.passport.user : null;
  const user = passportUserId ? db.findUserById(passportUserId) : null;

  socket.on("queue:play_bots", () => {
    if (!user) return socket.emit("error_msg", "Debes iniciar sesión con Google para jugar.");
    const seats = [
      { socketId: socket.id, name: user.name, avatar: user.avatar, isBot: false, userId: user.id },
      botSeat(1),
      botSeat(2),
      botSeat(3),
    ];
    const room = makeRoom("bots", seats);
    socket.join(room.id);
    socket.data.roomId = room.id;
    startRoom(room);
  });

  socket.on("queue:join_online", () => {
    if (!user) return socket.emit("error_msg", "Debes iniciar sesión con Google para jugar en línea.");
    if (queue.find((q) => q.socketId === socket.id)) return;
    queue.push({ socketId: socket.id, user });
    queue.forEach((q) => io.to(q.socketId).emit("queue:status", { inQueue: true, count: queue.length, needed: 4 }));

    if (queue.length >= 4) {
      const four = queue.splice(0, 4);
      const seats = four.map((q) => ({
        socketId: q.socketId,
        name: q.user.name,
        avatar: q.user.avatar,
        isBot: false,
        userId: q.user.id,
      }));
      const room = makeRoom("online", seats);
      four.forEach((q) => {
        const s = io.sockets.sockets.get(q.socketId);
        if (s) {
          s.join(room.id);
          s.data.roomId = room.id;
        }
      });
      startRoom(room);
    }
  });

  socket.on("queue:leave", () => {
    const i = queue.findIndex((q) => q.socketId === socket.id);
    if (i !== -1) queue.splice(i, 1);
  });

  socket.on("game:play", ({ tileIdx, side } = {}) => {
    const room = rooms.get(socket.data.roomId);
    if (!room) return;
    const seatIdx = seatIndexBySocket(room, socket.id);
    if (seatIdx === -1 || room.state.turn !== seatIdx) return;
    const res = engine.applyPlay(room.state, seatIdx, tileIdx, side);
    if (!res.ok) return socket.emit("error_msg", res.error);
    if (checkRoundEnd(room)) return;
    nextTurn(room);
    broadcastRoom(room);
    advanceBots(room);
  });

  socket.on("game:pass", () => {
    const room = rooms.get(socket.data.roomId);
    if (!room) return;
    const seatIdx = seatIndexBySocket(room, socket.id);
    if (seatIdx === -1 || room.state.turn !== seatIdx) return;
    const moves = engine.validMoves(room.state.hands[seatIdx], room.state.leftEnd, room.state.rightEnd);
    if (moves.length > 0) return socket.emit("error_msg", "Todavía tienes una jugada válida.");
    room.state.passCount++;
    if (checkRoundEnd(room)) return;
    nextTurn(room);
    broadcastRoom(room);
    advanceBots(room);
  });

  socket.on("chat:message", ({ text } = {}) => {
    const room = rooms.get(socket.data.roomId);
    if (!room || !text) return;
    const seatIdx = seatIndexBySocket(room, socket.id);
    if (seatIdx === -1) return;
    const safe = String(text).slice(0, 200);
    room.seats.forEach((s) => {
      if (s && !s.isBot && s.socketId) {
        io.to(s.socketId).emit("chat:message", { name: room.seats[seatIdx].name, text: safe });
      }
    });
  });

  socket.on("disconnect", () => {
    const qi = queue.findIndex((q) => q.socketId === socket.id);
    if (qi !== -1) queue.splice(qi, 1);

    const room = rooms.get(socket.data.roomId);
    if (!room) return;
    const seatIdx = seatIndexBySocket(room, socket.id);
    if (seatIdx === -1) return;
    // convertimos al jugador desconectado en CPU para no trabar la partida de los demás
    room.seats[seatIdx].isBot = true;
    room.seats[seatIdx].socketId = null;
    room.seats[seatIdx].name = room.seats[seatIdx].name + " (desconectado)";
    broadcastRoom(room);
    if (room.state.turn === seatIdx) advanceBots(room);
  });
});

server.listen(PORT, () => {
  console.log(`CAPICUA25 escuchando en http://localhost:${PORT}`);
  if (!googleConfigured) {
    console.log("   (login con Google deshabilitado: configura .env — ver README.md)");
  }
});
