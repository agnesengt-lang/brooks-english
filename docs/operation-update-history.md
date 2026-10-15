# 운영 업데이트 이력 (brooks-english)

이 문서는 v2.6.1부터 운영 AI가 Notion API로 쓸 수 없는 내용(수식 텍스트, 자동화 설정 등)까지 포함해
각 버전 적용 결과를 정리하기 위해 새로 만들었습니다. v2.6.1 이전 이력은 Notion
"[시스템 정보](https://app.notion.com/p/76e826675b3b46c9928760877b1040f2)" 페이지의
"버전 업데이트 이력" 표에 전부 기록되어 있습니다. 현재 버전 표기는 Notion 시스템 정보 페이지가 기준이며,
이 문서는 보조 기록입니다(이번 v2.6.x 묶음은 v2.6.5까지 끝난 뒤 시스템 정보의 "현재 버전"을 한 번에 갱신할 예정).

## v2.6.1 — 2026-10-16

- **원본 기준 커밋**: `bff09dd3d1d47e9b15e0e12aae78338fa95bfc75` (hada-notion/project1, main 최신)
- **적용 전 스냅샷**: 수업(학원) DB `생성 오류` 수식, 학습기록(학원) DB `단원` 수식은 변경 전 원문을 확인·보존했고 이번 버전에서는 손대지 않음. 등록(학원) DB에는 기존 속성명 `안내 링크`가 있었음.
- **항목 2 (AI 자동, 완료)**:
  - 수업(학원) DB: checkbox `보강` 신규 추가. 보강(시간표·클래스 없는 임시) 수업이면 체크. 출석 조정은 이 수업을 건너뛰고, 이 수업에서 만든 학습기록은 진도교재 진행도에서 빠짐.
  - 출석(학원) DB: 텍스트 `메모` 신규 추가. 내부용(출결 사정·특이사항), 학부모 리포트에는 보이지 않음.
  - 학습기록(학원) DB: 텍스트 `주제` 신규 추가. 교재가 없는 기록에서 리포트에 교재명 대신 표시(교재명 → 주제 → 구분 순). 레이아웃상 `범위` 앞에 배치.
- **항목 3 (AI 자동, 완료)**:
  - 등록(학원) DB: 기존 포뮬러 속성 `안내 링크` → `학생 페이지`로 이름만 변경(수식·버튼 동작 동일, 레이아웃은 자동 반영됨).
  - (선택) 출석(학원) DB: rollup `학생 페이지` 신규 추가(등록 관계 경유, 원본 그대로 표시). 사이드바 "기타" 섹션에 숨김으로 배치.
- **항목 4 (운영자 직접, 대기)**: 수업(학원) DB `생성 오류` 수식을 보강 수업 분기(🔵 보강 수업(N))가 포함된 새 수식으로 교체. Notion API로 수식 속성 값 자체를 쓸 수 없어 Notion 앱에서 운영자가 직접 붙여넣어야 함(`docs/updates/v2.6-노션-작업.md`의 N-3 참고).
- **항목 5 (운영자 직접, 대기)**: 최상위 학원관리 페이지 제목이 학원 이름("브룩스 잉글리쉬")인지, 연동 앱과 공유되어 있는지 확인(추후 키오스크 화면에서 사용 예정, N-1).
- **항목 6 (운영자 직접, 대기)**: 등록(학원) DB 등의 자동화에서 `/sync-registration-timetable`, `/mark-report-source-dirty`, `/sync-student-report`, `/sync-school-schedules`를 부르는 액션 정리(v2.6.2에서 서버 함수 자체가 삭제될 예정, N-8). `mark-report-source-dirty` 건은 v2.5.5 항목 2 대기분과 통합 처리.
- **적용 주체**: 운영 AI (소유자 승인, 항목 1·2·3 완료) — 항목 4·5·6은 운영자 직접 단계로 보류, 후반 일괄 처리 예정.

## v2.6.2 — 2026-10-16

- **원본 기준 커밋**: `bff09dd3d1d47e9b15e0e12aae78338fa95bfc75` (hada-notion/project1, main 최신, v2.6.1과 동일 커밋)
- **운영 반영 커밋**: `013df76a3e3eabfeb65d41cd3b2c6ea107bcf8b2` (main, squash 1개 커밋). 작업은 임시 브랜치 `v2.6.2-deploy`에 여러 커밋으로 올린 뒤 PR #1을 squash merge해 main에는 커밋 1개로만 반영(함수 배포 워크플로가 한 번만 트리거되도록).
- **반영 범위(항목 1·2·3, AI 자동, 완료)**: 원본 저장소 전체(화면·함수·마이그레이션·문서)를 커밋 기준으로 받아와 운영 값으로 치환.
  - 신규 함수 6개 배포: `admin-security`, `class-room`, `fill-record-units`, `kiosk-prepare`, `sync-class-room-copy`, `textbook-api`
  - 기존 함수 36개도 공용 모듈(`adminShared.ts`, `adminSecurity.ts` 등) 변경이 반영되도록 전부 재배포(총 42개 함수 배포 완료, OPTIONS 200 확인)
  - 코드에서 삭제: `mark-report-source-dirty`, `sync-registration-timetable`, `sync-student-report`, `_shared/registrationTimetableTarget.ts`, 옛 이름 출석 동기화 워크플로 2개(`sync-attendance-incremental-cron.yml`, `sync-attendance-reconcile-cron.yml` → 새 이름으로 교체)
  - 새 마이그레이션 16개 적용 완료(원본이 명시한 15개 + 목록에 없었지만 저장소에 포함돼 있던 `20261004010000_legal_document_numbers` 1개). 적용 후 `cron.job`에 `kiosk-prepare-daily`, `class-room-copy-first-fill`, `class-room-copy-incremental`, `class-room-copy-reconcile-sessions`·`-attendance`·`-records`·`-activities`, `library-copy-reconcile` 모두 등록 확인. `sync_cursors`에 `cr_sessions`·`cr_attendance`·`cr_records`·`lib_books`가 이미 값을 기록(적용 15~20분 후 확인, `cr_activities`는 아직 미기록 — 데이터 없을 수 있어 운영자 확인 권장)
  - `hada_config.js` 신규 생성(운영 Supabase 주소·anon 공개 키로 치환), README.md 안내 주소도 운영 값(`https://agnesengt-lang.github.io/brooks-english/`)으로 치환(치환 스크립트가 계정 도메인은 못 바꿔 `hada-notion.github.io`로 남았던 것을 직접 수정)
  - 운영 전용 문서 3개(`docs/버튼-웹훅-매핑.md`, `docs/새-학원-이식-체크리스트.md`, `docs/키오스크-처리-흐름.md`)는 원본 버전으로 덮지 않고 운영 버전 유지(원본은 아직 지침으로 받지 않은 더 앞선 기능들을 설명하고 있어 혼동 방지)
  - 화면 확인: GitHub Pages가 `admin_settings.html`·`class_room.html`·`library.html`·`hada_config.js`·`student_report.html` 모두 200으로 정상 서빙, `hada_config.js` 내용이 운영 Supabase 주소로 나오는 것 확인. 보안 모드(`ADMIN_SECURITY_ENABLED`)는 지침대로 켜지 않음(v2.6.5 예정)
  - ⚠️ GitHub Actions 워크플로 자체의 실행 여부는 이번에도 확인하지 못함(PR 상태 조회 결과 체크런 0건) — v2.5.x 때와 동일하게 Supabase MCP로 직접 배포해 코드 반영을 확인했으며, Actions 탭 확인은 운영자 권장 사항으로 남김
  - ⚠️ 알려진 제한 2건(낮은 우선순위): (1) 장식용 PNG 이미지 2개(`assets/admin-settings/menu-bulk-button.png`, `assets/brand/hada-wordmark.png`)는 바이너리 콘텐츠라 GitHub 파일 쓰기 도구로 옮기지 못함 — 관리자 설정 화면 아이콘 한두 개만 깨져 보일 뿐 기능 영향 없음. (2) 삭제 대상이었던 Supabase 함수 3개(`mark-report-source-dirty`, `sync-registration-timetable`, `sync-student-report`)는 코드 저장소에서는 지웠지만 Supabase 프로젝트에는 여전히 배포되어 있음(MCP에 함수 삭제 도구가 없음) — v2.6.1 항목 6의 Notion 자동화 정리가 끝나면 더 이상 호출되지 않으므로 기능상 무해하나, 운영자가 Supabase 대시보드에서 수동 삭제하면 완전히 정리됨
- **항목 4 (AI 자동, 완료)**: 위 반영·배포·검증 전체를 1회 커밋/배포로 수행
- **적용 주체**: 운영 AI (소유자 승인, 전체 완료)

## v2.6.3 — 2026-10-16

- **원본 기준 커밋**: `bff09dd3d1d47e9b15e0e12aae78338fa95bfc75` (hada-notion/project1, main 최신, v2.6.1·v2.6.2와 동일 커밋)
- **요약**: 학습기록의 `단원`을 수식에서 관계로 전환하고, "정규교재" 관계·DB 이름을 "라이브러리"로 통일.
- **항목 1 (N-9, AI 자동, 완료)**:
  - 학습기록(학원) DB: 기존 수식 속성 `단원`을 `단원(수식)`으로 이름만 변경(값·용도 보존, 나중에 N-12에서 삭제 예정). 사이드바 숨김으로 이동.
  - `notion_create_two_way_relation`으로 새 양방향 관계 속성 생성: 학습기록(학원) DB `단원` ↔ 단원목록(학원) DB `학습기록`(설명: "이 학습기록의 단원(단원목록 연결). [단원 입력]으로 범위에 맞게 채우거나 수업 관리에서 직접 고릅니다."). 레이아웃상 새 `단원`은 `범위`와 `내용` 사이에 배치.
- **항목 5 (N-13, AI 자동, 완료 — 권장 이름 통일)**:
  - "정규교재" 관계 속성명을 "라이브러리"로 변경(진도교재(학원)·교재배부(학원)·단원목록(학원)·과목(학원) DB 4곳). 교재배부·단원목록 DB는 테이블 뷰의 displayProperties가 옛 이름을 참조하고 있어, 같은 수정 안에 뷰의 displayProperties도 함께 새 이름으로 바꿔 반영.
  - 정규교재(학원) DB 자체 이름을 "라이브러리(학원) DB"로 변경.
  - 메뉴(학원) DB의 "정규교재" 행 이름을 "라이브러리"로 변경.
  - 이름 변경 후 관련 수식(진도교재 `진행도`, 교재배부 `교재비 금액` 등)의 내부 참조와 pinnedProperties가 자동으로 새 이름으로 반영된 것을 확인.
- **항목 2 (N-10, 운영자 직접, 대기)**: 학습기록(학원) DB에 버튼 `단원 입력` + 웹훅 액션 추가(URL `https://<학원 Supabase 주소>/functions/v1/fill-record-units`, 헤더 `x-admin-key` = 기존 버튼과 같은 Notion 웹훅 키). Notion API로는 버튼의 웹훅 액션(비밀 헤더 포함)을 만들 수 없어 운영자가 Notion 앱에서 직접 추가해야 함.
- **항목 3 (N-11, 운영자 직접 체인, 대기)**: 기존 학습기록에 `단원 입력` 버튼으로 단원을 채우는 작업. 현재 학습기록(학원) DB 전체 레코드는 4건뿐이며 전부 `범위`가 채워져 있어, 항목 2가 끝나면 운영자가 버튼을 4번 누르는 것으로 충분(대량 일괄 처리 불필요). 운영 AI는 웹훅의 `x-admin-key` 비밀값을 어떤 도구로도 읽을 수 없어 이 버튼을 대신 호출할 수 없음.
- **항목 4 (N-12, 체인 대기)**: 항목 2·3이 끝난 뒤, `단원(수식)` 삭제 전에 진도교재(학원) DB의 `최근 학습 범위`·`최근 학습 내용`·`진행도`, 출석(학원) DB의 `일일 학습 현황`, 학습활동(학원) DB의 `내용` 수식이 `단원(수식)`를 참조하지 않는지 확인 필요. 이 수식들은 내부적으로 불투명한 `current.‣` 참조 문법을 쓰고 있어 텍스트만으로는 참조 대상을 완전히 확인할 수 없음 — 운영자가 Notion 화면에서 수식 내용을 직접 확인해 주어야 함. 확인 후 `단원(수식)` 삭제.
- **적용 주체**: 운영 AI (소유자 승인, 항목 1·5 완료) — 항목 2·3·4는 운영자 직접/확인 체인으로 보류, 후반 일괄 처리 예정.
