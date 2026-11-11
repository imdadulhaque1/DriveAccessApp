// Google OAuth client of this app (type: "Desktop app").
// Set it ONCE here; end users never see or load any file. They only click "Sign in with Google".
//
// Where to get these: Google Cloud Console → APIs & Services → Credentials →
//   Create credentials → OAuth client ID → Application type "Desktop app".
// For Desktop apps, Google does not treat the client secret as confidential (it ships inside the app).
//
// Values can also come from environment variables GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.
module.exports = {
  CLIENT_ID: process.env.GOOGLE_CLIENT_ID || 'PASTE_YOUR_CLIENT_ID.apps.googleusercontent.com',
  CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || 'PASTE_YOUR_CLIENT_SECRET',
};
