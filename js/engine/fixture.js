import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, '../../data/fixtures/pool.sample.json');

let cached = null;

export function loadFixture() {
  if (!cached) {
    cached = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  }
  return cached;
}
