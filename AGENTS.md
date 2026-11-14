# AGENTS.md

이 저장소에서 일하는 AI 코딩 에이전트(Claude Code, Codex 등)를 위한 규칙입니다. 사람 기여자도 같은 규칙을 따릅니다.

## 작업을 끝내기 전에

```sh
pnpm check   # typecheck → lint → test → build
```

하나라도 실패하면 작업이 끝난 것이 아닙니다. 테스트를 지우거나 `@ts-expect-error`, `eslint-disable`로 통과시키지 마세요.

## 지켜야 할 규칙

1. **현재 시각을 직접 읽지 않습니다.** 시간에 따라 결과가 바뀌는 함수는 `now: Date`를 인자로 받고, 기본값으로만 `new Date()`를 씁니다. 테스트에서는 항상 `now`를 고정합니다.
2. **경계를 바꾸면 경계 테스트를 함께 바꿉니다.** 환불 구간을 건드리면 `tests/refund-policy.test.ts`의 "정확히 N시간", "±1ms" 케이스를 확인하고, `docs/policy.md`의 표도 고칩니다.
3. **`reason`, `status` 유니온에 값을 추가하면** `docs/api.md`와 README의 표를 같이 고칩니다.
4. **`processRefund`는 결제사를 `cancel` 1번, `query` 1번까지만 호출합니다.** 재시도 루프를 넣지 마세요. 재시도는 호출한 쪽의 DB 상태가 결정합니다.
5. **`uncertain`을 다른 결과로 바꾸지 않습니다.** 판단할 수 없을 때 멈추는 것이 이중 환불을 막는 장치입니다.
6. **금액은 원 단위 정수입니다.** 부분 환불은 내림하고, `환불액 + 수수료 = 결제 금액`이 깨지면 안 됩니다.
7. **런타임 의존성을 추가하지 않습니다.** `dependencies`는 비어 있어야 합니다.

## 파일 위치

| 바꾸려는 것 | 파일 |
| --- | --- |
| 환불 구간·비율 | `src/refund-policy.ts` |
| 환불 응답 유실 처리 | `src/refund-recovery.ts` |
| CLI 옵션·출력 | `src/cli.ts` (`src/bin.ts`는 실행만) |
| 공개 API | `src/index.ts` — 여기서 export하지 않은 것은 내부 구현 |

## 스타일

- 상대 경로 import는 `.ts` 확장자까지 씁니다. (Node가 빌드 없이 바로 실행하고, 빌드할 때 `.js`로 바뀝니다)
- enum, namespace, 생성자 매개변수 프로퍼티는 쓰지 않습니다. (`erasableSyntaxOnly`)
- 타입만 가져올 때는 `import type`을 씁니다.
