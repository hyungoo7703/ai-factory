# AI Factory

> **로컬에서 돌아가는, 자가개선되는 AI 개발 공장.**
> Claude Code 위에 올라가는 워크플로우 엔진. git-native, worktree-isolated.

AI Factory는 *프로젝트별 git 저장소*를 공장 라인으로 활용합니다. AI가 코드를
짤 때마다 격리된 git worktree 안에서 작업하고, 머지 전에 다중 시각의 검증을
거치며, 모든 실행은 추후 분석할 수 있도록 trace로 기록됩니다.

```
my-project/                  ← 사용자 프로젝트 (각 폴더마다 .git)
├── .git/
├── .factory/                ← AI Factory가 만드는 디렉토리
│   ├── config.yaml
│   ├── lines/               ← 파이프라인 정의 (yaml)
│   ├── skills/              ← 도메인 지식 (md)
│   ├── intake/              ← 인덱싱된 문서 스냅샷
│   ├── runs/                ← 실행 trace + 산출물
│   ├── sandbox/             ← 격리된 worktree
│   └── memory.jsonl         ← 누적 telemetry
└── src/
```

## 핵심 가치

| 메커니즘 | 보호 대상 |
|--------|---------|
| **Worktree 격리** | AI가 본 working tree를 절대 만지지 못함 |
| **Negotiation Review** | 단일 LLM의 echo chamber 방지 |
| **Skill 동적 주입** | 도메인 지식을 `.md`로 주입, 코드 변경 없이 확장 |
| **Trace 기반 학습** | 모든 호출을 기록 → 시간이 갈수록 더 똑똑해짐 |
| **Budget Hard Cap** | 토큰/비용/시간이 폭발하지 않게 강제 |
| **Git-native 상태** | 별도 DB 없음. 작업 결과는 branch와 commit |

## 의존성

- **Node.js 20+**
- **git 2.30+** (worktree 지원)
- **[Claude Code](https://docs.claude.com/claude-code) CLI** — 인증된 상태로 PATH에 설치
- 대상 프로젝트는 git 저장소여야 함 (`git init`)

## 설치

```bash
git clone <this-repo> ai-factory
cd ai-factory
npm install
npm run build
npm link        # `factory` 명령을 글로벌로 노출
```

또는 npm 패키지로 출시되면:

```bash
npm install -g ai-factory
```

## Quick Start

```bash
# 1. 대상 프로젝트로 이동
cd ../my-project

# 2. .factory/ 초기화
factory init

# 3. (옵션) 요구사항 문서 ingest
factory intake docs/spec.pdf docs/api.docx

# 4. 사용 가능한 라인 확인
factory list

# 5. 라인 실행
factory run feature "결제 페이지 추가 — 카드, 계좌이체 지원"

# 6. 진행/결과 확인
factory status
factory insights
```

## 명령 요약

| 명령 | 설명 |
|------|------|
| `factory init` | `.factory/` 초기화 (config, lines, skills 시드) |
| `factory intake [paths...]` | 문서를 ingest → 검색 가능한 스냅샷 |
| `factory run <line> [input]` | 라인 실행 |
| `factory resume <runId>` | 멈춘 run 재개 |
| `factory status [runId]` | 실행 요약 보기 |
| `factory list` | 사용 가능한 라인/스킬 |
| `factory insights` | 누적 통계 (cost, pass rate, defect) |

## 동봉된 라인

- **`feature`** — 단일 기능 구현 (clarify → implement → review → gate)
- **`bugfix`** — 재현 → 수정 → 검증 → 게이트
- **`refactor`** — 동작 보존 리팩토링
- **`intake-only`** — 문서만 ingest

## 동봉된 스킬

- **`coding-style`** — TypeScript/JS 코드 스타일 (auto: ts/js 트리거)
- **`review-criteria`** — 리뷰 기준 + JSON verdict 형식
- **`security-auditor`** — OWASP Top 10 (auto: payment/auth 등 트리거)

## 문서

- [docs/getting-started.md](docs/getting-started.md) — 처음 사용 시 가이드
- [docs/architecture.md](docs/architecture.md) — 시스템 구조와 동작 원리
- [docs/concepts.md](docs/concepts.md) — Line, Station, Worktree, Skill 등 용어
- [docs/line-spec.md](docs/line-spec.md) — `.factory/lines/*.yaml` 스펙
- [docs/skills.md](docs/skills.md) — 스킬 작성법
- [docs/faq.md](docs/faq.md) — 자주 묻는 질문

## 라이선스

MIT — see [LICENSE](LICENSE)
