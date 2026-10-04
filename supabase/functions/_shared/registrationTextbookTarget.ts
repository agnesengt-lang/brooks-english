// _shared/registrationTextbookTarget.ts
//
// sync-registration-textbook의 "개별교재 생성" 버튼(create-individual 라우트) 실제 로직을 별도
// 파일로 분리했다 (2026-09-18, 큐 기반 순차 처리 도입, Phase 3). cleanup-on-end 라우트는
// 다른 함수들이 내부적으로 동기 호출(fetch)해서 즉시 결과를 받아야 하므로 큐로 옮기지 않고
// index.ts에 그대로 둔다 (이 파일에서는 그 로직도 함께 두어 라우트 핸들러를 가벼게 유지한다).
//
// (2026-09-22, PART N-4: 개별 트리거 버튼 동기화 전환) create-individual 라우트도 등록 페이지 1건만
// 대상으로 하는 개별 트리거라 processCreateIndividualBooksQueueItem(process-sync-queue 전용
// 진입점)은 제거했다. index.ts가 createIndividualBooksForRegistration을 직접 호출한다.
//
// (2026-09-22, PART N-7: 클래스 "진도교재" 25개 제한 버그 수정) createIndividualBooksForRegistration이
// 클래스 페이지를 getPage로 통째로 읽어서 그 안의 "진도교재" relation을 후보로 쓰고 있었는데, Notion
// 페이지 조회 API는 relation 속성을 최대 25개까지만 돌려주고 나머지는 잘라버린다. "진도교재"는
// "클래스"<->"진도교재" 양방향 관계라 인스턴스가 생길 때마다 이 목록에도 자동으로 끼어들기 때문에,
// 개별 지도처럼 학생이 많이 쌓이는 클래스는 금방 25개를 넘기고 그 뒤로는 진짜 템플릿 일부가 후보
// 목록에서 조용히 사라진다 (실제로 "고등 과외" 클래스에서 템플릿 8개 중 4개가 이렇게 누락되어 개별
// 진도 교재 인스턴스가 일부만 생성되는 문제로 나타났다). 클래스 페이지를 거치지 않고, 진도교재
// 데이터소스를 "클래스 = 이 클래스"로 직접 쿼리(queryAllPages, 커서 끝까지 따라감)하도록 고쳤다.
//
// (2026-09-22, PART N-8: 클래스 "교재 생성" 버튼 라우트 누락 수정) 클래스(학원) DB "교재 생성" 버튼
// 자동화가 실제로는 sync-registration-textbook의 create-class 라우트를 호출하고 있었는데, 이
// 파일과 index.ts에는 create-individual/cleanup-on-end 두 라우트만 있었고 create-class는 애초에
// 구현된 적이 없었다 (항상 404 "알 수 없는 경로: create-class" — Supabase 로그로 실제 운영 클래스
// "고1 A반"에서도 확인됨, 화면에는 그냥 아무 반응 없음으로만 보였다). 클래스에 연결된 활성(🟢 수강
// 중) 등록 전체에 대해 createIndividualBooksForRegistration을 실행하는 createBooksForClass를
// 추가했다. 당시에는 create-individual과 동일한 runSyncWebhookForPage를 재사용해 즉시 응답 후
// EdgeRuntime.waitUntil 백그라운드에서 처리했다. pageId 자리에 classId를 넘기고, 잠금/상태 속성은
// 클래스 DB의 "교재 생성 상태"와 "마지막 오류"를 사용한다.
//
// (2026-10-04, PART N-13: "교재 생성" 버튼 경쟁 조건 + 대상 판정 버그 수정)
//
// [3-1. 동시성 제거] 위 createBooksForClass(mapWithConcurrency(..., 4, ...))는 클래스의 등록
// (학생) 여러 건을 동시에 처리했다. 그룹 진도 모드에서는 반별교재(템플릿) 페이지 "하나"를 반 전체
// 학생이 공유하는데, resolveInstanceForTemplate이 템플릿의 "등록" relation을 갱신할 때
// "읽고(read) → 고치고(modify) → 통째로 다시 쓰는(write)" 방식을 쓴다. 이 read-modify-write가
// 원자적이지 않아서, 같은 템플릿을 동시에 건드리는 학생 여러 명의 쓰기가 서로 경쟁(race)하면
// 나중에 쓴 쪽이 앞서 쓴 내용을 덮어써 버린다 (실제로 고1 A 클래스, 학생 5~6명 × 템플릿 4개
// 테스트에서 일부 학생-템플릿 쌍이 비거나 단방향으로만 연결되는 현상이 재현됨, 오류 메시지 없이
// "완료"로만 보였다). 동시 처리 건수가 많을수록(학생 수가 많을수록) 더 자주 재현됐다.
//
// 해결: 클래스 단위 배치를 send-class-daily-reports("보고서 일괄전송")와 동일한 "등록 1건 + 자기
// 호출 이어달리기(chained self-call)" 패턴으로 다시 짰다 (startClassTextbookChain/
// processClassTextbookChainStep, index.ts의 create-class 라우트 참고). 학생을 절대 동시에 처리하지
// 않으므로 템플릿 relation 경쟁이 구조적으로 사라진다. 매 학생 처리 시 등록(학원) DB의 "교재
// 상태"(TEXTBOOK_STATUS_SPEC)를 즉시 갱신해 실시간 진행 상황을 볼 수 있게 했고, 한 번 시도한
// 학생은 같은 체인 안에서 다시 재시도하지 않아 특정 학생이 계속 실패해도 다른 학생 처리를 막지
// 않는다. 체인 전체 30분 한도 안전장치도 포함했다.
//
// [3-2. 처리 대상 판정 방식 개선] 1차 수정(동시성 제거) 후 실사용 테스트에서 "완료로 표시된
// 학생은 새 템플릿이 추가돼도 다시 처리되지 않는다"는 구조적 한계가 추가로 발견됐다. 예전에는
// 등록의 "교재 상태"가 완료가 아닌 학생만 처리 대상으로 선정했는데, 템플릿이 나중에 추가되거나
// relation만 수동으로 바뀌어도 상태가 그대로면 영원히 대상에서 빠지는 문제가 있었다. 이제는
// 클래스의 템플릿 목록과 각 학생의 실제 relation 연결 상태를 직접 비교한다
// (registrationNeedsTextbookSync) — 모든 템플릿이 이미 연결된 학생은 빠르게 건너뛰고, 하나라도
// 빠진 학생만 처리한다. "교재 상태"는 더 이상 판정 기준이 아니며, 실시간 진행 표시용으로만
// 갱신한다. 덕분에 과거 경쟁 조건으로 남아있던 단방향 연결 상태도 자동으로 다시 잡혀 스스로
// 복구된다.

import {
	PROP_CLASS,
	PROP_LAST_ERROR,
	PROP_TITLE,
	DS_REGISTRATION,
	PROP_STATUS,
} from "./constants.ts"
import {
	getPage,
	queryDataSource,
	queryAllPages,
	createPage,
	updatePageProperties,
	archivePage,
	relationIds,
	selectName,
	statusName,
	titleText,
	formulaString,
} from "./notionClient.ts"
import { isRunning, markRunning, markDone, markError, type StatusSpec } from "./statusTracking.ts"
import { runInBackground, respondAccepted } from "./backgroundTask.ts"

// (2026-09-22, 처리 상태 관리 리팩토링 Phase 3) "교재 처리중" 체크박스(등록 DB, create-individual
// 라우트 전용) → "교재 상태"(select) + "교재 처리 시작 시각"(date). 마스터플랜:
// https://app.notion.com/p/903c90386c1d473494c5df6306c53517
export const TEXTBOOK_STATUS_SPEC: StatusSpec = {
	statusProp: "교재 상태",
	errorProp: PROP_LAST_ERROR,
	startedAtProp: "교재 처리 시작 시각",
}

// (2026-09-22, PART N-8 -> Phase 3 전환) 클래스(학원) DB "교재 생성" 버튼 전용 상태. "교재 생성중"
// 체크박스 -> "교재 생성 상태"(select) + "교재 생성 처리 시작 시각"(date). 클래스 DB의 "마지막
// 오류"는 수강료 생성/보고서 생성 등과 공유하는 필드다(PROP_LAST_ERROR, 값 동일). 마스터플랜:
// https://app.notion.com/p/903c90386c1d473494c5df6306c53517
export const CLASS_TEXTBOOK_STATUS_SPEC: StatusSpec = {
	statusProp: "교재 생성 상태",
	errorProp: PROP_LAST_ERROR,
	startedAtProp: "교재 생성 처리 시작 시각",
}

const DATA_SOURCE_PROGRESS_BOOK = Deno.env.get("DATA_SOURCE_PROGRESS_BOOK_ID")! // 진도교재(학원) DB

// 진도교재(학원) DB 속성 이름
const PROP_BOOK_TITLE = "진도교재" // title
const PROP_TEMPLATE_RELATION = "반별교재" // 인스턴스 -> 템플릿 (self-relation, limit 1)
const PROP_PROGRESS_MODE = "진도방식" // 개별 진도 | 그룹 진도
const PROP_PROGRESS_STATUS = "진행상태" // 다음 교재 | 진행 중 | 미사용 | 완료
const PROP_REGULAR_BOOK = "정규교재" // relation
const PROP_CLASS_ON_BOOK = "클래스" // relation (진도교재 DB 쪽)
const PROP_REGISTRATION_ON_BOOK = "등록" // relation
const PROP_LEARNING_RECORD = "학습기록" // relation
const PROP_REGISTRATION_BOOKS = "진도교재" // 등록 DB 쪽 relation
const STATUS_NEXT = "다음 교재"

// 클래스(학원) DB "교재 생성" 버튼 대상 판정 기준. 보고서 생성/수강료 생성/교재비 생성 등 다른
// 클래스 단위 일괄 버튼과 동일하게 "현재 🟢 수강 중"인 등록만 대상으로 한다.
const STATUS_ACTIVE = "🟢 수강 중"

// (PART N-13) 클래스에 연결된 반별교재(템플릿) 전체를 가져온다. candidates에는 진짜 템플릿 외에도
// 이미 생성된 개별교재 인스턴스가 섞여 있다 (둘 다 "클래스"를 갖기 때문). 진짜 템플릿은 절대
// PROP_TEMPLATE_RELATION("반별교재")이 채워지지 않으므로, 그것으로만 필터링해서 인스턴스가 실수로
// "템플릿"으로 취급되어 또 다른 인스턴스를 낳는(무한 증식) 일을 막는다 (createIndividualBooksForRegistration의
// 기존 로직을 재사용 가능하도록 분리함 — 클래스 단위 체인에서 매 학생마다 재조회한다).
async function getTemplatePagesForClass(classId: string): Promise<{ templatePages: any[]; candidateCount: number }> {
	// (PART N-7) 클래스 페이지를 getPage로 읽어서 그 안의 "진도교재" relation을 쓰면 25개까지만
	// 돌아온다 (Notion 페이지 조회 API의 relation 절단 제약). 그 대신 진도교재 데이터소스를
	// "클래스 = 이 클래스"로 직접 쿼리한다 - queryAllPages가 커서를 끝까지 따라가므로 개수 제한
	// 없이 전부 가져온다.
	const candidates = await queryAllPages(DATA_SOURCE_PROGRESS_BOOK, {
		property: PROP_CLASS_ON_BOOK,
		relation: { contains: classId },
	})
	const templatePages = candidates.filter((p: any) => relationIds(p, PROP_TEMPLATE_RELATION).length === 0)
	return { templatePages, candidateCount: candidates.length }
}

// (PART N-13) registrationId가 templatePage 하나에 대해 이미 연결(그룹 진도) 또는 인스턴스를
// 보유(개별 진도)하고 있는지 읽기 전용으로 확인한다. 그룹 진도는 templatePage에 이미 로드된
// "등록" relation을 그대로 보면 되므로 추가 조회가 없고, 개별 진도만 (등록+템플릿) 조합의
// 인스턴스 존재 여부를 쿼리한다.
async function isTemplateLinkedForRegistration(registrationId: string, templatePage: any): Promise<boolean> {
	const templateId = templatePage.id
	const mode = selectName(templatePage, PROP_PROGRESS_MODE) ?? "그룹 진도"

	if (mode === "그룹 진도") {
		return relationIds(templatePage, PROP_REGISTRATION_ON_BOOK).includes(registrationId)
	}

	const already = await queryDataSource(DATA_SOURCE_PROGRESS_BOOK, {
		filter: {
			and: [
				{ property: PROP_REGISTRATION_ON_BOOK, relation: { contains: registrationId } },
				{ property: PROP_TEMPLATE_RELATION, relation: { contains: templateId } },
			],
		},
		page_size: 1,
	})
	return already.results.length > 0
}

// (PART N-13, 3-2) 이 등록에게 templatePages 중 아직 연결되지 않은 템플릿이 하나라도 있으면
// true(= 처리 대상)를 반환한다. "교재 상태"(select)는 더 이상 판정 기준으로 쓰지 않는다 — 템플릿이
// 나중에 추가되거나 relation만 수동으로 바뀌어도 상태 값과 무관하게 항상 실제 연결 상태를 본다.
export async function registrationNeedsTextbookSync(registrationId: string, templatePages: any[]): Promise<boolean> {
	for (const templatePage of templatePages) {
		const linked = await isTemplateLinkedForRegistration(registrationId, templatePage)
		if (!linked) return true
	}
	return false
}

// 반별교재(템플릿) 하나를 보고, 이 등록에 연결할 개별교재 인스턴스를 확보한다.
// - 그룹 진도: 반 전체가 인스턴스 "하나"를 공유한다. 이미 이 템플릿의 인스턴스가 있으면
//   새로 만들지 않고 그 인스턴스에 이 등록을 추가로 연결(등록 relation에 추가)만 한다.
// - 개별 진도: 학생(등록)마다 자기만의 인스턴스를 갖는다. 이미 (이 등록 + 이 템플릿)
//   조합의 인스턴스가 있으면 건너뛰고, 없으면 새로 만든다.
// 주의: 등록 페이지의 "진도교재" relation은 여기서 건드리지 않는다. 호출부
// (createIndividualBooksForRegistration)에서 결과를 모아 마지막에 한 번만 반영한다.
// (PART N-13) 클래스 "교재 생성" 체인은 이제 학생을 한 번에 한 명씩만 처리하므로, 이 함수가
// 템플릿의 "등록" relation을 read-modify-write 하더라도 서로 다른 학생의 쓰기가 경쟁하지 않는다.
async function resolveInstanceForTemplate(registrationId: string, templatePage: any) {
	const templateId = templatePage.id
	const mode = selectName(templatePage, PROP_PROGRESS_MODE) ?? "그룹 진도"

	// 그룹 진도: 반별교재(템플릿) 페이지 자체가 곧 반 전체가 쓰는 "그 교재"이다 - 별도 인스턴스를
	// 찾거나 만들지 않고, 이 등록을 템플릿 자체의 "등록" relation에만 추가로 연결한다.
	if (mode === "그룹 진도") {
		const registrationIds = relationIds(templatePage, PROP_REGISTRATION_ON_BOOK)
		if (!registrationIds.includes(registrationId)) {
			await updatePageProperties(templateId, {
				[PROP_REGISTRATION_ON_BOOK]: { relation: [...registrationIds, registrationId].map((id) => ({ id })) },
			})
		}
		return { instanceId: templateId, linked: true }
	} else {
		const already = await queryDataSource(DATA_SOURCE_PROGRESS_BOOK, {
			filter: {
				and: [
					{ property: PROP_REGISTRATION_ON_BOOK, relation: { contains: registrationId } },
					{ property: PROP_TEMPLATE_RELATION, relation: { contains: templateId } },
				],
			},
			page_size: 1,
		})
		if (already.results.length > 0) return { instanceId: already.results[0].id, linked: true }
	}

	const regularBookIds = relationIds(templatePage, PROP_REGULAR_BOOK)
	const classIds = relationIds(templatePage, PROP_CLASS_ON_BOOK)
	const templateTitle = titleText(templatePage, PROP_BOOK_TITLE) ?? "진도교재"

	const properties: Record<string, unknown> = {
		[PROP_BOOK_TITLE]: { title: [{ text: { content: templateTitle } }] },
		[PROP_TEMPLATE_RELATION]: { relation: [{ id: templateId }] },
		[PROP_PROGRESS_MODE]: { select: { name: mode } },
		// 새 인스턴스는 아직 진도를 시작하지 않았으니 "다음 교재"로 생성한다.
		// 실제로 진도를 시작할 때 사용자가 "진행 중"으로 수동 전환한다.
		[PROP_PROGRESS_STATUS]: { status: { name: STATUS_NEXT } },
		[PROP_REGISTRATION_ON_BOOK]: { relation: [{ id: registrationId }] },
	}
	if (regularBookIds.length > 0) properties[PROP_REGULAR_BOOK] = { relation: [{ id: regularBookIds[0] }] }
	if (classIds.length > 0) properties[PROP_CLASS_ON_BOOK] = { relation: [{ id: classIds[0] }] }

	const page = await createPage(DATA_SOURCE_PROGRESS_BOOK, properties)
	return { instanceId: page.id, created: true }
}

// 등록에 연결된 클래스의 반별교재(템플릿) 전체를 그룹/개별 진도 규칙에 따라 연결하거나 생성한다.
// 클래스가 없거나 템플릿이 하나도 없으면 건너뛴다 (에러로 취급하지 않음 - 클래스 세팅 전에도
// 버튼을 눌러볼 수 있어야 하며, 그 경우 안내만 반환한다).
//
// (PART N-13) preloadedTemplatePages를 넘기면 getTemplatePagesForClass를 다시 호출하지 않는다 -
// 클래스 "교재 생성" 체인이 매 학생 단계에서 이미 조회해둔 템플릿 목록을 그대로 재사용해 대상 판정과
// 실제 생성에 드는 조회 횟수를 절반으로 줄인다. create-individual(등록 DB 개별 버튼)처럼 단건으로
// 호출할 때는 생략하면 된다(기존과 동일하게 내부에서 조회한다).
export async function createIndividualBooksForRegistration(
	registrationId: string,
	preloadedTemplatePages?: any[],
) {
	const registration = await getPage(registrationId)
	const classIds = relationIds(registration, PROP_CLASS)
	if (classIds.length === 0) return { skipped: "클래스가 아직 연결되어 있지 않음" }

	const { templatePages, candidateCount } = preloadedTemplatePages
		? { templatePages: preloadedTemplatePages, candidateCount: preloadedTemplatePages.length }
		: await getTemplatePagesForClass(classIds[0])
	if (candidateCount === 0) return { skipped: "클래스에 반별교재(템플릿)가 아직 없음 - 먼저 진도교재 DB에서 템플릿을 만들어 클래스에 연결하세요" }
	if (templatePages.length === 0) {
		return { skipped: "클래스에 연결된 진도교재 중 진짜 템플릿이 없음 (전부 이미 생성된 개별교재 인스턴스로 보임)" }
	}

	// (PART N-13) 템플릿을 절대 동시에(concurrency로) 처리하지 않는다 - 그룹 진도 템플릿은 반 전체
	// 학생이 공유하므로, 같은 학생이 템플릿 여러 개를 동시에 처리해도 서로 다른 템플릿이라 경쟁은
	// 없지만, 호출부(클래스 체인)가 학생 자체를 순차로만 넘기도록 보장해야 진짜 경쟁(같은 템플릿을
	// 여러 학생이 동시에 건드리는 것)이 사라진다. 여기서는 순서만 순차로 바꿔 코드를 단순하게 둔다.
	const results: Array<{ instanceId: string; linked?: boolean; created?: boolean }> = []
	for (const templatePage of templatePages) {
		results.push(await resolveInstanceForTemplate(registrationId, templatePage))
	}

	// 등록의 "진도교재" relation은 여기서 한 번만 최신 상태를 읽어서 반영한다 (동시 처리로 인한
	// read-modify-write 유실 방지).
	const freshRegistration = await getPage(registrationId)
	const existingBookIds = relationIds(freshRegistration, PROP_REGISTRATION_BOOKS)
	const newIds = results.map((r) => r.instanceId).filter((id) => !existingBookIds.includes(id))
	if (newIds.length > 0) {
		await updatePageProperties(registrationId, {
			[PROP_REGISTRATION_BOOKS]: { relation: [...existingBookIds, ...newIds].map((id) => ({ id })) },
		})
	}

	return { results }
}

// 클래스에 연결된 등록 중 현재 "🟢 수강 중"인 등록만 반환한다. (PART N-8) 보고서 생성/수강료 생성/
// 교재비 생성처럼 "학생수" 수식과 같은 기준으로 대상을 정한다 -- 종료된 학생은 새로 교재를 만들
// 필요가 없기 때문이다.
async function getActiveRegistrationsForClassNow(classId: string): Promise<any[]> {
	const registrations = await queryAllPages(DS_REGISTRATION, {
		property: PROP_CLASS,
		relation: { contains: classId },
	})
	return registrations.filter((reg: any) => formulaString(reg, PROP_STATUS) === STATUS_ACTIVE)
}

// ---------- (PART N-13) 클래스 "교재 생성" 버튼: 등록 1건 + 자기 호출 이어달리기 ----------
//
// send-class-daily-reports(수업 보고서 "일괄 전송")와 동일한 패턴. 학생을 절대 동시에 처리하지
// 않아서 템플릿 relation 경쟁 조건이 구조적으로 사라진다. index.ts의 create-class 라우트가 최초
// 호출과 연속 호출(continuation) 두 경우 모두 이 모듈의 함수를 쓴다.

const FUNCTIONS_BASE = `${Deno.env.get("SB_URL") ?? ""}/functions/v1`
const CLASS_TEXTBOOK_CONTINUATION_FLAG = "isContinuation"
const CLASS_TEXTBOOK_CHAIN_BUDGET_MS = 30 * 60 * 1000
// send-class-daily-reports와 동일하게 60초 - 30초는 Notion API가 살짝 느려지기만 해도 다음 학생
// 호출이 타임아웃으로 끊길 여지가 있었다.
const CLASS_TEXTBOOK_CONTINUATION_TIMEOUT_MS = 60_000

export type ClassTextbookChainState = {
	classId: string
	remainingRegistrationIds: string[]
	chainStartedAt: number
	successCount: number
	skippedCount: number
	failedNames: string[]
}

function classTextbookFinalMessage(state: ClassTextbookChainState): string | null {
	if (!state.failedNames.length) return null
	return `${state.failedNames.length}명 실패: ${state.failedNames.join(", ")}`
}

async function callNextClassTextbookChain(state: ClassTextbookChainState, adminKey: string): Promise<void> {
	const controller = new AbortController()
	const timeoutId = setTimeout(() => controller.abort(), CLASS_TEXTBOOK_CONTINUATION_TIMEOUT_MS)
	try {
		const res = await fetch(`${FUNCTIONS_BASE}/sync-registration-textbook/create-class`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "x-admin-key": adminKey },
			body: JSON.stringify({ ...state, [CLASS_TEXTBOOK_CONTINUATION_FLAG]: true }),
			signal: controller.signal,
		})
		if (!res.ok) throw new Error(`다음 학생 호출 실패: ${res.status} ${await res.text()}`)
	} finally {
		clearTimeout(timeoutId)
	}
}

async function finishClassTextbookChain(state: ClassTextbookChainState, message: string | null): Promise<void> {
	try {
		if (message) await markError(state.classId, CLASS_TEXTBOOK_STATUS_SPEC, message)
		else await markDone(state.classId, CLASS_TEXTBOOK_STATUS_SPEC)
	} catch (_e) {
		// 상태 표시 실패가 이미 처리된 개별 학생 결과를 바꾸지는 않는다.
	}
}

// 체인의 한 스텝: 학생 1명 처리(또는 건너뛰기) + 다음 학생 자기 호출. index.ts가 최초 호출과
// continuation 호출 양쪽 모두에서 이 함수를 runInBackground로 감싸 호출한다.
export async function processClassTextbookChainStep(state: ClassTextbookChainState, adminKey: string): Promise<void> {
	if (Date.now() - state.chainStartedAt > CLASS_TEXTBOOK_CHAIN_BUDGET_MS) {
		await finishClassTextbookChain(
			state,
			`전체 처리 한도(${Math.round(CLASS_TEXTBOOK_CHAIN_BUDGET_MS / 60000)}분)를 초과했습니다. 완료 ${state.successCount}명, 건너뜀 ${state.skippedCount}명, 실패 ${state.failedNames.length}명. 버튼을 다시 눌러 남은 학생을 이어서 처리하세요.`,
		)
		return
	}

	const registrationId = state.remainingRegistrationIds.shift()
	if (!registrationId) {
		await finishClassTextbookChain(state, classTextbookFinalMessage(state))
		return
	}

	try {
		// (3-2) "교재 상태"가 아니라, 클래스의 템플릿 목록과 이 등록의 실제 relation 연결 상태를
		// 매번 새로 조회해서 직접 비교한다 - 항상 최신 상태를 기준으로 판정한다.
		const { templatePages } = await getTemplatePagesForClass(state.classId)
		const needsSync = templatePages.length > 0 && (await registrationNeedsTextbookSync(registrationId, templatePages))

		if (!needsSync) {
			state.skippedCount++
		} else {
			await markRunning(registrationId, TEXTBOOK_STATUS_SPEC)
			try {
				await createIndividualBooksForRegistration(registrationId, templatePages)
				await markDone(registrationId, TEXTBOOK_STATUS_SPEC)
				state.successCount++
			} catch (err) {
				await markError(registrationId, TEXTBOOK_STATUS_SPEC, (err as Error).message)
				throw err
			}
		}
	} catch (err) {
		let name = registrationId
		try {
			const page = await getPage(registrationId)
			name = titleText(page, PROP_TITLE) ?? registrationId
		} catch (_e) {
			// 이름을 못 읽어도 다음 학생 처리는 계속한다.
		}
		state.failedNames.push(name)
	}

	if (!state.remainingRegistrationIds.length) {
		await finishClassTextbookChain(state, classTextbookFinalMessage(state))
		return
	}

	try {
		await callNextClassTextbookChain(state, adminKey)
	} catch (err) {
		await finishClassTextbookChain(
			state,
			`체인 중단: ${(err as Error).message}. 버튼을 다시 누르면 처리된 학생은 건너뛰고 이어서 처리합니다.`,
		)
	}
}

// index.ts의 create-class 라우트가 최초 버튼 클릭 시 호출하는 진입점. 이미 처리 중이면
// already_processing을 바로 응답하고, 아니면 "작업중"으로 표시한 뒤 백그라운드에서 체인을
// 시작하고 즉시 202를 응답한다 (Notion 버튼이 응답을 오래 기다리지 않도록).
export async function startClassTextbookChain(classId: string, adminKey: string): Promise<Response> {
	const classPage = await getPage(classId)
	if (isRunning(classPage, CLASS_TEXTBOOK_STATUS_SPEC)) {
		return new Response(JSON.stringify({ ok: true, message: "already_processing", classId }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		})
	}

	await markRunning(classId, CLASS_TEXTBOOK_STATUS_SPEC)

	const registrations = await getActiveRegistrationsForClassNow(classId)
	if (!registrations.length) {
		await finishClassTextbookChain(
			{ classId, remainingRegistrationIds: [], chainStartedAt: Date.now(), successCount: 0, skippedCount: 0, failedNames: [] },
			null,
		)
		return respondAccepted({ classId, total: 0 })
	}

	const state: ClassTextbookChainState = {
		classId,
		remainingRegistrationIds: registrations.map((r: any) => r.id),
		chainStartedAt: Date.now(),
		successCount: 0,
		skippedCount: 0,
		failedNames: [],
	}

	runInBackground(() => processClassTextbookChainStep(state, adminKey))
	return respondAccepted({ classId, total: state.remainingRegistrationIds.length })
}

// 종료 처리 시 교재 정리: "다음 교재" 상태 + 학습기록 없음 인 인스턴스만 정리 대상.
// 그룹 진도 -> 등록에서 연결만 해제 (인스턴스 페이지는 보존)
// 개별 진도 -> 인스턴스 페이지 자체를 아카이브
// 그 외(진행 중/완료 상태이거나 학습기록이 있음)는 절대 건드리지 않고 그대로 둔다.
export async function cleanupUnusedBooksOnEnd(registrationId: string) {
	const registration = await getPage(registrationId)
	const bookIds = relationIds(registration, PROP_REGISTRATION_BOOKS)
	const unlinked: string[] = []
	const deleted: string[] = []
	const kept: string[] = []
	let remaining = bookIds

	for (const bookId of bookIds) {
		const book = await getPage(bookId)
		const mode = selectName(book, PROP_PROGRESS_MODE)
		const status = statusName(book, PROP_PROGRESS_STATUS)
		const hasRecords = relationIds(book, PROP_LEARNING_RECORD).length > 0

		if (status !== STATUS_NEXT || hasRecords) {
			kept.push(bookId)
			continue
		}

		if (mode === "그룹 진도") {
			remaining = remaining.filter((id) => id !== bookId)
			unlinked.push(bookId)
			// 그룹 진도 교재는 반 전체가 공유하므로, 이 등록만 해당 교재의 "등록" relation에서 뺀다
			// (인스턴스 자체는 다른 학생들이 계속 쓰므로 보존).
			const bookRegistrationIds = relationIds(book, PROP_REGISTRATION_ON_BOOK).filter((id) => id !== registrationId)
			await updatePageProperties(bookId, {
				[PROP_REGISTRATION_ON_BOOK]: { relation: bookRegistrationIds.map((id) => ({ id })) },
			})
		} else {
			await archivePage(bookId)
			deleted.push(bookId)
			remaining = remaining.filter((id) => id !== bookId)
		}
	}

	if (unlinked.length > 0 || deleted.length > 0) {
		await updatePageProperties(registrationId, {
			[PROP_REGISTRATION_BOOKS]: { relation: remaining.map((id) => ({ id })) },
		})
	}

	return { unlinked, deleted, kept }
}
