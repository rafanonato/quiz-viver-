// Tela do participante (celular).

const $ = (id) => document.getElementById(id);

const session = {
  pin: localStorage.getItem('quiz.pin'),
  token: localStorage.getItem('quiz.token'),
};
let stream = null;
let lastState = null;
let renderedQ = -1;
let ticker = null;

function startStream(token) {
  if (stream) stream.close();
  stream = openStream('player', token, render, () => {
    stream = null;
    session.token = null;
    localStorage.removeItem('quiz.token');
    showScreen('join');
    $('joinError').textContent = 'Este jogo terminou ou foi reiniciado. Entre novamente com o PIN.';
  });
}

$('joinForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('joinError').textContent = '';
  const pin = $('pin').value.trim();
  const name = $('name').value.trim();
  try {
    const r = await api('/api/join', {
      pin,
      name,
      token: session.pin === pin ? session.token : null,
    });
    session.pin = pin;
    session.token = r.token;
    localStorage.setItem('quiz.pin', pin);
    localStorage.setItem('quiz.token', r.token);
    startStream(r.token);
  } catch (err) {
    $('joinError').textContent = err.message;
  }
});

function render(s) {
  lastState = s;
  setTheme(s.question ? s.question.theme : null);
  if (s.status === 'lobby') {
    showScreen('lobby');
    $('myName').textContent = s.you.name;
    $('lobbyCount').textContent = `${s.playerCount} participante(s) na sala`;
  } else if (s.status === 'question') {
    renderQuestion(s);
  } else if (s.status === 'reveal') {
    renderReveal(s);
  } else if (s.status === 'ranking') {
    // Ranking fica só na tela do apresentador: participante aguarda a próxima pergunta.
    showScreen('wait');
  } else if (s.status === 'podium') {
    showScreen('podium');
    $('podiumYou').textContent = `Você: ${s.you.name}`;
  } else if (s.status === 'end') {
    renderEnd(s);
  }
  if (!ticker) ticker = setInterval(tick, 200);
}

function renderQuestion(s) {
  showScreen('question');
  const box = $('answers');
  if (renderedQ !== s.qIndex) {
    renderedQ = s.qIndex;
    box.replaceChildren();
    s.question.options.forEach((opt, i) => {
      const b = el('button', `answer c${i}`);
      b.type = 'button';
      b.append(el('span', 'shape', SHAPES[i]), el('span', 'label', opt));
      b.addEventListener('click', () => choose(i));
      box.append(b);
    });
  }
  const answered = s.you.choice !== null;
  [...box.children].forEach((b, i) => {
    b.disabled = answered;
    b.classList.toggle('chosen', s.you.choice === i);
    b.classList.toggle('dim', answered && s.you.choice !== i);
  });
  $('pQ').textContent = `${s.qIndex + 1} / ${s.total}`;
  $('pText').textContent = s.question.text;
  $('pStatus').textContent = answered ? 'Resposta enviada! Aguarde…' : 'Escolha uma resposta';
}

async function choose(i) {
  if (!lastState || lastState.status !== 'question' || lastState.you.choice !== null) return;
  lastState.you.choice = i; // atualização otimista; o servidor confirma abaixo
  renderQuestion(lastState);
  try {
    await api('/api/answer', { token: session.token, choice: i });
  } catch (err) {
    $('pStatus').textContent = err.message;
  }
}

function renderReveal(s) {
  showScreen('reveal');
  const y = s.you;
  const box = $('resultBox');
  if (y.lastCorrect) {
    box.className = 'result ok';
    box.textContent = `Correto! +${y.lastGain}`;
  } else {
    box.className = 'result bad';
    box.textContent = y.choice === null ? 'Você não respondeu' : 'Errado';
  }
  $('correctAnswer').textContent = `Resposta certa: ${s.question.options[s.question.correct]}`;
}

function renderEnd(s) {
  showScreen('end');
  $('endText').textContent = `Você ficou em ${s.you.rank}º lugar com ${s.you.score} pts`;
  renderList($('endList'), s.leaderboard, s.you.name);
}

function tick() {
  if (!lastState || lastState.status !== 'question') return;
  const left = Math.max(0, Math.ceil((lastState.endsAt - serverNow()) / 1000));
  $('pTimer').textContent = left;
}

// Ao abrir a página: se já há sessão salva, reconecta direto.
if (new URLSearchParams(location.search).get('pin')) $('pin').value = new URLSearchParams(location.search).get('pin');
if (session.token) startStream(session.token);
