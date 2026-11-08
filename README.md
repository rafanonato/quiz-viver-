# Quiz ao vivo (estilo Kahoot)

Quiz em tempo real para até 100 participantes. Cada participante responde pelo celular, o apresentador controla o jogo pelo computador e o ranking aparece ao vivo. Não depende de plataforma paga: o código roda em Node.js e pode ser publicado no Google Cloud Run.

- Repositório: https://github.com/rafanonato/quiz-viver-
- Projeto GCP: `rafanonato1` · Região: `us-central1`

---

## Status

| Item | Situação |
|---|---|
| Jogo local (lobby, perguntas, ranking, pódio) | Pronto e testado |
| QR code no lobby | Pronto |
| Fundo temático por pergunta | Pronto (12 temas) |
| Painel `/admin.html` para editar perguntas, respostas, correta, tempo e tema | Pronto e testado |
| Repositório no GitHub | Publicado (`main`) |
| Testes em produção | Simulação de 50 participantes e painel (leitura, edição e restauração) passaram |
| Deploy no Cloud Run | **No ar**: https://quiz-viver-lw2pi32efa-uc.a.run.app (revisão `quiz-viver-00005-z4g`) |
| Versão atual | Commit com resiliência do jogo (ver seção **Resiliência**). Tag `v1.1.0` criada no mesmo commit. A `v1.0.0` continua disponível para rollback |
| Evento de 08/11 | Concluído com sucesso (palestra com todos os participantes) |
| Resiliência do jogo | Estado salvo no Firestore a cada mudança; se a instância cair, o jogo é retomado |
| Deploy automático pelo GitHub Actions | Ativo: cada push na `main` faz o deploy |

---

## Como usar no dia (versão online)

A URL pública do serviço é **https://quiz-viver-lw2pi32efa-uc.a.run.app** e funciona de qualquer rede. Os participantes não precisam estar no mesmo Wi-Fi.

1. **Apresentador:** abra `https://<URL>/host.html` no computador e clique em **Criar novo jogo**.
2. **Projetar a tela:** o lobby mostra o QR code, o endereço e o **PIN**.
3. **Participantes:** escaneiam o QR code (já abre com o PIN preenchido) ou digitam o endereço e o PIN, e escolhem um apelido. Nomes repetidos ganham um número (`Ana 2`).
4. **Começar:** quando todos entrarem, clique em **Começar**.
5. **Cada pergunta:**
   - aparece com o timer e o fundo do tema;
   - a revelação acontece sozinha quando todos respondem ou quando o tempo acaba, ou o apresentador pode clicar em **Revelar resposta agora**;
   - depois, **Ver ranking** (opcional) e **Próxima pergunta**;
   - na última pergunta o botão vira **Ver pódio final**.
6. **Pódio final:** depois da última pergunta, clique em **Ver pódio final**. O pódio aparece **só na tela do apresentador**. Os participantes veem a mensagem "Olhe para a tela do apresentador…", sem ranking, para manter o suspense.

### Suspense durante o jogo

Durante o jogo, o participante **não vê a posição nem a pontuação total**. Ele vê só se acertou, quantos pontos ganhou na pergunta e a resposta certa. Esses dados não são enviados ao celular antes do fim do jogo, e não apenas escondidos na tela. A posição e o total aparecem só depois de **Finalizar jogo**.
   - Clique em **⬆ Revelar 3º lugar**. Cada clique (ou a tecla seta para cima) revela o próximo: 3º, depois 2º e por último 1º, com confete. Não há tempo automático: você controla o ritmo.
   - Depois que o 1º lugar aparecer, clique em **Finalizar jogo**. Só então os participantes veem a posição final e o top 10.
   - Enquanto o jogo estiver no pódio com jogadores, não é possível criar outro jogo. Finalize antes.

Se o apresentador fechar a aba, basta reabrir `host.html`: o jogo continua de onde estava. Se um participante perder a conexão, ele reabre a página e volta ao jogo.

### Pontuação

Resposta correta vale de **1000 pontos** (respondida no início do tempo) até **500 pontos** (no último instante). Resposta errada ou não respondida vale 0.

---

## Editar perguntas, respostas, correta, tempo e tema

Acesse **`/admin.html`** (ou pelo link **Editar perguntas e tempos** na tela inicial do apresentador).

1. Digite a senha do painel. Ela fica guardada só na sessão do navegador (fecha ao fechar a aba).
2. Para cada pergunta você edita:
   - **Enunciado** (até 300 caracteres);
   - **Respostas** (de 2 a 4; use `+ resposta` e `×` para ajustar);
   - **Resposta correta** (marque o círculo);
   - **Tempo (s)** entre 5 e 120 segundos;
   - **Tema** do fundo (com miniatura para conferir).
3. Use **↑** e **↓** para reordenar e **Remover** para apagar.
4. **+ Adicionar pergunta** cria uma nova no fim da lista.
5. Clique em **Salvar alterações**. O servidor valida tudo antes de gravar: se algo estiver errado, ele mostra a mensagem indicando a pergunta e o problema, e nada é salvo.

**Regras importantes:**

- Alterações valem para os **jogos criados depois de salvar**. Um jogo em andamento continua com as perguntas que tinha ao ser criado.
- No ambiente online, as perguntas ficam no **Firestore**, então sobrevivem a reinícios e novos deploys.
- Antes do evento, faça uma revisão no painel. Quatro respostas corretas foram inferidas do conteúdo (ver "Pendências de conteúdo" abaixo).

### Editar pelo arquivo (modo local)

Sem `STORAGE=firestore`, o painel grava no arquivo `questions.json`. O formato é:

```json
{
  "text": "Pergunta",
  "options": ["Resposta A", "Resposta B", "Resposta C"],
  "correct": 1,
  "time": 20,
  "theme": "coracao"
}
```

`correct` começa em 0. Se você editar o arquivo à mão, reinicie o servidor.

---

## Temas visuais

Cada pergunta usa um SVG da pasta `public/themes/` como fundo:

`vida`, `coracao`, `dna`, `exames`, `estresse`, `ecg`, `comida`, `treino`, `peixe`, `sono`, `cafe`, `programa` (padrão, também usado no lobby).

Para criar um tema novo, coloque um arquivo `nome.svg` nessa pasta. Ele aparece automaticamente no seletor do painel. Os SVGs foram desenhados para este projeto (sem direitos de terceiros). Para trocar por fotos, basta substituir os arquivos mantendo o mesmo nome.

---

## Pendências de conteúdo (revisar antes do evento)

O PDF original marca a resposta correta com "(X)", mas quatro perguntas não tinham marcação. Escolhi a resposta pelo conteúdo:

| Pergunta | Resposta usada | Motivo |
|---|---|---|
| 6 (sistema nervoso autônomo) | VFC / HRV | Indicador clássico de resiliência ao estresse |
| 18 (O que é o Viver+) | "Todas as anteriores" | Opções 1 a 3 descrevem partes do programa |
| 19 (por que ingressar) | Opção 3 (entender a saúde e agir de forma preditiva) | A opção 4 é claramente falsa |
| 20 (como acompanhar) | "Todas as anteriores" | Cada opção é uma forma de acompanhamento |

Também vale revisar a pergunta 21: a opção "Não quero viver mais" é uma das alternativas, e a correta é a do "desconto especial". Confirme se esse tom é o que você quer apresentar.

---

## Rodar localmente

Requisitos: Node.js 20 ou superior.

```bash
cd kahoot
npm install
node server.js
```

O terminal mostra os endereços:

- Apresentador: `http://localhost:3000/host.html`
- Participantes (mesma rede): `http://<IP-do-seu-computador>:3000`
- Painel de perguntas: `http://localhost:3000/admin.html`

Para o painel funcionar localmente, defina a senha:

```bash
ADMIN_PASSWORD=sua-senha node server.js
```

Sem `ADMIN_PASSWORD`, o painel fica desativado (a API responde 503).

---

## Configuração (variáveis de ambiente)

| Variável | Padrão | Para que serve |
|---|---|---|
| `PORT` | `3000` (o Cloud Run define `8080`) | Porta do servidor |
| `ADMIN_PASSWORD` | vazio | Senha do painel `/admin.html`. Sem ela, o painel fica desativado |
| `STORAGE` | local | `firestore` para salvar perguntas e o estado do jogo no Firestore (produção) |
| `GAME_DOC` | `activeGame` | Nome do documento que guarda o jogo em andamento (usado em testes) |
| `PUBLIC_URL` | vazio | URL pública usada no QR code. Se vazia, o servidor usa o endereço pelo qual o apresentador acessou |

Limites fixos no código: 100 participantes por jogo, até 60 perguntas, 2 a 4 respostas por pergunta.

---

## Deploy no Google Cloud Run

### Arquitetura

- **Cloud Run** roda o servidor (uma imagem Docker construída a partir do `Dockerfile`).
- **Firestore** guarda as perguntas editadas (`quiz/questions`).
- **Secret Manager** guarda a senha do painel (`quiz-admin-password`).
- **Conta de serviço `quiz-runtime`** acessa o Firestore e o segredo, sem chave JSON.
- **GitHub Actions** faz o deploy a cada push na `main`, usando **Workload Identity Federation** (sem chave JSON no GitHub). A conta `github-deployer` faz o deploy.

### Configuração de cada serviço

| Parâmetro | Valor | Motivo |
|---|---|---|
| Região | `us-central1` | Região dos EUA com preços de entrada |
| Instâncias | mín. 0, máx. 1 | Uma instância escreve o jogo por vez (controle de dono no Firestore) |
| Concorrência | 250 | Cada participante usa uma conexão aberta; 100 participantes + apresentador cabem |
| Timeout | 3600 s | As conexões em tempo real ficam abertas durante o evento |
| Memória / CPU | 512 MiB / 1 vCPU | Suficiente para 100 participantes |
| Acesso | público | Os participantes entram sem conta Google |

### Passo 1: vincular o faturamento (obrigatório)

O projeto `rafanonato1` ainda **não tem conta de faturamento vinculada**, e sem ela o Cloud Run e o Firestore não funcionam. A conta aberta disponível é `rafa-nonato-nutri` (ID `01D507-D9BB95-EDFA4E`).

```bash
gcloud billing projects link rafanonato1 --billing-account=01D507-D9BB95-EDFA4E
```

Pode ser feito também em Console → Faturamento → Vincular projeto.

### Passo 2: configuração inicial (uma vez)

```bash
gh auth status            # GitHub logado
gcloud auth login         # GCP logado
./scripts/gcp-setup.sh    # cria APIs, Firestore, contas, segredo, WIF e variáveis do GitHub
```

O script é idempotente: pode ser rodado de novo sem quebrar nada. Ao final ele define as variáveis do repositório (`GCP_PROJECT_ID`, `GCP_REGION`, `GCP_WIF_PROVIDER`, `GCP_DEPLOY_SA`), que não são segredos.

Para ler a senha do painel depois:

```bash
gcloud secrets versions access latest --secret=quiz-admin-password
```

### Passo 3: primeiro deploy (já feito)

Com a configuração pronta, um push na `main` dispara o workflow `.github/workflows/deploy.yml`:

```bash
git push origin main
gh run watch --repo rafanonato/quiz-viver-
```

Ao terminar, a URL do serviço aparece no log. Para consultar:

```bash
gcloud run services describe quiz-viver --region us-central1 --format='value(status.url)'
```

### Passo 4: checagem pós-deploy

1. `GET <URL>/api/info` deve devolver a própria URL pública.
2. Abra `<URL>/host.html`, crie um jogo e confira o QR code.
3. Abra `<URL>/admin.html` e entre com a senha do Secret Manager.
4. Rode uma simulação contra a URL pública (`BASE=<URL> node scripts/simulate.mjs` simula 50 participantes no endereço informado).

### Custo

O Cloud Run cobra pelo tempo de CPU e memória usados pelas requisições, e o plano de entrada costuma ficar em poucos dólares por mês para uso como este. O Firestore e o Secret Manager usam volumes mínimos. Confira a estimativa na calculadora de preços do Google Cloud antes do evento.

**Opção mais segura para o dia do evento:** defina `--min-instances 1` durante a apresentação, para o servidor não ser desligado por inatividade. Depois volte para `0`:

```bash
gcloud run services update quiz-viver --region us-central1 --min-instances 1   # antes do evento
gcloud run services update quiz-viver --region us-central1 --min-instances 0   # depois
```

Com `min-instances 0`, o servidor fica ativo enquanto o apresentador e os participantes estiverem conectados. Se todos saírem por mais de alguns minutos, ele pode ser desligado, e o jogo em andamento se perde. Por isso o `min-instances 1` é recomendado no dia.

### Trocar a senha do painel

```bash
openssl rand -base64 24 | gcloud secrets versions add quiz-admin-password --data-file=-
gcloud run services update quiz-viver --region us-central1 --update-secrets ADMIN_PASSWORD=quiz-admin-password:latest
```

---

## Versões e como voltar atrás

**Versão validada em produção:** `v1.0.0`, tag no GitHub apontando para o commit `7b100e8`. Os commits depois dela alteram só a documentação.

Para ver a versão no GitHub: `https://github.com/rafanonato/quiz-viver-/releases/tag/v1.0.0` (ou `git tag`).

**Revisões do Cloud Run:** `quiz-viver-00005-z4g` é a versão atual (pódio por cliques, suspense e retomada de participantes). Para voltar à versão anterior, use `quiz-viver-00002-nlm` (ou `-00001-gpf`), que correspondem à `v1.0.0`.

**Revisão do Cloud Run com a v1.0.0:** `quiz-viver-00001-gpf` (primeiro deploy) e `quiz-viver-00002-nlm` (atual, mesmo código).

### Opção 1: voltar o tráfego para uma revisão anterior (segundos)

```bash
gcloud run revisions list --service quiz-viver --region us-central1   # lista as revisões
gcloud run services update-traffic quiz-viver --region us-central1 --to-revisions quiz-viver-00001-gpf=100
```

Para voltar ao normal depois, use `--to-latest`.

### Opção 2: voltar o código e deixar o GitHub Actions fazer o deploy (minutos)

```bash
git checkout v1.0.0                  # ver o código da versão validada
git revert <commit>                  # desfaz um commit específico; depois git push origin main
```

Qualquer push na `main` dispara o deploy. Para republicar exatamente a `v1.0.0`, crie um commit que reverta para o estado da tag (`git checkout v1.0.0 -- .` seguido de commit e push).

**Atenção:** o rollback de código não desfaz as perguntas salvas. Elas ficam no Firestore e continuam as mesmas, a menos que você restaure pelo painel.

## Participante que saiu do jogo

- **Mesmo celular e navegador:** basta abrir de novo a página (ou o QR code). A sessão salva reconecta sozinha, com a pergunta atual e a pontuação.
- **Outro celular, aba anônima ou navegador limpo:** durante o jogo, digite o **mesmo PIN e o mesmo apelido** que usou antes (sem diferenciar maiúsculas e espaços). A posição e a pontuação são recuperadas.
- **Quem não estava no jogo:** não consegue entrar depois do início ("Esse jogo já começou").
- **Limitação:** o apelido é a única identificação. Quem souber o PIN e o apelido de outra pessoa pode assumir a vaga dela. Para o evento, isso é considerado baixo risco.

## Resiliência do jogo

Em produção (`STORAGE=firestore`), o estado do jogo é salvo no Firestore, no documento `quiz/activeGame`:

- **O que é salvo:** PIN, token do apresentador, status e pergunta atual, horário de início e fim do timer, a cópia das perguntas e, para cada participante, token, apelido, pontuação e resposta.
- **Quando:** a cada mudança (entrada, início, resposta, revelação, próxima pergunta, pódio e fim). O POST só responde depois que a gravação terminou, então uma resposta confirmada não se perde.
- **Recuperação:** ao iniciar, a instância assume o jogo salvo e o retoma. Se o timer de uma pergunta estava rodando, ele continua de onde parou; se o tempo acabou durante a queda, a resposta é revelada. Participantes e apresentador reconectam com os tokens que já têm.
- **Troca de instância:** cada instância tem um identificador de dono. Quando outra assume o jogo, a antiga percebe em até 5 segundos, para de atender e encerra as conexões, para que os clientes reconectem na nova.
- **Cliente:** só desiste de uma sessão quando o servidor responde 403. Falhas temporárias (429, 5xx, rede) são repetidas.

**Como testar:** `STORAGE=firestore GAME_DOC=test-x GOOGLE_CLOUD_PROJECT=<projeto> node scripts/resilience-test.mjs` (exige `gcloud auth application-default login`). O script sobe três instâncias e verifica troca de instância, cerco da instância antiga, reconexão, timer retomado e pontuação preservada.

**Limite:** a gravação é completa a cada mudança, então um jogo muito grande (100 participantes) custa algumas dezenas de KB por escrita. Para o tamanho atual, isso é tranquilo.

## Operação e solução de problemas

| Sintoma | O que fazer |
|---|---|
| Painel `/admin.html` responde "Senha incorreta" | Confira a senha no Secret Manager (comando acima) |
| Painel responde 503 "desativado" | `ADMIN_PASSWORD` não está definida no serviço |
| QR code aponta para endereço errado | Defina `PUBLIC_URL` com a URL do serviço e faça um novo deploy |
| "Já existe um jogo em andamento" | Encerre o jogo atual (botão **Encerrar jogo**) antes de criar outro |
| Jogo parou após uma queda do servidor | A instância nova retoma o jogo salvo. Conferir no log: `Jogo <PIN> retomado` |
| Participante não consegue entrar | Confira o PIN. Em rede local, confira se o celular está no mesmo Wi-Fi |
| Deploy falhou no GitHub Actions | Veja o log com `gh run view --log-failed`. Erro de permissão costuma indicar que o faturamento ou alguma API não está ativa |
| Logs do servidor | `gcloud run services logs read quiz-viver --region us-central1 --limit 100` |

---

## Limitações e cuidados

- **Um jogo por vez.** O jogo ativo fica salvo no documento `quiz/activeGame` do Firestore, e a instância em execução o mantém em memória. Por isso `max-instances` deve ser 1.
- **Sem autenticação dos participantes.** Qualquer pessoa com o PIN entra no jogo. Isso é intencional para o evento.
- **Painel protegido por senha simples.** Não há limite de tentativas de login. Use uma senha longa (a gerada pelo script já é).
- **Criação de jogo.** Qualquer pessoa com acesso à URL pode criar um jogo novo, mas só quando não há jogo em andamento com participantes. Durante o evento, mantenha o painel do apresentador aberto.
- **Participantes com conexão ruim** podem perder a resposta se o envio falhar. Eles precisam reabrir a página, e a sessão é recuperada, mas a resposta daquela pergunta não é reenviada.

---

## Estrutura do projeto

```
server.js            servidor (HTTP, tempo real, regras do jogo, API do painel)
store.js             leitura e gravação das perguntas (arquivo local ou Firestore)
questions.json       perguntas iniciais (semente)
public/
  index.html         tela do participante
  host.html          tela do apresentador
  admin.html         painel de edição de perguntas
  common.js, player.js, host.js, admin.js   scripts das telas
  style.css          estilos
  themes/*.svg       fundos temáticos
scripts/gcp-setup.sh configuração inicial do GCP (rodar uma vez)
.github/workflows/deploy.yml   deploy automático no Cloud Run
Dockerfile           imagem do Cloud Run
```
