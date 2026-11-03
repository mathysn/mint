// Imports the case catalog from ByMykel/CSGO-API into Postgres (same code as the admin panel's
// Catalog > Import).
//   pnpm catalog:import --dry-run          download, validate, print the report, write nothing
//   pnpm catalog:import                    same, then write it to DATABASE_URL_UNPOOLED
//   pnpm catalog:import --commit <sha>     pin a specific commit of the API repository
// Idempotent. New cases arrive turned off: turn them on in the admin panel (Catalog).
import 'dotenv/config';

process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
const { db, closeDb } = await import('../server/db/client.js');
const schema = await import('../server/db/schema.js');
const { TIERS } = await import('../server/game/economy.js');
const { applyCatalog, buildCatalog, diffReport, resolveCommit } = await import('../server/services/catalogImport.js');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const commitArg = args.includes('--commit') ? args[args.indexOf('--commit') + 1] : undefined;

const commit = await resolveCommit(commitArg);
console.log(`Source: ByMykel/CSGO-API@${commit.slice(0, 7)} (en)`);
const build = await buildCatalog(commit);

console.log(`\nCases: ${build.crateRows.length} (of ${build.rawCrateCount} crates) · skins in the catalog: ${build.skinRows.length}`);
console.log('\nCase                              Mil  Res  Cla  Cov  ★    (vanilla ★)');
for (const c of build.perCrate) {
  const cols = TIERS.map((t) => String(c.tiers[t]).padStart(3)).join('  ');
  console.log(`${c.name.padEnd(32)}  ${cols}    ${c.vanilla || ''}`);
}
console.log(`Problems: ${build.problems.length}`);
for (const p of build.problems.slice(0, 30)) console.log(`  - ${p}`);
if (build.problems.length) {
  console.error('\nAborting: fix the problems above before importing.');
  await closeDb();
  process.exit(1);
}

const report = await diffReport(db(), build);
console.log(`\nAgainst the database (now on ${report.from?.slice(0, 7) ?? 'nothing'}):`);
console.log(`  +${report.casesAdded} cases (they start off), +${report.skinsAdded} skins (${report.skinsAddedInNewCases} in new cases), ${report.skinsRemoved} skins removed, ${report.casesRemoved} cases gone`);
console.log(`  Broken images: ${report.brokenImages.join(', ') || 'none'} · fixed: ${report.fixedImages.join(', ') || 'none'}`);

if (dryRun) {
  console.log('\nDry run: nothing written.');
  await closeDb();
  process.exit(0);
}

await db().transaction(async (tx) => {
  await applyCatalog(tx, build, report, 'script');
  await tx.insert(schema.catalogImports).values({
    sourceCommit: commit,
    counts: { cases: build.crateRows.length, skins: build.skinRows.length },
    status: 'done',
    staffName: 'script',
    report,
    finishedAt: new Date(),
  });
});
await closeDb();
console.log(`\nImported ${commit.slice(0, 7)}.`);
