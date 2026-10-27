// End-to-end handler test with every network boundary mocked; never writes real Notion/Supabase.
import { reconcileDeadline } from "../_shared/assignmentDeadline.ts"
function assert(v: unknown,msg="assertion failed"){if(!v)throw new Error(msg)}
for(const [name,value] of Object.entries({ADMIN_SECRET:"test-only",SB_URL:"https://mock.supabase",SB_SERVICE_ROLE_KEY:"test-only",NOTION_TOKEN:"mock",DATA_SOURCE_TIMETABLE_ID:"timetables",DATA_SOURCE_CLASS_SESSION_ID:"sessions",DATA_SOURCE_CLASS_ID:"classes",DATA_SOURCE_ATTENDANCE_ID:"attendance",DATA_SOURCE_REGISTRATION_ID:"registrations",DATA_SOURCE_SCHEDULE_EVENT_ID:"events",DATA_SOURCE_STUDY_ACTIVITY_ID:"activities"}))Deno.env.set(name,value)
let handler: (r:Request)=>Promise<Response>
const serve=Deno.serve;(Deno as any).serve=(h:any)=>{handler=h;return {}}
await import("./index.ts");const { processFixAttendanceQueueItem } = await import("../_shared/fixAttendanceTarget.ts");(Deno as any).serve=serve
const rel=(id?:string)=>({relation:id?[{id}]:[]})
const txt=(s:string)=>({rich_text:[{plain_text:s,text:{content:s}}]})
function mock(){
 const tasks:Promise<unknown>[]=[]; const pages:any={menu:{id:"menu",properties:{"상태":{select:{name:"⚪ 대기"}}}},class:{id:"class",properties:{"클래스명":{title:[{plain_text:"Mock Class"}]},"담당강사":rel("teacher")}}}
 const timetables=[{id:"fri",day:"금",date:"2026-10-09"},{id:"wed",day:"수",date:"2026-10-07"},{id:"mon",day:"월",date:"2026-10-05"}].map(t=>{const p={id:t.id,properties:{"클래스":rel("class"),"요일":{select:{name:t.day}},"등원시간(HH:mm)":txt("20:00"),"하원시간(HH:mm)":txt("21:00"),"상태":{select:{name:"⚪ 대기"}}}};pages[t.id]=p;pages["old-"+t.id]={id:"old-"+t.id,db:"sessions",properties:{"시간표":rel(t.id),"수업일시":{date:{start:t.date+"T20:00:00+09:00"}},"학습기록":rel("record")}};return p})
 pages.record={id:"record",properties:{"구분":{select:{name:"과제"}},"등록":{relation:[{id:"a"},{id:"b"}]}}}
 for(const id of ["a","b"]){pages["source-"+id]={id:"source-"+id,db:"attendance",properties:{"등록":rel(id),"수업일시":{date:{start:"2026-10-09T20:00:00+09:00"}},"수업":rel("old-fri")}};pages["task-"+id]={id:"task-"+id,db:"activities",properties:{"등록":rel(id),"출석":rel("source-"+id),"학습기록":rel("record"),"과제상태":{select:{name:"🔴 미제출"}},"과제 마감":rel(),"자동 마감 기준":rel()}}}
 const created:any[]=[],calls:any[]=[]
 const result=(results:any[])=>new Response(JSON.stringify({results,has_more:false}),{status:200})
 const fetch=async(input:any,init:any={})=>{
  const url=String(input),body=init.body?JSON.parse(init.body):{};calls.push({url,body})
  if(url.includes("/functions/v1/generate-classes"))return await handler(new Request(url,{...init}))
  if(url.startsWith("https://mock.supabase"))return new Response("{}",{status:202})
  const db=url.match(/\/data_sources\/([^/]+)\/query/)?.[1]
  if(db){
   if(db==="timetables")return result(timetables)
   if(db==="sessions"){
    const filters=body.filter.and??[body.filter];const tid=filters.find((x:any)=>x.property==="시간표").relation.contains
    const eq=filters.find((x:any)=>x.property==="수업일시")?.date?.equals
    return result(Object.values(pages).filter((p:any)=>p.db==="sessions"&&p.properties["시간표"].relation[0].id===tid&&(!eq||Date.parse(p.properties["수업일시"].date.start)===Date.parse(eq))).sort((a:any,b:any)=>Date.parse(b.properties["수업일시"].date.start)-Date.parse(a.properties["수업일시"].date.start)).slice(0,body.page_size??100))
   }
   if(db==="events")return result((pages.__events as any)??[])
   if(db==="registrations")return result((pages.__registrations as any)??["a","b"].map(id=>({id,properties:{}})))
   if(db==="activities"){const f0=body.filter.and[0];const regs=f0.or?f0.or.map((x:any)=>x.relation.contains):[f0.relation.contains];return result(regs.map((r:string)=>pages["task-"+r]).filter(Boolean))}
   if(db==="attendance")return result([])
   throw new Error("unknown mock database "+db)
  }
  const id=url.match(/\/pages\/([^/?]+)/)?.[1]
  if(id){assert(pages[id],"missing page "+id);if(init.method==="PATCH")Object.assign(pages[id].properties,body.properties);return new Response(JSON.stringify(pages[id]))}
  if(url.endsWith("/pages")&&init.method==="POST"){const page={id:"new-"+created.length,db:body.parent.data_source_id,properties:body.properties};pages[page.id]=page;created.push(page);return new Response(JSON.stringify(page))}
  throw new Error("unmocked request "+url)
 }
 return {pages,created,calls,fetch,tasks,drain:async()=>{for(let i=0;i<tasks.length;i++){assert(i<100,"chain did not stop");await tasks[i]}}}
}
Deno.test("실제 버튼 핸들러: 월수금 날짜순 수업 생성 → 출석 조정 큐 → 학생별 출석·백필·역순 워커·재실행 검증",async()=>{
 const f=mock(),originalFetch=globalThis.fetch;globalThis.fetch=f.fetch as typeof fetch;(globalThis as any).EdgeRuntime={waitUntil:(p:Promise<unknown>)=>f.tasks.push(p)}
 try{
  const unauth=await handler(new Request("https://mock.supabase/functions/v1/generate-classes?mode=bulk",{method:"POST",body:"{}"}));assert(unauth.status===401&&f.created.length===0)
  const response=await handler(new Request("https://mock.supabase/functions/v1/generate-classes?mode=bulk",{method:"POST",headers:{"x-admin-key":"test-only"},body:JSON.stringify({id:"menu"})}));assert(response.status===202);await f.drain()
  const generation=f.calls.filter(c=>c.url.endsWith("/rest/v1/sync_queue")).map(c=>c.body[0]).filter(q=>q.target==="generate-classes")
  const { processGenerateClassesQueueItem } = await import("../_shared/generateClassesQueue.ts")
  for(const q of generation)await processGenerateClassesQueueItem(q.payload)
  const sessions=f.created.filter(p=>p.db==="sessions");assert(sessions.map(p=>p.properties["수업일시"].date.start.slice(0,10)).join()==="2026-10-12,2026-10-14,2026-10-16","wrong order "+JSON.stringify(sessions));assert(f.pages.menu.properties["상태"].select.name==="✅ 완료")
  // v2.6.12: 수업추가는 수업만 명단과 함께 만들고(완료 상태) 출석은 만들지 않는다. 수업마다 출석 조정 큐에 한 건.
  assert(f.created.filter(p=>p.db==="attendance").length===0,"no attendance from generate-classes")
  assert(sessions.every(p=>p.properties["등록"].relation.map((r:any)=>r.id).join()==="a,b"&&p.properties["생성 상태"].select.name==="✅ 완료"))
  const queued=f.calls.filter(c=>c.url.endsWith("/rest/v1/sync_queue")).map(c=>c.body[0]).filter(q=>q.target==="fix-attendance");assert(queued.length===3&&queued.every(q=>q.target==="fix-attendance")&&queued.map(q=>q.payload.pageId).join()===sessions.map(p=>p.id).join(),JSON.stringify(queued))
  // 워커: Notion이 계산한 "출석 조정 정보"(명단 a,b 모두 출석 없음)를 수업 페이지에 두고 큐를 처리한다.
  for(const p of sessions)p.properties["출석 조정 정보"]={type:"formula",formula:{type:"string",string:JSON.stringify({v:1,day:p.properties["수업일시"].date.start.slice(0,10),add:[{reg:"a",att:"",rec:[]},{reg:"b",att:"",rec:[]}],del:[]})}}
  for(const q of queued)await processFixAttendanceQueueItem(q.payload)
  const attends=f.created.filter(p=>p.db==="attendance");assert(attends.length===6)
  assert(sessions.every(p=>p.properties["출석 조정 상태"].select.name==="✅ 완료"))
  // 대기 과제는 수업마다 한 번에 조회(학생마다 조회하지 않음)
  assert(f.calls.filter(c=>c.url.includes("/data_sources/activities/query")).length===3,"one deadline query per session")
  for(const p of attends)assert(p.properties["과제마감 백필 대상"].relation.map((r:any)=>r.id).join()==="task-"+p.properties["등록"].relation[0].id,"cross-student queue target")
  // Execute the same policy used by the actual worker against all attendance pages now present.
  const io={getPage:async(id:string)=>structuredClone(f.pages[id]),activityDb:"activities",attendanceDb:"attendance",query:async(_db:string,b:any)=>({results:attends.filter(p=>p.properties["등록"].relation[0].id===b.filter.and[0].relation.contains&&Date.parse(p.properties["수업일시"].date.start)>Date.parse(b.filter.and[1].date.after)).sort((a,b)=>Date.parse(a.properties["수업일시"].date.start)-Date.parse(b.properties["수업일시"].date.start)),has_more:false}),update:async(id:string,props:any)=>Object.assign(f.pages[id].properties,props)}
  for(const p of [...attends].reverse())for(const target of p.properties["과제마감 백필 대상"].relation)await reconcileDeadline(io,target.id,p.id)
  for(const id of ["a","b"]){const deadline=f.pages[f.pages["task-"+id].properties["과제 마감"].relation[0].id];assert(deadline.properties["등록"].relation[0].id===id && deadline.properties["수업일시"].date.start.startsWith("2026-10-12"))}
  const before=f.created.length;await handler(new Request("https://mock.supabase/functions/v1/generate-classes?mode=bulk",{method:"POST",headers:{"x-admin-key":"test-only"},body:JSON.stringify({isContinuation:true,menuPageId:"menu",horizonDate:"2026-10-18",chainStartedAt:Date.now(),bulkPlan:[]})}));await f.drain();assert(f.created.length===before)
 }finally{globalThis.fetch=originalFetch;delete(globalThis as any).EdgeRuntime}
})
const U=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`
const planText=(o:any)=>({type:"formula",formula:{type:"string",string:JSON.stringify({v:1,start:"20:00",end:"21:00",name:"중1 A",tch:[U(9)],reg:[U(1),U(2)],...o})}})
Deno.test("v2.6.14 수업 추가 정보 해석: 형식·기준일·클래스가 맞을 때만 쓴다",async()=>{
 const { sessionPlanFromTimetable, sessionPlanFromText, sessionTitle } = await import("../_shared/timetableSessionPlan.ts")
 const base=(d:string)=>({type:"formula",formula:{type:"date",date:{start:d}}})
 const ok={"클래스":rel(U(7)),"기준일":base("2026-10-26"),"수업 추가 정보":planText({date:"2026-10-26",cls:U(7)})}
 const p=sessionPlanFromTimetable(ok);assert(p&&p.date==="2026-10-26"&&p.regIds.length===2&&p.teacherIds[0]===U(9)&&p.className==="중1 A",JSON.stringify(p))
 assert(!sessionPlanFromTimetable({...ok,"기준일":base("2026-11-02")}),"기준일과 날짜가 다르면 안 씀")
 assert(!sessionPlanFromTimetable({...ok,"클래스":rel(U(8))}),"클래스가 다르면 안 씀")
 assert(!sessionPlanFromText('{"v":1,"date":"2026-10-26","cls":"x","reg":[]}'),"id 형식 오류")
 assert(!sessionPlanFromText('{"v":1,"date":"10/26","cls":"'+U(7)+'","reg":[]}'),"날짜 형식 오류")
 assert(!sessionPlanFromText("")&&!sessionPlanFromText("not json"))
 assert(sessionPlanFromText('{"v":1,"date":"2026-10-26","cls":"'+U(7).replace(/-/g,"")+'","reg":[]}')?.regIds.length===0,"하이픈 없는 id·빈 명단 허용")
 assert(sessionTitle("중1 A","2026-10-26")==="중1 A 10.26(월)")
})

const base=(d:string)=>({type:"formula",formula:{type:"date",date:{start:d}}})
async function runFixture(fn:(f:ReturnType<typeof mock>)=>Promise<void>){
 const f=mock(),originalFetch=globalThis.fetch;globalThis.fetch=f.fetch as typeof fetch;(globalThis as any).EdgeRuntime={waitUntil:(p:Promise<unknown>)=>f.tasks.push(p)}
 try{await fn(f)}finally{globalThis.fetch=originalFetch;delete(globalThis as any).EdgeRuntime}
}
const bulkReq=()=>new Request("https://mock.supabase/functions/v1/generate-classes?mode=bulk",{method:"POST",headers:{"x-admin-key":"test-only"},body:JSON.stringify({id:"menu"})})
function morning(f:ReturnType<typeof mock>){
 f.pages["old-mon"].properties["수업일시"].date.start="2026-10-18T23:30:00Z"
 f.pages.mon.properties["등원시간(HH:mm)"]=txt("08:30");f.pages.mon.properties["하원시간(HH:mm)"]=txt("09:15")
 f.pages.mon.properties["기준일"]=base("2026-10-19")
 f.pages.mon.properties["수업 추가 정보"]=planText({date:"2026-10-19",cls:U(7)})
 f.pages["old-wed"].properties["수업일시"].date.start="2026-10-21T20:00:00+09:00"
 f.pages["old-fri"].properties["수업일시"].date.start="2026-10-23T20:00:00+09:00"
}
Deno.test("KST: 08:30의 오래된 기준일을 무시하고 월수금 모두 다음 빈 주에 날짜·시간순 적재",()=>runFixture(async f=>{
 morning(f);assert((await handler(bulkReq())).status===202);await f.drain()
 const q=f.calls.filter(c=>c.url.endsWith("/rest/v1/sync_queue")).map(c=>c.body[0])
 assert(q.map(x=>x.payload.date).join()==="2026-10-26,2026-10-28,2026-10-30",JSON.stringify(q))
 assert(q.map(x=>x.payload.timetableId).join()==="mon,wed,fri"&&q.every(x=>!x.payload.plan))
 assert(f.created.length===0,"bulk only queues")
}))
Deno.test("KST 미리보기는 인증 필수이며 상태·큐·수업에 쓰지 않음",()=>runFixture(async f=>{
 morning(f)
 const url="https://mock.supabase/functions/v1/generate-classes?mode=preview"
 assert((await handler(new Request(url,{method:"POST",body:"{}"}))).status===401)
 const res=await handler(new Request(url,{method:"POST",headers:{"x-admin-key":"test-only"},body:"{}"}));const d=await res.json()
 assert(d.readOnly&&d.weekStart==="2026-10-26"&&d.rows.find((x:any)=>x.id==="mon").nextNeeded==="2026-10-26")
 assert(f.created.length===0&&f.calls.every(c=>!c.url.includes("/rest/")&&c.body.properties===undefined),"no writes")
}))
Deno.test("KST 워커: 오전 수업의 등록 명단을 수정된 날짜로 재계산; 같은 큐 재시도는 다음 주를 추가 생성하지 않음",()=>runFixture(async f=>{
 morning(f)
 f.pages.__registrations=[{id:"active",properties:{}},{id:"future",properties:{"등록일":{date:{start:"2026-11-02"}}}},{id:"ended",properties:{"종료일":{date:{start:"2026-10-25"}}}}]
 const {processGenerateClassesQueueItem}=await import("../_shared/generateClassesQueue.ts")
 await processGenerateClassesQueueItem({timetableId:"mon",date:"2026-10-26"})
 const sessions=f.created.filter(p=>p.db==="sessions")
 assert(sessions.length===1&&sessions[0].properties["수업일시"].date.start==="2026-10-26T08:30:00+09:00")
 assert(sessions[0].properties["등록"].relation.map((r:any)=>r.id).join()==="active")
 await processGenerateClassesQueueItem({timetableId:"mon",date:"2026-10-26"})
 assert(f.created.filter(p=>p.db==="sessions").length===1,"retry must not advance to another week")
}))
Deno.test("KST 구 plan 큐: 지난주 날짜를 다시 만들거나 임의로 다음 주로 바꾸지 않음",()=>runFixture(async f=>{
 morning(f)
 const {processGenerateClassesQueueItem}=await import("../_shared/generateClassesQueue.ts")
 const {sessionPlanFromText}=await import("../_shared/timetableSessionPlan.ts")
 const plan=sessionPlanFromText(planText({date:"2026-10-19",cls:U(7)}).formula.string)!
 await processGenerateClassesQueueItem({timetableId:"mon",plan})
 assert(f.created.length===0,"old plan cannot create a duplicate")
}))
Deno.test("KST /queue: 웹훅의 오래된 formula plan 대신 실제 수업일로 예정일 고정",()=>runFixture(async f=>{
 morning(f)
 const q=await handler(new Request("https://mock.supabase/functions/v1/generate-classes/queue",{method:"POST",headers:{"x-admin-key":"test-only"},body:JSON.stringify({data:{id:"mon",properties:f.pages.mon.properties}})}))
 assert(q.status===202)
 const job=f.calls.find(c=>c.url.endsWith("/rest/v1/sync_queue"))!.body[0]
 assert(job.payload.date==="2026-10-26"&&!job.payload.plan&&f.created.length===0)
}))
Deno.test("KST 휴원: 10/26 휴원은 11/2로 넘어가며, 그보다 이른 주의 수·금만 적재",()=>runFixture(async f=>{
 morning(f)
 f.pages.__events=[{properties:{"날짜":{date:{start:"2026-10-26",end:"2026-10-26"}}}}]
 await handler(bulkReq());await f.drain()
 const q=f.calls.filter(c=>c.url.endsWith("/rest/v1/sync_queue")).map(c=>c.body[0])
 assert(q.map(x=>x.payload.timetableId).join()==="wed,fri",JSON.stringify(q))
}))
Deno.test("자연키 방어: 같은 시간표·시각의 수업이 있으면 기존 ID 반환, POST 없음",()=>runFixture(async f=>{
 morning(f)
 const {createSessionFromPlan}=await import("../_shared/timetableSessionPlan.ts")
 const id=await createSessionFromPlan("mon",{date:"2026-10-19",start:"08:30",end:"09:15",classId:"class",className:"Mock",teacherIds:[],regIds:[]})
 assert(id==="old-mon"&&f.created.length===0)
}))
Deno.test("실패 재시도: 응답 유실 뒤에도 고정 날짜를 검증해 추가 주를 만들지 않음",()=>runFixture(async f=>{
 morning(f)
 const {processGenerateClassesQueueItem}=await import("../_shared/generateClassesQueue.ts")
 const original=globalThis.fetch
 globalThis.fetch=(async(input:any,init:any={})=>{
  if(String(input).endsWith("/v1/pages")&&init.method==="POST"){await f.fetch(input,init);return new Response("lost response",{status:502})}
  return f.fetch(input,init)
 }) as typeof fetch
 let failed=false;try{await processGenerateClassesQueueItem({timetableId:"mon",date:"2026-10-26"})}catch{failed=true}
 assert(failed&&f.created.filter(p=>p.db==="sessions").length===1)
 globalThis.fetch=original
 await processGenerateClassesQueueItem({timetableId:"mon",date:"2026-10-26"})
 assert(f.created.filter(p=>p.db==="sessions").length===1)
}))

Deno.test("단건 버튼 중복 클릭도 같은 직렬 큐를 사용하고 예정일을 고정",()=>runFixture(async f=>{
 morning(f)
 const request=()=>new Request("https://mock.supabase/functions/v1/generate-classes",{method:"POST",headers:{"x-admin-key":"test-only"},body:JSON.stringify({timetableId:"mon"})})
 await Promise.all([handler(request()),handler(request())])
 const jobs=f.calls.filter(c=>c.url.endsWith("/rest/v1/sync_queue")).map(c=>c.body[0])
 assert(jobs.length===2&&jobs.every(q=>q.payload.date==="2026-10-26")&&f.created.length===0)
 const {processGenerateClassesQueueItem}=await import("../_shared/generateClassesQueue.ts")
 for(const q of jobs)await processGenerateClassesQueueItem(q.payload)
 assert(f.created.filter(p=>p.db==="sessions").length===1)
}))
