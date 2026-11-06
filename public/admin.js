// Editor de perguntas (painel admin).

const $ = (id) => document.getElementById(id);

let Q = [];
let themes = [];
let defaultTheme = 'programa';
let password = sessionStorage.getItem('quiz.adminPw');

async function adminApi(method, body) {
  const res = await fetch('/api/admin/questions', {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${password}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erro de conexão');
  return data;
}

function setStatus(msg, isError = true) {
  const s = $('status');
  s.textContent = msg;
  s.style.color = isError ? '#ffd166' : '#b7f7a6';
}

async function loadEditor() {
  const data = await adminApi('GET');
  Q = data.questions;
  themes = data.themes;
  defaultTheme = data.defaultTheme;
  showScreen('editor');
  render();
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  password = $('password').value;
  try {
    await loadEditor();
    sessionStorage.setItem('quiz.adminPw', password);
  } catch (err) {
    password = null;
    $('loginError').textContent = err.message;
  }
});

function btn(label, onClick, cls = '') {
  const b = el('button', `small ${cls}`.trim(), label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

function move(i, delta) {
  const j = i + delta;
  if (j < 0 || j >= Q.length) return;
  [Q[i], Q[j]] = [Q[j], Q[i]];
  render();
}

function removeOption(q, j) {
  if (q.options.length <= 2) return setStatus('Cada pergunta precisa de pelo menos 2 respostas.');
  q.options.splice(j, 1);
  if (j === q.correct) q.correct = 0;
  else if (j < q.correct) q.correct -= 1;
  render();
}

function card(q, i) {
  const c = el('div', 'qcard');

  const head = el('div', 'qhead');
  head.append(el('strong', '', `Pergunta ${i + 1}`));
  const tools = el('div', 'qtools');
  tools.append(
    btn('↑', () => move(i, -1)),
    btn('↓', () => move(i, 1)),
    btn('Remover', () => {
      if (confirm(`Remover a pergunta ${i + 1}?`)) {
        Q.splice(i, 1);
        render();
      }
    }, 'danger')
  );
  head.append(tools);
  c.append(head);

  const text = el('textarea');
  text.rows = 2;
  text.maxLength = 300;
  text.placeholder = 'Enunciado da pergunta';
  text.value = q.text;
  text.addEventListener('input', () => (q.text = text.value));
  c.append(text);

  q.options.forEach((opt, j) => {
    const row = el('div', 'opt');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = `correct-${i}`;
    radio.title = 'Resposta correta';
    radio.checked = q.correct === j;
    radio.addEventListener('change', () => (q.correct = j));

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'optText';
    input.maxLength = 150;
    input.placeholder = `Resposta ${j + 1}`;
    input.value = opt;
    input.addEventListener('input', () => (q.options[j] = input.value));

    row.append(radio, input, btn('×', () => removeOption(q, j), 'ghost'));
    c.append(row);
  });

  const foot = el('div', 'qfoot');
  if (q.options.length < 4) {
    foot.append(btn('+ resposta', () => {
      q.options.push('');
      render();
    }, 'ghost'));
  }
  const timeLabel = el('label', '', 'Tempo (s): ');
  const time = document.createElement('input');
  time.type = 'number';
  time.min = 5;
  time.max = 120;
  time.value = q.time;
  time.className = 'num';
  time.addEventListener('input', () => (q.time = Number(time.value)));
  timeLabel.append(time);

  const themeLabel = el('label', '', 'Tema: ');
  const sel = document.createElement('select');
  for (const t of themes) {
    const o = document.createElement('option');
    o.value = t;
    o.textContent = t;
    o.selected = t === (q.theme || defaultTheme);
    sel.append(o);
  }
  sel.addEventListener('change', () => (q.theme = sel.value));
  themeLabel.append(sel);

  const preview = el('img', 'thumb');
  preview.alt = '';
  preview.src = `themes/${encodeURIComponent(q.theme || defaultTheme)}.svg`;
  sel.addEventListener('change', () => (preview.src = `themes/${encodeURIComponent(sel.value)}.svg`));

  foot.append(timeLabel, themeLabel, preview);
  c.append(foot);
  return c;
}

function render() {
  const list = $('list');
  list.replaceChildren(...Q.map((q, i) => card(q, i)));
  $('count').textContent = `${Q.length} pergunta(s)`;
}

function addQuestion() {
  Q.push({ text: '', options: ['', '', '', ''], correct: 0, time: 20, theme: defaultTheme });
  render();
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}

async function save() {
  // Campos de texto dentro de cards já atualizam Q em tempo real; aqui só enviamos.
  setStatus('Salvando…', false);
  try {
    const res = await adminApi('PUT', { questions: Q });
    setStatus(`Salvo! ${res.count} pergunta(s) no ar para os próximos jogos.`, false);
  } catch (err) {
    setStatus(err.message);
  }
}

['addBtn', 'addBtn2'].forEach((id) => $(id).addEventListener('click', addQuestion));
['saveBtn', 'saveBtn2'].forEach((id) => $(id).addEventListener('click', save));

// Ao abrir: se a senha já estiver na sessão, entra direto.
if (password) {
  loadEditor().catch(() => {
    sessionStorage.removeItem('quiz.adminPw');
    password = null;
  });
}
