'use strict';
// Servidor do quiz: HTTP (arquivos estáticos + API), Server-Sent Events para o tempo real
// e painel admin para editar perguntas. Dependências: qrcode, @google-cloud/firestore.

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const QRCode = require('qrcode');
const store = require('./store');

const PORT = Number(process.env.PORT) || 3000;
// Opcional. Se vazio, a URL dos participantes é derivada do cabeçalho Host da requisição.
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const MAX_PLAYERS = 100;
const MAX_POINTS = 1000; // resposta correta no primeiro instante
const MIN_POINTS = 500; // resposta correta no último instante
const MAX_QUESTIONS = 60;
const DEFAULT_THEME = 'programa';
const PUBLIC_DIR = path.join(__dirname, 'public');
const THEMES_DIR = path.join(PUBLIC_DIR, 'themes');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

let QUESTIONS = []; // perguntas atuais (editáveis pelo admin)
const clients = new Set(); // conexões SSE abertas: { role, res, player? }
let game = null;

// ---------- persistência do jogo (Firestore) ----------
const OWNER = crypto.randomUUID(); // identifica esta instância; só ela escreve o jogo
let fenced = false; // true quando outra instância assumiu o jogo: esta para de atender
let writeChain = Promise.resolve(); // escritas em ordem
let writeFailed = false;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new HttpError(status, message);
};

function newGame() {
  return {
    pin: String(100000 + crypto.randomInt(900000)),
    hostToken: crypto.randomBytes(16).toString('hex'),
    status: 'lobby', // lobby | question | reveal | ranking | podium | end
    qIndex: -1,
    startedAt: 0,
    endsAt: 0,
    timer: null,
    // Cópia das perguntas feita na criação: editar durante um jogo não altera o jogo em andamento.
    questions: structuredClone(QUESTIONS),
    players: new Map(), // token -> jogador
  };
}

// ---------- validação e temas ----------

function listThemes() {
  return fs
    .readdirSync(THEMES_DIR)
    .filter((f) => f.endsWith('.svg'))
    .map((f) => f.slice(0, -4))
    .sort();
}

const toInt = (v) => (typeof v === 'number' || /^\d+$/.test(String(v ?? '').trim()) ? Number(v) : NaN);

function validateQuestions(list, themes) {
  if (!Array.isArray(list) || list.length === 0) fail(400, 'Inclua pelo menos uma pergunta');
  if (list.length > MAX_QUESTIONS) fail(400, `No máximo ${MAX_QUESTIONS} perguntas`);
  return list.map((raw, i) => {
    const q = raw || {};
    const n = i + 1;
    const text = String(q.text ?? '').trim();
    if (!text || text.length > 300) fail(400, `Pergunta ${n}: escreva o enunciado (até 300 caracteres)`);
    const options = Array.isArray(q.options) ? q.options.map((o) => String(o ?? '').trim()) : [];
    if (options.length < 2 || options.length > 4) fail(400, `Pergunta ${n}: use de 2 a 4 respostas`);
    if (options.some((o) => !o || o.length > 150)) {
      fail(400, `Pergunta ${n}: respostas não podem ficar vazias (máximo 150 caracteres)`);
    }
    const correct = toInt(q.correct);
    if (!Number.isInteger(correct) || correct < 0 || correct >= options.length) {
      fail(400, `Pergunta ${n}: marque qual resposta é a correta`);
    }
    const time = toInt(q.time);
    if (!Number.isInteger(time) || time < 5 || time > 120) fail(400, `Pergunta ${n}: tempo entre 5 e 120 segundos`);
    const theme = q.theme || DEFAULT_THEME;
    if (!themes.includes(theme)) fail(400, `Pergunta ${n}: tema "${theme}" não existe`);
    return { text, options, correct, time, theme };
  });
}

// ---------- regras do jogo ----------

const revealed = () => ['reveal', 'ranking', 'end'].includes(game.status);

function ranking() {
  return [...game.players.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

function leaderboard() {
  return ranking().map((p) => ({ name: p.name, score: p.score }));
}

function clearTimer() {
  if (game.timer) {
    clearTimeout(game.timer);
    game.timer = null;
  }
}

function startQuestion(index) {
  clearTimer();
  const q = game.questions[index];
  game.qIndex = index;
  game.status = 'question';
  game.startedAt = Date.now();
  game.endsAt = game.startedAt + q.time * 1000;
  for (const p of game.players.values()) {
    p.answer = null;
    p.lastCorrect = false;
    p.lastGain = 0;
  }
  game.timer = setTimeout(revealAnswer, q.time * 1000);
  publish();
}

function revealAnswer() {
  if (game.status !== 'question') return;
  clearTimer();
  const q = game.questions[game.qIndex];
  const limit = q.time * 1000;
  for (const p of game.players.values()) {
    p.lastCorrect = false;
    p.lastGain = 0;
    if (p.answer && p.answer.choice === q.correct) {
      const elapsed = Math.min(Math.max(p.answer.at - game.startedAt, 0), limit);
      p.lastGain = Math.round(MAX_POINTS - (MAX_POINTS - MIN_POINTS) * (elapsed / limit));
      p.lastCorrect = true;
      p.score += p.lastGain;
    }
  }
  game.status = 'reveal';
  publish();
}

// Pódio: só o apresentador vê (animado no navegador). Participantes ficam na tela de espera.
function showPodium() {
  clearTimer();
  game.status = 'podium';
  publish();
}

function endGame() {
  clearTimer();
  game.status = 'end';
  publish();
}

function hostAction(action) {
  switch (action) {
    case 'start':
      if (game.status === 'lobby' && game.players.size > 0) startQuestion(0);
      break;
    case 'reveal':
      revealAnswer();
      break;
    case 'ranking':
      if (game.status === 'reveal') {
        game.status = 'ranking';
        publish();
      }
      break;
    case 'next':
      if (game.status === 'reveal' || game.status === 'ranking') {
        if (game.qIndex + 1 < game.questions.length) startQuestion(game.qIndex + 1);
        else showPodium();
      }
      break;
    case 'end':
      endGame();
      break;
    default:
      fail(400, 'Ação inválida');
  }
}

function submitAnswer(token, choice) {
  const p = game.players.get(token);
  if (!p) fail(403, 'Jogador não encontrado');
  if (game.status !== 'question') fail(409, 'Tempo encerrado');
  if (!Number.isInteger(choice) || choice < 0 || choice >= game.questions[game.qIndex].options.length) {
    fail(400, 'Opção inválida');
  }
  if (p.answer) return;
  p.answer = { choice, at: Date.now() };
  if ([...game.players.values()].every((x) => x.answer)) revealAnswer();
  else publishHost();
}

function join({ pin, name, token }) {
  if (String(pin) !== game.pin) fail(404, 'PIN inválido');
  if (token && game.players.has(token)) {
    return { token, name: game.players.get(token).name }; // reconexão
  }
  const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 20);
  if (!clean) fail(400, 'Digite um apelido');

  // Depois do início, só retorna quem já estava no jogo (mesmo apelido, sem novo cadastro).
  // Isso permite voltar com outro celular ou depois de limpar o navegador, recuperando a posição.
  if (game.status !== 'lobby') {
    const found = [...game.players.entries()].find(([, p]) => p.name.toLowerCase() === clean.toLowerCase());
    if (!found) fail(409, 'Esse jogo já começou. Só quem já estava nele pode voltar, usando o mesmo apelido.');
    return { token: found[0], name: found[1].name };
  }
  if (game.players.size >= MAX_PLAYERS) fail(409, 'Sala cheia');

  const taken = new Set([...game.players.values()].map((p) => p.name.toLowerCase()));
  let unique = clean;
  for (let n = 2; taken.has(unique.toLowerCase()); n++) unique = `${clean.slice(0, 17)} ${n}`;

  const newToken = crypto.randomBytes(16).toString('hex');
  game.players.set(newToken, { name: unique, score: 0, answer: null, lastCorrect: false, lastGain: 0 });
  publish();
  return { token: newToken, name: unique };
}

function createGame() {
  const busy = game.status !== 'end' && game.players.size > 0;
  if (busy) fail(409, 'Já existe um jogo em andamento. Encerre-o antes de criar outro.');
  clearTimer();
  for (const c of clients) c.res.end();
  clients.clear();
  game = newGame();
  persist();
  return { pin: game.pin, hostToken: game.hostToken };
}

// ---------- estado enviado aos clientes ----------

function hostState() {
  const s = {
    role: 'host',
    pin: game.pin,
    status: game.status,
    total: game.questions.length,
    qIndex: game.qIndex,
    serverNow: Date.now(),
    endsAt: game.endsAt,
    playerCount: game.players.size,
    names: [...game.players.values()].map((p) => p.name),
    leaderboard: ['ranking', 'podium', 'end'].includes(game.status) ? leaderboard() : [],
  };
  if (game.qIndex >= 0) {
    const q = game.questions[game.qIndex];
    const counts = q.options.map(() => 0);
    let answered = 0;
    for (const p of game.players.values()) {
      if (p.answer) {
        counts[p.answer.choice]++;
        answered++;
      }
    }
    s.question = {
      text: q.text,
      options: q.options,
      time: q.time,
      theme: q.theme || DEFAULT_THEME,
      correct: revealed() ? q.correct : null,
    };
    s.counts = counts;
    s.answered = answered;
  }
  return s;
}

function playerState(p) {
  const s = {
    role: 'player',
    pin: game.pin,
    status: game.status,
    total: game.questions.length,
    qIndex: game.qIndex,
    serverNow: Date.now(),
    endsAt: game.endsAt,
    playerCount: game.players.size,
    // Posição e pontuação total só vão ao participante no fim (suspense).
    you: {
      name: p.name,
      choice: p.answer ? p.answer.choice : null,
      lastCorrect: p.lastCorrect,
      lastGain: p.lastGain,
      ...(game.status === 'end' ? { score: p.score, rank: ranking().indexOf(p) + 1 } : {}),
    },
    leaderboard: game.status === 'end' ? leaderboard().slice(0, 10) : [],
  };
  if (game.qIndex >= 0) {
    const q = game.questions[game.qIndex];
    s.question = {
      text: q.text,
      options: q.options,
      time: q.time,
      theme: q.theme || DEFAULT_THEME,
      correct: revealed() ? q.correct : null,
    };
  }
  return s;
}

function send(client, data) {
  client.res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function publish() {
  for (const c of clients) send(c, c.role === 'host' ? hostState() : playerState(c.player));
  persist();
}

function publishHost() {
  for (const c of clients) if (c.role === 'host') send(c, hostState());
  persist();
}

function snapshot() {
  return {
    pin: game.pin,
    hostToken: game.hostToken,
    status: game.status,
    qIndex: game.qIndex,
    startedAt: game.startedAt,
    endsAt: game.endsAt,
    questions: game.questions,
    players: [...game.players.entries()].map(([token, p]) => ({
      token,
      name: p.name,
      score: p.score,
      answer: p.answer,
      lastCorrect: p.lastCorrect,
      lastGain: p.lastGain,
    })),
  };
}

// Salva o estado completo, em ordem. Não bloqueia quem chama; use flush() para esperar.
function persist() {
  if (!store.USE_FIRESTORE || fenced) return;
  const snap = snapshot();
  writeChain = writeChain.then(async () => {
    try {
      await store.saveGame(snap, OWNER);
      writeFailed = false;
    } catch (err) {
      if (err instanceof store.FencedError) fence();
      else {
        writeFailed = true;
        console.error('Falha ao salvar o jogo:', err.message);
      }
    }
  });
}

// Espera as escritas pendentes. Só então a resposta sai: se a instância cair, o que foi confirmado está salvo.
async function flush() {
  await writeChain;
  if (fenced || writeFailed) throw new HttpError(503, 'Não foi possível salvar o jogo. Tente de novo.');
}

// Outra instância assumiu o jogo: encerra as conexões para os clientes reconectarem na nova.
function fence() {
  fenced = true;
  for (const c of clients) c.res.end();
  clients.clear();
  console.error('Instância substituída: parando de atender.');
}

function restoreGame(s) {
  return {
    pin: s.pin,
    hostToken: s.hostToken,
    status: s.status,
    qIndex: s.qIndex,
    startedAt: s.startedAt,
    endsAt: s.endsAt,
    timer: null,
    questions: s.questions,
    players: new Map(
      s.players.map((p) => [
        p.token,
        { name: p.name, score: p.score, answer: p.answer, lastCorrect: p.lastCorrect, lastGain: p.lastGain },
      ])
    ),
  };
}

// Retoma o timer de uma pergunta em andamento (ou revela já, se o tempo acabou durante a queda).
function resumeTimers() {
  if (game.status !== 'question') return;
  const left = game.endsAt - Date.now();
  if (left <= 0) revealAnswer();
  else game.timer = setTimeout(revealAnswer, left);
}

// ---------- HTTP ----------

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit = 10000) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > limit) {
        reject(new HttpError(413, 'Requisição grande demais'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new HttpError(400, 'JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

const routes = {
  '/api/create': () => createGame(),
  '/api/join': (b) => join(b),
  '/api/answer': (b) => {
    submitAnswer(b.token, b.choice);
  },
  '/api/host': (b) => {
    if (b.token !== game.hostToken) fail(403, 'Sem permissão');
    hostAction(b.action);
  },
};

function openStream(url, req, res) {
  if (fenced) return sendJson(res, 503, { error: 'Servidor atualizando, tente de novo' });
  const role = url.searchParams.get('role');
  const token = url.searchParams.get('token') || '';
  let client;
  if (role === 'host' && token === game.hostToken) {
    client = { role: 'host', res };
  } else if (role === 'player' && game.players.has(token)) {
    client = { role: 'player', res, player: game.players.get(token) };
  } else {
    return sendJson(res, 403, { error: 'Sessão inválida' });
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(': conectado\n\n');
  clients.add(client);
  send(client, client.role === 'host' ? hostState() : playerState(client.player));
  req.on('close', () => clients.delete(client));
}

function serveStatic(pathname, res) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname);
  const file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 403, { error: 'Proibido' });
  fs.readFile(file, (err, data) => {
    if (err) return sendJson(res, 404, { error: 'Não encontrado' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

function lanUrls() {
  const urls = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) urls.push(`http://${i.address}:${PORT}`);
    }
  }
  return urls.length ? urls : [`http://localhost:${PORT}`];
}

// URL que os participantes usam. Ordem: PUBLIC_URL; endereço pelo qual o apresentador acessou
// (se não for localhost); IP da rede local.
function baseUrl(req) {
  if (PUBLIC_URL) return PUBLIC_URL;
  const host = req && req.headers.host;
  if (host && !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) {
    const proto = req.headers['x-forwarded-proto'] || 'http';
    return `${proto}://${host}`;
  }
  return lanUrls()[0];
}

function checkAdmin(req) {
  const h = req.headers.authorization || '';
  const given = Buffer.from(h.startsWith('Bearer ') ? h.slice(7) : '');
  const expected = Buffer.from(ADMIN_PASSWORD);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

async function handleAdmin(req, res, url) {
  if (!ADMIN_PASSWORD) return sendJson(res, 503, { error: 'Painel desativado: defina a variável ADMIN_PASSWORD' });
  if (!checkAdmin(req)) return sendJson(res, 401, { error: 'Senha incorreta' });
  if (req.method === 'GET' && url.pathname === '/api/admin/questions') {
    return sendJson(res, 200, { questions: QUESTIONS, themes: listThemes(), defaultTheme: DEFAULT_THEME });
  }
  if (req.method === 'PUT' && url.pathname === '/api/admin/questions') {
    const body = await readBody(req, 300000);
    const items = validateQuestions(body.questions, listThemes());
    await store.saveQuestions(items);
    QUESTIONS = items;
    return sendJson(res, 200, { ok: true, count: items.length });
  }
  return sendJson(res, 404, { error: 'Rota não encontrada' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/admin/')) return await handleAdmin(req, res, url);
    if (req.method === 'GET' && url.pathname === '/events') return openStream(url, req, res);
    if (req.method === 'GET' && url.pathname === '/api/info') {
      return sendJson(res, 200, { urls: [baseUrl(req)] });
    }
    if (req.method === 'GET' && url.pathname === '/api/qr.svg') {
      // O QR já leva o PIN: quem escaneia entra direto no campo certo
      const target = `${baseUrl(req)}/?pin=${game.pin}`;
      const svg = await QRCode.toString(target, { type: 'svg', margin: 1, color: { dark: '#000', light: '#fff' } });
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
      return res.end(svg);
    }
    if (req.method === 'POST' && routes[url.pathname]) {
      if (fenced) return sendJson(res, 503, { error: 'Servidor atualizando, tente de novo' });
      const body = await readBody(req);
      const result = routes[url.pathname](body);
      await flush();
      return sendJson(res, 200, result || { ok: true });
    }
    if (req.method === 'GET') return serveStatic(url.pathname, res);
    sendJson(res, 405, { error: 'Método não permitido' });
  } catch (err) {
    sendJson(res, err.status || 400, { error: err.message });
  }
});

// Confere periodicamente se esta instância ainda é a dona do jogo. Conexões abertas na
// revisão antiga continuam vivas após uma troca de revisão, então não basta checar na hora de gravar.
setInterval(async () => {
  if (!store.USE_FIRESTORE || fenced) return;
  try {
    const owner = await store.currentOwner();
    if (owner && owner !== OWNER) fence();
  } catch (err) {
    console.error('Falha ao verificar o dono do jogo:', err.message);
  }
}, 5000);

// Mantém as conexões SSE vivas (celulares e Wi-Fi costumam derrubar conexões ociosas).
setInterval(() => {
  for (const c of clients) c.res.write(': ping\n\n');
}, 15000);

(async () => {
  QUESTIONS = validateQuestions(await store.loadQuestions(), listThemes());
  const saved = await store.claimGame(OWNER);
  game = saved && saved.status !== 'end' ? restoreGame(saved) : newGame();
  if (saved && saved.status !== 'end') console.log(`  Jogo ${game.pin} retomado (${game.players.size} participantes, status ${game.status}).`);
  resumeTimers();
  server.listen(PORT, '0.0.0.0', () => {
    console.log('\nQuiz no ar!');
    console.log(`  Armazenamento: ${store.USE_FIRESTORE ? 'Firestore' : 'questions.json'}`);
    console.log(`  Apresentador: http://localhost:${PORT}/host.html`);
    console.log(`  Painel de perguntas: http://localhost:${PORT}/admin.html ${ADMIN_PASSWORD ? '' : '(desativado: sem ADMIN_PASSWORD)'}`);
    for (const u of lanUrls()) console.log(`  Participantes (mesma rede): ${u}`);
    console.log(`  ${QUESTIONS.length} perguntas carregadas. Ctrl+C para parar.\n`);
  });
})().catch((err) => {
  console.error('Falha ao iniciar:', err);
  process.exit(1);
});
