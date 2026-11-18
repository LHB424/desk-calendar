const $ = id => document.getElementById(id)
const DAYS = ['일', '월', '화', '수', '목', '금', '토']
const pad = n => String(n).padStart(2, '0')
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const dateOf = key => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}
const nextKey = key => {
  const d = dateOf(key)
  return keyOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1))
}
const daysBetween = (a, b) => Math.round((dateOf(b) - dateOf(a)) / 86400000)
const ddayText = n => (n === 0 ? '오늘' : n > 0 ? `D-${n}` : `D+${-n}`)
const md = key => {
  const d = dateOf(key)
  return `${d.getMonth() + 1}/${d.getDate()}`
}
const validKey = k => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k)

// 일정 색. 이름은 events.json에 저장되는 값, 처음 것(blue)이 기본이라 저장하지 않는다
const COLORS = {
  blue: '#3b6fd4',
  red: '#e03131',
  orange: '#e8590c',
  yellow: '#e0a100',
  green: '#2f9e44',
  teal: '#0c8599',
  purple: '#7048e8',
  pink: '#d6336c',
  gray: '#868e96',
}
const colorOf = name => COLORS[name] || COLORS.blue

let events = [] // [{ id, date, end?, title, color?, memo? }] end가 있으면 date부터 end까지 이어지는 일정
let todayKey = keyOf(new Date())
let picked = todayKey // 고른 범위의 첫날
let pickedEnd = todayKey // 고른 범위의 마지막 날 (하루만 골랐으면 picked와 같다)
let view = new Date() // 보고 있는 달
let editingId = null // 아래 목록에서 펼쳐 고치고 있는 일정

// 창이 이만큼 커지면 날짜 칸 안에 일정 이름을 적는다(big). 더 넓으면 아래 목록을 오른쪽으로 옮긴다(wide).
const BIG = { width: 560, height: 560 }
const WIDE = 860
const CHIP = 18 // 일정 한 줄 높이(16) + 간격(2)
const CHIP_TOP = 28 // 칸 위 테두리(1) + 여백(3) + 날짜 숫자(22) + 간격(2)
let chipRoom = 0 // 칸 하나에 들어가는 줄 수
const MAX_DOTS = 5 // 작은 화면에서 한 날짜 밑에 찍는 점의 최대 개수

// 달력과 일정 목록 사이 경계선 자리. 사용자가 끈 값(h: 목록 높이, w: 넓은 화면의 목록 넓이)을 기억한다
const SPLIT_KEY = 'calendar.split'
let split = {}
try {
  split = JSON.parse(localStorage.getItem(SPLIT_KEY)) || {}
} catch {}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// 기억한 값을 지금 창 크기에 맞게 잘라서 적용한다 (달력이 너무 작아지지 않게)
function applySplit() {
  const card = document.querySelector('.card')
  const big = document.body.classList.contains('big')
  const wide = document.body.classList.contains('wide')
  card.style.removeProperty('--agenda-w')
  card.style.removeProperty('--agenda-h')
  card.classList.remove('fixed-agenda')
  if (wide) {
    const w = clamp(split.w ?? 270, 220, Math.max(220, card.clientWidth - 380))
    card.style.setProperty('--agenda-w', w + 'px')
    return
  }
  if (split.h == null && !big) return // 작은 화면 기본: 달력은 원래 높이, 남는 자리는 목록
  const head = document.querySelector('.head').offsetHeight
  const week = document.querySelector('.week').offsetHeight
  const calMin = week + 6 * (big ? 44 : 40) + 8
  const h = clamp(split.h ?? 200, 110, Math.max(110, card.clientHeight - head - calMin - 9))
  card.style.setProperty('--agenda-h', h + 'px')
  card.classList.add('fixed-agenda')
}

// 크기는 창이 아니라 body로 잰다 (크기 조절 중엔 창이 미리 크게 펴져 있고 body만 늘어나기 때문)
function layout() {
  const w = document.body.offsetWidth
  const h = document.body.offsetHeight
  const big = w >= BIG.width && h >= BIG.height
  document.body.classList.toggle('big', big)
  document.body.classList.toggle('wide', big && w >= WIDE)
  applySplit()
  if (!big) return 0
  const rowH = $('grid').clientHeight / 6
  return Math.max(1, Math.floor((rowH - CHIP_TOP - 2) / CHIP))
}

const isMulti = e => !!e.end && e.end !== e.date
const endOf = e => e.end || e.date
const eventItem = e => ({
  kind: 'event',
  name: e.title,
  id: e.id,
  date: e.date,
  end: endOf(e),
  multi: isMulti(e),
  color: colorOf(e.color),
  memo: e.memo || '',
})

// 그날의 항목: 공휴일, 내 일정 순서 (여러 날 일정은 걸쳐 있는 모든 날에 들어간다)
function itemsOn(key) {
  return [
    ...holidayNames(key).map(name => ({ kind: 'holiday', name })),
    ...events.filter(e => e.date <= key && key <= endOf(e)).map(eventItem),
  ]
}

// 한 주(7칸)에 막대를 줄(lane)로 쌓는다. 여러 날 일정이 먼저, 길수록 위로.
// height는 그 주에 필요한 줄 수. 한 칸에 다 안 들어가면 막대 대신 점으로 그린다(renderGrid).
function placeWeek(days) {
  const first = days[0]
  const last = days[6]
  const entries = []
  for (const e of events) {
    if (!isMulti(e) || e.date > last || e.end < first) continue
    const clipL = e.date < first
    const clipR = e.end > last
    entries.push({
      item: eventItem(e),
      from: clipL ? 0 : days.indexOf(e.date),
      to: clipR ? 6 : days.indexOf(e.end),
      clipL,
      clipR,
    })
  }
  entries.sort((a, b) => a.from - b.from || b.to - b.from - (a.to - a.from))
  days.forEach((key, col) => {
    for (const it of itemsOn(key)) if (!it.multi) entries.push({ item: it, from: col, to: col })
  })

  const lanes = [] // lanes[lane][col] = 차 있으면 true
  for (const en of entries) {
    let lane = 0
    while (lanes[lane] && lanes[lane].slice(en.from, en.to + 1).some(Boolean)) lane++
    lanes[lane] = lanes[lane] || Array(7).fill(false)
    for (let c = en.from; c <= en.to; c++) lanes[lane][c] = true
    en.lane = lane
  }

  const segments = entries.map(en => ({
    ...en,
    start: en.from,
    stop: en.to,
    roundL: !en.clipL,
    roundR: !en.clipR,
  }))
  return { segments, height: lanes.length }
}

function laneEl(row, start, stop, lane, className, item, text) {
  const el = document.createElement('span')
  el.className = 'lane ' + className
  el.style.gridRow = row + 1
  el.style.gridColumn = `${start + 1} / ${stop + 2}`
  el.style.setProperty('--lane', lane)
  if (item && item.kind === 'event') {
    el.style.setProperty('--c', item.color)
    el.dataset.id = item.id
    el.title = item.memo ? `${item.name}\n${item.memo}` : item.name
  }
  if (text) el.textContent = text
  return el
}

function renderGrid() {
  const y = view.getFullYear()
  const m = view.getMonth()
  $('month').textContent = `${m + 1}월`
  $('year').textContent = y
  const first = 1 - new Date(y, m, 1).getDay() // 첫 칸(일요일)의 날짜. 지난달이면 0이나 음수
  const grid = $('grid')
  grid.textContent = ''
  const rows = []
  for (let row = 0; row < 6; row++) {
    const days = []
    for (let col = 0; col < 7; col++) days.push(keyOf(new Date(y, m, first + row * 7 + col)))
    rows.push(days)
  }
  // 큰 화면이어도, 이 달에 겹친 일정이 칸 높이보다 많이 쌓이는 날이 하루라도 있으면 그 달은 전부 점으로 그린다
  const weeks = chipRoom > 0 ? rows.map(placeWeek) : null
  const bars = !!weeks && weeks.every(w => w.height <= chipRoom)
  grid.classList.toggle('dots', !bars)

  rows.forEach((days, row) => {
    const week = bars ? weeks[row] : null

    days.forEach((key, col) => {
      const d = dateOf(key)
      const items = itemsOn(key)
      const cell = document.createElement('button')
      cell.className = 'day'
      cell.dataset.key = key
      cell.style.gridRow = row + 1
      cell.style.gridColumn = col + 1
      if (d.getMonth() !== m) cell.classList.add('out')
      if (d.getDay() === 0 || items.some(it => it.kind === 'holiday')) cell.classList.add('red')
      else if (d.getDay() === 6) cell.classList.add('blue')
      if (key === todayKey) cell.classList.add('today')
      cell.title = items.map(it => it.name).join(', ')

      const num = document.createElement('span')
      num.className = 'num'
      num.textContent = d.getDate()
      // 점으로 그릴 때: 일정마다 점 하나 (여러 날 일정은 걸친 날마다). 겹치면 그날 점이 늘고, 가운데 정렬된다.
      // 여러 날 일정을 먼저(일찍 시작한 것부터) 찍어 이어지는 날들에서 순서가 덜 흔들리게 한다
      const marks = document.createElement('span')
      marks.className = 'marks'
      const dots = items
        .filter(it => it.kind !== 'holiday')
        .sort((a, b) => (b.multi ? 1 : 0) - (a.multi ? 1 : 0) || (a.multi && b.multi ? a.date.localeCompare(b.date) : 0))
      for (const it of dots.slice(0, MAX_DOTS)) {
        const dot = document.createElement('i')
        dot.style.background = it.color
        marks.append(dot)
      }
      cell.append(num, marks)
      grid.append(cell)
    })

    if (!week) return
    for (const s of week.segments) {
      const out = dateOf(days[s.start]).getMonth() !== m && dateOf(days[s.stop]).getMonth() !== m
      const cls = [
        s.item.kind,
        s.item.done ? 'done' : '',
        s.roundL ? '' : 'sq-l',
        s.roundR ? '' : 'sq-r',
        out ? 'out' : '',
        s.item.id && s.item.id === editingId ? 'editing' : '',
      ]
      grid.append(laneEl(row, s.start, s.stop, s.lane, cls.filter(Boolean).join(' '), s.item, s.item.name))
    }
  })
  markSelection()
}

// 고른 범위를 칸에 칠한다 (다시 그리지 않고 class만 바꾼다. 끌어서 고르는 동안에도 쓴다)
// showSel이 꺼져 있으면(처음 켰을 때, 빈 곳을 눌렀을 때, 잠갔을 때) 아래 목록은 오늘을 보여 주되 칸에는 아무 표시도 안 한다
let showSel = false
function markSelection() {
  const grid = $('grid')
  grid.classList.toggle('multi', showSel && picked !== pickedEnd)
  for (const cell of grid.querySelectorAll('.day')) {
    const key = cell.dataset.key
    if (!showSel) {
      cell.classList.remove('sel', 'sel-start', 'sel-end', 'picked')
      continue
    }
    const inside = picked <= key && key <= pickedEnd
    cell.classList.toggle('sel', inside)
    cell.classList.toggle('sel-start', key === picked)
    cell.classList.toggle('sel-end', key === pickedEnd)
    cell.classList.toggle('picked', key === picked || key === pickedEnd)
  }
}

function row(item, tag) {
  const li = document.createElement('li')
  li.className = item.kind + (item.done ? ' done' : '')
  if (item.color) li.style.setProperty('--c', item.color)
  const bar = document.createElement('span')
  bar.className = 'bar'
  const text = document.createElement('span')
  text.className = 'text'
  const name = document.createElement('span')
  name.className = 'name'
  name.textContent = item.name
  name.title = item.name
  text.append(name)
  if (item.memo) {
    const memo = document.createElement('span')
    memo.className = 'memo'
    memo.textContent = item.memo
    text.append(memo)
  }
  li.append(bar, text)
  if (tag) {
    const t = document.createElement('span')
    t.className = 'tag'
    t.textContent = tag
    li.append(t)
  }
  return li
}

// 고른 범위 안의 항목 (여러 날 일정은 한 번만)
function itemsIn(from, to) {
  const out = []
  const seen = new Set()
  for (let key = from; key <= to; key = nextKey(key)) {
    for (const it of itemsOn(key)) {
      const id = it.kind === 'event' ? 'e' + it.id : it.kind + key + it.name
      if (seen.has(id)) continue
      seen.add(id)
      out.push({ ...it, day: key })
    }
  }
  return out
}

function rangeTitle() {
  const a = dateOf(picked)
  if (picked === pickedEnd) return `${a.getMonth() + 1}월 ${a.getDate()}일 ${DAYS[a.getDay()]}요일`
  const b = dateOf(pickedEnd)
  const to = a.getMonth() === b.getMonth() ? `${b.getDate()}일` : `${b.getMonth() + 1}월 ${b.getDate()}일`
  return `${a.getMonth() + 1}월 ${a.getDate()}일 – ${to} · ${daysBetween(picked, pickedEnd) + 1}일`
}

// 일정 고치기: 제목, 기간, 색, 메모. 글자는 치는 대로 저장한다
function editorFor(ev, li) {
  const box = document.createElement('li')
  box.className = 'editor'
  box.style.setProperty('--c', colorOf(ev.color))

  const title = document.createElement('input')
  title.className = 'ed-title'
  title.value = ev.title
  title.maxLength = 40
  title.spellcheck = false
  title.addEventListener('input', () => {
    const v = title.value.trim()
    if (!v) return
    ev.title = v
    li.querySelector('.name').textContent = v
    renderGrid()
    saveSoon()
  })

  const dates = document.createElement('div')
  dates.className = 'ed-dates'
  const from = document.createElement('input')
  from.type = 'date'
  from.value = ev.date
  const to = document.createElement('input')
  to.type = 'date'
  to.value = endOf(ev)
  const tilde = document.createElement('span')
  tilde.textContent = '~'
  const onDates = changed => {
    let a = from.value
    let b = to.value
    if (!validKey(a) || !validKey(b)) return
    // 시작을 끝보다 뒤로 옮기면 끝도 따라가고, 끝을 시작보다 앞으로 옮기면 시작이 따라온다
    if (b < a) changed === 'from' ? (b = a) : (a = b)
    ev.date = a
    if (b !== a) ev.end = b
    else delete ev.end
    saveNow()
    pick(a, b) // 고친 기간을 달력에 보여 주고, 이 편집기도 그 자리에 다시 연다
  }
  from.addEventListener('change', () => onDates('from'))
  to.addEventListener('change', () => onDates('to'))
  dates.append(from, tilde, to)

  const swatches = document.createElement('div')
  swatches.className = 'swatches'
  for (const [name, hex] of Object.entries(COLORS)) {
    const b = document.createElement('button')
    b.className = 'swatch' + ((ev.color || 'blue') === name ? ' on' : '')
    b.style.setProperty('--c', hex)
    b.title = name
    b.addEventListener('click', () => {
      if (name === 'blue') delete ev.color
      else ev.color = name
      saveNow()
      render()
    })
    swatches.append(b)
  }

  const memo = document.createElement('textarea')
  memo.className = 'ed-memo'
  memo.placeholder = '메모'
  memo.rows = 3
  memo.maxLength = 1000
  memo.spellcheck = false
  memo.value = ev.memo || ''
  memo.addEventListener('input', () => {
    if (memo.value.trim()) ev.memo = memo.value
    else delete ev.memo
    saveSoon()
  })

  const foot = document.createElement('div')
  foot.className = 'ed-foot'
  const del = document.createElement('button')
  del.className = 'ed-del'
  del.textContent = '지우기'
  del.addEventListener('click', () => removeEvent(ev.id))
  const done = document.createElement('button')
  done.className = 'ed-done'
  done.textContent = '완료'
  done.addEventListener('click', closeEditor)
  foot.append(del, done)

  box.append(title, dates, swatches, memo, foot)
  return box
}

function closeEditor() {
  if (!editingId) return
  editingId = null
  saveNow()
  render()
}

function renderAgenda() {
  const range = picked !== pickedEnd
  $('picked').textContent = rangeTitle()
  $('dday').textContent = ddayText(daysBetween(todayKey, picked))
  $('input').placeholder = range ? `${md(picked)}~${md(pickedEnd)} 일정 추가` : '일정 추가'

  const list = $('list')
  list.textContent = ''
  const items = itemsIn(picked, pickedEnd)
  for (const it of items) {
    let tag = it.kind === 'holiday' ? '공휴일' : ''
    if (it.multi) tag = `${md(it.date)}~${md(it.end)}`
    else if (range) tag = `${md(it.day)} ${tag}`.trim()
    const li = row(it, tag)
    list.append(li)
    if (it.kind !== 'event' || locked) continue // 잠겨 있으면 보기만 한다

    const del = document.createElement('button')
    del.className = 'del'
    del.textContent = '×'
    del.title = '지우기'
    del.addEventListener('click', e => {
      e.stopPropagation()
      removeEvent(it.id)
    })
    li.append(del)
    // 일정을 누르면 그 밑에 고치는 칸이 펼쳐진다
    li.classList.add('editable')
    li.title = '눌러서 고치기'
    li.addEventListener('click', () => {
      editingId = editingId === it.id ? null : it.id
      saveNow()
      render()
    })
    const ev = events.find(e => e.id === it.id)
    if (ev && editingId === it.id) {
      li.classList.add('open')
      list.append(editorFor(ev, li))
    }
  }
  if (!items.length) {
    const li = document.createElement('li')
    li.className = 'empty'
    li.textContent = '일정 없음'
    list.append(li)
  }

  // 오늘부터 앞으로 올(또는 지금 진행 중인) 일정. 고른 범위에 걸친 것은 위에 이미 있으니 뺀다
  const soon = events
    .map(eventItem)
    .filter(x => x.end >= todayKey && !(x.date <= pickedEnd && x.end >= picked))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 4)
  const soonList = $('soon')
  soonList.textContent = ''
  $('soonHead').hidden = !soon.length
  for (const it of soon) {
    const li = row({ ...it, memo: '' }, it.date < todayKey ? '진행 중' : ddayText(daysBetween(todayKey, it.date)))
    li.addEventListener('click', () => {
      editingId = null
      showSel = true
      pick(it.date, it.end)
    })
    soonList.append(li)
  }
}

function render() {
  chipRoom = layout()
  renderGrid()
  renderAgenda()
}

function pick(key, end = key) {
  picked = key
  pickedEnd = end
  const d = dateOf(key)
  if (d.getFullYear() !== view.getFullYear() || d.getMonth() !== view.getMonth()) view = new Date(d.getFullYear(), d.getMonth(), 1)
  render()
}

// 하이라이트 끄기: 고른 날을 오늘로 돌리고 칸 표시를 지운다. 보고 있던 달은 그대로 둔다
function clearSelection() {
  if (!showSel && picked === todayKey && pickedEnd === todayKey && !editingId) return
  showSel = false
  editingId = null
  picked = pickedEnd = todayKey
  saveNow()
  render()
}

function moveMonth(n) {
  view = new Date(view.getFullYear(), view.getMonth() + n, 1)
  renderGrid()
}

// 저장: 글자를 치는 동안은 잠깐 모았다가 한 번에, 나머지는 바로
let saveTimer = null
function saveSoon() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(saveNow, 400)
}
function saveNow() {
  if (saveTimer === null) return Promise.resolve()
  clearTimeout(saveTimer)
  saveTimer = null
  return window.cal.save(events)
}
function save() {
  clearTimeout(saveTimer)
  saveTimer = null
  return window.cal.save(events)
}

async function removeEvent(id) {
  events = events.filter(e => e.id !== id)
  if (editingId === id) editingId = null
  render()
  await save()
}

$('add').addEventListener('submit', async e => {
  e.preventDefault()
  const title = $('input').value.trim()
  if (!title || locked) return
  const ev = { id: Date.now().toString(36), date: picked, title }
  if (pickedEnd !== picked) ev.end = pickedEnd
  events.push(ev)
  $('input').value = ''
  render()
  await save()
})
$('prev').addEventListener('click', () => moveMonth(-1))
$('next').addEventListener('click', () => moveMonth(1))
$('today').addEventListener('click', () => {
  editingId = null
  showSel = false
  pick(todayKey)
})
$('menu').addEventListener('click', () => window.cal.menu())

// 날짜 칸이나 다른 누를 거리가 아닌 빈 곳을 누르면 하이라이트를 끈다
const INTERACTIVE = '.day, .lane, button, input, textarea, select, label, a, li, form, .editor, .split, .grips, .setup'
window.addEventListener('pointerdown', e => {
  if (e.button !== 0 || anchor) return
  if (e.target.closest && e.target.closest(INTERACTIVE)) return
  if (document.querySelector('#grid') && cellAt(e)) return // 일정 막대 밑이 날짜 칸이면 그 칸을 누른 것
  clearSelection()
})

// 잠금: 잠기면 main.js가 창을 클릭 통과로 바꿔 달력을 눌러도 뒤의 바탕화면이 눌린다.
// 자물쇠 위에 마우스가 올라오면 그때만 클릭을 받는다. 아래 locked 막음들은 혹시 클릭이 들어와도 바뀌지 않게 하는 안전장치.
// 상태는 main.js가 window.json에 기억한다
$('lock').addEventListener('mouseenter', () => window.cal.lockHover(true))
$('lock').addEventListener('mouseleave', () => window.cal.lockHover(false))
let locked = false
function setLocked(on, remember = true) {
  locked = !!on
  document.body.classList.toggle('locked', locked)
  const b = $('lock')
  b.setAttribute('aria-pressed', String(locked))
  b.title = b.ariaLabel = locked ? '잠금 풀기' : '잠그기'
  if (locked) {
    $('input').value = ''
    $('input').blur()
    showSel = false // 잠그면 하이라이트도 끈다
    editingId = null
    picked = pickedEnd = todayKey
  }
  if (remember) window.cal.setLocked(locked)
  render()
}
$('lock').addEventListener('click', () => setLocked(!locked))
window.addEventListener('contextmenu', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
  e.preventDefault()
  // 날짜 칸을 오른쪽 클릭하면 그날을 고르고 바로 '일정 추가' 칸에 글자를 칠 수 있게 한다.
  // 이미 골라 둔 여러 날 범위 안을 눌렀으면 범위를 그대로 둔다
  const cell = !locked && cellAt(e)
  if (cell) {
    const key = cell.dataset.key
    const inRange = showSel && picked <= key && key <= pickedEnd
    editingId = null
    showSel = true
    if (inRange) render()
    else pick(key)
    $('input').focus()
    return
  }
  window.cal.menu()
})
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeEditor()
})

// 날짜 고르기: 누르면 하루, 누른 채 끌면 그 사이 전부, Shift+클릭은 고른 날부터 거기까지.
// 달력의 일정 막대를 누르면(끌지 않고) 그 일정을 고치는 칸이 열린다.
let anchor = null
let downKey = null
let downLane = null
const cellAt = e => document.elementsFromPoint(e.clientX, e.clientY).find(el => el.classList && el.classList.contains('day'))
const setRange = (a, b) => {
  picked = a < b ? a : b
  pickedEnd = a < b ? b : a
  markSelection()
}
$('grid').addEventListener('pointerdown', e => {
  const cell = cellAt(e)
  if (!cell || e.button !== 0) return
  const lane = e.target.closest('.lane[data-id]')
  downLane = lane && !e.shiftKey ? lane.dataset.id : null
  downKey = cell.dataset.key
  anchor = e.shiftKey && showSel ? picked : downKey
  showSel = true
  setRange(anchor, downKey)
})
$('grid').addEventListener('pointerover', e => {
  if (!anchor) return
  const cell = cellAt(e)
  if (cell) setRange(anchor, cell.dataset.key)
})
window.addEventListener('pointerup', () => {
  if (!anchor) return
  anchor = null
  const ev = downLane && picked === pickedEnd && picked === downKey && events.find(x => x.id === downLane)
  downLane = null
  saveNow()
  if (ev && !locked) {
    editingId = ev.id
    pick(ev.date, endOf(ev))
  } else {
    editingId = null
    pick(picked, pickedEnd) // 하루만 골랐는데 다른 달 날짜면 그 달로 넘어간다
  }
})

// 달력 위에서 휠을 굴리면 달이 넘어간다
let wheelAt = 0
$('grid').addEventListener(
  'wheel',
  e => {
    if (anchor || Date.now() - wheelAt < 180) return
    wheelAt = Date.now()
    moveMonth(e.deltaY > 0 ? 1 : -1)
  },
  { passive: true }
)

// 경계선 끌기: 넓은 화면에선 좌우, 아니면 위아래. 두 번 누르면 처음 자리로
{
  const bar = $('split')
  const saveSplit = () => {
    try {
      localStorage.setItem(SPLIT_KEY, JSON.stringify(split))
    } catch {}
  }
  bar.addEventListener('pointerdown', e => {
    if (e.button !== 0 || locked) return
    bar.setPointerCapture(e.pointerId)
    bar.classList.add('dragging')
  })
  bar.addEventListener('pointermove', e => {
    if (!bar.hasPointerCapture(e.pointerId)) return
    const card = document.querySelector('.card')
    const r = card.getBoundingClientRect()
    const wide = document.body.classList.contains('wide')
    if (wide) split.w = Math.round(r.right - e.clientX - 4)
    else split.h = Math.round(r.bottom - e.clientY - 4)
    relayout()
    // 끝까지 밀었으면 잘린 값으로 기억한다
    const v = parseInt(card.style.getPropertyValue(wide ? '--agenda-w' : '--agenda-h'))
    if (v) split[wide ? 'w' : 'h'] = v
  })
  const end = () => {
    if (!bar.classList.contains('dragging')) return
    bar.classList.remove('dragging')
    saveSplit()
  }
  bar.addEventListener('pointerup', end)
  bar.addEventListener('lostpointercapture', end)
  bar.addEventListener('dblclick', () => {
    if (locked) return
    if (document.body.classList.contains('wide')) delete split.w
    else delete split.h
    saveSplit()
    relayout()
  })
}

// 크기가 바뀌면 칸에 들어가는 줄 수를 다시 세고, 달라졌을 때만 다시 그린다
function relayout() {
  const was = document.body.className
  const room = layout()
  if (room !== chipRoom || was !== document.body.className) {
    chipRoom = room
    renderGrid()
  }
}
window.addEventListener('resize', relayout)

// 가장자리를 잡고 끌면 크기가 바뀐다. main.js가 창을 미리 크게 펴 두면(stage)
// 끄는 동안 여기서는 body의 자리와 크기만 바꾼다. 창 자체가 매번 바뀌지 않으니 떨리지 않는다.
// 누르기만 하고 안 끌면 아무 일도 없다: 3px 넘게 움직였을 때 비로소 창을 편다 (그냥 클릭에 창이 깜빡이지 않게)
const GRIP_SLOP = 3
let gripDown = null
for (const grip of document.querySelectorAll('.grips i')) {
  grip.addEventListener('pointerdown', e => {
    if (e.button !== 0 || locked) return
    grip.setPointerCapture(e.pointerId)
    gripDown = { edge: grip.dataset.edge, x: e.screenX, y: e.screenY, started: false }
  })
  grip.addEventListener('pointermove', e => {
    const g = gripDown
    if (!g || g.started) return
    if (Math.abs(e.screenX - g.x) < GRIP_SLOP && Math.abs(e.screenY - g.y) < GRIP_SLOP) return
    g.started = true
    // 누른 뒤 움직인 만큼을 같이 보내서, 창이 처음 3px도 빠짐없이 따라오게 한다
    window.cal.resizeStart(g.edge, { dx: e.screenX - g.x, dy: e.screenY - g.y })
  })
  const end = () => {
    if (gripDown && gripDown.started) window.cal.resizeEnd()
    gripDown = null
  }
  grip.addEventListener('pointerup', end)
  grip.addEventListener('lostpointercapture', end)
}
const afterPaint = fn => requestAnimationFrame(() => requestAnimationFrame(fn))
window.cal.onStage(r => {
  const b = document.body
  const first = !b.classList.contains('staged')
  b.classList.add('staged')
  b.style.left = r.x + 'px'
  b.style.top = r.y + 'px'
  b.style.width = r.width + 'px'
  b.style.height = r.height + 'px'
  relayout()
  if (first) afterPaint(() => window.cal.staged())
  // 왼쪽·위로 펴느라 잠깐 감췄던 창: 옮긴 자리에서 다 그렸으면 바로 다시 보이게 한다
  else if (r.reveal) afterPaint(() => window.cal.unstaged())
})
window.cal.onUnstage(() => {
  const b = document.body
  b.classList.remove('staged')
  b.removeAttribute('style')
  relayout()
  afterPaint(() => window.cal.unstaged())
})

// 테마는 main.js가 바꾸면 prefers-color-scheme가 따라 바뀌어 저절로 칠해진다. 투명도만 여기서 적용
const applyLook = look => {
  if (look && Number.isFinite(look.alpha)) document.documentElement.style.setProperty('--bg-alpha', look.alpha)
}
window.cal.onLook(applyLook)

// 처음 설정 카드: main.js가 setup 값을 주면 한 번만 띄운다
let setup = null
function openSetup(s) {
  setup = { theme: s.theme, transparency: s.transparency, corner: s.corner, onTop: s.onTop, autoStart: s.autoStart }
  $('sAutoRow').hidden = !s.canAutoStart
  $('sAlpha').value = setup.transparency
  $('sAuto').checked = setup.autoStart
  $('sTop').checked = setup.onTop
  paintSetup()
  $('setup').hidden = false
  document.querySelector('.card').classList.add('setting')
}
function paintSetup() {
  for (const b of $('sTheme').children) b.classList.toggle('on', b.dataset.v === setup.theme)
  for (const b of $('sCorner').children) b.classList.toggle('on', b.dataset.v === setup.corner)
  $('sAlphaOut').textContent = setup.transparency === 0 ? '불투명' : `${setup.transparency}%`
}
const previewSetup = () => {
  paintSetup()
  window.cal.setupPreview({ theme: setup.theme, transparency: setup.transparency })
}
$('sTheme').addEventListener('click', e => {
  const b = e.target.closest('button')
  if (!b) return
  setup.theme = b.dataset.v
  previewSetup()
})
$('sAlpha').addEventListener('input', () => {
  setup.transparency = Math.round(Number($('sAlpha').value) / 10) * 10
  previewSetup()
})
$('sCorner').addEventListener('click', e => {
  const b = e.target.closest('button')
  if (!b) return
  setup.corner = b.dataset.v
  paintSetup()
})
$('sAuto').addEventListener('change', () => (setup.autoStart = $('sAuto').checked))
$('sTop').addEventListener('change', () => (setup.onTop = $('sTop').checked))
$('sStart').addEventListener('click', () => {
  window.cal.setupDone(setup)
  $('setup').hidden = true
  document.querySelector('.card').classList.remove('setting')
  setup = null
  $('input').focus()
})

async function reload() {
  // 고치는 중에 아직 안 쓴 게 있으면 파일을 다시 읽지 않는다 (쓴 글자가 날아가지 않게)
  if (saveTimer !== null || anchor) return
  const data = await window.cal.load()
  if (!setup) applyLook(data.look) // 처음 설정 중에는 고르고 있는 투명도를 덮어쓰지 않는다
  if (data.setup && !setup && $('setup').hidden) openSetup(data.setup)
  if (!!data.locked !== locked) {
    locked = !!data.locked
    document.body.classList.toggle('locked', locked)
    $('lock').setAttribute('aria-pressed', String(locked))
    $('lock').title = $('lock').ariaLabel = locked ? '잠금 풀기' : '잠그기'
    if (locked) {
      editingId = null
      showSel = false
      picked = pickedEnd = todayKey
    }
  }
  events = Array.isArray(data.events) ? data.events.filter(e => e && validKey(e.date) && e.title) : []
  for (const e of events) {
    if (!validKey(e.end) || e.end <= e.date) delete e.end
    if (!(e.color in COLORS) || e.color === 'blue') delete e.color
    if (typeof e.memo !== 'string' || !e.memo.trim()) delete e.memo
  }
  if (editingId && !events.some(e => e.id === editingId)) editingId = null
  // 고치는 칸에 커서가 있으면 목록은 그대로 두고 달력만 다시 그린다
  if (document.activeElement && document.activeElement.closest('.editor')) {
    chipRoom = layout()
    renderGrid()
  } else render()
}

// 자정이 지나면 오늘을 옮기고, 파일을 밖에서 고쳤을 수도 있으니 창에 돌아올 때 다시 읽는다
setInterval(() => {
  const now = keyOf(new Date())
  if (now === todayKey) return
  if (picked === todayKey && pickedEnd === todayKey) picked = pickedEnd = now
  todayKey = now
  reload()
}, 30000)
window.addEventListener('focus', reload)
window.addEventListener('blur', saveNow)

reload()
