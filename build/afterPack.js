// electron-builder afterPack hook: drop Chromium files this app never uses,
// to make the installer smaller.
const fs = require('fs');
const path = require('path');

// WebGPU shader compiler (~26 MB). The app does not use WebGPU.
const REMOVE = ['dxcompiler.dll', 'dxil.dll'];

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  let saved = 0;
  for (const name of REMOVE) {
    const file = path.join(context.appOutDir, name);
    if (fs.existsSync(file)) {
      saved += fs.statSync(file).size;
      fs.rmSync(file);
    }
  }
  console.log(`  • afterPack: removed unused files, saved ${(saved / 1024 / 1024).toFixed(1)} MB`);
};
