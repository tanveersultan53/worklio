<p align="center">
  <img src="docs/logo.svg" alt="Worklio" width="96" height="96">
</p>

<h1 align="center">Worklio</h1>

<p align="center">
  <strong>Open-Source-Teamchat, den Sie selbst hosten.</strong><br>
  Kanäle, Threads, Anrufe und Huddles, gemeinsame Dokumente, Boards und KI, auf Ihren eigenen Servern.
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
  <b>Deutsch</b> ·
  <a href="README.pt-BR.md">Português</a> ·
  <a href="README.ar.md">العربية</a> ·
  <a href="README.ur.md">اردو</a>
</p>

> Dies ist eine Übersetzung der englischen README. Bei Abweichungen gilt die [englische Fassung](README.md).

<p align="center">
  <img src="docs/screenshots/walkthrough.gif" alt="Worklio" width="960">
</p>

## Warum wir Worklio gebaut haben

Teamchat ist der Ort geworden, an dem Unternehmen arbeiten. Trotzdem mieten die meisten Teams ihn nur:

- **Die Rechnung wächst mit jeder Einstellung.** Gehosteter Chat wird meist pro Person und Monat abgerechnet. Zehn Leute mehr, und die Rechnung steigt, auch wenn sich sonst nichts ändert.
- **Ihre Gespräche liegen auf fremden Servern.** Entscheidungen, Kundendaten, Pläne und Dateien liegen in der Datenbank eines Anbieters, nach dessen Regeln und in dessen Region.
- **Sie sind gebunden.** Verlaufsgrenzen, Exportbeschränkungen und Funktionen nur für teurere Tarife erschweren den Wechsel.
- **KI hat Haken.** KI-Funktionen kosten oft extra und schicken Ihre Nachrichten an Dienste, die Sie nicht ausgewählt haben.

Worklio ist die Alternative: ein vollständiger, moderner Teamchat, den **Sie selbst betreiben**. Er steht unter der MIT-Lizenz: Sie können ihn kostenlos und dauerhaft nutzen, ändern und erweitern.

## Was sich ändert, wenn Sie selbst hosten

| | Typischer gehosteter Teamchat | Worklio |
|---|---|---|
| **Kosten** | Eine Gebühr pro Person, jeden Monat | Kostenlose Software; Sie zahlen nur Ihren Server |
| **Wo Ihre Daten liegen** | In der Cloud des Anbieters | Auf Ihren Servern, in Ihrer Region, mit Ihren Backups |
| **Nachrichtenverlauf** | In kleinen Tarifen oft begrenzt | Unbegrenzt; die Datenbank gehört Ihnen |
| **Quellcode** | Geschlossen | Offen (MIT): lesen, prüfen und ändern |
| **KI** | Aufpreis, Modell nach Wahl des Anbieters | Eigener Schlüssel: Claude, Gemini oder DeepSeek |
| **Wechsel** | Exporte und Migrationen | Nichts zu verlassen; es gehört Ihnen schon |

**Ein Beispiel.** Bei einem Beispielpreis von 10 USD pro Person und Monat zahlt ein Team mit 50 Personen **6.000 USD im Jahr**, bei 100 Personen **12.000 USD**. Worklio läuft auf einem einzigen Server; bei Beispielkosten von 40 USD im Monat sind das **480 USD im Jahr**, egal ob 20 oder 200 Personen. Ihre Zahlen werden abweichen, das Prinzip nicht: Gehosteter Chat wächst mit der Mitarbeiterzahl, Worklio mit Ihrer Hardware.

## Was Sie bekommen

### Sprechen: Gespräche mit Ordnung

Kanäle, Direktnachrichten und Threads mit Reaktionen, Umfragen, angehefteten Nachrichten, Lesezeichen, geplanten Nachrichten, Slash-Befehlen und Suchfiltern. Springen Sie zu jeder Nachricht, egal wie alt.

![](docs/screenshots/channel.png)

### Treffen: Anrufe, die klingeln, Huddles zum Dazustoßen

Rufen Sie eine Kollegin an oder starten Sie ein Huddle in einem Kanal. Teilen Sie Ihren Bildschirm und zeichnen Sie darauf, reagieren Sie, melden Sie sich, machen Sie Notizen, die im Thread landen, und holen Sie Whiteboard oder Board auf die Bühne. Anrufe laufen über LiveKit in Ihrer eigenen Installation.

![](docs/screenshots/huddle.png)

### Gestalten: Dokumente, Boards und Whiteboards neben dem Chat

Jeder Kanal hat ein Dokument, das das Team live gemeinsam schreibt, ein Board mit Prioritäten, Labels, Fälligkeiten und Tabellenansicht sowie ein gemeinsames Whiteboard.

| | |
|---|---|
| ![](docs/screenshots/canvas.png) | ![](docs/screenshots/board.png) |

### Fragen: KI, die nur sieht, was Sie sehen dürfen

Stellen Sie Fragen zu Ihrem Workspace und erhalten Sie Antworten mit Quellen, holen Sie in vollen Kanälen auf, formulieren oder übersetzen Sie Nachrichten und machen Sie aus Threads Aufgaben. Worklio AI nutzt dieselben Berechtigungsprüfungen wie die Suche und zeigt nie eine Nachricht, die jemand nicht öffnen dürfte. Nutzen Sie Ihren eigenen Claude-, Gemini- oder DeepSeek-Schlüssel, verschlüsselt gespeichert.

### Betreiben: Verwaltung, Berechtigungen und Vertrauen

Rollen (Eigentümer, Admin, Mitglied, Gast), serverseitig durchgesetzte Berechtigungen, Einladungslinks, Mitgliederverwaltung und ein Audit-Log jeder sensiblen Änderung.

**[Alle 46 Ansichten mit Beschreibungen ansehen →](docs/SCREENSHOTS.md)**

## In fünf Minuten selbst hosten

Sie brauchen Docker (mit Compose), Node.js 22 und npm.

```bash
git clone https://github.com/tanveersultan53/worklio.git && cd worklio
cp .env.example .env
make up
cd frontend && npm install && npm run dev
```

Öffnen Sie http://localhost:3000, legen Sie ein Konto und einen Workspace an und laden Sie Ihr Team unter **Workspace-Einstellungen → Einladungen** ein.

Für den Produktivbetrieb startet `docker-compose.prod.yml` alles auf einem Server. Die Schritt-für-Schritt-Anleitung steht in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Ihre Daten, Ihre Regeln

- Alles bleibt in Ihrer Infrastruktur: Nachrichten und Dateien in Ihrem Postgres und Ihrem S3-kompatiblen Speicher, Anrufe über Ihren eigenen LiveKit-Server.
- Die Trennung zwischen Workspaces wird bei jeder Anfrage serverseitig durchgesetzt.
- Kurzlebige Sitzungen mit rotierenden Refresh-Tokens und Begrenzung von Anmeldeversuchen.
- KI-Schlüssel werden verschlüsselt gespeichert, nie protokolliert und nie wieder angezeigt.

## Mehr erfahren

Die technische Referenz (Dienste und Ports, Befehle, Projektstruktur) finden Sie in der englischen Dokumentation:

- [README (English)](README.md) · [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) · [docs/CONFIGURATION.md](docs/CONFIGURATION.md) · [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [CONTRIBUTING.md](CONTRIBUTING.md) · [GOVERNANCE.md](GOVERNANCE.md) · [SECURITY.md](SECURITY.md) · [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

## Lizenz

[MIT](LICENSE) © 2026 Muhammad Tanveer Sultan und die Worklio-Mitwirkenden.

Worklio ist ein unabhängiges Open-Source-Projekt. Es ist nicht mit Slack Technologies, LLC oder Salesforce, Inc. verbunden und wird von diesen weder gesponsert noch unterstützt.
