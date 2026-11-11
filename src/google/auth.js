// Google OAuth 2.0 for installed (desktop) apps: loopback redirect + PKCE.
const http = require('http');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { app, shell } = require('electron');
const config = require('../config/google');

// drive.file = the app can only see/modify files it created itself.
// openid/email/profile = to show which account is connected.
const SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.file'];
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const tokenPath = () => path.join(app.getPath('userData'), 'token.json');

let tokens = null; // { access_token, refresh_token, expiry, user }
let pending = null; // in-progress browser sign-in: { url, cancel }

async function readJson(p) {
  try {
    return JSON.parse(await fs.readFile(p, 'utf8'));
  } catch {
    return null;
  }
}

// The app's own OAuth client, built into the code (src/config/google.js).
async function loadCredentials() {
  const id = String(config.CLIENT_ID || '');
  if (!id.endsWith('.apps.googleusercontent.com') || id.startsWith('PASTE_')) return null;
  return { clientId: id, clientSecret: config.CLIENT_SECRET || '' };
}

async function loadTokens() {
  if (!tokens) tokens = await readJson(tokenPath());
  return tokens;
}

async function saveTokens(t) {
  tokens = t;
  await fs.writeFile(tokenPath(), JSON.stringify(t, null, 2));
}

// id_token comes straight from Google's token endpoint over TLS, so decoding is enough.
function userFromIdToken(idToken) {
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8'));
    return payload.email ? { email: payload.email, name: payload.name || '', picture: payload.picture || '' } : null;
  } catch {
    return null;
  }
}

async function fetchUser(accessToken) {
  try {
    const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress,photoLink)', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const { user } = await res.json();
    return { email: user.emailAddress, name: user.displayName || '', picture: user.photoLink || '' };
  } catch {
    return null;
  }
}

async function status() {
  const creds = await loadCredentials();
  const t = await loadTokens();
  const signedIn = !!(creds && t && t.refresh_token);
  if (signedIn && !t.user) {
    // Older sign-in without stored account info: look it up once.
    try {
      const user = await fetchUser(await getAccessToken());
      if (user) await saveTokens({ ...tokens, user });
    } catch {
      /* offline or expired – account shown as unknown */
    }
  }
  return {
    hasCredentials: !!creds,
    signedIn: !!(creds && tokens && tokens.refresh_token),
    user: (tokens && tokens.user) || null,
  };
}

async function tokenRequest(params) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error_description || data.error || `Token request failed (${res.status})`);
    err.code = data.error;
    throw err;
  }
  return data;
}

const b64url = (buf) => buf.toString('base64url');

function resultPage(ok, message) {
  const color = ok ? '#16a34a' : '#dc2626';
  return `<!doctype html><html><head><meta charset="utf-8"><title>DriveAccessApp</title></head>
<body style="margin:0;font-family:Segoe UI,system-ui,sans-serif;background:#f4f6f9;display:flex;align-items:center;justify-content:center;height:100vh">
<div style="background:#fff;border:1px solid #dde1e7;border-radius:12px;padding:36px 48px;text-align:center;max-width:420px">
<div style="font-size:44px;color:${color}">${ok ? '&#10004;' : '&#10006;'}</div>
<h2 style="margin:8px 0">${ok ? 'Google Drive connected' : 'Sign-in failed'}</h2>
<p style="color:#6b7280">${message}</p></div></body></html>`;
}

// Starts a one-time local server, opens Google sign-in in the system browser
// (Chrome, Edge, Firefox… whichever is default) and waits for the redirect.
function waitForAuthCode(creds, challenge, state) {
  return new Promise((resolve, reject) => {
    let redirectUri = null;
    let timer = null;
    let finished = false;

    const finish = (fn, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      server.close();
      pending = null;
      fn(value);
    };

    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname !== '/callback') {
        res.writeHead(404);
        res.end();
        return;
      }
      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      const ok = !error && code && url.searchParams.get('state') === state;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        resultPage(
          ok,
          ok
            ? 'You can close this tab and return to DriveAccessApp.'
            : error === 'access_denied'
              ? 'Access was not granted. Return to DriveAccessApp and try again.'
              : 'Something went wrong. Return to DriveAccessApp and try again.'
        )
      );
      if (ok) finish(resolve, { code, redirectUri });
      else
        finish(
          reject,
          new Error(error === 'access_denied' ? 'Sign-in was cancelled in the browser.' : `Google sign-in failed: ${error || 'invalid response'}`)
        );
    });

    server.on('error', (err) => finish(reject, err));
    timer = setTimeout(() => finish(reject, new Error('Sign-in timed out. Please try again.')), 5 * 60 * 1000);

    server.listen(0, '127.0.0.1', () => {
      redirectUri = `http://127.0.0.1:${server.address().port}/callback`;
      const params = new URLSearchParams({
        client_id: creds.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPES.join(' '),
        access_type: 'offline',
        prompt: 'select_account consent',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
      });
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
      pending = {
        url: authUrl,
        cancel: () => finish(reject, new Error('Sign-in cancelled.')),
      };
      shell.openExternal(authUrl).catch(() => {
        /* no default browser – user can copy the link instead */
      });
    });
  });
}

async function signIn() {
  const creds = await loadCredentials();
  if (!creds) {
    throw new Error('This app is not set up for Google sign-in yet. Please contact your administrator.');
  }
  if (pending) pending.cancel(); // only one sign-in at a time

  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));

  const { code, redirectUri } = await waitForAuthCode(creds, challenge, state);
  const data = await tokenRequest({
    code,
    client_id: creds.clientId,
    client_secret: creds.clientSecret || '',
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: verifier,
  });
  if (!data.refresh_token) throw new Error('Google did not return a refresh token. Please try again.');
  const user = userFromIdToken(data.id_token) || (await fetchUser(data.access_token));
  await saveTokens({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expiry: Date.now() + data.expires_in * 1000,
    user,
  });
  return user;
}

function cancelSignIn() {
  if (pending) pending.cancel();
}

// URL of the in-progress sign-in (to reopen or copy), or null.
function pendingSignInUrl() {
  return pending ? pending.url : null;
}

async function signOut() {
  const t = await loadTokens();
  if (t && (t.refresh_token || t.access_token)) {
    // Best effort revoke; ignore network errors.
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t.refresh_token || t.access_token)}`, {
      method: 'POST',
    }).catch(() => {});
  }
  tokens = null;
  await fs.rm(tokenPath(), { force: true });
}

async function getAccessToken() {
  const t = await loadTokens();
  if (!t || !t.refresh_token) throw new Error('Not signed in to Google Drive.');
  if (t.access_token && t.expiry - 60_000 > Date.now()) return t.access_token;

  const creds = await loadCredentials();
  if (!creds) throw new Error('This app is not set up for Google sign-in yet. Please contact your administrator.');
  try {
    const data = await tokenRequest({
      client_id: creds.clientId,
      client_secret: creds.clientSecret || '',
      refresh_token: t.refresh_token,
      grant_type: 'refresh_token',
    });
    await saveTokens({
      ...t,
      access_token: data.access_token,
      expiry: Date.now() + data.expires_in * 1000,
    });
    return data.access_token;
  } catch (err) {
    if (err.code === 'invalid_grant') {
      tokens = null;
      await fs.rm(tokenPath(), { force: true });
      throw new Error('Google session expired. Please connect again.');
    }
    throw err;
  }
}

module.exports = { status, signIn, cancelSignIn, pendingSignInUrl, signOut, getAccessToken };
