<p align="center">
  <img src="docs/logo.svg" alt="Worklio" width="96" height="96">
</p>

<h1 align="center">Worklio</h1>

<p align="center">
  <strong>Chat de equipe de código aberto que você mesmo hospeda.</strong><br>
  Canais, threads, chamadas e huddles, documentos compartilhados, quadros e IA, nos seus próprios servidores.
</p>

<p align="center">
  <a href="https://github.com/tanveersultan53/worklio/actions/workflows/ci.yml"><img src="https://github.com/tanveersultan53/worklio/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/tanveersultan53/worklio/releases"><img src="https://img.shields.io/github/v/release/tanveersultan53/worklio" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-007a5a" alt="MIT"></a>
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a> ·
  <a href="README.es.md">Español</a> ·
  <a href="README.fr.md">Français</a> ·
  <a href="README.de.md">Deutsch</a> ·
  <b>Português</b> ·
  <a href="README.ar.md">العربية</a> ·
  <a href="README.ur.md">اردو</a>
</p>

> Esta é uma tradução do README em inglês. Em caso de diferença, a [versão em inglês](README.md) prevalece.

<p align="center">
  <img src="docs/screenshots/walkthrough.gif" alt="Worklio" width="960">
</p>

## Por que criamos o Worklio

O chat de equipe virou o lugar onde as empresas trabalham. Mesmo assim, a maioria das equipes o aluga:

- **A conta cresce a cada contratação.** Chats hospedados costumam cobrar por pessoa, por mês. Contrate mais dez pessoas e a conta sobe, mesmo que nada mais mude.
- **Suas conversas ficam nos servidores de outra empresa.** Decisões, dados de clientes, planos e arquivos ficam no banco de dados de um fornecedor, sob as regras e na região dele.
- **Você fica preso.** Limites de histórico, restrições de exportação e recursos só nos planos mais caros dificultam a saída.
- **A IA vem com condições.** Recursos de IA costumam custar mais e enviam suas mensagens para serviços que você não escolheu.

O Worklio é a alternativa: um chat de equipe completo e moderno que **você mesmo opera**. Com licença MIT, você pode usar, modificar e expandir de graça, para sempre.

## O que muda quando você hospeda

| | Chat de equipe hospedado típico | Worklio |
|---|---|---|
| **Custo** | Uma taxa por pessoa, todo mês | Software gratuito; você paga só o servidor |
| **Onde ficam seus dados** | Na nuvem do fornecedor | Nos seus servidores, na sua região, com seus backups |
| **Histórico de mensagens** | Muitas vezes limitado nos planos básicos | Ilimitado; o banco de dados é seu |
| **Código-fonte** | Fechado | Aberto (MIT): leia, audite e altere tudo |
| **IA** | Custo extra, modelo escolhido pelo fornecedor | Use sua própria chave: Claude, Gemini ou DeepSeek |
| **Sair** | Exportações e migrações | Nada a deixar; já é seu |

**Um exemplo.** Com um preço de exemplo de US$ 10 por pessoa por mês, uma equipe de 50 pessoas paga **US$ 6.000 por ano**, e **US$ 12.000** quando chega a 100. O Worklio roda em um único servidor; com um custo de exemplo de US$ 40 por mês, são **US$ 480 por ano**, com 20 ou 200 pessoas. Seus números serão outros, mas a lógica é a mesma: chat hospedado cresce com o número de pessoas, o Worklio cresce com o seu hardware.

## O que você ganha

### Conversar: tudo organizado

Canais, mensagens diretas e threads, com reações, enquetes, mensagens fixadas, favoritos, envio agendado, comandos de barra e filtros de busca. Vá direto a qualquer mensagem, por mais antiga que seja.

![](docs/screenshots/channel.png)

### Reunir: chamadas que tocam e huddles para entrar quando quiser

Ligue para um colega ou comece um huddle em um canal. Compartilhe a tela e desenhe sobre ela, reaja, levante a mão, faça anotações que vão para a thread e leve o quadro branco ou o quadro de tarefas para o palco. As chamadas usam LiveKit dentro da sua própria instalação.

![](docs/screenshots/huddle.png)

### Criar: documentos, quadros e quadro branco ao lado do chat

Cada canal tem um documento que a equipe escreve em tempo real, um quadro com prioridades, etiquetas, prazos e visão em tabela, e um quadro branco compartilhado.

| | |
|---|---|
| ![](docs/screenshots/canvas.png) | ![](docs/screenshots/board.png) |

### Perguntar: IA que só vê o que você pode ver

Faça perguntas sobre seu espaço de trabalho e receba respostas com fontes, acompanhe canais movimentados, reescreva ou traduza mensagens e transforme threads em tarefas. O Worklio AI consulta com as mesmas permissões da busca, então nunca mostra uma mensagem que a pessoa não poderia abrir. Use sua própria chave Claude, Gemini ou DeepSeek, guardada com criptografia.

### Administrar: permissões e confiança

Funções (proprietário, administrador, membro, convidado), permissões aplicadas no servidor, links de convite, gestão de membros e um registro de auditoria de cada alteração sensível.

**[Ver as 46 telas com descrições →](docs/SCREENSHOTS.md)**

## Hospede em cinco minutos

Você precisa de Docker (com Compose), Node.js 22 e npm.

```bash
git clone https://github.com/tanveersultan53/worklio.git && cd worklio
cp .env.example .env
make up
cd frontend && npm install && npm run dev
```

Abra http://localhost:3000, crie uma conta e um espaço de trabalho e convide sua equipe em **Configurações do espaço de trabalho → Convites**.

Em produção, `docker-compose.prod.yml` roda tudo em um servidor. O guia passo a passo está em [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Seus dados, suas regras

- Tudo fica na sua infraestrutura: mensagens e arquivos no seu Postgres e no seu armazenamento compatível com S3, chamadas pelo seu próprio servidor LiveKit.
- O isolamento entre espaços de trabalho é aplicado no servidor em cada requisição.
- Sessões curtas, tokens de atualização rotativos e limite de tentativas de login.
- Chaves de IA ficam criptografadas e nunca são registradas nem exibidas de novo.

## Saiba mais

A referência técnica (serviços e portas, comandos, estrutura do projeto) está na documentação em inglês:

- [README (English)](README.md) · [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) · [docs/CONFIGURATION.md](docs/CONFIGURATION.md) · [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [CONTRIBUTING.md](CONTRIBUTING.md) · [GOVERNANCE.md](GOVERNANCE.md) · [SECURITY.md](SECURITY.md) · [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

## Licença

[MIT](LICENSE) © 2026 Muhammad Tanveer Sultan e os colaboradores do Worklio.

O Worklio é um projeto independente de código aberto. Não é afiliado, patrocinado nem endossado pela Slack Technologies, LLC ou pela Salesforce, Inc.
