# Getting Started

이 가이드는 AI Factory를 처음 쓰는 사람이 30분 안에 첫 라인을 돌릴 수 있게
설계됐습니다.

## 1. 사전 준비

다음 세 가지가 필요합니다.

### 1.1 Node.js 20 이상

```bash
node --version
# v20.x.x or higher
```

### 1.2 Claude Code CLI

설치 + 인증:

```bash
npm install -g @anthropic-ai/claude-code   # 또는 https://docs.claude.com/claude-code 안내
claude login
claude --version
```

`claude` 명령이 PATH에 보여야 합니다. (Windows에서는 cmd/PowerShell 둘 다 확인.)

### 1.3 git 저장소

대상 프로젝트는 반드시 git 저장소여야 합니다. 새 프로젝트라면:

```bash
mkdir my-project && cd my-project
git init
git commit --allow-empty -m "init"
```

## 2. AI Factory 설치

소스 빌드 (현재 권장):

```bash
git clone <this-repo> ~/tools/ai-factory
cd ~/tools/ai-factory
npm install
npm run build
npm link
```

설치 확인:

```bash
factory --version
factory --help
```

## 3. 프로젝트 초기화

```bash
cd /path/to/my-project
factory init
```

다음이 생성됩니다:

```
.factory/
├── config.yaml           # 모델, 예산, 기본 정책
├── lines/                # 파이프라인 정의 (feature, bugfix, refactor, intake-only)
├── skills/               # 도메인 지식 (coding-style, review-criteria, security-auditor)
└── .gitignore            # runs/, sandbox/, intake/ 제외
```

`config.yaml`에서 사용할 모델을 확인하세요:

```yaml
defaultModel: claude-sonnet-4-6
reviewerModel: claude-haiku-4-5
```

## 4. 첫 라인 실행

### 4.1 가장 단순한 시나리오: bugfix 라인

```bash
factory run bugfix "FormatDate가 timezone을 무시하고 있다"
```

진행 단계:

1. `reproduce` station이 worktree를 새로 파서 실패하는 테스트를 추가
2. `fix` station이 같은 worktree에서 코드를 수정하여 테스트 통과
3. `review` station이 변경분을 검토 (별도 reviewer LLM)
4. `gate` station에서 사람이 머지 승인 또는 거부

성공 시 worktree의 변경분이 현재 브랜치에 fast-forward 머지됩니다.

### 4.2 로그/결과 보기

```bash
factory status              # 가장 최근 run
factory status <runId>      # 특정 run
factory insights            # 누적 통계
```

`.factory/runs/<runId>/`에는:

- `trace.jsonl` — 모든 LLM 이벤트 (재현/디버깅용)
- `summary.json` — 결과 요약
- `stations/<name>/output.md` — station별 출력
- `stations/<name>/prompt.md` — 실제로 보낸 프롬프트

## 5. 문서 ingest로 시작하기

요구사항 PDF, 기획서 PPT, API 명세 Excel을 던져 넣고 싶다면:

```bash
factory intake docs/spec.pdf docs/api.docx
# Snapshot: intake-2026-04-28T01-12-33
```

이후 라인이 `canSearchIntake: true`로 정의돼 있으면 자동으로 검색 가능한
컨텍스트로 사용됩니다. 동봉된 `feature.yaml`이 이 옵션을 켜둡니다.

```bash
factory run feature "회원 등급제 백엔드 구현"
```

`clarify`와 `implement` station의 프롬프트에 자동으로 *"top 5 BM25 hits from intake"*
가 들어갑니다.

## 6. 라인을 본인 프로젝트에 맞게 수정

`.factory/lines/feature.yaml`을 열어 station을 추가하거나 persona를 바꾸세요.
station 1개를 추가하는 것은 yaml 5줄로 가능합니다:

```yaml
  - name: typecheck
    kind: llm
    bot:
      name: typecheck-runner
      persona: |
        Run `npm run typecheck` in the worktree. If it fails, summarize errors.
```

## 7. 본인 도메인 지식을 skill로 추가

```bash
echo '---
triggers: ["payment", "card", "결제"]
---
# Payment Module Conventions

- 모든 금액은 정수 minor unit (KRW 100원 = 100)
- 카드사 코드는 `lib/payment/codes.ts`에 enum
' > .factory/skills/payment.md
```

이제 입력에 "결제"가 포함되면 자동으로 이 스킬이 모든 station 프롬프트에
주입됩니다.

## 8. 멈췄다? 재개

human gate에서 거부하거나 SIGINT(`Ctrl+C`)로 중단했다면:

```bash
factory status              # runId 확인
factory resume <runId>      # 미완 station부터 재개
```

## 9. 다음 단계

- [docs/concepts.md](concepts.md) — Line/Station/Worktree 개념
- [docs/line-spec.md](line-spec.md) — yaml 작성 레퍼런스
- [docs/architecture.md](architecture.md) — 내부 동작
- [docs/faq.md](faq.md) — 트러블슈팅
