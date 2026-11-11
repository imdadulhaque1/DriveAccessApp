const { contextBridge, ipcRenderer } = require('electron');

async function call(channel, ...args) {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

contextBridge.exposeInMainWorld('api', {
  authStatus: () => call('auth:status'),
  signIn: () => call('auth:signIn'),
  cancelSignIn: () => call('auth:cancel'),
  reopenBrowser: () => call('auth:reopenBrowser'),
  copySignInLink: () => call('auth:copyLink'),
  signOut: () => call('auth:signOut'),

  pickFiles: () => call('files:pick'),
  openLink: (url) => call('link:open', url),
  openDriveFolder: () => call('drive:openFolder'),

  listEmployees: () => call('emp:list'),
  createEmployee: (data) => call('emp:create', data),
  updateEmployee: (id, data) => call('emp:update', id, data),
  deleteEmployee: (id) => call('emp:delete', id),
});
