// Minimal Google Drive v3 REST client.
const fs = require('fs/promises');
const path = require('path');
const auth = require('./auth');

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const FILE_FIELDS = 'id,name,mimeType,size,webViewLink';

async function request(method, url, { json, body, headers = {}, raw = false } = {}) {
  const token = await auth.getAccessToken();
  const h = { Authorization: `Bearer ${token}`, ...headers };
  if (json !== undefined) h['Content-Type'] = 'application/json; charset=UTF-8';

  const res = await fetch(url, {
    method,
    headers: h,
    body: json !== undefined ? JSON.stringify(json) : body,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const d = await res.json();
      msg = (d.error && d.error.message) || msg;
    } catch {
      /* non-JSON error body */
    }
    const err = new Error(`Google Drive: ${msg} (${res.status})`);
    err.status = res.status;
    throw err;
  }
  if (raw) return res;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const q = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

async function findOne(name, parentId, mimeType) {
  let query = `name='${q(name)}' and trashed=false`;
  if (mimeType) query += ` and mimeType='${mimeType}'`;
  if (parentId) query += ` and '${parentId}' in parents`;
  const params = new URLSearchParams({ q: query, fields: `files(${FILE_FIELDS})`, pageSize: '1', spaces: 'drive' });
  const data = await request('GET', `${API}/files?${params}`);
  return data.files[0] || null;
}

async function findOrCreateFolder(name, parentId) {
  const existing = await findOne(name, parentId, FOLDER_MIME);
  if (existing) return existing;
  const meta = { name, mimeType: FOLDER_MIME };
  if (parentId) meta.parents = [parentId];
  return request('POST', `${API}/files?fields=${FILE_FIELDS}`, { json: meta });
}

async function createJsonFile(name, parentId, data) {
  const file = await request('POST', `${API}/files?fields=${FILE_FIELDS}`, {
    json: { name, parents: [parentId], mimeType: 'application/json' },
  });
  await writeJson(file.id, data);
  return file;
}

async function readJson(fileId) {
  const res = await request('GET', `${API}/files/${fileId}?alt=media`, { raw: true });
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function writeJson(fileId, data) {
  return request('PATCH', `${UPLOAD}/files/${fileId}?uploadType=media&fields=id`, {
    body: JSON.stringify(data, null, 2),
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
  });
}

// Resumable upload works for any file size.
async function uploadFile(localPath, parentId) {
  const stat = await fs.stat(localPath);
  if (!stat.isFile()) throw new Error(`Not a file: ${localPath}`);
  const name = path.basename(localPath);

  const init = await request('POST', `${UPLOAD}/files?uploadType=resumable&fields=${FILE_FIELDS}`, {
    json: { name, parents: [parentId] },
    headers: { 'X-Upload-Content-Length': String(stat.size) },
    raw: true,
  });
  const location = init.headers.get('location');
  if (!location) throw new Error('Upload session could not be started.');

  const token = await auth.getAccessToken();
  const res = await fetch(location, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: await fs.readFile(localPath),
  });
  if (!res.ok) throw new Error(`Upload failed for "${name}" (${res.status})`);
  const f = await res.json();
  return {
    driveFileId: f.id,
    name: f.name,
    mimeType: f.mimeType,
    size: Number(f.size || stat.size),
    webViewLink: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
  };
}

async function deleteFile(fileId) {
  try {
    await request('DELETE', `${API}/files/${fileId}`);
  } catch (err) {
    if (err.status !== 404) throw err; // already gone is fine
  }
}

module.exports = { findOne, findOrCreateFolder, createJsonFile, readJson, writeJson, uploadFile, deleteFile };
