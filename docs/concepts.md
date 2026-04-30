# Concepts

핵심 용어들의 정의.

## Project Root

`.git` 디렉토리가 있는 폴더. AI Factory는 항상 가장 가까운 부모 git 저장소를
project root로 인식합니다. 모든 상태는 `<projectRoot>/.factory/`에 저장.

## Line

선언적 워크플로우. `.factory/lines/<name>.yaml`로 정의. 한 라인은 station의
순차 시퀀스이며 하나의 input을 받아 하나의 결과(보통 git branch)로 끝납니다.

다음 셋이 동봉:

- `feature` — clarify → implement → review → gate
- `bugfix` — reproduce → fix → review → gate
- `refactor` — plan → refactor → review → gate
- `intake-only` — ingest만

라인은 yaml이므로 추가/수정이 자유롭습니다. 자세히는 [line-spec.md](line-spec.md).

## Station

라인의 한 단계. 4가지 종류:

| Kind | 역할 |
|------|------|
| `ingest` | 사용자 문서를 검색 가능한 형태로 인덱싱 |
| `llm` | LLM에게 작업 위임 (보통 코드 작성/분석) |
| `review` | 다른 LLM이 결과를 평가 (Negotiation Loop) |
| `gate` | 사람이 승인/거부 → 머지 또는 폐기 |

## Worktree

`station.worktree: true`일 때 그 station은 격리된 git worktree에서 실행됩니다.

- 위치: `.factory/sandbox/<sanitized-branch>/`
- 브랜치: `factory/<line>/<runId>/<station>`
- LLM은 그 디렉토리에서만 파일 편집 가능
- 가장 최근의 worktree-bearing station만 gate에 carry over (이전 worktree는
  자동 정리)
- gate 승인 시 fast-forward 머지, 거부 시 자동 정리

## Bot

LLM 인스턴스 + persona + 모델 + 스킬의 집합.

```yaml
bot:
  name: coder              # 표시 이름
  model: claude-sonnet-4-6 # Claude Code에 전달할 model id
  persona: |               # 시스템 프롬프트 추가
    You are a senior implementer...
  skills:                  # 명시적 스킬 (trigger 무관 항상 포함)
    - coding-style
```

## Skill

`.md` 파일에 담긴 도메인 지식. `.factory/skills/`에 둠.

- **frontmatter triggers**: 입력에 키워드가 있으면 자동 주입
- **frontmatter agent.name**: (v2 예약) 별도 에이전트로 등록 가능
- **본문**: 자유 markdown — 이게 LLM 시스템 프롬프트에 추가됨

스킬은 코드 변경 없이 도메인 지식을 확장하는 1차 메커니즘입니다.

## Run

라인 한 번 실행 = 1 run. 고유한 `runId`(예: `2026-04-28-feature-abc123`)를
가지며 `.factory/runs/<runId>/`에 모든 산출물이 저장됩니다.

```
runs/<runId>/
├── summary.json    # 결과 메타데이터
├── trace.jsonl     # 모든 LLM 이벤트
└── stations/<name>/
    ├── output.md   # station 산출물
    └── prompt.md   # 실제로 보낸 프롬프트
```

## Trace

`trace.jsonl` — append-only 이벤트 스트림. 한 줄에 한 이벤트 (JSON).
재현/디버깅/메모리 분석의 원천 데이터.

이벤트 타입: `run_start`, `station_start`, `bot_start`, `tool_use`,
`tool_result`, `subagent_start`, `subagent_end`, `review_round`, `bot_end`,
`station_end`, `budget_warn`, `budget_exhaust`, `error`, `run_end`.

## Memory

`.factory/memory.jsonl` — 모든 run을 가로지르는 station 결과 누적. 한 줄에
한 station 실행 (line, station, bot, model, status, verdict, score, cost,
tokens, duration, defects).

`factory insights`로 집계.

## Intake Snapshot

`factory intake <files...>` 결과물. `.factory/intake/<snapshot-id>/`에:

- `manifest.json` — 메타데이터
- `raw/<source>.txt` — 추출된 원문
- `index.jsonl` — 청크 + 토큰 (BM25용)
- `summary.md` — LLM 요약 (1페이지)
- `decisions.md` — Decided / Ambiguous 분류

라인의 station이 `canSearchIntake: true`이면 가장 최근 스냅샷을 자동 검색.

## Budget

토큰/비용/시간/도구호출의 hard cap. 라인별 설정 가능. 80%에서 warn, 100%에서
중단(awaiting_human). 재개 시 새로 시작.

## Negotiation

리뷰가 PASS가 아닐 때 main bot에게 ACCEPT/DISPUTE를 묻는 라운드.

- ACCEPT → main이 새 draft 작성, 다음 라운드 review
- DISPUTE → 1줄 반박 후 종료 (verdict는 WARN로 격하)

`maxNegotiations`(기본 2)까지 반복.

## Verdict

`PASS` / `WARN` / `FAIL`. 리뷰의 결론. score(0-100)와 함께 표기.

| Verdict | 의미 |
|---------|------|
| PASS | threshold 이상, 그대로 진행 |
| WARN | 개선 가능하지만 진행 (gate에서 사람이 결정) |
| FAIL | 차단, 재작업 필요 |
