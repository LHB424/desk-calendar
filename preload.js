const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('cal', {
  load: () => ipcRenderer.invoke('load'),
  save: events => ipcRenderer.invoke('save', events),
  menu: () => ipcRenderer.send('menu'),
  setLocked: on => ipcRenderer.send('lock', !!on),
  lockHover: on => ipcRenderer.send('lock-hover', !!on),
  setupPreview: p => ipcRenderer.send('setup-preview', p),
  setupDone: p => ipcRenderer.send('setup-done', p),
  onLook: fn => ipcRenderer.on('look', (_e, look) => fn(look)),
  resizeStart: (edge, at) => ipcRenderer.send('resize-start', edge, at),
  resizeEnd: () => ipcRenderer.send('resize-end'),
  // 크기 조절 중: 창 안에서 카드가 놓일 자리와 크기를 받는다
  onStage: fn => ipcRenderer.on('stage', (_e, rect) => fn(rect)),
  onUnstage: fn => ipcRenderer.on('unstage', () => fn()),
  staged: () => ipcRenderer.send('staged'),
  unstaged: () => ipcRenderer.send('unstaged'),
})
