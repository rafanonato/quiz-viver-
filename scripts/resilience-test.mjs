// Teste de resiliência contra o Firestore real, com documento de teste (GAME_DOC).
// Simula queda/troca de instância: uma nova instância assume o jogo; a antiga deve parar de atender.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KAHOOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { Firestore } = createRequire(KAHOOT + '/package.json')('@google-cloud/firestore');
const GAME_DOC = `test-resilience-${Date.now()}`;
const env = { ...process.env, STORAGE: 'firestore', GAME_DOC, GOOGLE_CLOUD_PROJECT: 'rafanonato1' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function startServer(port) {
  const child = spawn('node', ['server.js'], { cwd: KAHOOT, env: { ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  child.out = () => out;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('servidor não subiu: ' + out)), 20000);
    const check = setInterval(() => {
      if (out.includes('Quiz no ar')) {
        clearInterval(check);
        clearTimeout(t);
        resolve(child);
      }
    }, 200);
  });
}

const api = async (base, path, body) => {
  const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

// Abre SSE e guarda a última mensagem recebida
function listen(base, role, token) {
  const box = { last: null, status: null };
  const ctrl = new AbortController();
  (async () => {
    try {
      const res = await fetch(`${base}/events?role=${role}&token=${token}`, { signal: ctrl.signal });
      box.status = res.status;
      if (res.status !== 200) return;
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const line = block.split('\n').find((l) => l.startsWith('data: '));
          if (line) box.last = JSON.parse(line.slice(6));
        }
      }
    } catch {}
  })();
  box.close = () => ctrl.abort();
  return box;
}

const waitFor = async (fn, ms, label) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return;
    await sleep(100);
  }
  throw new Error('timeout: ' + label);
};

let A, B, C;
const BASE_A = 'http://localhost:3601';
const BASE_B = 'http://localhost:3602';
const BASE_C = 'http://localhost:3603';
const ok = (cond, msg) => {
  log(cond ? 'OK  ' : 'FALHA', msg);
  if (!cond) process.exitCode = 1;
};

try {
  // 1) Instância A: jogo com 3 participantes, uma pergunta respondida
  A = await startServer(3601);
  log('A no ar');
  const c = (await api(BASE_A, '/api/create')).body;
  const ana = (await api(BASE_A, '/api/join', { pin: c.pin, name: 'Ana' })).body;
  const bruno = (await api(BASE_A, '/api/join', { pin: c.pin, name: 'Bruno' })).body;
  await api(BASE_A, '/api/join', { pin: c.pin, name: 'Carla' });
  await api(BASE_A, '/api/host', { token: c.hostToken, action: 'start' });
  const q1 = (await listen(BASE_A, 'player', ana.token)).last; // só para confirmar conexão
  await api(BASE_A, '/api/answer', { token: ana.token, choice: 2 }); // 2 = correta da pergunta 1
  await api(BASE_A, '/api/answer', { token: bruno.token, choice: 0 });
  await api(BASE_A, '/api/host', { token: c.hostToken, action: 'reveal' });
  await sleep(300);
  const anaLive = listen(BASE_A, 'player', ana.token);
  await sleep(500);
  const ganhoAna = anaLive.last && anaLive.last.you.lastGain;
  ok(typeof ganhoAna === 'number' && ganhoAna > 0, `Ana ganhou ${ganhoAna} pontos na pergunta 1 (em A)`);
  anaLive.close();

  // 2) Instância B assume o jogo (simula queda + nova instância). A deve ser "cercada".
  B = await startServer(3602);
  ok(B.out().includes('retomado'), 'B retomou o jogo salvo');
  await sleep(800);
  // A confere o dono a cada 5 s: espera até ela se cercar sozinha (sem nenhuma gravação)
  let aStatus = null;
  for (let i = 0; i < 30 && aStatus !== 503; i++) {
    await sleep(1000);
    aStatus = (await fetch(BASE_A + '/api/answer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then((r) => r.status).catch(() => null));
  }
  ok(aStatus === 503, `A se cerca sozinha após ser substituída (status ${aStatus})`);

  // 3) Participante e apresentador reconectam em B com os mesmos tokens
  const anaB = listen(BASE_B, 'player', ana.token);
  const hostB = listen(BASE_B, 'host', c.hostToken);
  await waitFor(() => anaB.last && hostB.last, 5000, 'estado em B');
  ok(anaB.status === 200, 'Ana reconecta em B com o mesmo token');
  ok(hostB.status === 200, 'apresentador reconecta em B com o mesmo token');
  ok(hostB.last.playerCount === 3, `B tem os 3 participantes (${hostB.last.playerCount})`);
  ok(hostB.last.status === 'reveal' && hostB.last.qIndex === 0, `B está na revelação da pergunta 1 (${hostB.last.status}, ${hostB.last.qIndex})`);

  // 4) Timer retomado: pergunta 2 em B, troca para C no meio e confere o fim automático
  await api(BASE_B, '/api/host', { token: c.hostToken, action: 'next' });
  await waitFor(() => hostB.last.status === 'question' && hostB.last.qIndex === 1, 5000, 'pergunta 2 em B');
  const endsB = hostB.last.endsAt;
  await sleep(2000);
  C = await startServer(3603);
  ok(C.out().includes('retomado'), 'C retomou a pergunta 2 em andamento');
  const hostC = listen(BASE_C, 'host', c.hostToken);
  await waitFor(() => hostC.last, 5000, 'estado em C');
  ok(hostC.last.status === 'question' && hostC.last.endsAt === endsB, 'C mantém o mesmo horário de fim da pergunta');
  await waitFor(() => hostC.last && hostC.last.status === 'reveal', 25000, 'revelação automática em C');
  ok(true, 'C revelou a pergunta 2 sozinho, no tempo certo');

  // 5) Pontuação preservada até o fim
  await api(BASE_C, '/api/host', { token: c.hostToken, action: 'end' });
  const anaEnd = listen(BASE_C, 'player', ana.token);
  await waitFor(() => anaEnd.last && anaEnd.last.status === 'end', 5000, 'fim em C');
  ok(typeof anaEnd.last.you.score === 'number' && anaEnd.last.you.score >= ganhoAna, `pontuação de Ana preservada no fim (${anaEnd.last.you.score} pts, ganhou ${ganhoAna} na 1ª)`);

  // limpeza
  anaEnd.close();
  hostC.close();
  hostB.close();
  anaB.close();
} catch (err) {
  log('ERRO:', err.message);
  process.exitCode = 1;
} finally {
  for (const s of [A, B, C]) if (s) s.kill('SIGTERM');
  // remove o documento de teste
  await new Firestore({ projectId: 'rafanonato1' }).collection('quiz').doc(GAME_DOC).delete().catch(() => {});
  log('fim do teste (documento de teste removido)');
  setTimeout(() => process.exit(process.exitCode || 0), 500);
}
