import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { parse } from 'csv-parse';

export async function* readCsvGz(filePath) {
  const parser = createReadStream(filePath)
    .pipe(createGunzip())
    .pipe(parse({ columns: true, bom: true, relax_column_count: true }));
  for await (const row of parser) yield row;
}
