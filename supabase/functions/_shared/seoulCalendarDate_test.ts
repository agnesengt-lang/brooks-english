import { seoulCalendarDate } from "./seoulCalendarDate.ts"
const cases = [
 ["2026-10-18T23:30:00Z", "2026-10-19"],
 ["2026-10-19T08:30:00+09:00", "2026-10-19"],
 ["2026-10-19T12:40:00+09:00", "2026-10-19"],
 ["2026-10-18T15:00:00Z", "2026-10-19"],
 ["2026-10-18T14:59:59Z", "2026-10-18"],
 ["2026-12-31T23:30:00Z", "2027-01-01"],
 ["2028-02-28T23:30:00Z", "2028-02-29"],
 ["2026-10-19", "2026-10-19"],
]
for(const [input, expected] of cases) Deno.test(`Seoul calendar: ${input}`, () => {
 if(seoulCalendarDate(input)!==expected)throw new Error(input)
})
Deno.test("ambiguous timestamps fail closed",()=>{
 for(const input of ["2026-10-19T08:30:00", "bad"]){let threw=false;try{seoulCalendarDate(input)}catch{threw=true};if(!threw)throw new Error(input)}
})
