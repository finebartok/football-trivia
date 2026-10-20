import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const MANIFEST = 'manifest.json';

export function readManifest(dir) {
  try {
    const raw = fs.readFileSync(path.join(dir, MANIFEST), 'utf8');
    const parsed = JSON.parse(raw);
    return { sources: parsed.sources ?? {} };
  } catch {
    return { sources: {} };
  }
}

export function writeManifest(dir, manifest) {
  fs.writeFileSync(path.join(dir, MANIFEST), JSON.stringify(manifest, null, 2));
}

export async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

export async function fileBytes(filePath) {
  return (await fsp.stat(filePath)).size;
}
