import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const roots = ['src', 'server.mjs', 'vite.config.js'];
const files = [];

function collect(entry) {
  if (!fs.existsSync(entry)) return;
  const stat = fs.statSync(entry);
  if (stat.isDirectory()) {
    for (const item of fs.readdirSync(entry)) {
      collect(path.join(entry, item));
    }
  } else if (entry.endsWith('.js') || entry.endsWith('.mjs')) {
    files.push(entry);
  }
}

for (const r of roots) collect(r);

let failed = false;
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    failed = true;
    console.error(`Syntax error in ${file}:`);
    console.error(err.stderr?.toString() || err.message);
  }
}

if (failed) {
  process.exit(1);
}
console.log(`Syntax check passed for ${files.length} JavaScript files.`);
