/**
 * Motor de dominó dominicano (doble-seis, 4 jugadores).
 * Toda la lógica del juego vive aquí y corre en el servidor,
 * así ningún cliente puede jugar fichas que no tiene o hacer
 * movimientos inválidos.
 */

function buildDeck() {
  const deck = [];
  for (let a = 0; a <= 6; a++) {
    for (let b = a; b <= 6; b++) {
      deck.push([a, b]);
    }
  }
  return deck;
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function tileSum(t) {
  return t[0] + t[1];
}

function handSum(hand) {
  return hand.reduce((s, t) => s + tileSum(t), 0);
}

/** Reparte una ronda nueva de 28 fichas entre 4 jugadores y decide quién empieza. */
function dealNewRound() {
  const deck = shuffleArray(buildDeck());
  const hands = [[], [], [], []];
  for (let i = 0; i < 28; i++) hands[i % 4].push(deck[i]);

  let starter = 0;
  let bestDouble = -1;
  for (let p = 0; p < 4; p++) {
    hands[p].forEach((t) => {
      if (t[0] === t[1] && t[0] > bestDouble) {
        bestDouble = t[0];
        starter = p;
      }
    });
  }
  if (bestDouble === -1) {
    let best = -1;
    for (let p = 0; p < 4; p++) {
      hands[p].forEach((t) => {
        if (tileSum(t) > best) {
          best = tileSum(t);
          starter = p;
        }
      });
    }
  }

  return {
    hands,
    board: [],
    leftEnd: null,
    rightEnd: null,
    turn: starter,
    passCount: 0,
  };
}

/** Devuelve los índices de fichas de `hand` que se pueden jugar dado el estado del tablero. */
function validMoves(hand, leftEnd, rightEnd) {
  if (leftEnd === null) return hand.map((_, i) => i);
  const moves = [];
  hand.forEach((t, i) => {
    if (t[0] === leftEnd || t[1] === leftEnd || t[0] === rightEnd || t[1] === rightEnd) {
      moves.push(i);
    }
  });
  return moves;
}

/**
 * Intenta jugar la ficha `tileIdx` de la mano del jugador `playerIdx`.
 * Muta `roundState` in-place. Devuelve {ok:true} o {ok:false, error}.
 */
function applyPlay(roundState, playerIdx, tileIdx, side) {
  const hand = roundState.hands[playerIdx];
  const t = hand[tileIdx];
  if (!t) return { ok: false, error: "Ficha inválida." };

  const moves = validMoves(hand, roundState.leftEnd, roundState.rightEnd);
  if (!moves.includes(tileIdx)) return { ok: false, error: "Esa ficha no encaja en el tablero." };

  const isDouble = t[0] === t[1];

  if (roundState.leftEnd === null) {
    roundState.board.push({ a: t[0], b: t[1], double: isDouble });
    roundState.leftEnd = t[0];
    roundState.rightEnd = t[1];
  } else {
    let useSide = side;
    if (useSide !== "left" && useSide !== "right") {
      // auto-detección igual que el motor original: prioriza el lado derecho
      useSide = (t[0] === roundState.rightEnd || t[1] === roundState.rightEnd) ? "right" : "left";
    }
    if (useSide === "right") {
      if (t[0] !== roundState.rightEnd && t[1] !== roundState.rightEnd) {
        return { ok: false, error: "Esa ficha no encaja a la derecha." };
      }
      const match = t[0] === roundState.rightEnd ? t[0] : t[1];
      const other = t[0] === roundState.rightEnd ? t[1] : t[0];
      roundState.board.push({ a: match, b: other, double: isDouble });
      roundState.rightEnd = other;
    } else {
      if (t[0] !== roundState.leftEnd && t[1] !== roundState.leftEnd) {
        return { ok: false, error: "Esa ficha no encaja a la izquierda." };
      }
      const match = t[1] === roundState.leftEnd ? t[1] : t[0];
      const other = t[1] === roundState.leftEnd ? t[0] : t[1];
      roundState.board.unshift({ a: other, b: match, double: isDouble });
      roundState.leftEnd = other;
    }
  }

  hand.splice(tileIdx, 1);
  roundState.passCount = 0;
  return { ok: true };
}

/** IA simple para las CPU: prioriza dobles y fichas de mayor valor. */
function cpuChoose(hand, leftEnd, rightEnd) {
  const moves = validMoves(hand, leftEnd, rightEnd);
  if (moves.length === 0) return { pass: true };
  moves.sort((ia, ib) => {
    const a = hand[ia], b = hand[ib];
    const da = a[0] === a[1] ? 1 : 0;
    const db = b[0] === b[1] ? 1 : 0;
    if (da !== db) return db - da;
    return tileSum(b) - tileSum(a);
  });
  return { pass: false, tileIdx: moves[0] };
}

module.exports = {
  buildDeck,
  shuffleArray,
  tileSum,
  handSum,
  dealNewRound,
  validMoves,
  applyPlay,
  cpuChoose,
};
