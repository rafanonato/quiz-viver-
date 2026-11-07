// Funções compartilhadas entre a tela do apresentador e a do participante.

const SHAPES = ['▲', '◆', '●', '■'];

const clock = { offset: 0 }; // diferença entre o relógio do servidor e o deste aparelho
const serverNow = () => Date.now() + clock.offset;

async function api(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erro de conexão');
  return data;
}

// Conexão em tempo real com reconexão. Só desiste (onClosed) quando o servidor responde 403,
// ou seja, a sessão realmente não existe mais. Falhas temporárias (429, 5xx, rede) são repetidas.
async function probeSession(role, token) {
  try {
    const res = await fetch(`/events?role=${role}&token=${encodeURIComponent(token)}`, { cache: 'no-store' });
    if (res.body) res.body.cancel();
    return res.status;
  } catch {
    return 0;
  }
}

function openStream(role, token, onState, onClosed) {
  let es = null;
  let stopped = false;
  const connect = () => {
    if (stopped) return;
    es = new EventSource(`/events?role=${role}&token=${encodeURIComponent(token)}`);
    es.onmessage = (ev) => {
      const s = JSON.parse(ev.data);
      clock.offset = s.serverNow - Date.now();
      onState(s);
    };
    es.onerror = async () => {
      if (es.readyState !== EventSource.CLOSED) return; // o navegador reconecta sozinho
      es.close();
      const status = await probeSession(role, token);
      if (stopped) return;
      if (status === 403) return onClosed();
      setTimeout(connect, 2000); // 429, 5xx ou rede: tenta de novo sem apagar a sessão
    };
  };
  connect();
  return {
    close() {
      stopped = true;
      if (es) es.close();
    },
  };
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function renderList(listEl, rows, myName) {
  listEl.replaceChildren();
  rows.forEach((r, i) => {
    const li = el('li', r.name === myName ? 'me' : '');
    const medal = ['🥇', '🥈', '🥉'][i] || `${i + 1}º`;
    li.append(el('span', 'pos', medal), el('span', 'name', r.name), el('span', 'pts', `${r.score}`));
    listEl.append(li);
  });
}

// Fundo temático: SVG da pasta themes/ com uma película escura para o texto ficar legível.
let currentTheme = null;
function setTheme(name) {
  const theme = name || 'programa';
  if (theme === currentTheme) return;
  currentTheme = theme;
  document.body.style.backgroundImage =
    `linear-gradient(rgba(30,11,74,.45), rgba(30,11,74,.75)), url("themes/${encodeURIComponent(theme)}.svg")`;
}

function showScreen(id) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
}
