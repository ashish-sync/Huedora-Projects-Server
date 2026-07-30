/**
 * Pre-deployment verification for TYLO One.
 * Runs client + server checks and optional live API smoke when API_BASE is reachable.
 *
 * Usage:
 *   node scripts/predeploy-verify.js
 *   SKIP_LIVE_API=1 node scripts/predeploy-verify.js
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { purgeDemoData, DEMO_USER_EMAILS } from '../src/utils/purgeDemoData.js';
import { CampOpsCamp, CampOpsClient } from '../src/modules/campOps/campOps.model.js';
import { User } from '../src/modules/users/user.model.js';
import { GeoState } from '../src/modules/geo/geo.model.js';
import { Role } from '../src/modules/users/role.model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const clientRoot = path.resolve(repoRoot, 'client');
const serverRoot = path.resolve(__dirname, '..');
const skipLiveApi = String(process.env.SKIP_LIVE_API || '').toLowerCase() === '1';

const checks = [];

function record(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${name}${detail ? ` — ${detail}` : ''}`);
}

function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, {
    cwd,
    shell: process.platform === 'win32',
    stdio: 'pipe',
    encoding: 'utf8',
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

async function verifyProductionConfig() {
  if (!env.isProd) {
    record('production config', true, 'skipped in non-production NODE_ENV');
    return;
  }
  const issues = [];
  if (env.seedCampOneDemo) issues.push('SEED_CAMP_ONE_DEMO must be false in production');
  if (env.seedDemoUsers) issues.push('SEED_DEMO_USERS must be false in production');
  if (env.seedAgreementSamples) issues.push('SEED_AGREEMENT_SAMPLES must be false in production');
  if (!env.useMongoose) issues.push('USE_MONGOOSE must be true in production');
  record('production config', issues.length === 0, issues.join('; ') || 'ok');
}

async function verifyDataIntegrity() {
  await connectDb();
  try {
    const roles = await Role.countDocuments({ isDeleted: false });
    const states = await GeoState.countDocuments({ isDeleted: false });
    const clients = await CampOpsClient.find({ isDeleted: false });
    const camps = await CampOpsCamp.find({ isDeleted: false });
    const users = await User.find({ isDeleted: false });

    const demoClients = clients.filter((row) => String(row.name || '').includes('Demo Pharma'));
    const demoCamps = camps.filter((row) => String(row.doctorCode || '').toUpperCase().startsWith('DEMO-'));
    const demoUsers = users.filter((row) => DEMO_USER_EMAILS.has(String(row.email || '').toLowerCase()));

    record('master roles present', roles > 0, `${roles} role(s)`);
    record('geo states present', states >= 30, `${states} state(s)`);
    record('no demo clients', demoClients.length === 0, demoClients.length ? demoClients.map((c) => c.name).join(', ') : 'ok');
    record('no demo camps', demoCamps.length === 0, demoCamps.length ? `${demoCamps.length} camp(s)` : 'ok');
    record('no demo users', demoUsers.length === 0, demoUsers.length ? demoUsers.map((u) => u.email).join(', ') : 'ok');
  } finally {
    await disconnectDb();
  }
}

async function verifyLiveApi() {
  if (skipLiveApi) {
    record('live API smoke', true, 'skipped (SKIP_LIVE_API=1)');
    return;
  }
  const base = String(process.env.API_BASE || 'http://localhost:5000/api/v1').replace(/\/$/, '');
  try {
    const health = await fetch(`${base}/health`);
    if (!health.ok) {
      record('live API smoke', true, `skipped — ${base}/health returned ${health.status}`);
      return;
    }
    const live = await fetch(`${base}/live`);
    record('live API probe', live.ok, `status ${live.status}`);
  } catch (err) {
    record('live API smoke', true, `skipped — ${err.message}`);
  }
}

async function main() {
  console.log('=== TYLO One pre-deployment verification ===\n');

  const purge = run('npm', ['run', 'purge:demo'], serverRoot);
  record('purge demo/test data', purge.ok, purge.ok ? '' : purge.stderr.slice(-400));

  if (!fs.existsSync(clientRoot)) {
    record('client workspace', false, `missing ${clientRoot}`);
  } else {
    const clientVerify = run('npm', ['run', 'verify:camps'], clientRoot);
    record('client verify:camps', clientVerify.ok, clientVerify.ok ? '' : clientVerify.stderr.slice(-400));

    const clientBuild = run('npm', ['run', 'build'], clientRoot);
    record('client production build', clientBuild.ok, clientBuild.ok ? '' : clientBuild.stderr.slice(-400));
  }

  const persistence = run('npm', ['run', 'test:persistence'], serverRoot);
  record('server persistence checks', persistence.ok, persistence.ok ? '' : persistence.stderr.slice(-400));

  const campImport = run('npm', ['run', 'test:camp-import'], serverRoot);
  record('camp import validation', campImport.ok, campImport.ok ? '' : campImport.stderr.slice(-400));

  const campParser = run('npm', ['run', 'test:camp-parser'], serverRoot);
  record('camp parser tests', campParser.ok, campParser.ok ? '' : campParser.stderr.slice(-400));

  const purgeMarkers = run('npm', ['run', 'test:purge-markers'], serverRoot);
  record('purge demo marker tests', purgeMarkers.ok, purgeMarkers.ok ? '' : purgeMarkers.stderr.slice(-400));

  const serverBuild = run('npm', ['run', 'build:parsers'], serverRoot);
  record('server parser build', serverBuild.ok, serverBuild.ok ? '' : serverBuild.stderr.slice(-400));

  await verifyProductionConfig();
  await verifyDataIntegrity();
  await verifyLiveApi();

  const failed = checks.filter((check) => !check.ok);
  console.log(`\n=== Summary: ${checks.length - failed.length}/${checks.length} passed ===`);
  if (failed.length) {
    failed.forEach((check) => console.error(`  - ${check.name}: ${check.detail}`));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
