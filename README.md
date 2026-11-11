# DriveAccessApp – Employee Records (Electron + Google Drive)

Desktop app to **Insert / Update / Delete** employee records (Employee ID, Comments, file attachments).
All data is saved as JSON in your Google Drive:

```
My Drive/
└── DriveAccessApp/
    ├── employees.json        ← all records
    └── uploads/              ← attached files
```

`employees.json` format:

```json
{
  "version": 1,
  "updatedAt": "2026-11-11T10:00:00.000Z",
  "employees": [
    {
      "id": "6f1c…",
      "employeeId": "EMP-1001",
      "comments": "Joined in March",
      "files": [
        { "driveFileId": "1AbC…", "name": "cv.pdf", "mimeType": "application/pdf",
          "size": 20480, "webViewLink": "https://drive.google.com/file/d/1AbC…/view" }
      ],
      "createdAt": "…",
      "updatedAt": "…"
    }
  ]
}
```

## 1. Google Cloud setup (one time)

1. Go to <https://console.cloud.google.com/> and create (or select) a project.
2. **APIs & Services → Library** → search **Google Drive API** → **Enable**.
3. **APIs & Services → OAuth consent screen** (Google Auth Platform):
   - User type: **External** → fill app name and support email → Save.
   - **Audience / Test users** → add the Gmail account(s) that will use the app.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Desktop app** → Create.
   - Copy the **Client ID** and **Client secret** shown and paste them into
     **`src/config/google.js`**. No JSON file is needed:
     ```js
     CLIENT_ID: '1234-abc.apps.googleusercontent.com',
     CLIENT_SECRET: 'GOCSPX-…',
     ```
     This is done once by the developer. End users only click **Sign in with Google**.
     For a Desktop-app client, Google does not treat the secret as confidential, so it can ship inside the app.

The app uses the `drive.file` scope, so it can only see files that it created itself. It cannot read anything else in your Drive.

## 2. Run

```bash
npm install
npm start
```

> If you start it from the VS Code integrated terminal and see
> `Cannot read properties of undefined (reading 'handle')`, then VS Code has set
> `ELECTRON_RUN_AS_NODE`. Run it from a normal terminal instead, or clear the variable first:
> PowerShell: `Remove-Item Env:ELECTRON_RUN_AS_NODE; npm start`

## 3. Use

1. If Drive is not connected, the app first shows a **"Google Drive is not connected"** warning with a
   **Sign in with Google** button.
2. Click it. Google sign-in opens in your **default browser** (Chrome, Edge, Firefox…). Choose an account and click **Allow**.
   The app waits on a "Waiting for Google sign-in…" screen, which has three buttons:
   - **Open browser again**
   - **Copy sign-in link**: paste the link into any browser if none opened.
   - **Cancel**
   When sign-in finishes, the browser tab says "Google Drive connected". The app switches to the records screen and shows the connected email at the top right.
   While the app is in "Testing" mode, Google may show an "unverified app" warning. Click *Continue*.
   If the Client ID is not set in `src/config/google.js`, the app shows a "Developer setup needed" note.
3. **Insert**: enter an Employee ID (required, must be unique) and comments, click **+ Add files**, then click **Insert**.
4. **Update**: click **Edit** on a row. Change the fields, add new files or click ✕ to remove existing files, then click **Update**.
5. **Delete**: click **Delete** on a row. The record and its attached files are removed from Drive.
6. Click a file name to open it in Google Drive. **Open in Drive** opens the app's data folder.

Tokens are stored locally in `%APPDATA%\driveaccessapp\token.json`. **Sign out** revokes and deletes them.

## Project structure

```
src/
├── main.js              Electron main process + IPC handlers
├── preload.js           Safe bridge (window.api) for the renderer
├── store.js             CRUD logic on employees.json
├── google/
│   ├── auth.js          OAuth 2.0 (loopback + PKCE), token refresh
│   └── drive.js         Google Drive v3 REST calls (fetch, no extra deps)
└── renderer/
    ├── index.html
    ├── renderer.js      UI logic
    └── styles.css
```
