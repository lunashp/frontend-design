# Component Explorer

기존 **React + TypeScript 프로젝트를 읽어(읽기 전용)** 디자인 컴포넌트를 자동으로 분류·시각화하고, 원하는 컴포넌트를 **이식 가능한 형태로 복사**한 뒤, 새 프로젝트에서 **색상·크기를 실시간으로 재커스텀**할 수 있게 해주는 도구입니다. (Storybook + 코드 하베스터를 합친 개념)

> **핵심 원칙: 대상 프로젝트는 절대 수정하지 않습니다.** 소스를 읽기만 하고, 모든 변형은 이 도구 자신의 워크스페이스(`.workspace/`)에서만 일어납니다. 대상의 dev 서버도 실행하지 않습니다.

---

## 무엇을 할 수 있나요

1. **프로젝트 분석** — 대상 프로젝트의 UI 컴포넌트를 자동으로 찾아 **원자적 분류**(atom / molecule / organism / page)와 **종류**(presentational / container / layout)로 나눕니다.
2. **격리 렌더링** — 추출한 컴포넌트를 host가 **esbuild로 로컬 번들**(외부 CDN 없이 대상의 `node_modules`에 대해)한 뒤, 원본과 분리된 **샌드박스 iframe**에서 실제로 렌더링해 눈으로 확인합니다.
3. **이식 가능한 코드 복사** — 컴포넌트와 그 로컬 의존성을 **자립형 번들**로 묶고(import 경로 자동 재작성), 필요한 npm 패키지 목록과 함께 복사합니다.
4. **실시간 커스텀** — 추출된 **디자인 토큰**(색상·radius·폰트 크기·간격)과 props를 편집하면 미리보기가 즉시 재테마됩니다. 옮겨진 코드는 CSS 변수 토큰을 사용하므로 **새 프로젝트에서도 계속 재테마 가능**합니다.

---

## 아키텍처 한눈에 보기

브라우저는 디스크를 읽을 수 없으므로, 무거운 분석(ts-morph 등)은 반드시 **로컬 Node 백엔드**에서 돕니다.

```
[대상 프로젝트]                [이 도구]                          [브라우저]
../backoffice-frontend   →   @ce/host (localhost Node 서버)  ⇄   @ce/web (갤러리 UI)
(디스크 경로, 읽기 전용)        ├ @ce/core 엔진 실행                 └ 컴포넌트를 esbuild 번들
                              │ (필요 소스를 .workspace/ 로 복사)     로 만든 샌드박스 iframe에 렌더
                              └ esbuild로 미리보기 HTML 번들
```

host는 API(스캔·아티팩트·미리보기)와 **빌드된 갤러리(`packages/web/dist`)를 한 포트에서 함께 서빙**합니다. 즉 host 하나만 띄우면 제품이 돕니다(두 번째 dev 서버 불필요).

**모노레포(pnpm) 구성:**

| 패키지                    | 역할                                                                              |
| ------------------------- | --------------------------------------------------------------------------------- |
| `@ce/core`                | 프레임워크 무관 엔진. 스캔 → 분류 → 이식성 → 토큰화. 직렬화 가능한 스펙만 내보내며 **미리보기 라이브러리를 import하지 않음** |
| `@ce/host`                | `@ce/core`를 감싸는 로컬 HTTP + WebSocket 서버(읽기 전용 접근). 미리보기를 **esbuild로 번들**하고 빌드된 갤러리를 서빙 |
| `@ce/web`                 | Vite + React 갤러리 UI. host와 JSON API로만 통신                                  |
| `component-explorer-mcp`  | 에이전트용 MCP 서버(`packages/mcp`, **구현 완료**). 같은 엔진을 `scan_project`/`list_components`/`get_portable_code`/`customize_component` 4개 도구로 노출 |

---

## 요구 사항

- **Node.js 20.11 이상**
- **pnpm 10 이상** (`npm i -g pnpm`)
- 분석할 **대상 프로젝트**는:
  - React + TypeScript 프로젝트여야 하고
  - **같은 머신**에 있어야 하며
  - `node_modules`가 설치되어 있어야 합니다 (외부 의존성·버전 해석용)

---

## 빠른 시작

### 1. 설치

```bash
cd /Users/luna/workspace/frontend-design
pnpm install
```

### 2. 갤러리 빌드

host가 정적으로 서빙할 갤러리를 한 번 빌드합니다.

```bash
pnpm --filter @ce/web build
# → packages/web/dist 생성
```

### 3. 실행 (명령 1개)

host 하나가 API와 빌드된 갤러리를 **같은 포트**에서 서빙합니다. 분석할 대상 프로젝트 경로를 지정해 실행하세요.

```bash
pnpm --filter @ce/host start -- --project ../backoffice-frontend
# → http://localhost:4317 (포트가 사용 중이면 자동으로 다음 포트로 넘어감)
```

브라우저에서 host가 출력한 주소(기본 **http://localhost:4317**)를 열면 됩니다. `--project`로 지정한 프로젝트가 자동으로 스캔됩니다.

> 💡 `backoffice-frontend`(Vite + Tailwind, 클라이언트 컴포넌트)가 렌더링이 가장 잘 됩니다. Next.js(app router) 프로젝트는 서버 컴포넌트(RSC)가 많아 일부는 "code-only"로 표시됩니다.

> **갤러리 UI를 직접 개발할 때(두 개의 dev 서버)**: 터미널 1에서 `pnpm --filter @ce/host dev -- --project ../backoffice-frontend`(API, :4317), 터미널 2에서 `pnpm --filter @ce/web dev`(Vite, :5173 — `/api`·`/ws`를 :4317로 프록시)를 띄우고 **http://localhost:5173** 를 엽니다. 이때 host는 프록시 대상이 고정이라 `:4317`에 있어야 합니다.

### host 실행 옵션

```bash
pnpm --filter @ce/host start -- --project <경로> [--port 4317] [--workspace <워크스페이스 경로>]
```

| 옵션          | 설명                                              | 기본값             |
| ------------- | ------------------------------------------------- | ------------------ |
| `--project`   | 분석할 대상 프로젝트 경로 (첫 인자로도 전달 가능) | (없으면 UI에서 입력) |
| `--port`      | host 서버 시작 포트 (사용 중이면 다음 포트로 폴백) | `4317`             |
| `--workspace` | 소스 복사본이 저장될 워크스페이스 디렉터리        | `<cwd>/.workspace` |

UI 상단 좌측의 **Target project** 입력란에 다른 프로젝트의 절대경로를 넣고 **Scan project**를 눌러 대상을 바꿀 수도 있습니다.

---

## 사용법

컴포넌트 카드를 클릭하면 우측 **인스펙터**가 열리고, 4개의 탭을 쓸 수 있습니다.

### 갤러리 화면

- **분류 색상 = 의미** — atom(청록) / molecule(초록) / organism(호박) / page(자홍)로 색이 다릅니다.
- **Context load 게이지** — 각 카드의 "컨텍스트 부하"는 그 컴포넌트를 격리해서 렌더링하기가 얼마나 쉬운지를 나타냅니다. 낮을수록(비어 있을수록) 깔끔하게 렌더링됩니다.
- **필터** — 이름/경로 검색, 원자 레벨·종류 필터, "Presentational only"(가장 안정적으로 렌더되는 것만) 토글.

### 1) Details 탭

컴포넌트의 소스 경로, export 형태, 원자 레벨, context load, 그리고 **props 표**(타입·기본값·설명·컨트롤 종류)를 보여줍니다.

### 2) Preview 탭

추출한 컴포넌트를 host가 **esbuild로 번들**해 **격리된 샌드박스 iframe**에서 실제로 렌더링합니다(외부 CDN 없음).

- **Isolated render**(초록): 앱 컨텍스트 없이 깔끔하게 렌더링됨
- **Stubbed render**(호박): 앱 컨텍스트가 필요해 프로바이더 없이 렌더 — 어색할 수 있음
- **Code only**(빨강): 샌드박스에서 실행 불가(예: `next` 의존, `workspace:` 버전) — 코드만 제공

### 3) Portable 탭

**복사해서 다른 프로젝트에 붙여넣을 자립형 번들**입니다.

- 파일 탭으로 번들 내 각 파일을 열람 (import 경로가 이미 상대경로로 재작성되어 있음)
- **Copy file** / **Copy all files** 버튼으로 복사
- **Install in the destination project** — 필요한 `npm install ...` 명령을 복사
- 아래 **Preview of the copied code** — 복사될 코드가 실제로 동작하는지 별도 미리보기로 확인

### 4) Customize 탭

**실시간 재테마**를 합니다.

- **Colors / Radius / Font size / Spacing** — CSS(모듈)에서 추출된 디자인 토큰. 색상은 스와치·hex 입력으로, 나머지는 값 입력으로 편집 → 위 미리보기가 즉시 갱신됩니다.
- **Props** — enum(드롭다운)·boolean·number·color·string props를 실시간으로 바꿔봅니다.
- **Copy themed tokens.css** — 편집한 값이 반영된 `tokens.css`를 복사.
- 토큰 편집은 **`tokens.css`만** 바꾸고 컴포넌트 본문은 `var(--token, 기본값)` 참조를 유지하므로, **복사한 코드는 새 프로젝트에서도 계속 재테마 가능**합니다.

> Emotion 같은 CSS-in-JS나 인라인 스타일은 자동 토큰화가 어려워 스타일을 그대로 이식하고, 대신 **props**로 커스텀합니다. Tailwind / CSS Modules / 일반 CSS는 토큰화가 잘 됩니다.

---

## 프로젝트 구조

```
frontend-design/
├─ packages/
│  ├─ core/                 # @ce/core — 엔진 (Node, 프레임워크 무관)
│  │  ├─ src/
│  │  │  ├─ types/          # ComponentArtifact 등 계약(타입)
│  │  │  ├─ project/        # 프로젝트 로드 + tsconfig 별칭 해석
│  │  │  ├─ scanner/ classify/   # 컴포넌트 탐색 + 분류
│  │  │  ├─ graph/ portability/  # import 그래프 + 이식성 번들
│  │  │  ├─ tokenize/       # 스타일 → 디자인 토큰 (postcss + culori)
│  │  │  ├─ sandbox/        # 미리보기 스펙 조립 (엔트리/샘플 props; host의 esbuild가 소비)
│  │  │  ├─ adapters/react/ # React 어댑터 (ts-morph + react-docgen)
│  │  │  ├─ pipeline/       # EngineSession (scan / buildArtifact)
│  │  │  └─ util/           # fs-readonly, workspace 가드
│  │  └─ test/              # 유닛/통합 테스트 + 픽스처 프로젝트
│  ├─ host/                 # @ce/host — HTTP + WS 서버
│  ├─ web/                  # @ce/web — Vite + React 갤러리
│  │  └─ src/features/      # scan / gallery / inspector / preview / portable / customize
│  └─ mcp/                  # component-explorer-mcp — 에이전트용 MCP 서버 (구현 완료)
├─ .github/workflows/ci.yml # CI (install → typecheck → test)
├─ turbo.json  pnpm-workspace.yaml  tsconfig.base.json  vitest.config.ts
└─ README.md
```

---

## 개발 명령어

| 명령                | 설명                                        |
| ------------------- | ------------------------------------------- |
| `pnpm test`         | 전체 테스트 실행 (vitest)                   |
| `pnpm test:watch`   | 감시 모드 테스트                            |
| `pnpm test --coverage` 또는 `pnpm exec vitest run --coverage` | 커버리지 (엔진 80% 게이트) |
| `pnpm typecheck`    | 전 패키지 타입체크                          |
| `pnpm lint`         | 전 패키지 린트 (Biome; turbo가 각 패키지로 팬아웃) |
| `pnpm build`        | 전 패키지 빌드 (turbo)                      |
| `pnpm --filter @ce/web build` | 웹 프로덕션 빌드                  |

현재 상태: **79개 테스트 통과 / 커버리지 92.6% 라인·81% 브랜치**.

---

## 동작 원리 (요약)

- **탐색**: `ts-morph`로 export된 PascalCase + JSX를 가진 컴포넌트를 찾습니다. 배럴(index.ts) 재-export는 원본까지 관통해 중복을 방지합니다.
- **props**: `react-docgen-typescript`로 타입·enum 옵션·기본값·JSDoc을 추출하고, DOM 상속 props는 걸러냅니다.
- **분류**: hook/router/store/context 사용 등 구조 신호로 원자 레벨·종류·context 점수를 순수 함수로 판정합니다.
- **이식성**: 컴포넌트의 로컬 import 서브트리를 `/src` 아래로 미러링하고, 별칭·상대 import를 번들 상대경로로 재작성, 외부 npm 의존성은 버전과 함께 수집합니다.
- **토큰화**: `postcss`로 CSS를 파싱, `culori`로 색을 정규화·중복 제거해 `var(--token, 기본값)`으로 바꾸고 `tokens.css`를 방출합니다.
- **렌더링**: 엔진은 직렬화 가능한 미리보기 스펙만 내보내고, host가 이를 **esbuild**로 대상 프로젝트의 `node_modules`에 대해 번들해 자립형 미리보기 HTML을 만든 뒤, 웹이 그 HTML을 **샌드박스 iframe**으로 띄웁니다(외부 CDN·codesandbox.io 불필요).

---

## 로드맵

- ✅ **P0–P4 (1차 범위) 완료** — 웹 갤러리(스캔·분류·렌더·이식·커스텀) 전체.
- ✅ **P5 — MCP 서버 완료** — 같은 엔진(`EngineSession`)을 `component-explorer-mcp`로 감싸, 에이전트용 MCP 도구(`scan_project` / `list_components` / `get_portable_code` / `customize_component`)로 노출합니다. 엔진이 이미 transport-무관이라 얇은 어댑터로 구현됐습니다.
- 향후: 컨텍스트 프로바이더 스텁(`provider-stubs.ts`) 보강, 에셋 인라인, Vue 등 프레임워크 어댑터 추가.

---

## 참고

- 이 워크스페이스는 **git 저장소**입니다. `.gitignore`와 CI 워크플로우(`.github/workflows/ci.yml`)가 준비되어 있습니다.
- 브라우저 자동화 확장(Playwright/claude-in-chrome)이 이 환경엔 연결돼 있지 않아, 개발 중 시각 검증은 headless `playwright`로 진행했습니다.
- 대상이 pnpm 모노레포라 내부 패키지가 `workspace:*`로 고정돼 있으면, 그 패키지를 쓰는 컴포넌트는 esbuild가 `node_modules`에서 해석할 수 없어 "code-only"로 표시됩니다(의도된 안전 동작).
