# CAPICUA25 — Dominó multijugador en línea

Dominó dominicano (doble-seis) con backend real: 4 jugadores en línea por
WebSockets, login con cuenta de Google, y modo contra CPU. Probado de
punta a punta antes de entregarlo (login, emparejamiento, jugar fichas,
pasar turno, cierre de ronda, puntuación, ronda siguiente).

## ¿Qué cambió respecto al archivo original?

El HTML que me pasaste era **solo apariencia**: todo el juego vivía en el
navegador (`localStorage`/variables JS), no había servidor, y los botones
de login no se conectaban a nada real. Ahora:

- **Backend en Node.js** (`server.js`) con Express + Socket.IO. Toda la
  lógica del dominó corre en el servidor (`game/engine.js`), así ningún
  jugador puede hacer trampa jugando fichas que no tiene.
- **Login real con Google** (Passport + OAuth2). Al iniciar sesión se crea
  tu cuenta automáticamente (nombre, foto y correo vienen de Google).
- **4 jugadores en línea de verdad**: al elegir "Jugadores en línea" entras
  a una cola de emparejamiento; cuando hay 4 personas, arranca la partida
  y cada jugador ve el tablero, su propia mano, y el conteo de fichas de
  los demás en tiempo real.
- **Modo CPU** para jugar solo/practicar (sigue requiriendo login).
- **Estadísticas y ranking** persistidos en un archivo de base de datos
  (`data.json`, se crea solo).
- Quité el formulario de usuario/contraseña porque no tenía backend real
  detrás — Google es ahora el único método de login, tal como pediste.

## Estructura del proyecto

```
capicua25/
├── server.js           # servidor Express + Socket.IO + Google OAuth + salas
├── db.js                # capa de datos (usuarios, ranking) — archivo JSON
├── game/
│   └── engine.js         # reglas del dominó (reparto, jugadas válidas, puntaje)
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js            # cliente: se conecta al servidor por WebSockets
├── package.json
├── .env.example
└── README.md
```

## 1. Instalar y correr en tu computadora

```bash
cd capicua25
npm install
cp .env.example .env
```

Abre `.env` y por ahora deja `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`
vacíos si solo quieres probar — el servidor arranca igual, pero el botón
de "Ingresar con Google" no funcionará hasta que los configures (paso 2).

```bash
npm start
```

Abre `http://localhost:3000`.

## 2. Configurar Google OAuth (para que el login funcione)

1. Ve a [Google Cloud Console](https://console.cloud.google.com/) →
   crea un proyecto (o usa uno existente).
2. Menú **APIs y servicios → Pantalla de consentimiento OAuth**:
   configúrala como "Externa", agrega el nombre de tu app (CAPICUA25),
   correo de soporte, y guarda.
3. Menú **APIs y servicios → Credenciales → Crear credenciales →
   ID de cliente de OAuth**.
   - Tipo de aplicación: **Aplicación web**.
   - En **Orígenes autorizados de JavaScript** agrega:
     `http://localhost:3000` (y luego tu dominio real cuando publiques).
   - En **URIs de redirección autorizados** agrega:
     `http://localhost:3000/auth/google/callback`
     (y luego `https://tu-dominio.com/auth/google/callback`).
4. Copia el **Client ID** y **Client Secret** que te dan y pégalos en tu
   archivo `.env`:
   ```
   GOOGLE_CLIENT_ID=tu-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=tu-client-secret
   GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback
   ```
5. Reinicia el servidor (`npm start`). Ya debería funcionar el botón
   "Ingresar con Google".

Mientras la app esté en modo "Prueba" en Google Cloud, solo los correos
que agregues como "usuarios de prueba" podrán iniciar sesión. Para que
cualquiera pueda entrar, tienes que **publicar** la app OAuth (Google
puede pedir verificación si usas scopes sensibles, pero `profile`/`email`
normalmente no la requieren para un volumen bajo/medio de usuarios).

## 3. Publicarlo en línea (para que la gente juegue de verdad)

Este juego necesita **WebSockets persistentes**, así que no sirve un
hosting "serverless" clásico (tipo Vercel functions). Te recomiendo un
servicio de proceso siempre-vivo. Las opciones más simples:

### Opción recomendada: Render.com
1. Sube esta carpeta a un repositorio de GitHub.
2. En Render: **New → Web Service**, conecta el repo.
3. Build command: `npm install` — Start command: `npm start`.
4. En **Environment**, agrega las variables de `.env` (SESSION_SECRET,
   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL con tu
   dominio de Render, y `NODE_ENV=production`).
5. Cuando Render te dé tu URL pública (algo como
   `https://capicua25.onrender.com`), vuelve a Google Cloud Console y
   agrega esa URL + `/auth/google/callback` como URI de redirección
   autorizado (y como origen autorizado).

### Otras opciones válidas
- **Railway.app** — flujo casi idéntico a Render.
- **Fly.io** — un poco más técnico, pero funciona muy bien para Node + WS.
- Un **VPS** (DigitalOcean, Hetzner) con Node + PM2 + Nginx como proxy
  inverso (agrega HTTPS con Certbot) — más control, más trabajo.

Evita Vercel/Netlify "serverless" para este proyecto: cortan las
conexiones WebSocket de larga duración, así que el multijugador no
funcionaría correctamente.

## 4. Limitaciones actuales (para que las conozcas)

- La base de datos es un archivo JSON local (`data.json`). Funciona bien
  para arrancar, pero **no persiste** si tu hosting reinicia el disco
  (Render free, por ejemplo, borra el disco en cada deploy). Para
  producción seria, migra `db.js` a Postgres/MongoDB — el resto del
  código no cambia, solo esa capa.
- Las salas y partidas viven en memoria del proceso: si el servidor se
  reinicia, las partidas en curso se pierden (los jugadores tendrían que
  volver a entrar a la cola).
- Si un jugador se desconecta a mitad de partida, su asiento pasa a ser
  controlado por la CPU automáticamente, para no trabar a los demás.
- El modo "Parejas (2v2)" del diseño original no se implementó todavía
  (quedó solo el modo clásico individual 1v1v1v1); puedo agregarlo si lo
  necesitas.
- Con más de un servidor/instancia corriendo a la vez (escalado
  horizontal), las salas y la cola en memoria no se comparten entre
  instancias — para eso se necesitaría mover ese estado a Redis. Para
  un lanzamiento inicial con una sola instancia no hace falta.

## 5. Cómo lo probé

Antes de entregarte esto, levanté el servidor localmente, simulé un
jugador autenticado, lo conecté por Socket.IO, y jugué una partida
completa contra las 3 CPU: reparto de fichas, turnos, jugadas válidas,
cierre de ronda por "capicúa" y por bloqueo, puntuación acumulada, y
arranque automático de la siguiente ronda — todo funcionando de extremo
a extremo antes de quitar el código de prueba.
