import { readFileSync } from "node:fs";
// Simula um evento com 1 apresentador + 50 participantes contra o servidor local.
const BASE = process.env.BASE || 'http://localhost:3457';
const N = 50;
const ROUNDS = Number(process.env.ROUNDS || 3);
const questions = JSON.parse(readFileSync(new URL("../questions.json", import.meta.url), "utf8"));

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = async (path, body) => {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};

function openSSE(role, token, onState) {
  const ctrl = new AbortController();
  const p = (async () => {
    const res = await fetch(`${BASE}/events?role=${role}&token=${token}`, { signal: ctrl.signal });
    if (res.status !== 200) return { status: res.status };
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const line = block.split('\n').find((l) => l.startsWith('data: '));
            if (line) onState(JSON.parse(line.slice(6)));
          }
        }
      } catch {}
    })();
    return { status: 200 };
  })();
  return { ready: p, close: () => ctrl.abort() };
}

async function waitFor(fn, timeoutMs, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (fn()) return;
    await sleep(50);
  }
  throw new Error('Timeout esperando: ' + label);
}

// ---- 1. apresentador cria o jogo
const created = await post('/api/create', {});
const { pin, hostToken } = created.body;
log('Jogo criado. PIN =', pin);

let hostLast = null;
const host = openSSE('host', hostToken, (s) => (hostLast = s));
log('SSE host status:', (await host.ready).status);

// ---- 2. 50 participantes entram
const players = [];
await Promise.all(
  Array.from({ length: N }, (_, i) =>
    post('/api/join', { pin, name: `Pessoa ${i + 1}`, token: null }).then((r) => {
      if (r.status !== 200) throw new Error('join falhou: ' + JSON.stringify(r));
      players.push({ name: r.body.name, token: r.body.token, last: null, answeredQ: -1, skill: Math.random() });
    })
  )
);
log('Participantes entraram:', players.length);

// Nome duplicado deve virar "Nome 2"
const dup = await post('/api/join', { pin, name: 'pessoa 1', token: null });
log('Nome repetido ->', dup.body.name);

// Pin errado e apelido vazio
log('PIN errado ->', (await post('/api/join', { pin: '999999', name: 'x' })).body.error);
log('Apelido vazio ->', (await post('/api/join', { pin, name: '   ' })).body.error);

// Abrir SSE de cada participante
for (const p of players) {
  p.sse = openSSE('player', p.token, (s) => {
    p.last = s;
    if (s.status === 'question' && p.answeredQ !== s.qIndex && s.you.choice === null) {
      p.answeredQ = s.qIndex;
      const q = questions[s.qIndex];
      // Um pouco mais de "acerto" para quem é mais "skilled"
      const pickCorrect = Math.random() < 0.3 + 0.5 * p.skill;
      const choice = pickCorrect ? q.correct : Math.floor(Math.random() * q.options.length);
      const delay = 300 + Math.random() * 6000;
      setTimeout(() => {
        post('/api/answer', { token: p.token, choice }).then((r) => {
          p.lastAnswerStatus = r.status;
        });
      }, delay);
    }
  });
}
await Promise.all(players.map((p) => p.sse.ready));
log('SSE de todos os participantes conectado');

await waitFor(() => hostLast && hostLast.playerCount === N + 1, 3000, 'lobby com 50 + 1 duplicado');
log('Host vê', hostLast.playerCount, 'jogadores no lobby');

// Reconexão: mesmo token devolve o mesmo nome
const re = await post('/api/join', { pin, name: 'Outro', token: players[0].token });
log('Reconexão mantém nome:', re.body.name === players[0].name, `(${re.body.name})`);

// ---- 3. início e rodadas
const start = await post('/api/host', { token: hostToken, action: 'start' });
log('Start ->', start.status);

// Entrar depois de começar deve ser recusado
log('Join tardio ->', (await post('/api/join', { pin, name: 'Atrasado' })).body.error);

for (let r = 0; r < ROUNDS; r++) {
  const t0 = Date.now();
  await waitFor(() => hostLast.status === 'reveal' && hostLast.qIndex === r, 40000, `reveal da pergunta ${r + 1}`);
  log(`Pergunta ${r + 1}: revelada em ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    `| respostas: ${hostLast.answered}/${hostLast.playerCount}`,
    `| contagem por opção: ${JSON.stringify(hostLast.counts)} | correta: ${hostLast.question.correct}`);

  // Resposta depois do reveal deve ser recusada
  const late = await post('/api/answer', { token: players[1].token, choice: 0 });
  log('  Resposta tardia ->', late.status, late.body.error || 'ok');

  const withRank = await post('/api/host', { token: hostToken, action: 'ranking' });
  await waitFor(() => hostLast.status === 'ranking', 2000, 'ranking');
  const top = hostLast.leaderboard.slice(0, 3).map((x) => `${x.name}=${x.score}`).join(', ');
  log('  Top 3:', top);

  await post('/api/host', { token: hostToken, action: 'next' });
  if (r < ROUNDS - 1) await waitFor(() => hostLast.status === 'question' && hostLast.qIndex === r + 1, 3000, 'próxima');
}

// Checar consistência: soma das pontuações = soma dos ganhos
const totalScore = hostLast.leaderboard.reduce((a, x) => a + x.score, 0);
const sorted = hostLast.leaderboard.every((x, i, arr) => i === 0 || arr[i - 1].score >= x.score);
log('Ranking ordenado:', sorted, '| pontuação total:', totalScore);

// Participante vê a própria posição coerente
const sample = players[7].last;
log('Participante 8 (meio do jogo) ->', sample.status, '| campos de posição visíveis?', 'rank' in sample.you, 'score' in sample.you);

// Encerrar
await post('/api/host', { token: hostToken, action: 'end' });
await waitFor(() => hostLast.status === 'end', 2000, 'end');
log('Jogo encerrado. Top 3 final:', hostLast.leaderboard.slice(0, 3).map((x) => `${x.name}=${x.score}`).join(', '));

// Respostas de cada participante (de quem respondeu com status 200 ou 409)
const statuses = players.map((p) => p.lastAnswerStatus);
log('Status das respostas enviadas:', [...new Set(statuses)]);

// Limpeza
host.close();
players.forEach((p) => p.sse.close());
log('Simulação concluída.');
process.exit(0);
