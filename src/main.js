const { app, BrowserWindow, ipcMain, shell, dialog, clipboard } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const auth = require('./google/auth');
const store = require('./store');

let win = null;
// Only paths the user picked through the native dialog may be uploaded.
const pickedPaths = new Set();

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 740,
    minWidth: 860,
    minHeight: 520,
    title: 'DriveAccessApp – Employee Records',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// Wrap handlers so the renderer gets clean error messages.
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });
}

function checkPaths(paths = []) {
  for (const p of paths) {
    if (!pickedPaths.has(p)) throw new Error(`File not allowed: ${p}`);
  }
  return paths;
}

// ---- Auth ----
handle('auth:status', () => auth.status());

handle('auth:signIn', async () => {
  try {
    await auth.signIn();
    store.reset();
  } finally {
    // Bring the app back in front of the browser.
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  }
});

handle('auth:cancel', () => auth.cancelSignIn());

handle('auth:reopenBrowser', () => {
  const url = auth.pendingSignInUrl();
  if (!url) throw new Error('No sign-in in progress.');
  return shell.openExternal(url);
});

handle('auth:copyLink', () => {
  const url = auth.pendingSignInUrl();
  if (!url) throw new Error('No sign-in in progress.');
  clipboard.writeText(url);
});

handle('auth:signOut', async () => {
  await auth.signOut();
  store.reset();
});

// ---- Files ----
handle('files:pick', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Select files to upload',
    properties: ['openFile', 'multiSelections'],
  });
  if (r.canceled) return [];
  return Promise.all(
    r.filePaths.map(async (p) => {
      pickedPaths.add(p);
      const st = await fs.stat(p);
      return { path: p, name: path.basename(p), size: st.size };
    })
  );
});

handle('link:open', (url) => {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !/(^|\.)google\.com$/.test(u.hostname)) {
    throw new Error('Blocked non-Google link.');
  }
  return shell.openExternal(url);
});

handle('drive:openFolder', async () => shell.openExternal(await store.folderUrl()));

// ---- Employees CRUD ----
handle('emp:list', () => store.list());

handle('emp:create', (data) =>
  store.create({
    employeeId: data.employeeId,
    comments: data.comments,
    filePaths: checkPaths(data.filePaths),
  })
);

handle('emp:update', (id, data) =>
  store.update(id, {
    employeeId: data.employeeId,
    comments: data.comments,
    addPaths: checkPaths(data.addPaths),
    removeFileIds: data.removeFileIds || [],
  })
);

handle('emp:delete', (id) => store.remove(id));

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
