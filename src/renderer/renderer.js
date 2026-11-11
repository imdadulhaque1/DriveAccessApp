const backend = window.api;
const $ = (id) => document.getElementById(id);

const state = {
  signedIn: false,
  employees: [],
  editing: null, // record being edited, or null for insert
  newFiles: [], // [{ path, name, size }]
  removeIds: new Set(), // driveFileIds of existing files marked for removal
};

// ---------- helpers ----------
function formatSize(bytes) {
  if (bytes == null || isNaN(bytes)) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  return `${bytes.toFixed(i ? 1 : 0)} ${units[i]}`;
}

const formatDate = (iso) => (iso ? new Date(iso).toLocaleString() : '');

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const c of children) if (c != null) node.append(c);
  return node;
}

function toast(msg, type = 'info') {
  const t = el('div', { className: `toast ${type}`, textContent: msg });
  $('toasts').append(t);
  setTimeout(() => t.remove(), type === 'error' ? 7000 : 3500);
}

async function run(label, fn) {
  $('busyText').textContent = label;
  $('busy').hidden = false;
  try {
    return await fn();
  } catch (err) {
    toast(err.message, 'error');
    return undefined;
  } finally {
    $('busy').hidden = true;
  }
}

// ---------- connection ----------
async function refreshStatus() {
  let s;
  try {
    s = await backend.authStatus();
  } catch (err) {
    toast(err.message, 'error');
    return;
  }
  state.signedIn = s.signedIn;
  const pill = $('connStatus');
  pill.textContent = s.signedIn ? '● Google Drive connected' : '● Google Drive not connected';
  pill.className = `pill ${s.signedIn ? 'ok' : 'warn'}`;

  // Not connected → warning + connect steps first; CRUD screen stays hidden.
  $('connectView').hidden = s.signedIn;
  $('mainView').hidden = !s.signedIn;
  $('account').hidden = !s.signedIn;
  $('signOutBtn').hidden = !s.signedIn;
  $('folderBtn').hidden = !s.signedIn;

  // OAuth client missing (developer setup) → show a small note under the button.
  $('notConfigured').hidden = s.hasCredentials;
  $('connectBtn').disabled = !s.hasCredentials;
  setWaiting(false);

  if (s.signedIn) {
    const u = s.user || {};
    $('accEmail').textContent = u.email || 'Unknown account';
    $('accName').textContent = u.name || 'Connected account';
    $('avatar').textContent = (u.name || u.email || '?').trim().charAt(0).toUpperCase();
    $('account').title = u.email ? `Data is saved to the Google Drive of ${u.email}` : '';
    await loadList();
  } else {
    state.employees = [];
    resetForm();
  }
}

// ---------- list ----------
async function loadList() {
  const list = await run('Loading from Google Drive…', () => backend.listEmployees());
  if (list) {
    state.employees = list;
    renderRows();
  }
}

function renderRows() {
  const term = $('search').value.trim().toLowerCase();
  const rows = state.employees.filter(
    (e) => !term || e.employeeId.toLowerCase().includes(term) || e.comments.toLowerCase().includes(term)
  );
  const tbody = $('rows');
  tbody.replaceChildren();

  for (const e of rows) {
    const files = el('td', { className: 'files' });
    if (!e.files.length) files.append(el('span', { className: 'muted', textContent: '—' }));
    for (const f of e.files) {
      const a = el('a', { href: '#', textContent: f.name, title: `${f.name} (${formatSize(f.size)})` });
      a.onclick = (ev) => { ev.preventDefault(); backend.openLink(f.webViewLink).catch((err) => toast(err.message, 'error')); };
      files.append(a);
    }

    const editBtn = el('button', { className: 'btn small', textContent: 'Edit' });
    editBtn.onclick = () => startEdit(e);
    const delBtn = el('button', { className: 'btn small danger', textContent: 'Delete' });
    delBtn.onclick = () => deleteRecord(e);

    const tr = el(
      'tr',
      { className: state.editing && state.editing.id === e.id ? 'editing' : '' },
      el('td', { className: 'empid', textContent: e.employeeId }),
      el('td', { className: 'comments', textContent: e.comments }),
      files,
      el('td', { className: 'date', textContent: formatDate(e.updatedAt) }),
      el('td', { className: 'actions-col' }, editBtn, delBtn)
    );
    tbody.append(tr);
  }

  const empty = $('emptyMsg');
  if (!state.signedIn) return;
  empty.textContent = rows.length
    ? ''
    : state.employees.length
      ? 'No records match your search.'
      : 'No employee records yet. Add one using the form.';
}

// ---------- form ----------
function renderFileList() {
  const ul = $('fileList');
  ul.replaceChildren();

  if (state.editing) {
    for (const f of state.editing.files) {
      const removed = state.removeIds.has(f.driveFileId);
      const btn = el('button', {
        type: 'button',
        className: 'link-btn',
        textContent: removed ? 'Undo' : '✕',
        title: removed ? 'Keep this file' : 'Remove this file',
      });
      btn.onclick = () => {
        removed ? state.removeIds.delete(f.driveFileId) : state.removeIds.add(f.driveFileId);
        renderFileList();
      };
      ul.append(
        el('li', { className: removed ? 'removed' : '' },
          el('span', { className: 'fname', textContent: f.name }),
          el('span', { className: 'muted', textContent: formatSize(f.size) }),
          btn)
      );
    }
  }

  state.newFiles.forEach((f, i) => {
    const btn = el('button', { type: 'button', className: 'link-btn', textContent: '✕', title: 'Remove' });
    btn.onclick = () => { state.newFiles.splice(i, 1); renderFileList(); };
    ul.append(
      el('li', { className: 'new' },
        el('span', { className: 'fname', textContent: f.name }),
        el('span', { className: 'muted', textContent: `${formatSize(f.size)} · new` }),
        btn)
    );
  });

  if (!ul.children.length) ul.append(el('li', { className: 'muted none', textContent: 'No files attached' }));
}

function resetForm() {
  state.editing = null;
  state.newFiles = [];
  state.removeIds.clear();
  $('empForm').reset();
  $('formTitle').textContent = 'Add Employee';
  $('saveBtn').textContent = 'Insert';
  $('cancelBtn').hidden = true;
  renderFileList();
  renderRows();
}

function startEdit(rec) {
  state.editing = rec;
  state.newFiles = [];
  state.removeIds.clear();
  $('employeeId').value = rec.employeeId;
  $('comments').value = rec.comments;
  $('formTitle').textContent = `Edit Employee – ${rec.employeeId}`;
  $('saveBtn').textContent = 'Update';
  $('cancelBtn').hidden = false;
  renderFileList();
  renderRows();
  $('employeeId').focus();
}

async function deleteRecord(rec) {
  const n = rec.files.length;
  const ok = confirm(
    `Delete employee "${rec.employeeId}"?` + (n ? `\n\n${n} attached file(s) will also be deleted from Google Drive.` : '')
  );
  if (!ok) return;
  const list = await run('Deleting…', () => backend.deleteEmployee(rec.id));
  if (list) {
    state.employees = list;
    if (state.editing && state.editing.id === rec.id) resetForm();
    else renderRows();
    toast(`Deleted "${rec.employeeId}"`, 'success');
  }
}

$('empForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const employeeId = $('employeeId').value.trim();
  const comments = $('comments').value.trim();
  if (!employeeId) {
    toast('Employee ID is required.', 'error');
    return;
  }

  const uploading = state.newFiles.length ? ` and uploading ${state.newFiles.length} file(s)` : '';
  let list;
  if (state.editing) {
    list = await run(`Updating${uploading}…`, () =>
      backend.updateEmployee(state.editing.id, {
        employeeId,
        comments,
        addPaths: state.newFiles.map((f) => f.path),
        removeFileIds: [...state.removeIds],
      })
    );
  } else {
    list = await run(`Saving${uploading}…`, () =>
      backend.createEmployee({ employeeId, comments, filePaths: state.newFiles.map((f) => f.path) })
    );
  }
  if (list) {
    toast(state.editing ? `Updated "${employeeId}"` : `Inserted "${employeeId}"`, 'success');
    state.employees = list;
    resetForm();
  }
});

$('addFilesBtn').onclick = async () => {
  try {
    const picked = await backend.pickFiles();
    for (const f of picked) {
      if (!state.newFiles.some((x) => x.path === f.path)) state.newFiles.push(f);
    }
    renderFileList();
  } catch (err) {
    toast(err.message, 'error');
  }
};

$('cancelBtn').onclick = resetForm;
$('search').addEventListener('input', renderRows);
$('refreshBtn').onclick = loadList;

// ---------- Google sign-in ----------
function setWaiting(on) {
  $('signInIdle').hidden = on;
  $('signInWaiting').hidden = !on;
}

$('connectBtn').onclick = async () => {
  setWaiting(true);
  let ok = false;
  try {
    await backend.signIn(); // resolves once the browser redirects back
    ok = true;
  } catch (err) {
    if (!/cancelled/i.test(err.message) || /browser/i.test(err.message)) toast(err.message, 'error');
  }
  await refreshStatus(); // also switches back from the waiting view
  if (ok) toast(`Connected to Google Drive as ${$('accEmail').textContent}`, 'success');
};

$('reopenBtn').onclick = () => backend.reopenBrowser().catch((err) => toast(err.message, 'error'));
$('copyLinkBtn').onclick = () =>
  backend
    .copySignInLink()
    .then(() => toast('Sign-in link copied. Paste it into your browser.', 'success'))
    .catch((err) => toast(err.message, 'error'));
$('cancelSignInBtn').onclick = () => backend.cancelSignIn().catch(() => {});

$('signOutBtn').onclick = async () => {
  if (!confirm('Sign out from Google Drive?')) return;
  await run('Signing out…', () => backend.signOut());
  resetForm();
  refreshStatus();
};

$('folderBtn').onclick = () => backend.openDriveFolder().catch((err) => toast(err.message, 'error'));

renderFileList();
refreshStatus();
