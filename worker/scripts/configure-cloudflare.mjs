import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1]?.trim() : undefined;
}

const domain = argument('domain')?.toLowerCase();
const productionDatabaseId = argument('prod-db-id')?.toLowerCase();
const stagingDatabaseId = argument('staging-db-id')?.toLowerCase();
const outputPath = argument('output');
const domainPattern = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

if (!domain || !domainPattern.test(domain)) {
  throw new Error('Use --domain with a valid dedicated tempmail domain');
}
if (!productionDatabaseId || !uuidPattern.test(productionDatabaseId)) {
  throw new Error('Use --prod-db-id with the UUID returned by wrangler d1 create');
}
if (!stagingDatabaseId || !uuidPattern.test(stagingDatabaseId)) {
  throw new Error('Use --staging-db-id with the UUID returned by wrangler d1 create');
}

const templateUrl = new URL('../wrangler.toml.example', import.meta.url);
const outputUrl = outputPath
  ? pathToFileURL(resolve(outputPath))
  : new URL('../wrangler.toml', import.meta.url);
const template = await readFile(templateUrl, 'utf8');
const output = template
  .replaceAll('__TEMPMAIL_DOMAIN__', domain)
  .replaceAll('__PROD_DB_ID__', productionDatabaseId)
  .replaceAll('__STAGING_DB_ID__', stagingDatabaseId);
await writeFile(outputUrl, output, 'utf8');
console.log(`${outputUrl.pathname} configured for staging and production`);
