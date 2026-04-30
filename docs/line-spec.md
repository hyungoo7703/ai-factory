# Line Spec

`.factory/lines/<name>.yaml` 작성 레퍼런스.

## 최소 예시

```yaml
name: hello
description: minimal line for sanity check.

stations:
  - name: greet
    kind: llm
    bot:
      name: greeter
      persona: "Reply with a one-sentence greeting in Korean."
```

실행:

```bash
factory run hello "프로젝트 시작"
```

## 전체 스키마

```yaml
name: <string>                  # 라인 식별자 (파일명과 일치 권장)
description: <string>           # 표시용 설명

# 라인 단위 예산 — 미지정 시 config.yaml 또는 내장 기본값
budget:
  tokens: <number>
  costUsd: <number>
  durationMin: <number>
  toolCalls: <number>
  subAgentMaxDepth: <number>    # 재귀 sub-agent 깊이 제한 (v2 예약)
  subAgentMaxCount: <number>    # 한 main이 spawn할 수 있는 sub-agent 수

stations:                       # 1+개 필수
  - name: <string>              # 라인 내에서 unique
    kind: ingest|llm|review|gate
    instructions: <path>        # 옵션: 추가 instructions.md 경로
    optional: <bool>            # 옵션: 사용자가 생략 가능 (현재는 표시용)
    worktree: <bool>            # llm station만 — 격리된 worktree 사용
    canSearchIntake: <bool>     # llm/review만 — intake 검색 hint 주입
    inputs:                     # 옵션: 사전 산출물 path (project root 기준)
      - <path>
    outputs:                    # 옵션: 이 station이 반드시 만들어야 할 파일
      - <path>
    bot:                        # llm/review에서 사용
      name: <string>
      model: <string>           # Claude Code model id
      persona: <multiline>
      skills:                   # 명시적 스킬 (trigger 무관 항상 포함)
        - <skill-name-or-path>
    reviewOf: <string>          # review만 — 평가할 station 이름
    passThreshold: <0-100>      # review만 — 통과 점수 (default 80)
    maxNegotiations: <number>   # review만 — Negotiation 라운드 (default 2)
    budget:                     # 옵션: 이 station만의 예산 override
      tokens: <number>
      ...
```

## kind별 동작

### `ingest`

- 사용자 입력에서 path를 추출(`ctx.input` 줄별 검사) + `station.inputs`
- 모든 path를 ingest 파이프라인에 통과 → snapshot 생성
- `ctx.intakeId`에 snapshot id 바인딩 → 다음 station들이 검색 가능

### `llm`

- 옵션으로 worktree 생성
- 프롬프트 조립:
  1. `instructions.md` (있으면)
  2. 사용자 입력
  3. 이전 station들의 output (chained context)
  4. (canSearchIntake이면) intake 검색 top-5
  5. working directory 안내 + 필수 outputs 안내
- explicit + auto-matched skills를 system prompt에 append
- bot 호출, 모든 이벤트 trace
- worktree에서 변경사항 자동 commit

### `review`

- `reviewOf`로 지정된 station의 output을 입력으로 받음
- Negotiation Loop (최대 `maxNegotiations` 라운드)
- JSON verdict 파싱 (실패 시 휴리스틱 fallback)
- 점수 ≥ threshold이면 PASS

### `gate`

- 직전 worktree-bearing station의 worktree를 carry-over
- CLI에서 사용자에게 approve/reject/discard 프롬프트 (--yes로 자동 승인)
- approve → fast-forward merge → branch 보존
- reject → 중단, branch 유지
- discard → worktree 제거, branch 삭제

## Skill 참조 방식

`bot.skills:`는 다음 셋 중 하나를 받습니다.

```yaml
bot:
  skills:
    - coding-style                                   # 스킬 이름 (.md 자동 추가)
    - skills/payment.md                              # 프로젝트 상대 path
    - /absolute/path/to/skill.md                     # 절대 path
```

## Persona 작성 팁

- **목적과 제약을 명확히** — *"무엇을 한다"*보다 *"무엇은 하지 않는다"*
- **출력 형식 강제** — Review station은 JSON verdict가 필수
- **컨텍스트 사이즈 제한** — *"3페이지 이상의 산출물 금지"* 같은 명시
- **persona는 frontmatter처럼** — 본격 instructions은 `instructions:` 파일로 분리

## 예: 다단 sub-agent 설계 (v1: 명시적)

현재 MVP는 sub-agent를 yaml로 fix할 수 없습니다. 대신 main bot의 persona에서
**"Task tool로 다음 sub-agent들을 호출"**을 강제하는 방식으로 구현:

```yaml
- name: implement
  kind: llm
  worktree: true
  bot:
    name: coordinator
    persona: |
      You orchestrate three sub-agents using your Task tool:
        1. api-designer: produce api/<name>.openapi.yaml
        2. db-modeler: produce db/<name>.schema.sql
        3. ui-spec: produce ui/<name>.tsx skeleton
      After all three complete, merge into a single implementation report.
      Do not write code yourself — delegate via Task.
```

이렇게 하면 Claude Code의 Task tool이 sub-agent 격리/병렬을 알아서 처리합니다.
v2에서는 이를 yaml로 선언적으로 표현할 예정.

## 라인 검증

라인 yaml은 로드 시 자동 검증됩니다. 자주 보는 에러:

- `line.name is required` — yaml 최상위 `name:` 필요
- `Duplicate station name` — 라인 내 station 이름 unique
- `Review station 'X' must specify 'reviewOf'`
- `Station 'X' references unknown station 'Y'` — reviewOf가 존재하지 않음
- `passThreshold must be 0-100`
