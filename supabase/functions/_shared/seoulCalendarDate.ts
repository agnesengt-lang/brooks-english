// Calendar dates must not be extracted by slicing a UTC timestamp.
const seoul = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
})
export function seoulCalendarDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) throw new Error(`Timezone required: ${value}`)
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid date: ${value}`)
  const parts = seoul.formatToParts(date)
  const part = (type: string) => parts.find(p => p.type === type)!.value
  return `${part("year")}-${part("month")}-${part("day")}`
}
