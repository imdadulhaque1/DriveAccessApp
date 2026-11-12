// Google OAuth client of this app (type: "Desktop app").
// Real values live in src/config/google.local.js (gitignored, never pushed).
// Copy src/config/google.local.example.js to google.local.js and fill it in.
// Values can also come from env vars GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.
let local = {};
try {
  local = require('./google.local');
} catch {
  /* no local credentials file */
}

module.exports = {
  CLIENT_ID: process.env.GOOGLE_CLIENT_ID || local.CLIENT_ID || 'PASTE_YOUR_CLIENT_ID.apps.googleusercontent.com',
  CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || local.CLIENT_SECRET || 'PASTE_YOUR_CLIENT_SECRET',
};
