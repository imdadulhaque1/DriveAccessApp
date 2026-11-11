// Employee records stored as JSON in Google Drive:
//   My Drive/DriveAccessApp/employees.json
//   My Drive/DriveAccessApp/uploads/<attached files>
const crypto = require('crypto');
const drive = require('./google/drive');

const ROOT_FOLDER = 'DriveAccessApp';
const UPLOADS_FOLDER = 'uploads';
const DATA_FILE = 'employees.json';

let ctx = null; // { rootId, uploadsId, dataFileId }

async function init() {
  if (ctx) return ctx;
  const root = await drive.findOrCreateFolder(ROOT_FOLDER);
  const uploads = await drive.findOrCreateFolder(UPLOADS_FOLDER, root.id);
  let dataFile = await drive.findOne(DATA_FILE, root.id);
  if (!dataFile) {
    dataFile = await drive.createJsonFile(DATA_FILE, root.id, emptyDb());
  }
  ctx = { rootId: root.id, uploadsId: uploads.id, dataFileId: dataFile.id };
  return ctx;
}

function reset() {
  ctx = null;
}

const emptyDb = () => ({ version: 1, updatedAt: new Date().toISOString(), employees: [] });

async function load() {
  try {
    const { dataFileId } = await init();
    const db = (await drive.readJson(dataFileId)) || emptyDb();
    if (!Array.isArray(db.employees)) db.employees = [];
    return db;
  } catch (err) {
    if (err.status === 404) {
      // Data file/folder was removed in Drive; recreate.
      reset();
      await init();
      return emptyDb();
    }
    throw err;
  }
}

async function save(db) {
  const { dataFileId } = await init();
  db.updatedAt = new Date().toISOString();
  await drive.writeJson(dataFileId, db);
}

// Serialize all write operations so read-modify-write never races.
let queue = Promise.resolve();
function serial(fn) {
  const p = queue.then(fn, fn);
  queue = p.catch(() => {});
  return p;
}

function validate(db, employeeId, selfId) {
  const id = String(employeeId || '').trim();
  if (!id) throw new Error('Employee ID is required.');
  const dup = db.employees.find((e) => e.employeeId.toLowerCase() === id.toLowerCase() && e.id !== selfId);
  if (dup) throw new Error(`Employee ID "${id}" already exists.`);
  return id;
}

async function uploadAll(paths) {
  const { uploadsId } = await init();
  const uploaded = [];
  try {
    for (const p of paths) uploaded.push(await drive.uploadFile(p, uploadsId));
  } catch (err) {
    await deleteAll(uploaded); // roll back partial uploads
    throw err;
  }
  return uploaded;
}

async function deleteAll(files) {
  await Promise.all(files.map((f) => drive.deleteFile(f.driveFileId).catch(() => {})));
}

const sorted = (db) => [...db.employees].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

function list() {
  return serial(async () => sorted(await load()));
}

function create({ employeeId, comments, filePaths = [] }) {
  return serial(async () => {
    const db = await load();
    const empId = validate(db, employeeId);
    const files = await uploadAll(filePaths);
    const now = new Date().toISOString();
    db.employees.push({
      id: crypto.randomUUID(),
      employeeId: empId,
      comments: String(comments || ''),
      files,
      createdAt: now,
      updatedAt: now,
    });
    try {
      await save(db);
    } catch (err) {
      await deleteAll(files);
      throw err;
    }
    return sorted(db);
  });
}

function update(id, { employeeId, comments, addPaths = [], removeFileIds = [] }) {
  return serial(async () => {
    const db = await load();
    const rec = db.employees.find((e) => e.id === id);
    if (!rec) throw new Error('Record not found (it may have been deleted).');
    const empId = validate(db, employeeId, id);

    const added = await uploadAll(addPaths);
    const removeSet = new Set(removeFileIds);
    const removed = rec.files.filter((f) => removeSet.has(f.driveFileId));

    rec.employeeId = empId;
    rec.comments = String(comments || '');
    rec.files = rec.files.filter((f) => !removeSet.has(f.driveFileId)).concat(added);
    rec.updatedAt = new Date().toISOString();
    try {
      await save(db);
    } catch (err) {
      await deleteAll(added);
      throw err;
    }
    await deleteAll(removed); // only after the JSON no longer references them
    return sorted(db);
  });
}

function remove(id) {
  return serial(async () => {
    const db = await load();
    const rec = db.employees.find((e) => e.id === id);
    if (!rec) throw new Error('Record not found.');
    db.employees = db.employees.filter((e) => e.id !== id);
    await save(db);
    await deleteAll(rec.files);
    return sorted(db);
  });
}

async function folderUrl() {
  const { rootId } = await init();
  return `https://drive.google.com/drive/folders/${rootId}`;
}

module.exports = { list, create, update, remove, reset, folderUrl };
