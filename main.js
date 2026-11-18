// 바탕화면 달력: 테두리 없는 작은 창. 일정은 events.json에 저장한다.
const { app, BrowserWindow, Menu, ipcMain, nativeTheme, screen, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const WIDTH = 348
const HEIGHT = 620
const MIN_W = 300
const MIN_H = 480
// 일정 파일: 폴더에서 바로 켜면 이 폴더의 events.json, exe로 설치하면 사용자 폴더(AppData)에 둔다.
// CAL_EVENTS는 확인용: 진짜 일정 대신 다른 파일을 읽는다
const EVENTS = () =>
  process.env.CAL_EVENTS ||
  (app.isPackaged ? path.join(app.getPath('userData'), 'events.json') : path.join(__dirname, 'events.json'))
const STATE = () => path.join(app.getPath('userData'), 'window.json')
// 확인용으로 찍을 때는 따로 쓰는 임시 폴더를 써서, 켜져 있는 진짜 달력과 설정·캐시가 부딪치지 않게 한다
if (process.env.CAL_SHOT) app.setPath('userData', path.join(app.getPath('temp'), 'desk-calendar-shot'))

let win = null
let state = {}

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

const saveState = patch => {
  state = { ...state, ...patch }
  if (process.env.CAL_SHOT) return // 확인용 실행은 저장해 둔 자리를 건드리지 않는다
  try {
    fs.mkdirSync(path.dirname(STATE()), { recursive: true })
    fs.writeFileSync(STATE(), JSON.stringify(state))
  } catch {}
}

// 화면 네 구석: tr 오른쪽 위, tl 왼쪽 위, br 오른쪽 아래, bl 왼쪽 아래
const CORNERS = ['tr', 'tl', 'br', 'bl']
const cornerOf = () => (CORNERS.includes(state.corner) ? state.corner : 'tr')
const cornerPosition = (width = WIDTH, corner = cornerOf(), height = HEIGHT) => {
  const area = screen.getPrimaryDisplay().workArea
  return {
    x: corner.endsWith('l') ? area.x + 16 : area.x + area.width - width - 16,
    y: corner.startsWith('b') ? area.y + area.height - height - 16 : area.y + 16,
  }
}

// 저장해 둔 크기(모니터보다 크면 줄여서)와 자리. 자리가 지금 모니터 밖이면 오른쪽 위 구석
function startBounds() {
  const clampTo = area => ({
    width: Math.max(MIN_W, Math.min(Number(state.width) || WIDTH, area.width)),
    height: Math.max(MIN_H, Math.min(Number(state.height) || HEIGHT, area.height)),
  })
  if (Number.isFinite(state.x) && Number.isFinite(state.y)) {
    const area = screen.getDisplayMatching({ x: state.x, y: state.y, width: WIDTH, height: HEIGHT }).workArea
    const { width, height } = clampTo(area)
    const inside =
      state.x + width > area.x && state.x < area.x + area.width && state.y + height > area.y && state.y < area.y + area.height
    if (inside) return { x: state.x, y: state.y, width, height }
  }
  const size = clampTo(screen.getPrimaryDisplay().workArea)
  return { ...cornerPosition(size.width, cornerOf(), size.height), ...size }
}

// 크기 조절: 투명한 테두리 없는 창은 윈도우가 직접 늘려 주지 않으니 가장자리를 잡으면 여기서 마우스를 따라간다.
// 창 자체를 매 프레임 늘리면 윈도우가 창을 옮기는 박자와 안을 그리는 박자가 어긋나 요소들이 떨린다.
// 그래서 잡는 순간 창을 끌 수 있는 데까지 투명하게 미리 펴 두고(stage), 끄는 동안은 그 안의 카드만 늘린다.
// 놓으면 창을 카드 크기로 다시 줄인다. edge는 'n', 'se', 'w' 같은 방향.
let drag = null
const rel = (r, stage) => ({ x: r.x - stage.x, y: r.y - stage.y, width: r.width, height: r.height })

function startResize(edge, downAt) {
  if (drag) return
  const from = win.getBounds()
  const area = screen.getDisplayMatching(from).workArea
  const left = edge.includes('w') ? Math.min(area.x, from.x) : from.x
  const top = edge.includes('n') ? Math.min(area.y, from.y) : from.y
  const right = edge.includes('e') ? Math.max(area.x + area.width, from.x + from.width) : from.x + from.width
  const bottom = edge.includes('s') ? Math.max(area.y + area.height, from.y + from.height) : from.y + from.height
  const stage = { x: left, y: top, width: right - left, height: bottom - top }
  // 왼쪽·위로 펼 때는 창이 옮겨지는 순간 카드가 한 번 튀어 보일 수 있어 잠깐 감춘다
  const shift = stage.x !== from.x || stage.y !== from.y
  // at: 마우스를 누른 자리. 화면 쪽은 몇 px 끈 다음에야 시작을 알리므로, 지금 커서에서 그만큼 되돌린다
  const now = screen.getCursorScreenPoint()
  const moved = downAt && Number.isFinite(downAt.dx) && Number.isFinite(downAt.dy) ? downAt : { dx: 0, dy: 0 }
  const at = { x: now.x - Math.round(moved.dx), y: now.y - Math.round(moved.dy) }
  drag = { edge, from, at, stage, rect: from, shift, ready: false, timer: null }
  if (shift) win.setOpacity(0)
  win.webContents.send('stage', rel(from, stage))
}

// 화면 쪽이 카드를 제자리에 고정했다고 알려 오면 그제서야 창을 편다
function staged() {
  if (!drag || drag.ready || !win) return
  drag.ready = true
  win.setBounds(drag.stage)
  if (drag.shift) {
    // 옮긴 창에서 카드를 한 번 더 그리게 하고, 다 그렸다는 답(unstaged)이 오면 바로 보인다. 답이 늦으면 150ms 뒤에라도
    win.webContents.send('stage', { ...rel(drag.rect, drag.stage), reveal: true })
    setTimeout(() => win && win.setOpacity(1), 150)
  }
  drag.timer = setInterval(follow, 16)
}

function follow() {
  if (!win || !drag) return
  const { edge, from, at, stage } = drag
  const p = screen.getCursorScreenPoint()
  const dx = p.x - at.x
  const dy = p.y - at.y
  let { x, y, width, height } = from
  if (edge.includes('e')) width = Math.min(stage.x + stage.width - x, Math.max(MIN_W, from.width + dx))
  if (edge.includes('s')) height = Math.min(stage.y + stage.height - y, Math.max(MIN_H, from.height + dy))
  if (edge.includes('w')) {
    width = Math.min(from.x + from.width - stage.x, Math.max(MIN_W, from.width - dx))
    x = from.x + from.width - width
  }
  if (edge.includes('n')) {
    height = Math.min(from.y + from.height - stage.y, Math.max(MIN_H, from.height - dy))
    y = from.y + from.height - height
  }
  const r = drag.rect
  if (r.x === x && r.y === y && r.width === width && r.height === height) return
  drag.rect = { x, y, width, height }
  win.webContents.send('stage', rel(drag.rect, stage))
}

function stopResize() {
  if (!drag) return
  const d = drag
  drag = null
  clearInterval(d.timer)
  if (!win) return
  if (d.ready) {
    const shift = d.rect.x !== d.stage.x || d.rect.y !== d.stage.y
    if (shift) win.setOpacity(0)
    win.setBounds(d.rect)
    saveState(d.rect)
  }
  win.webContents.send('unstage') // 화면 쪽이 다 그리고 'unstaged'를 보내면 다시 보인다
}

// 겉모습: 테마(system/light/dark)와 배경 투명도(%, 0이면 불투명). 글자는 그대로 두고 카드 배경만 비친다
const THEMES = [
  ['system', '시스템 따라가기'],
  ['light', '라이트'],
  ['dark', '다크'],
]
const TRANSPARENCY = [0, 10, 20, 30, 40, 50, 60]
const themeOf = () => (THEMES.some(([v]) => v === state.theme) ? state.theme : 'system')
const transparencyOf = () => (TRANSPARENCY.includes(state.transparency) ? state.transparency : 10)
const look = () => ({ alpha: 1 - transparencyOf() / 100 })
function setLook(patch) {
  saveState(patch)
  nativeTheme.themeSource = themeOf()
  if (win) win.webContents.send('look', look())
}

// 휴대용 exe는 켤 때마다 임시 폴더에 풀리므로, 자동 실행에는 exe 파일 자체를 적는다
const exePath = () => process.env.PORTABLE_EXECUTABLE_FILE || process.execPath
const loginSettings = () => ({ path: exePath(), args: app.isPackaged ? [] : [app.getAppPath()] })
// 스토어판(appx)은 이 방식의 자동 실행이 안 돼서 메뉴와 처음 설정에서 뺀다
const canAutoStart = !process.windowsStore
const autoStartOn = () => canAutoStart && app.getLoginItemSettings(loginSettings()).openAtLogin
const setAutoStart = on => {
  if (canAutoStart && !process.env.CAL_SHOT) app.setLoginItemSettings({ ...loginSettings(), openAtLogin: on })
}

// 처음 켤 때(저장된 창 상태가 없을 때) 화면 쪽에 처음 설정 카드를 띄운다. CAL_SETUP=1 은 확인용으로 강제로 띄운다
let setupPending = false
const setupInfo = () =>
  setupPending
    ? {
        theme: themeOf(),
        transparency: transparencyOf(),
        onTop: !!state.onTop,
        autoStart: canAutoStart,
        canAutoStart,
        corner: cornerOf(),
      }
    : null

function showMenu() {
  const autoStart = autoStartOn()
  Menu.buildFromTemplate([
    {
      label: '항상 위에 두기',
      type: 'checkbox',
      checked: !!state.onTop,
      click: item => {
        saveState({ onTop: item.checked })
        win.setAlwaysOnTop(item.checked)
      },
    },
    ...(canAutoStart
      ? [
          {
            label: '윈도우 켤 때 같이 켜기',
            type: 'checkbox',
            checked: autoStart,
            click: item => setAutoStart(item.checked),
          },
        ]
      : []),
    {
      label: '테마',
      submenu: THEMES.map(([value, label]) => ({
        label,
        type: 'radio',
        checked: themeOf() === value,
        click: () => setLook({ theme: value }),
      })),
    },
    {
      label: '배경 투명도',
      submenu: TRANSPARENCY.map(t => ({
        label: t === 0 ? '불투명' : `${t}%` + (t === 10 ? ' (기본)' : ''),
        type: 'radio',
        checked: transparencyOf() === t,
        click: () => setLook({ transparency: t }),
      })),
    },
    { type: 'separator' },
    {
      label: '구석으로 돌려보내기',
      click: () => {
        win.setBounds({ ...cornerPosition(), width: WIDTH, height: HEIGHT })
        saveState(win.getBounds())
      },
    },
    {
      label: '일정 파일 열기',
      click: () => {
        if (!fs.existsSync(EVENTS())) writeEvents([])
        shell.openPath(EVENTS())
      },
    },
    { type: 'separator' },
    { label: '닫기', click: () => app.quit() },
  ]).popup({ window: win })
}

function createWindow() {
  setupPending = process.env.CAL_SETUP === '1' || (!process.env.CAL_SHOT && !fs.existsSync(STATE()))
  state = readJson(STATE(), {})
  // 확인용: CAL_LOOK=dark,40 이면 그 테마와 투명도로 띄운다 (저장은 안 한다)
  const testLook = /^(system|light|dark),(\d+)$/.exec(process.env.CAL_LOOK || '')
  if (testLook) Object.assign(state, { theme: testLook[1], transparency: +testLook[2] })
  if (process.env.CAL_LOCKED) state.locked = process.env.CAL_LOCKED === '1' // 확인용: 잠긴/풀린 모습으로 찍기
  nativeTheme.themeSource = themeOf()
  win = new BrowserWindow({
    ...startBounds(),
    minWidth: MIN_W,
    minHeight: MIN_H,
    transparent: true,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: !!state.onTop,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  })
  win.loadFile('index.html')
  applyClickThrough() // 잠긴 채로 껐으면 켤 때부터 클릭 통과
  win.on('moved', () => {
    if (drag) return // 크기 조절 중에 편 자리는 저장하지 않는다
    const [x, y] = win.getPosition()
    saveState({ x, y })
  })
  win.on('closed', () => {
    stopResize()
    win = null
  })

  // 확인용: CAL_SHOT=파일경로 로 켜면 잠시 뒤 화면을 그 파일에 찍고 꺼진다
  // CAL_SIZE=가로x세로 를 같이 주면 그 크기로 바꾼 뒤에 찍는다 (크기 조절 확인용)
  if (process.env.CAL_SHOT) {
    const size = /^(\d+)x(\d+)$/.exec(process.env.CAL_SIZE || '')
    if (size) setTimeout(() => win.setBounds({ ...win.getBounds(), width: +size[1], height: +size[2] }), 500)
    // CAL_PICK=2026-11-18,2026-11-20 이면 그 범위를 고른 모습으로 찍는다
    const range = /^(\d{4}-\d{2}-\d{2}),(\d{4}-\d{2}-\d{2})$/.exec(process.env.CAL_PICK || '')
    if (range) setTimeout(() => win.webContents.executeJavaScript(`showSel = true; pick('${range[1]}', '${range[2]}')`), 900)
    // CAL_JS=스크립트 면 찍기 전에 그 스크립트를 화면 쪽에서 돌린다 (클릭 같은 동작을 흉내 내 확인할 때)
    if (process.env.CAL_JS) setTimeout(() => win.webContents.executeJavaScript(process.env.CAL_JS).catch(() => {}), 1100)
    // CAL_EDIT=일정id 면 그 일정을 고치는 칸을 연 모습으로 찍는다
    const edit = /^\w+$/.exec(process.env.CAL_EDIT || '')
    if (edit) setTimeout(() => win.webContents.executeJavaScript(`editingId = '${edit[0]}'; render()`), 1000)
    // CAL_SPLIT=h300 이나 w400 이면 경계선을 그만큼 옮긴 모습으로 찍는다 (저장은 안 한다)
    const sp = /^([hw])(\d+)$/.exec(process.env.CAL_SPLIT || '')
    if (sp) setTimeout(() => win.webContents.executeJavaScript(`split = { ${sp[1]}: ${sp[2]} }; render()`), 1000)
    setTimeout(async () => {
      fs.writeFileSync(process.env.CAL_SHOT, (await win.webContents.capturePage()).toPNG())
      app.quit()
    }, 1500)
  }
}

ipcMain.handle('load', () => ({
  events: readJson(EVENTS(), []),
  look: look(),
  setup: setupInfo(),
  locked: !!state.locked,
}))
// 잠금 = 클릭 통과: 잠겨 있으면 창이 마우스를 무시해서 클릭이 뒤의 바탕화면으로 간다.
// 마우스 움직임만은 계속 받아(forward) 자물쇠 위에 올라왔을 때만 잠깐 클릭을 받는다
let lockHover = false
function applyClickThrough() {
  if (!win) return
  const through = !!state.locked && !lockHover
  if (through) win.setIgnoreMouseEvents(true, { forward: true })
  else win.setIgnoreMouseEvents(false)
}
ipcMain.on('lock', (_e, on) => {
  if (drag) stopResize()
  saveState({ locked: !!on })
  applyClickThrough()
})
ipcMain.on('lock-hover', (_e, on) => {
  lockHover = !!on
  applyClickThrough()
})

// 처음 설정: 고르는 동안은 테마·투명도만 바로 보여 주고(저장 안 함), '시작하기'를 누르면 한꺼번에 저장한다
const pickTheme = v => (THEMES.some(([t]) => t === v) ? v : 'system')
const pickTransparency = v => (TRANSPARENCY.includes(v) ? v : 10)
ipcMain.on('setup-preview', (_e, p) => {
  if (!setupPending || !win || !p) return
  nativeTheme.themeSource = pickTheme(p.theme)
  win.webContents.send('look', { alpha: 1 - pickTransparency(p.transparency) / 100 })
})
ipcMain.on('setup-done', (_e, p) => {
  if (!setupPending || !win || !p) return
  setupPending = false
  const corner = CORNERS.includes(p.corner) ? p.corner : 'tr'
  const onTop = !!p.onTop
  const b = win.getBounds()
  saveState({ theme: pickTheme(p.theme), transparency: pickTransparency(p.transparency), onTop, corner })
  setLook({})
  win.setAlwaysOnTop(onTop)
  setAutoStart(!!p.autoStart)
  win.setBounds({ ...b, ...cornerPosition(b.width, corner, b.height) })
  saveState(win.getBounds())
})
const writeEvents = events => {
  fs.mkdirSync(path.dirname(EVENTS()), { recursive: true })
  fs.writeFileSync(EVENTS(), JSON.stringify(events, null, 2) + '\n')
}
ipcMain.handle('save', (_e, events) => {
  writeEvents(events)
  return true
})
ipcMain.on('menu', showMenu)
ipcMain.on('resize-start', (_e, edge, at) => {
  if (win && typeof edge === 'string' && /^(n|s)?(e|w)?$/.test(edge) && edge) startResize(edge, at)
})
ipcMain.on('resize-end', stopResize)
ipcMain.on('staged', staged)
ipcMain.on('unstaged', () => win && win.setOpacity(1))

// 확인용으로 찍을 때는 이미 켜져 있는 달력과 따로 뜬다
if (!process.env.CAL_SHOT && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.whenReady().then(createWindow)
  app.on('window-all-closed', () => app.quit())
}
