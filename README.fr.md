<p align="center">
  <img src="docs/logo.svg" alt="Worklio" width="96" height="96">
</p>

<h1 align="center">Worklio</h1>

<p align="center">
  <strong>La messagerie d'équipe open source que vous hébergez vous-même.</strong><br>
  Canaux, fils de discussion, appels et réunions éclair, documents partagés, tableaux et IA, sur vos propres serveurs.
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
  <b>Français</b> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="README.pt-BR.md">Português</a> ·
  <a href="README.ar.md">العربية</a> ·
  <a href="README.ur.md">اردو</a>
</p>

> Ceci est une traduction du README anglais. En cas de différence, la [version anglaise](README.md) fait foi.

<p align="center">
  <img src="docs/screenshots/walkthrough.gif" alt="Worklio" width="960">
</p>

## Pourquoi nous avons créé Worklio

La messagerie d'équipe est devenue l'endroit où les entreprises travaillent. Pourtant, la plupart des équipes la louent :

- **La facture grimpe à chaque recrutement.** Les messageries hébergées sont généralement facturées par personne et par mois. Dix personnes de plus, et la facture augmente, même si rien d'autre ne change.
- **Vos conversations sont sur les serveurs de quelqu'un d'autre.** Décisions, données clients, plans et fichiers sont stockés dans la base d'un fournisseur, selon ses règles et dans sa région.
- **Vous êtes captif.** Limites d'historique, restrictions d'export et fonctions réservées aux offres supérieures rendent le départ difficile.
- **L'IA a ses conditions.** Les fonctions d'IA coûtent souvent plus cher et envoient vos messages à des services que vous n'avez pas choisis.

Worklio est l'alternative : une messagerie d'équipe complète et moderne que **vous exploitez vous-même**. Sous licence MIT, vous pouvez l'utiliser, la modifier et l'enrichir gratuitement, pour toujours.

## Ce qui change quand vous l'hébergez

| | Messagerie d'équipe hébergée classique | Worklio |
|---|---|---|
| **Coût** | Un tarif par personne, chaque mois | Logiciel gratuit ; vous ne payez que votre serveur |
| **Où sont vos données** | Dans le cloud du fournisseur | Sur vos serveurs, dans votre région, avec vos sauvegardes |
| **Historique des messages** | Souvent limité sur les petites offres | Illimité ; la base de données vous appartient |
| **Code source** | Fermé | Ouvert (MIT) : lisez, auditez et modifiez tout |
| **IA** | Coût supplémentaire, modèle imposé | Votre propre clé : Claude, Gemini ou DeepSeek |
| **Partir** | Exports et migrations | Rien à quitter : c'est déjà à vous |

**Un exemple.** À un prix d'exemple de 10 $ par personne et par mois, une équipe de 50 personnes paie **6 000 $ par an**, et **12 000 $** à 100 personnes. Worklio tourne sur un seul serveur ; à un coût d'exemple de 40 $ par mois, cela fait **480 $ par an**, que vous soyez 20 ou 200. Vos chiffres seront différents, mais la logique reste la même : une messagerie hébergée suit vos effectifs, Worklio suit votre matériel.

## Ce que vous obtenez

### Échanger : des conversations bien rangées

Canaux, messages directs et fils de discussion, avec réactions, sondages, épingles, signets, envois programmés, commandes slash et filtres de recherche. Accédez à n'importe quel message, même très ancien.

![](docs/screenshots/channel.png)

### Se réunir : des appels qui sonnent, des réunions éclair

Appelez un collègue ou lancez une réunion éclair dans un canal. Partagez votre écran et annotez-le, réagissez, levez la main, prenez des notes qui arrivent dans le fil, et mettez le tableau blanc ou le tableau des tâches à l'écran. Les appels passent par LiveKit, dans votre propre déploiement.

![](docs/screenshots/huddle.png)

### Créer : documents, tableaux et tableau blanc à côté du chat

Chaque canal dispose d'un document rédigé en temps réel par l'équipe, d'un tableau avec priorités, étiquettes, échéances et vue en tableau, et d'un tableau blanc partagé.

| | |
|---|---|
| ![](docs/screenshots/canvas.png) | ![](docs/screenshots/board.png) |

### Demander : une IA qui ne voit que ce que vous voyez

Posez des questions sur votre espace de travail et obtenez des réponses sourcées, faites le point sur les canaux chargés, reformulez ou traduisez des messages, transformez des fils en tâches. Worklio AI passe par les mêmes contrôles d'accès que la recherche : elle ne montre jamais un message que la personne ne pourrait pas ouvrir. Utilisez votre propre clé Claude, Gemini ou DeepSeek, stockée chiffrée.

### Administrer : droits et confiance

Rôles (propriétaire, administrateur, membre, invité), droits appliqués côté serveur, liens d'invitation, gestion des membres et journal d'audit de chaque modification sensible.

**[Voir les 46 écrans avec leurs descriptions →](docs/SCREENSHOTS.md)**

## Hébergez-le en cinq minutes

Il vous faut Docker (avec Compose), Node.js 22 et npm.

```bash
git clone https://github.com/tanveersultan53/worklio.git && cd worklio
cp .env.example .env
make up
cd frontend && npm install && npm run dev
```

Ouvrez http://localhost:3000, créez un compte et un espace de travail, puis invitez votre équipe depuis **Paramètres de l'espace de travail → Invitations**.

En production, `docker-compose.prod.yml` fait tourner l'ensemble sur un seul serveur. Le guide pas à pas se trouve dans [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Vos données, vos règles

- Tout reste sur votre infrastructure : messages et fichiers dans votre Postgres et votre stockage compatible S3, appels via votre propre serveur LiveKit.
- L'isolation entre espaces de travail est appliquée côté serveur à chaque requête.
- Sessions courtes, jetons de rafraîchissement renouvelés et limitation des tentatives de connexion.
- Les clés d'IA sont chiffrées, jamais journalisées ni réaffichées.

## En savoir plus

La référence technique (services et ports, commandes, structure du projet) est disponible en anglais :

- [README (English)](README.md) · [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) · [docs/CONFIGURATION.md](docs/CONFIGURATION.md) · [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [CONTRIBUTING.md](CONTRIBUTING.md) · [GOVERNANCE.md](GOVERNANCE.md) · [SECURITY.md](SECURITY.md) · [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

## Licence

[MIT](LICENSE) © 2026 Muhammad Tanveer Sultan et les contributeurs de Worklio.

Worklio est un projet open source indépendant. Il n'est ni affilié, ni parrainé, ni approuvé par Slack Technologies, LLC ou Salesforce, Inc.
