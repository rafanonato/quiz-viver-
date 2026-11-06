// Tela do apresentador (computador / projeção).

const $ = (id) => document.getElementById(id);

let host = JSON.parse(localStorage.getItem('quiz.host') || 'null');
let joinBase = location.origin;
let stream = null;
let lastState = null;
let renderedQ = -1;
let ticker = null;

function connect(token) {
  if (stream) stream.close();
  stream = openStream('host', token, render, () => {
    stream = null;
    host = null;
    localStorage.removeItem('quiz.host');
    showScreen('setup');
    $('setupError').textContent = 'Sessão encerrada. Crie um novo jogo.';
  });
}

$('createBtn').addEventListener('click', async () => {
  $('setupError').textContent = '';
  try {
    const r = await api('/api/create');
    host = { pin: r.pin, token: r.hostToken };
    localStorage.setItem('quiz.host', JSON.stringify(host));
    connect(host.token);
  } catch (err) {
    $('setupError').textContent = err.message;
  }
});

async function act(action) {
  try {
    await api('/api/host', { token: host.token, action });
  } catch (err) {
    alert(err.message);
  }
}

$('startBtn').addEventListener('click', () => act('start'));
document.querySelector('#question .reveal-btn').addEventListener('click', () => act('reveal'));
document.querySelector('#reveal .rank-btn').addEventListener('click', () => act('ranking'));
document.querySelectorAll('.next-btn').forEach((b) => b.addEventListener('click', () => act('next')));
document.querySelectorAll('.end-btn').forEach((b) =>
  b.addEventListener('click', () => {
    if (confirm('Encerrar o jogo agora?')) act('end');
  })
);
$('newBtn').addEventListener('click', () => {
  host = null;
  localStorage.removeItem('quiz.host');
  showScreen('setup');
});

function render(s) {
  lastState = s;
  setTheme(s.question ? s.question.theme : null);
  if (s.status === 'lobby') renderLobby(s);
  else if (s.status === 'question') renderQuestion(s);
  else if (s.status === 'reveal') renderReveal(s);
  else if (s.status === 'ranking') renderRanking(s);
  else if (s.status === 'end') renderEnd(s);
  if (!ticker) ticker = setInterval(tick, 200);
}

function renderLobby(s) {
  showScreen('lobby');
  $('joinUrl').textContent = joinBase;
  $('bigPin').textContent = s.pin;
  if ($('qr').dataset.pin !== s.pin) {
    // novo PIN = novo QR (só recarrega quando o PIN muda)
    $('qr').dataset.pin = s.pin;
    $('qr').src = `/api/qr.svg?pin=${s.pin}`;
  }
  $('lobbyCount').textContent = `${s.playerCount} participante(s) conectado(s)`;
  $('names').replaceChildren(...s.names.map((n) => el('span', 'chip', n)));
  $('startBtn').disabled = s.playerCount === 0;
}

function buildTiles(container, options, counts, correct) {
  container.replaceChildren();
  options.forEach((opt, i) => {
    let cls = `tile c${i}`;
    if (correct !== null) cls += i === correct ? ' right' : ' wrong';
    const t = el('div', cls);
    t.append(el('span', 'shape', SHAPES[i]), el('span', 'label', opt));
    if (counts) t.append(el('span', 'count-badge', `${counts[i]}`));
    container.append(t);
  });
}

function renderQuestion(s) {
  showScreen('question');
  const q = s.question;
  $('hQ').textContent = `Pergunta ${s.qIndex + 1} de ${s.total}`;
  $('hText').textContent = q.text;
  $('hAnswered').textContent = `${s.answered}/${s.playerCount} responderam`;
  buildTiles($('hTiles'), q.options, null, null);
}

function renderReveal(s) {
  showScreen('reveal');
  const q = s.question;
  $('rCount').textContent = `${s.answered}/${s.playerCount} responderam`;
  $('rText').textContent = q.text;
  buildTiles($('rTiles'), q.options, s.counts, q.correct);
  const isLast = s.qIndex + 1 >= s.total;
  document.querySelectorAll('#reveal .next-btn, #ranking .next-btn').forEach((b) => {
    b.textContent = isLast ? 'Ver pódio final' : 'Próxima pergunta';
  });
}

function renderRanking(s) {
  showScreen('ranking');
  renderList($('rankList'), s.leaderboard.slice(0, 10), null);
  const isLast = s.qIndex + 1 >= s.total;
  document.querySelector('#ranking .next-btn').textContent = isLast ? 'Ver pódio final' : 'Próxima pergunta';
}

function renderEnd(s) {
  showScreen('end');
  renderList($('finalList'), s.leaderboard.slice(0, 10), null);
}

function tick() {
  if (!lastState || lastState.status !== 'question') return;
  $('hTimer').textContent = Math.max(0, Math.ceil((lastState.endsAt - serverNow()) / 1000));
}

// Ao abrir: pega o endereço da rede local (para os participantes) e reconecta se já havia jogo.
(async () => {
  try {
    const info = await fetch('/api/info').then((r) => r.json());
    if (info.urls && info.urls.length) joinBase = info.urls[0];
  } catch {}
  if (host) connect(host.token);
  else showScreen('setup');
})();
