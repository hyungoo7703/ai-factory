# FAQ

## 일반

### AI Factory는 Claude Code와 뭐가 다른가요?

Claude Code는 **단일 대화 단위의 AI 코딩 도구**입니다. AI Factory는 그 위에
**워크플로우 레이어**를 얹어 다음을 추가합니다:

- 격리된 git worktree (사용자 working tree 보호)
- Negotiation 기반 다중 시각 검증
- 도메인 지식 주입 (skills)
- 모든 실행 trace + 누적 메모리 (자가개선)
- 예산/타임아웃 hard cap
- 인간 게이트 (병합 전 승인)

요약: Claude Code = 실행 엔진, Factory = 공장의 운영체계.

### MSSQL이나 별도 DB가 필요한가요?

아니요. 모든 상태는 **git + 로컬 JSONL 파일**로 관리됩니다.
`.factory/memory.jsonl`은 단순 append 파일.

### Electron이나 GUI가 있나요?

없습니다. CLI 전용입니다 (`factory <command>`). VS Code Extension은 v2 후보.

## 설치 / 실행

### `claude` 명령을 못 찾는다는 에러

Claude Code CLI가 PATH에 없습니다.

```bash
which claude     # macOS/Linux
where claude     # Windows
```

설치: https://docs.claude.com/claude-code

설치 후 `claude --version`이 동작해야 합니다. 환경별로 PATH 추가가 필요할 수
있습니다.

### `Not a git repository` 에러

대상 프로젝트가 git 저장소가 아닙니다:

```bash
git init
git commit --allow-empty -m "init"
factory init
```

### Windows에서 `EPERM` 또는 권한 에러

다음을 확인:

1. PowerShell 또는 cmd에서 실행 중인지 (WSL과 다르게 경로 처리)
2. 다른 프로세스가 `.factory/sandbox/` 내 worktree 디렉토리를 잡고 있지 않은지
3. Antivirus가 `.factory/` 쓰기를 차단하지 않는지

## 워크플로우

### 어떤 라인을 언제 써야 하나요?

| 시나리오 | 라인 |
|---------|------|
| 새 기능 한 개 추가 | `feature` |
| 버그 한 개 고치기 | `bugfix` |
| 동작 보존 리팩토링 | `refactor` |
| 그냥 문서만 정리 | `intake-only` |

복잡한 시나리오는 위 라인을 복사해서 본인 입맛에 맞게 편집하세요.

### 라인 실행이 매우 오래 걸려요

원인 가능성:

1. **Claude Code의 thinking이 길어짐** — 복잡한 작업일수록 정상
2. **무한 도구 호출 루프** — `factory status <runId>` 후 `trace.jsonl`의
   `tool_use` 이벤트 수 확인. 많으면 station persona를 더 좁게 작성하거나
   `budget.toolCalls`를 낮춰서 hard cap을 거세요.
3. **타임아웃** — 기본 30분. station 별 더 길게 필요하면 직접 `timeoutMs`를
   조정 (현재 코드 수정 필요, v2에서 yaml로 노출 예정).

`Ctrl+C`로 언제든 중단 가능. 이후 `factory resume <runId>`로 재개.

### Reviewer가 main bot의 답을 그대로 PASS합니다

같은 모델로 main과 reviewer를 쓰면 발생하는 echo chamber 문제입니다.
`config.yaml`에서 다른 모델 지정:

```yaml
defaultModel: claude-opus-4-7
reviewerModel: claude-haiku-4-5
```

또는 라인 yaml에서 station별 명시:

```yaml
- name: review
  kind: review
  bot:
    model: claude-haiku-4-5
    persona: |
      You are an extremely critical reviewer. Default to skepticism. ...
```

### 비용이 너무 많이 나옵니다

1. `factory insights`로 어느 station이 비용이 큰지 확인
2. 라인의 `budget.costUsd`를 낮춰서 hard cap 강제
3. 큰 작업은 sub-task 단위로 분할 (라인 1번 호출 = 한 PR 단위로 유지)
4. reviewer를 더 작은 모델로 (haiku 등)

## 격리

### Worktree가 사용자 working tree와 어떻게 분리되나요?

`git worktree add` 명령으로 같은 저장소에서 별도 디렉토리 + 별도 브랜치를
만듭니다. LLM은 그 디렉토리만 cwd로 가짐 → 사용자 working tree는 안 건드림.

### worktree에서 작업한 결과는 어디로?

기본은 `factory/<line>/<runId>/<station>` 브랜치에 commit. gate station에서
사람이 승인하면 사용자의 현재 브랜치로 fast-forward 머지. 거부하면 브랜치는
남고 worktree만 정리.

### 머지 충돌은 어떻게?

fast-forward만 허용하므로 충돌이 발생하면 머지가 거부됩니다. 사용자가 직접
`git rebase` 후 다시 시도해야 합니다 (의도된 동작 — 임의 자동 머지 금지).

## 데이터 / 보안

### .factory/는 git에 커밋해야 하나요?

기본 `.gitignore`가 다음을 제외합니다:
- `runs/` (실행 trace, 보통 큼)
- `sandbox/` (임시)
- `intake/` (사내 문서일 수 있음)
- `memory.jsonl` (개인 통계)

다음은 커밋 권장:
- `config.yaml` (팀이 같은 모델/예산 공유)
- `lines/` (팀의 작업 정의)
- `skills/` (팀의 도메인 지식)

### 회사 기밀 문서가 LLM으로 나가지 않게 하려면?

`config.yaml`의 `redactPatterns`에 정규식을 추가하세요. 매칭되는 부분은
프롬프트에서 마스킹됩니다. (현재 MVP는 ingest 시에만 적용 — v2에서 전체
프롬프트 단계로 확장 예정.)

또한 `factory intake --no-llm`으로 LLM 없이 인덱싱만 하는 모드가 있습니다.

### 한 번 실행한 결과를 똑같이 재현 가능한가요?

부분적으로. `trace.jsonl`에 prompt + tool calls가 다 기록되지만, LLM 자체는
non-deterministic이므로 *완전 재현*은 안 됩니다. 같은 입력 → 비슷한 결과는
가능합니다. 결정론적 재현은 v2 후보.

## 문제 해결

### 라인이 멈췄어요

```bash
factory status              # 마지막 run의 상태
factory resume <runId>      # 미완 station부터 재개
```

`awaiting_human` 상태는 gate 또는 budget exhausted입니다.

### `summary.json`에 에러가 있어요

```bash
cat .factory/runs/<runId>/summary.json | jq .error
cat .factory/runs/<runId>/trace.jsonl | grep '"type":"error"'
```

대부분의 에러는 trace의 마지막 몇 이벤트에 원인이 있습니다.

### Worktree 정리가 안 됐어요

```bash
git worktree list                      # 현재 등록된 worktree 확인
git worktree remove --force <path>     # 강제 제거
git worktree prune                     # 누락된 항목 정리
```

`.factory/sandbox/<dir>`만 남아있다면 그 디렉토리를 직접 `rm -rf`해도 됩니다.

## 확장

### 본인 라인을 만드는 가장 빠른 방법?

```bash
cp .factory/lines/feature.yaml .factory/lines/my-line.yaml
# 편집
factory list   # my-line이 보이는지 확인
factory run my-line "..."
```

### 본인 스킬 추가는?

```bash
cat > .factory/skills/my-domain.md <<'EOF'
---
triggers: ["my-keyword"]
---
# My Domain
- ...
EOF
```

다음 run부터 자동 적용. 별도 등록 불필요.

### Codex/Gemini 어댑터는 언제?

v2 로드맵. 현재 어댑터 인터페이스는 [src/adapters/bot.ts](../src/adapters/bot.ts)에
있고, `ClaudeCodeAdapter` 외에 새 클래스 추가만으로 확장 가능합니다.
