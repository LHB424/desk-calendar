// 한국 공휴일. 음력 명절은 브라우저의 음력(dangi) 달력으로 계산하고, 대체공휴일 규칙을 얹는다.
(() => {
const lunarFmt = new Intl.DateTimeFormat('ko-KR-u-ca-dangi', { month: 'numeric', day: 'numeric' })
const ELECTIONS = { '2026-06-03': '지방선거', '2028-04-12': '국회의원 선거' }
const cache = new Map()

const pad = n => String(n).padStart(2, '0')
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

function lunarOf(d) {
  const parts = lunarFmt.formatToParts(d)
  const m = parts.find(p => p.type === 'month').value
  return { m: /^\d+$/.test(m) ? +m : null, d: +parts.find(p => p.type === 'day').value } // 윤달은 m이 null
}

function holidaysOf(year) {
  if (cache.has(year)) return cache.get(year)
  const map = new Map()
  const put = (d, name) => map.set(keyOf(d), [...(map.get(keyOf(d)) || []), name])
  const substitutable = [] // 대체공휴일이 붙는 날: [날짜, 토요일도 대체하는지]

  const fixed = [
    [1, 1, '신정', false],
    [3, 1, '삼일절', true],
    [5, 5, '어린이날', true],
    [6, 6, '현충일', false],
    [8, 15, '광복절', true],
    [10, 3, '개천절', true],
    [10, 9, '한글날', true],
    [12, 25, '성탄절', true],
  ]
  if (year >= 2026) fixed.push([7, 17, '제헌절', false])
  for (const [m, d, name, sub] of fixed) {
    const date = new Date(year, m - 1, d)
    put(date, name)
    if (sub) substitutable.push([date, true])
  }

  for (let d = new Date(year, 0, 1); d.getFullYear() === year; d = addDays(d, 1)) {
    const l = lunarOf(d)
    if (l.m === 1 && l.d === 1) {
      for (const n of [-1, 0, 1]) {
        put(addDays(d, n), n ? '설날 연휴' : '설날')
        substitutable.push([addDays(d, n), false])
      }
    } else if (l.m === 4 && l.d === 8) {
      put(d, '부처님오신날')
      substitutable.push([d, true])
    } else if (l.m === 8 && l.d === 15) {
      for (const n of [-1, 0, 1]) {
        put(addDays(d, n), n ? '추석 연휴' : '추석')
        substitutable.push([addDays(d, n), false])
      }
    }
  }

  // 일요일(명절 외에는 토요일도)이거나 다른 공휴일과 겹치면 그 뒤 첫 평일이 대체공휴일
  const triggers = new Set()
  for (const [date, saturday] of substitutable) {
    const day = date.getDay()
    if (day === 0 || (saturday && day === 6) || map.get(keyOf(date)).length > 1) triggers.add(keyOf(date))
  }
  for (const key of [...triggers].sort()) {
    const [y, m, d] = key.split('-').map(Number)
    let next = new Date(y, m - 1, d + 1)
    while (next.getDay() === 0 || next.getDay() === 6 || map.has(keyOf(next))) next = addDays(next, 1)
    put(next, '대체공휴일')
  }

  for (const [key, name] of Object.entries(ELECTIONS)) {
    if (key.startsWith(year + '-')) map.set(key, [...(map.get(key) || []), name])
  }
  cache.set(year, map)
  return map
}

// 'YYYY-MM-DD' → 공휴일 이름 배열(없으면 빈 배열)
window.holidayNames = key => holidaysOf(+key.slice(0, 4)).get(key) || []
})()
