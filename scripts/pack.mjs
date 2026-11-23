import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { zipSync } from 'fflate';

const exclude = new Set([
  'node_modules',
  'dist',
  '.git',
  '.openai',
  'tsconfig.tsbuildinfo',
  '.env.local',
  'si-ledger-production.zip'
]);

function getFiles(dir, base = dir) {
  const result = {};
  for (const item of readdirSync(dir)) {
    if (exclude.has(item) || item.startsWith('.' && item !== '.gitignore' && item !== '.env.example')) continue;
    const fullPath = join(dir, item);
    const relPath = relative(base, fullPath).replace(/\\/g, '/');
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      Object.assign(result, getFiles(fullPath, base));
    } else if (stat.isFile()) {
      result[relPath] = new Uint8Array(readFileSync(fullPath));
    }
  }
  return result;
}

const files = getFiles('.');
console.log(`Archiving ${Object.keys(files).length} files into si-ledger-production.zip...`);
const zipped = zipSync(files, { level: 6 });
writeFileSync('si-ledger-production.zip', zipped);
console.log(`Created si-ledger-production.zip (${(zipped.length / 1024).toFixed(1)} KB).`);
