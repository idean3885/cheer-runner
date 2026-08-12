# 아키텍처

## 전제

작성자는 코드를 읽지 않는다. 그래서 **사람이 코드를 검토해서 잡던 것을 기계가 잡아야 한다.** 이 문서의 절반은 계층 설계이고 절반은 그 강제 장치다. 장치 없는 계층 규칙은 두 번째 세션에 무너진다.

## 계층과 의존 방향

```
presentation  ──>  application  ──>  domain
      │                 │              ↑
      └─────────────────┴──> infrastructure
                                (포트 구현체)
```

의존은 안쪽으로만 흐른다. `domain` 은 아무것도 모른다.

| 계층 | 담는 것 | 물어올 수 있는 것 |
|---|---|---|
| `domain` | 값 객체, 집합체, 정책, 사건 | 없음. 표준 내장 함수만 |
| `application` | 유스케이스, 포트 선언 | `domain` |
| `infrastructure` | 포트 구현체 | `domain`, `application` |
| `presentation` | 화면, 입력 | `application` |

`domain` 이 `expo-location` 을 물어오면 그 순간 시험 비용이 실기기로 돌아간다. 그래서 이 한 줄이 나머지 규칙보다 중요하다.

## 포트

`application` 이 필요를 선언하고 `infrastructure` 가 채운다.

인터페이스마다 구현체를 둘 둔다 — 운영용과 시험 대역. 백엔드에서 하던 그대로다.

| 포트 (인터페이스) | 하는 일 | 운영 구현체 | 시험 대역 |
|---|---|---|---|
| `LocationPort` | 측위 구독 시작·중지 | `ExpoLocationAdapter` | `ReplayLocationAdapter` |
| `ClockPort` | 현재 시각 | 시스템 시계 | 고정 시계 |
| `CourseRepository` | 코스 저장·조회·삭제 | `expo-sqlite` | 메모리 |
| `SpeechPort` | 한국어 음성 안내 | `expo-speech` | 호출 기록 |
| `NotifyPort` | 알림 | `expo-notifications` | 호출 기록 |
| `MapPort` | 지도 표시·탭 좌표 | `react-native-maps` | 첫 릴리스에 없음 |

`ClockPort` 를 따로 두는 이유는 시험이다. `Date.now()` 를 도메인이 직접 부르면 틱 경계·결손 판정·무이동 판정 시험을 짤 수 없다.

그리고 이 규칙 덕에 **재생 배속이 계산 결과를 바꾸지 않는다.** 측위의 시각은 고정 표본에서 오고 도메인은 벽시계를 읽지 않으므로, 20분 주행을 밀리초에 흘려도 같은 값이 나온다. 근거는 [ADR 0004](adr/0004-replay-adapter.md).

### 어댑터 안은 포트를 갈아도 시험되지 않는다

포트를 갈아끼우면 그 **위**는 전부 시험되는데 운영 어댑터 **안**은 한 번도 돌지 않는다. 플랫폼이 준 객체를 도메인 값으로 옮기는 코드가 시험 밖에 남는다. 선행 검증에서 이 종류가 났다 — 속도 필드를 쓰는 판단은 맞았는데 값이 없을 때 처리가 갈렸다.

그래서 위치 어댑터를 둘로 가른다.

| 조각 | 성격 | 시험 |
|---|---|---|
| `toFix(플랫폼 객체) → Fix` | 순수 함수 | CI 단위 시험 |
| `ExpoLocationAdapter` | 구독 시작·중지, 백그라운드 작업 등록 | 기기에서만 |

매핑을 순수 함수로 떼어내면 기기에서만 확인할 수 있는 부분이 구독 기계 장치 몇 줄로 줄어든다. 그 몇 줄은 [MVP.md](MVP.md) 의 0 단계에서 걸러진다.

## 기계 강제 장치

코드 검토를 대신하는 자리다. 모두 CI 에서 돌고, 하나라도 실패하면 머지되지 않는다.

| 층 | 장치 | 막는 것 |
|---|---|---|
| 타입 | TypeScript `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` | 배열 접근 뒤 `undefined`, 선택 속성 오용 |
| 타입 우회 | `@typescript-eslint/no-explicit-any`: error | `any` 로 검사를 끄는 것 |
| 계층 | `dependency-cruiser` 규칙 | `domain` 이 프레임워크를 물어오는 것 |
| 함수 크기 | eslint `complexity` 10, `max-depth` 3, `max-lines-per-function` 40, `max-params` 3 | PoC 의 `closeTick` 같은 다역 함수 |
| 파일 크기 | eslint `max-lines` 300 | 1,900줄 한 파일의 재발 |
| 조용한 실패 | `no-empty` + `@typescript-eslint/no-unused-vars` | 빈 `catch {}` 로 오류를 삼키는 것 |
| 도메인 정확성 | Vitest 단위 시험, `domain` 커버리지 하한 90% | 페이스·거리·구간 템포 회귀 |
| 모의 주입 경계 | 재생 어댑터는 **플랫폼이 주는 모양 그대로** 넣는다. `dependency-cruiser` 로 도메인 값 객체 직접 주입을 막는다 | 어댑터 매핑 버그가 모든 시험을 통과하는 것 |
| 경계 조건 | 합성 표본 — 일정 속도·급감속·15초 결손·정확도 200m 잡음·652초 단절 | 실제 주행에서만 드러나던 결함 |
| 서식 | Prettier | 서식 논쟁 |
| 이력 | ops-agent `flow` (이슈 → PR) | 이력 없는 변경 |

커버리지 하한을 `domain` 에만 거는 이유가 있다. 화면 커버리지는 숫자만 올라가고 뜻이 없다. 정확성이 걸린 곳은 순수 함수뿐이다.

## 쓰는 패턴

필요해서 쓰는 것만 적는다.

| 패턴 | 쓰는 자리 | 없으면 무슨 일이 |
|---|---|---|
| 값 객체 | 미터·초당미터·초당킬로미터 | PoC 에서 실제로 났던 단위 혼용이 다시 난다 |
| 상태 기계 | 주행 생애 (대기·달리는 중·끝) | 종료된 주행에 측위가 더 들어오는 일이 생긴다 |
| 순수 접기 연산 | 측위 목록 → 최종 상태 | 시험이 실기기로 돌아간다 |
| 포트와 어댑터 | 위치·저장·음성·알림·지도·시계 | 도메인이 프레임워크에 묶인다 |
| 도메인 사건 | 도달·피버·배지·종료 | 정책 함수가 음성 합성기를 직접 부른다 |
| 저장소 | 코스·프로필 | 화면이 저장 형식을 알게 된다 |

## 쓰지 않는 패턴

과설계를 미리 잘라둔다. 나중에 필요해지면 그때 넣는다.

| 패턴 | 왜 안 쓰나 |
|---|---|
| 거리 계산의 전략 패턴 | 두 계산이 동시에 돌고 둘 다 기록된다. 실행 중 고르는 게 아니라서 전략이 아니다 |
| 사건 소싱·CQRS | 읽기와 쓰기가 갈릴 만큼 복잡하지 않다 |
| 의존성 주입 컨테이너 | 조립 지점이 한 곳이다. 모듈 수준 연결로 충분하다 |
| 모든 반환값을 `Result` 로 감싸기 | 실패가 의미 있는 함수만 판별 합집합으로 표현한다. 전면 적용은 읽는 비용만 늘린다 |
| 계층별 상태 관리자 | 화면이 몇 개다. 저장소 하나로 족하다 |
| 저장소 인터페이스의 다중 구현 | 구현이 하나다. 인터페이스는 시험용 대역 때문에만 둔다 |

## PoC 의 코드 스멜

버릴 코드지만 목록으로 남긴다. 같은 실수를 다시 하지 않기 위한 자료이고, 실제로 이번 작업에서 시간을 쓴 것들이다.

| 스멜 | PoC 에서의 모습 | 새 설계에서 막는 장치 |
|---|---|---|
| 거대 파일 | `index.html` 한 파일 1,900줄 | `max-lines` 300 |
| 전역 가변 상태 | `track`·`game`·`course`·`profile`·`session` 이 모듈 전역 | 집합체가 자기 상태를 소유 |
| 원시값 집착 | 미터·초당미터·초당킬로미터가 모두 `number` | 값 객체 |
| 시간적 결합 | `startRun` 이 오디오 해제 → 재생 → 음성 → 알림 순서를 암묵으로 요구했고, 순서를 어겨 오디오가 조용히 꺼졌다 | 유스케이스 하나가 순서를 소유, 순서 시험 작성 |
| 다역 함수 | `closeTick` 이 점수 계산·로그·음성·화면 갱신·종료 판정을 함께 했다 | `complexity` 10, 사건으로 분리 |
| 산탄총 수술 | 화면에 값 하나 추가하려면 마크업·갱신 함수·보고서 작성부를 모두 고쳐야 했다 | 계층 분리 |
| 이름 없는 숫자 | `dist < 5` 처럼 문맥 없는 상수가 함수 안에 있었다 | 상수 표로 승격 (`DOMAIN.md`) |
| 조용한 실패 | `try { ... } catch (e) {}` 로 저장 오류를 삼켰다 | `no-empty` |
| 중복 | 시간·페이스 서식 함수가 유사한 형태로 여럿 | 값 객체가 자기 서식을 소유 |

## 폴더 구조

```
src/
  domain/
    value/        Meters, MetersPerSecond, SecondsPerKm, Millis, GeoPoint
    model/        Fix, Waypoint, Course, Track, Run, Profile, Split
    policy/       distance, pace, score, fever, arrival, idle, badge, dog
    event/        도메인 사건 정의
  application/
    port/         LocationPort, ClockPort, Repository, SpeechPort, NotifyPort
    usecase/      startRun, ingestFix, finishRun, saveCourse, loadCourse
  infrastructure/
    location/     expo-location 어댑터 (백그라운드 작업 등록)
    storage/      저장소 구현
    speech/       expo-speech 어댑터
    notify/       expo-notifications 어댑터
  presentation/
    screen/       주행, 코스 목록, 결과
    component/    지도, 계기판, 점수판
test/
  domain/         순수 단위 시험
  fixture/        실측 측위 로그 (PoC 수집분)
docs/
  DOMAIN.md       도메인 계약
  ARCHITECTURE.md 이 문서
  MEASURE.md      ops-agent·볼트 측정
  adr/            결정 기록
```

## 검토 지점

작성자가 보는 것은 셋뿐이다.

1. **`docs/` 의 문서** — 설계가 맞는지
2. **CI 결과** — 기계 장치가 통과했는지
3. **실기기 동작** — 실제로 되는지

코드는 이 셋 사이에 있고, 셋이 다 맞으면 코드를 읽지 않아도 된다는 것이 이 설계의 전제다. 이 전제가 깨지는 순간 — 문서와 구현이 어긋났는데 CI 가 통과하는 경우 — 가 나오면 그건 장치가 부족한 것이므로 장치를 추가한다.
