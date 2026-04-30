# Architecture

AI Factory는 Claude Code를 실행 엔진으로 삼아 그 위에 **워크플로우 레이어**를
얹는 구조입니다. 자체 LLM 호출 로직, 파일 편집, bash 실행은 **만들지 않습니다**.
Claude Code가 그 영역을 처리하고, Factory는 *공장의 운영체계* 역할만 합니다.

## 큰 그림

```
┌──────────────────────────────────────────────────┐
│  Conductor (factory CLI)                          │
│  - line yaml 해석                                 │
│  - station 큐 + 순차 실행                         │
│  - 예산 추적, 취소, 재개                          │
│  - trace 기록, memory 누적                        │
└──────────────────────────────────────────────────┘
                       │
       ┌───────────────┼─────────────────┐
       ▼               ▼                 ▼
   ┌────────┐    ┌────────────┐    ┌──────────┐
   │ ingest │    │    llm     │    │  review  │ ─→ gate
   │station │    │  station   │    │  station │
   └───┬────┘    └─────┬──────┘    └─────┬────┘
       │               │                  │
       │      ┌────────▼─────────┐        │
       │      │  Worktree (git)  │        │
       │      │  isolated branch │        │
       │      └────────┬─────────┘        │
       │               │                  │
       └───────────────▼──────────────────┘
                       │
                ┌──────▼───────┐
                │  BotAdapter  │
                │ (interface)  │
                └──────┬───────┘
                       │
              ┌────────▼─────────┐
              │ ClaudeCodeAdapter│
              │  spawn `claude`  │
              │  stream-json IO  │
              └──────────────────┘
```

## 레이어별 책임

### Conductor — 라인 실행자

[src/core/conductor.ts](../src/core/conductor.ts)

- `RunOptions` (line, input, projectRoot) → `RunSummary`
- `runDir`(`.factory/runs/<id>/`)을 만들고 trace 시작
- `BudgetTracker`로 토큰/비용/시간/도구호출 추적
- station 순서대로 dispatch
- 실패/취소/예산소진/사람대기 4가지 종료 분기

### Station Handler — 한 단계 실행자

| Kind | 파일 | 역할 |
|------|------|------|
| `ingest` | [src/stations/ingest.ts](../src/stations/ingest.ts) | 문서 → 청킹 → 인덱싱 → 요약 |
| `llm` | [src/stations/llm.ts](../src/stations/llm.ts) | 프롬프트 조립 → bot 호출 → 산출물 검증 |
| `review` | [src/stations/review.ts](../src/stations/review.ts) | Negotiation Loop |
| `gate` | [src/stations/gate.ts](../src/stations/gate.ts) | Human approve/reject |

### BotAdapter — 백엔드 추상화

[src/adapters/bot.ts](../src/adapters/bot.ts), [src/adapters/claude-code.ts](../src/adapters/claude-code.ts)

```ts
interface BotAdapter {
  health(): Promise<void>;
  run(invocation: BotInvocation): Promise<BotResult>;
  runStream(invocation, onEvent): Promise<BotResult>;
}
```

MVP는 `ClaudeCodeAdapter` 1개. Codex/Gemini 추가 시 새 어댑터 클래스만 추가
(엔진 변경 0).

### Claude Code 호출 방식

`claude -p` (print mode) + `--output-format stream-json` + `--input-format stream-json`.

- 프롬프트는 stdin으로 user 메시지로 전달 (Windows arg-length, quoting 회피)
- stream-json으로 모든 tool_use, tool_result, thinking, text 블록을 받음
- 각 블록은 trace.jsonl에 기록
- 최종 cost/token은 `result` 이벤트에서 추출

### Worktree Manager

[src/core/worktree.ts](../src/core/worktree.ts)

- `git worktree add -b factory/<line>/<run>/<station> <sandbox>/...`
- LLM은 cwd가 worktree로 고정된 상태로 spawn
- 머지는 gate station에서 사람 승인 후 fast-forward만 허용
- 실패/취소 시 워크트리 + 브랜치 제거

### Trace + Memory

[src/core/trace.ts](../src/core/trace.ts) — append-only JSONL per run.
이벤트 종류: `run_start`, `station_start`, `bot_start`, `tool_use`,
`tool_result`, `subagent_start`, `review_round`, `budget_warn`,
`budget_exhaust`, `error`, `run_end`.

[src/core/memory.ts](../src/core/memory.ts) — `memory.jsonl` (전체 누적).
한 줄에 한 station 결과 + 비용 + verdict + score. `factory insights`가 이걸
집계합니다.

## 격리 모델

```
                user's project
                 ┌─────────┐
                 │  .git   │
                 │   src/  │   ← 사용자 working tree (LLM 절대 못 만짐)
                 └─────────┘
                      │
                      │ worktree add
                      ▼
              .factory/sandbox/
              ┌──────────────────┐
              │ feature__implement│ ← LLM의 cwd
              │   .git → 공유      │
              │   src/             │
              └──────────────────┘
                      │
                      │ gate 승인
                      ▼
              fast-forward merge to user's current branch
```

- LLM은 항상 worktree 안에서만 cwd를 가짐
- worktree는 별도 branch를 가지므로 사용자의 commit 흐름과 분리
- 실패해도 cleanup이 worktree 디렉토리만 제거 → 사용자 영향 0
- 성공 시 fast-forward(병합 충돌 없음)로만 머지 — non-FF 발생 시 거부

## Negotiation Loop

[src/stations/review.ts](../src/stations/review.ts)

```
round 1:
  reviewer가 target output 평가 → JSON {verdict, score, feedback}
  if PASS && score >= threshold: end
  else:
    main bot에게 ACCEPT/DISPUTE 결정 요청
    ACCEPT → main이 새 draft 생성, target output 교체
    DISPUTE → 1줄 반박, loop 종료 (verdict는 WARN으로)
round 2: 위 반복
... up to maxNegotiations
```

핵심: **다른 모델로 reviewer를 쓰는 게 권장**입니다. 같은 모델이면 echo
chamber 위험. 동봉된 `feature.yaml`은 main = sonnet, reviewer = haiku로 설정.

## Skill 주입 메커니즘

[src/skills/loader.ts](../src/skills/loader.ts)

스킬은 `.md` 파일. 옵션 frontmatter에 trigger 키워드를 둘 수 있음.

매 LLM station 시점에:

1. `bot.skills:`에 명시된 스킬 (explicit) — 무조건 포함
2. 입력 텍스트와 trigger 매칭 (auto) — 동적으로 포함
3. 합쳐서 Claude Code의 `--append-system-prompt`로 전달

확장 = `.factory/skills/`에 `.md` 추가. 코드 변경 0.

## Budget 시스템

[src/core/budget.ts](../src/core/budget.ts)

4개 메트릭: `tokens`, `costUsd`, `durationMin`, `toolCalls`.

- 80% 도달: warn 이벤트 발생, 진행 계속
- 100% 도달: `BudgetExhausted` throw → conductor가 `awaiting_human`으로 종료
- `factory resume`으로 재개 가능 (메트릭은 누적되지 않음, 새로 시작)

기본값은 [src/templates/config.yaml](../src/templates/config.yaml). 라인별
override 가능 (`line.budget:`).

## 데이터 위치 요약

```
<projectRoot>/.factory/
├── config.yaml             # 프로젝트 설정
├── .gitignore              # runs/, sandbox/, intake/, memory.jsonl 제외
├── lines/<name>.yaml       # 라인 정의
├── skills/<name>.md        # 스킬
├── intake/<id>/            # ingest 스냅샷
│   ├── manifest.json
│   ├── raw/<source>.txt
│   ├── index.jsonl
│   ├── summary.md
│   └── decisions.md
├── runs/<runId>/
│   ├── summary.json
│   ├── trace.jsonl
│   └── stations/<name>/
│       ├── output.md
│       ├── prompt.md
│       └── review.md       # review station만
├── sandbox/                # worktree 디렉토리들 (실행 중에만)
└── memory.jsonl            # 모든 run의 station 결과 누적
```

`runs/`, `sandbox/`, `intake/`, `memory.jsonl`은 default `.gitignore`로 제외.
`config.yaml`, `lines/`, `skills/`는 git에 커밋해서 팀과 공유 가능.

## 확장 포인트 (v2 후보)

- 다른 LLM 어댑터 (Codex, Gemini, Ollama)
- Embedding 기반 의미 검색 (Ollama nomic-embed-text)
- Skill A/B 자동 측정
- MCP server 모드 (다른 AI 도구에서 호출)
- Web/이미지 추출
- VS Code Extension (CLI wrapper)
