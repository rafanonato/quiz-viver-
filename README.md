# Quiz ao vivo (estilo Kahoot)

Quiz em tempo real para até 100 participantes, rodando no seu computador. Sem plataforma paga e sem dependências (só Node.js).

## Antes da apresentação (faça hoje)

1. Tenha o **Node.js** instalado (`node -v` no terminal).
2. Teste uma vez: `node server.js` e abra `http://localhost:3000/host.html`.
3. Teste também num celular, usando o endereço que aparece no terminal (`http://192.168.x.x:3000`).

## No dia

1. Conecte o computador do apresentador e os celulares **no mesmo Wi-Fi**.
   Se o Wi-Fi do local for ruim ou tiver isolamento de clientes, use o **hotspot do celular do apresentador** e conecte o computador e os participantes nele.
2. No terminal, dentro da pasta `kahoot`: `node server.js`
3. No computador do apresentador, abra `http://localhost:3000/host.html` e clique em **Criar novo jogo**.
4. Projete a tela. Os participantes veem o endereço e o **PIN** no lobby.
5. Participantes abrem o endereço no celular, digitam o PIN e um apelido.
6. Quando todos entrarem, clique em **Começar**.
7. Fluxo de cada pergunta: pergunta com timer → **Revelar** (ou automático quando todos respondem ou o tempo acaba) → **Ver ranking** (opcional) → **Próxima pergunta**.

## QR code e temas

- No lobby do apresentador aparece um QR code. Quem escaneia já cai na página com o PIN preenchido.
- Cada pergunta tem um `theme` (ex.: `coracao`, `dna`, `comida`). O fundo é o SVG correspondente em `public/themes/`. Para criar um tema novo, adicione um SVG nessa pasta e use o nome dele no `theme`.

## Deploy no Cloud Run (próxima fase, ainda não feito)

Pontos que precisam ser respeitados, porque o estado do jogo fica na memória do servidor:

- Use **uma única instância** (`--max-instances=1`) e mantenha **uma sempre ligada** (`--min-instances=1`), senão o jogo se perde se o servidor reiniciar ou escalar.
- Use **CPU sempre alocada** (`--no-cpu-throttling`), porque os timers e as conexões em tempo real dependem do processo estar ativo.
- Defina `PUBLIC_URL` com a URL do serviço (ex.: `https://quiz-xxxx.a.run.app`), para que o QR code aponte para o endereço público e não para um IP interno.
- `--timeout=3600` para as conexões em tempo real não caírem cedo.

## Editar as perguntas

Tudo fica em `questions.json`. Cada pergunta tem:

- `text`: o enunciado
- `options`: as alternativas (2 a 4)
- `correct`: índice da correta, começando em 0
- `time`: segundos para responder

O servidor precisa ser reiniciado depois de editar o arquivo (Ctrl+C e `node server.js`).

## Pontuação

Resposta correta vale de 1000 pontos (resposta imediata) até 500 (no último segundo). Erro vale 0.

## Problemas comuns

- **Participante não consegue entrar:** confira se o celular está no mesmo Wi-Fi. Teste com o endereço exato que o terminal mostra.
- **"Já existe um jogo em andamento":** só é possível criar um jogo novo depois que o anterior foi encerrado. Se o apresentador perdeu o painel com jogadores no lobby, reinicie o `node server.js`.
- **Apresentador fechou a aba:** basta reabrir `host.html`. O jogo continua de onde estava.
- **Participante ficou sem conexão:** ele reabre a página, e a sessão é recuperada automaticamente.
