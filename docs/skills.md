# Skills

스킬은 `.factory/skills/<name>.md` 파일로 작성하는 도메인 지식입니다.
LLM의 시스템 프롬프트에 *추가 컨텍스트*로 주입되어 모델이 프로젝트의 관습,
규약, 위험 영역을 알 수 있게 합니다.

## 작성 형식

```markdown
---
triggers: ["payment", "결제", "card"]
agent:
  name: payment-domain
  outputs: ["payment-design.md"]
---

# Payment Module Conventions

- 모든 금액은 정수 minor unit (KRW 100원 = 100, USD $1 = 100)
- 카드사 코드는 `lib/payment/codes.ts`의 enum
- 환불은 `payments.refund` 트랜잭션으로만 처리
- 결제 실패 시 외부에 노출되는 메시지는 `i18n/payment-errors.ts` 참조
```

## Frontmatter (선택)

| 키 | 타입 | 의미 |
|----|------|------|
| `triggers` | string[] | 입력에 포함되면 자동 주입 (대소문자 무관 substring) |
| `agent.name` | string | (v2) 별도 sub-agent로 등록 가능하게 함 |
| `agent.triggers` | string[] | (v2) agent 자동 호출 트리거 |
| `agent.inputs` | string[] | (v2) 의존하는 입력 파일 |
| `agent.outputs` | string[] | (v2) 만들어야 할 산출물 |

frontmatter가 없어도 됩니다 — 그러면 본문만 사용 가능.

## 주입 시점

매 LLM station 시작 시:

1. `bot.skills:`에 명시된 항목 → **무조건 포함** (explicit)
2. `triggers:`가 있는 모든 스킬 → 입력 텍스트와 매칭 → 매칭되면 **자동 포함** (auto)

두 경우 모두 Claude Code의 `--append-system-prompt`로 합쳐져 전달됩니다.

## 명시적 vs 자동의 차이

```yaml
# 라인에서 명시
bot:
  skills:
    - coding-style    # 항상 포함
```

```markdown
---
triggers: ["payment", "결제"]
---
# 입력에 "결제"가 있으면 자동 포함
```

- **항상 적용되어야 하는 규약** (코드 스타일, lint 규칙) → 명시적
- **특정 도메인에서만 의미 있는 지식** (결제, 인증, 보안) → 자동

## 좋은 스킬의 모양

### 1. 작고 한 가지에 집중

```markdown
---
triggers: ["i18n", "translation"]
---
# i18n Conventions

- 모든 사용자 향 텍스트는 `i18n/<lang>.json`에 키로 분리
- 키 명명: `<scope>.<screen>.<element>` (예: `auth.login.submit_button`)
- 새 언어 추가 시 `lib/i18n/index.ts`의 `SUPPORTED_LOCALES` 업데이트
```

5~15줄이 좋습니다. 100줄짜리 스킬은 LLM이 무시할 가능성이 큼.

### 2. WHY를 짧게 포함

```markdown
- 환불은 항상 `payments.refund` 함수로만 — 직접 DB UPDATE 금지
  (이유: 환불 로그가 audit_log 테이블에 자동 기록되어야 함, 컴플라이언스)
```

WHY가 있으면 LLM이 새로운 상황에서도 원칙을 적용합니다.

### 3. 안티패턴을 명시

```markdown
## 절대 하지 말 것

- `process.env.DATABASE_URL`을 직접 참조 (`config/database.ts`만 사용)
- `setTimeout`으로 순서 동기화 (`await` 또는 `Promise` 활용)
- 새 종속성 추가 시 의논 없이 (PR 설명에 사유 필수)
```

## 스킬 우선순위

같은 이름의 스킬이 두 곳에 있으면 **사용자 디렉토리(.factory/skills/)** 가
번들된 디폴트보다 우선합니다. 사용자가 `coding-style.md`를 자기 입맛에 맞게
override할 수 있습니다.

## 디버깅

특정 run에서 어떤 스킬이 실제로 주입됐는지 확인:

```bash
cat .factory/runs/<runId>/stations/<station>/prompt.md
```

`prompt.md`는 LLM에 보낸 user 메시지 본문입니다. 스킬은 system prompt로
들어가므로 `trace.jsonl`에서 `bot_start` 이벤트의 `data.skills`로 확인:

```bash
grep '"type":"bot_start"' .factory/runs/<runId>/trace.jsonl | head -1 | jq .
```

## 미래 (v2): Skill Marketplace

frontmatter의 `agent` 키는 v2를 위한 예약 영역입니다. 예정된 기능:

- 스킬을 *sub-agent 정의*로 등록 — main bot이 자동 발견하고 위임
- 트리거 매칭으로 동적 라인업 구성
- A/B 측정으로 어느 스킬 조합이 결과 품질에 기여하는지 학습
