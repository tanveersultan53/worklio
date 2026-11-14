<p align="center">
  <img src="docs/logo.svg" alt="Worklio" width="96" height="96">
</p>

<h1 align="center">Worklio</h1>

<p align="center">
  <strong>직접 호스팅하는 오픈 소스 팀 채팅.</strong><br>
  채널, 스레드, 통화와 허들, 공유 문서, 보드, AI를 모두 여러분의 서버에서.
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
  <b>한국어</b> ·
  <a href="README.es.md">Español</a> ·
  <a href="README.fr.md">Français</a> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="README.pt-BR.md">Português</a> ·
  <a href="README.ar.md">العربية</a> ·
  <a href="README.ur.md">اردو</a>
</p>

> 이 문서는 영어 README의 번역본입니다. 내용이 다를 경우 [영어 원문](README.md)이 기준입니다.

<p align="center">
  <img src="docs/screenshots/walkthrough.gif" alt="Worklio" width="960">
</p>

## Worklio를 만든 이유

팀 채팅은 회사가 일하는 공간이 되었습니다. 그런데 대부분의 팀은 그것을 빌려 쓰고 있습니다.

- **인원이 늘수록 요금도 늘어납니다.** 호스팅형 채팅은 보통 1인당 월 요금입니다. 열 명을 더 뽑으면 다른 것이 그대로여도 요금이 오릅니다.
- **대화가 다른 회사의 서버에 있습니다.** 결정, 고객 정보, 계획, 파일이 공급업체의 정책과 지역 아래 그들의 데이터베이스에 저장됩니다.
- **떠나기 어렵습니다.** 기록 제한, 내보내기 제한, 상위 요금제 전용 기능 때문에 옮기기 어렵습니다.
- **AI에는 조건이 붙습니다.** AI 기능은 대개 추가 비용이 들고, 선택하지 않은 서비스로 메시지를 보냅니다.

Worklio는 그 대안입니다. 여러분이 **직접 운영하는** 완전하고 현대적인 팀 채팅이며, MIT 라이선스로 영원히 무료로 사용하고 수정하고 확장할 수 있습니다.

## 직접 호스팅하면 달라지는 것

| | 일반적인 호스팅형 팀 채팅 | Worklio |
|---|---|---|
| **비용** | 매월 1인당 요금 | 소프트웨어는 무료, 서버 비용만 부담 |
| **데이터 위치** | 공급업체의 클라우드 | 여러분의 서버, 지역, 백업 |
| **메시지 기록** | 하위 요금제에서 제한되는 경우가 많음 | 무제한, 데이터베이스는 여러분의 것 |
| **소스 코드** | 비공개 | 공개(MIT): 읽고, 감사하고, 수정 가능 |
| **AI** | 추가 비용, 모델은 공급업체가 선택 | 자체 키 사용: Claude, Gemini, DeepSeek |
| **이전** | 내보내기와 마이그레이션 | 필요 없음, 이미 여러분의 것 |

**예시.** 1인당 월 10달러라는 예시 가격이라면 50명 팀은 연 **6,000달러**, 100명이 되면 **12,000달러**를 냅니다. Worklio는 서버 한 대에서 실행되며, 예시로 월 40달러라면 연 **480달러**입니다. 20명이든 200명이든 같습니다. 실제 수치는 다르겠지만 원리는 같습니다. 호스팅형은 인원에 비례하고 Worklio는 하드웨어에 비례합니다.

## 제공되는 기능

### 대화: 정리된 커뮤니케이션

채널, DM, 스레드와 함께 리액션, 투표, 고정, 북마크, 예약 전송, 슬래시 명령, 검색 필터를 제공합니다. 아무리 오래된 메시지로도 바로 이동할 수 있습니다.

![](docs/screenshots/channel.png)

### 만남: 울리는 통화, 언제든 참여하는 허들

동료에게 전화를 걸거나 채널에서 허들을 시작하세요. 화면을 공유하고 그 위에 그리기, 리액션, 손 들기, 스레드에 남는 메모, 화이트보드나 보드를 무대로 가져오기까지. 통화는 여러분의 배포 안에서 LiveKit으로 동작합니다.

![](docs/screenshots/huddle.png)

### 만들기: 채팅 옆의 문서, 보드, 화이트보드

모든 채널에 팀이 실시간으로 함께 쓰는 캔버스, 우선순위·라벨·마감일·표 보기를 갖춘 보드, 공유 화이트보드가 있습니다.

| | |
|---|---|
| ![](docs/screenshots/canvas.png) | ![](docs/screenshots/board.png) |

### 질문: 내가 볼 수 있는 것만 보는 AI

워크스페이스에 대해 질문하면 출처와 함께 답하고, 바쁜 채널을 요약하고, 메시지를 다시 쓰거나 번역하고, 스레드를 작업으로 만듭니다. Worklio AI는 검색과 같은 권한 검사를 거치므로 열어볼 수 없는 메시지를 절대 보여주지 않습니다. Claude, Gemini, DeepSeek 키를 직접 사용하며 키는 암호화되어 저장됩니다.

### 운영: 관리, 권한, 신뢰

역할(소유자, 관리자, 멤버, 게스트), 서버에서 강제되는 권한, 초대 링크, 멤버 관리, 모든 중요한 변경을 기록하는 감사 로그.

**[설명과 함께 46개 화면 모두 보기 →](docs/SCREENSHOTS.md)**

## 5분 만에 직접 호스팅

Docker(Compose 포함), Node.js 22, npm이 필요합니다.

```bash
git clone https://github.com/tanveersultan53/worklio.git && cd worklio
cp .env.example .env
make up
cd frontend && npm install && npm run dev
```

http://localhost:3000 을 열고 계정과 워크스페이스를 만든 뒤 **워크스페이스 설정 → 초대**에서 팀을 초대하세요.

프로덕션에서는 `docker-compose.prod.yml`로 서버 한 대에서 전체 스택을 실행합니다. 단계별 안내는 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)를 참고하세요.

## 여러분의 데이터, 여러분의 규칙

- 모든 것이 여러분의 인프라에 남습니다. 메시지와 파일은 여러분의 Postgres와 S3 호환 스토리지에, 통화는 여러분의 LiveKit 서버를 거칩니다.
- 모든 요청에서 테넌트 격리가 서버에서 강제됩니다.
- 짧은 세션, 교체되는 리프레시 토큰, 로그인 속도 제한.
- AI 키는 암호화되어 저장되며 로그에 남거나 다시 표시되지 않습니다.

## 더 알아보기

기술 참고 자료(서비스와 포트, 명령어, 프로젝트 구조)는 영어 문서를 참고하세요:

- [README (English)](README.md) · [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) · [docs/CONFIGURATION.md](docs/CONFIGURATION.md) · [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [CONTRIBUTING.md](CONTRIBUTING.md) · [GOVERNANCE.md](GOVERNANCE.md) · [SECURITY.md](SECURITY.md) · [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

## 라이선스

[MIT](LICENSE) © 2026 Muhammad Tanveer Sultan 및 Worklio 기여자.

Worklio는 독립적인 오픈 소스 프로젝트이며 Slack Technologies, LLC 또는 Salesforce, Inc.와 제휴, 후원 또는 보증 관계가 없습니다.
