// v2.5.7 회귀 테스트: 개별교재 귀속(클래스 미연결)·네이밍(정규교재명(등록명))·템플릿 오인 방지.
// 운영 PART N-13 체인 구조(원본 diff 시점에는 없던 구조) 위에서 동작을 검증한다.
// Notion API 경계는 전부 fetch 모의로 대체하며 실제 Notion/Supabase에 쓰지 않는다.

function assert(v: unknown, msg = "assertion failed") {
	if (!v) throw new Error(msg)
}

for (const [k, v] of Object.entries({
	NOTION_TOKEN: "mock",
	DATA_SOURCE_PROGRESS_BOOK_ID: "progress-book",
	DATA_SOURCE_REGISTRATION_ID: "registrations",
	SB_URL: "https://mock.supabase",
})) Deno.env.set(k, v)

const { createIndividualBooksForRegistration, registrationNeedsTextbookSync } = await import(
	"./registrationTextbookTarget.ts"
)

const rel = (ids: string[]) => ({ relation: ids.map((id) => ({ id })) })
const titleOf = (...parts: string[]) => ({ title: parts.map((p) => ({ plain_text: p, text: { content: p } })) })

function matchCond(page: any, cond: any): boolean {
	if (cond.and) return cond.and.every((c: any) => matchCond(page, c))
	if (cond.or) return cond.or.some((c: any) => matchCond(page, c))
	const prop = page.properties[cond.property]
	if (cond.relation) return (prop?.relation ?? []).some((r: any) => r.id === cond.relation.contains)
	return false
}

// 공용 모의 fetch: progress-book 데이터소스 쿼리 + 임의 페이지 get/patch/create를 지원한다.
function makeMockFetch(state: { pages: Record<string, any>; progressBooks: any[]; created: any[] }) {
	return async (input: any, init: any = {}) => {
		const url = String(input)
		const body = init.body ? JSON.parse(init.body) : {}
		const dsMatch = url.match(/\/data_sources\/([^/]+)\/query/)
		if (dsMatch) {
			assert(dsMatch[1] === "progress-book", "예상치 못한 데이터소스 쿼리: " + dsMatch[1])
			let results = state.progressBooks
			if (body.filter) results = results.filter((p) => matchCond(p, body.filter))
			return new Response(JSON.stringify({ results, has_more: false }), { status: 200 })
		}
		const pageMatch = url.match(/\/pages\/([^/?]+)$/)
		if (pageMatch && (!init.method || init.method === "GET")) {
			const page = state.pages[pageMatch[1]]
			assert(page, "존재하지 않는 페이지 조회: " + pageMatch[1])
			return new Response(JSON.stringify(page), { status: 200 })
		}
		if (pageMatch && init.method === "PATCH") {
			const page = state.pages[pageMatch[1]]
			assert(page, "존재하지 않는 페이지 수정: " + pageMatch[1])
			Object.assign(page.properties, body.properties)
			return new Response(JSON.stringify(page), { status: 200 })
		}
		if (url.endsWith("/pages") && init.method === "POST") {
			const page = { id: "new-" + state.created.length, properties: body.properties }
			state.pages[page.id] = page
			state.progressBooks.push(page)
			state.created.push(page)
			return new Response(JSON.stringify(page), { status: 200 })
		}
		throw new Error("모의 처리되지 않은 요청: " + url)
	}
}

// 그룹 진도 템플릿 1개 + 정규교재 연결된 개별 진도 템플릿 1개 + 학생에게 "직접 만들었는데 실수로
// 클래스에도 연결된" 개별교재(다른 등록이 이미 연결됨) 1개로 구성된 표준 픽스처.
function fixture() {
	const pages: Record<string, any> = {}
	function addPage(id: string, properties: any) {
		pages[id] = { id, properties }
		return pages[id]
	}
	addPage("book-regular", { "교재명": titleOf("기초 ", "영문법") }) // 제목이 두 조각으로 나뉨
	addPage("reg-1", { "이름": titleOf("김민준"), "클래스": rel(["class-1"]), "진도교재": rel([]) })
	const tmplGroup = addPage("tmpl-group", {
		"클래스": rel(["class-1"]),
		"반별교재": rel([]),
		"진도방식": { select: { name: "그룹 진도" } },
		"정규교재": rel([]),
		"등록": rel([]),
	})
	const tmplIndiv = addPage("tmpl-indiv", {
		"클래스": rel(["class-1"]),
		"반별교재": rel([]),
		"진도방식": { select: { name: "개별 진도" } },
		"정규교재": rel(["book-regular"]),
		"등록": rel([]),
	})
	const strayIndiv = addPage("stray-indiv", {
		"클래스": rel(["class-1"]), // 실수로 클래스에 연결된 직접 생성 개별교재
		"반별교재": rel([]),
		"진도방식": { select: { name: "개별 진도" } },
		"정규교재": rel(["book-regular"]),
		"등록": rel(["reg-other"]),
	})
	const progressBooks = [tmplGroup, tmplIndiv, strayIndiv]
	const created: any[] = []
	return { pages, progressBooks, created, fetch: makeMockFetch({ pages, progressBooks, created }) }
}

Deno.test("새 개별교재는 클래스를 직접 연결하지 않고 제목은 정규교재명(등록명)", async () => {
	const f = fixture()
	const originalFetch = globalThis.fetch
	globalThis.fetch = f.fetch as typeof fetch
	try {
		await createIndividualBooksForRegistration("reg-1")
		const newBook = f.created.find((p) => p.properties["반별교재"]?.relation?.[0]?.id === "tmpl-indiv")
		assert(newBook, "개별 진도 인스턴스가 생성되어야 함")
		assert(newBook.properties["클래스"] === undefined, "새 개별교재는 클래스를 직접 연결하지 않음")
		assert(
			newBook.properties["진도교재"].title[0].text.content === "기초 영문법(김민준)",
			"제목은 정규교재명(등록명), 여러 서식 조각도 합쳐짐: " + JSON.stringify(newBook.properties["진도교재"]),
		)
		assert(
			f.pages["tmpl-group"].properties["등록"].relation.map((r: any) => r.id).includes("reg-1"),
			"그룹 진도는 복사 없이 템플릿 자체의 등록에만 추가",
		)
		assert(
			f.created.every((p) => p.properties["반별교재"]?.relation?.[0]?.id !== "stray-indiv"),
			"직접 생성되어 클래스에 잘못 연결된 개별교재는 배포 기준(템플릿)으로 쓰이지 않음",
		)
	} finally {
		globalThis.fetch = originalFetch
	}
})

Deno.test("정규교재 미연결 템플릿은 '정규교재 연결 필요'로 표시", async () => {
	const pages: Record<string, any> = {
		"reg-2": { id: "reg-2", properties: { "이름": titleOf("박서연"), "클래스": rel(["class-2"]), "진도교재": rel([]) } },
		"tmpl-indiv-2": {
			id: "tmpl-indiv-2",
			properties: {
				"클래스": rel(["class-2"]),
				"반별교재": rel([]),
				"진도방식": { select: { name: "개별 진도" } },
				"정규교재": rel([]),
				"등록": rel([]),
			},
		},
	}
	const progressBooks = [pages["tmpl-indiv-2"]]
	const created: any[] = []
	const originalFetch = globalThis.fetch
	globalThis.fetch = makeMockFetch({ pages, progressBooks, created }) as typeof fetch
	try {
		await createIndividualBooksForRegistration("reg-2")
		assert(created.length === 1)
		assert(
			created[0].properties["진도교재"].title[0].text.content === "정규교재 연결 필요(박서연)",
			"정규교재가 없으면 '정규교재 연결 필요'로 표시: " + JSON.stringify(created[0].properties["진도교재"]),
		)
	} finally {
		globalThis.fetch = originalFetch
	}
})

Deno.test("이미 연결된 조합은 재생성하지 않고, 동기화 필요 여부도 false로 바뀜", async () => {
	const f = fixture()
	const originalFetch = globalThis.fetch
	globalThis.fetch = f.fetch as typeof fetch
	try {
		await createIndividualBooksForRegistration("reg-1")
		const createdAfterFirstRun = f.created.length
		const templatePages = f.progressBooks.filter((p) => ["tmpl-group", "tmpl-indiv"].includes(p.id))
		assert((await registrationNeedsTextbookSync("reg-1", templatePages)) === false, "첫 실행 후에는 동기화 불필요")

		await createIndividualBooksForRegistration("reg-1")
		assert(f.created.length === createdAfterFirstRun, "재실행 시 새 인스턴스를 또 만들지 않음")
	} finally {
		globalThis.fetch = originalFetch
	}
})
