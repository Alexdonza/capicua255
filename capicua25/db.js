/**
 * Base de datos muy simple basada en archivo JSON (lowdb).
 * Suficiente para arrancar en producción a escala pequeña/mediana.
 * Si el proyecto crece, esto se puede migrar a Postgres/Mongo sin
 * tocar el resto del código (solo esta capa).
 */
const path = require("path");
const low = require("lowdb");
const FileSync = require("lowdb/adapters/FileSync");
const { nanoid } = require("nanoid");

const adapter = new FileSync(path.join(__dirname, "data.json"));
const db = low(adapter);
db.defaults({ users: [] }).write();

function findUserById(id) {
  return db.get("users").find({ id }).value();
}

function findOrCreateGoogleUser(profile) {
  let user = db.get("users").find({ googleId: profile.id }).value();
  if (user) return user;

  user = {
    id: nanoid(),
    googleId: profile.id,
    name: profile.displayName || "Jugador",
    email: (profile.emails && profile.emails[0] && profile.emails[0].value) || null,
    avatar: (profile.photos && profile.photos[0] && profile.photos[0].value) || null,
    wins: 0,
    gamesPlayed: 0,
    totalPoints: 0,
    createdAt: new Date().toISOString(),
  };
  db.get("users").push(user).write();
  return user;
}

function publicUser(user) {
  if (!user) return null;
  const { id, name, email, avatar, wins, gamesPlayed, totalPoints } = user;
  return { id, name, email, avatar, wins, gamesPlayed, totalPoints };
}

function recordGameResult(userId, won, points) {
  const user = db.get("users").find({ id: userId }).value();
  if (!user) return;
  db.get("users")
    .find({ id: userId })
    .assign({
      gamesPlayed: (user.gamesPlayed || 0) + 1,
      wins: (user.wins || 0) + (won ? 1 : 0),
      totalPoints: (user.totalPoints || 0) + points,
    })
    .write();
}

function topRanking(limit = 20) {
  return db
    .get("users")
    .orderBy(["wins", "totalPoints"], ["desc", "desc"])
    .take(limit)
    .map((u) => publicUser(u))
    .value();
}

module.exports = {
  findUserById,
  findOrCreateGoogleUser,
  publicUser,
  recordGameResult,
  topRanking,
};
