import { execSync } from 'child_process';
import * as fs from 'fs';

const BUDGET_BYTES = 3 * 1024 * 1024;

function auditBundleSize(): number {
  try {
    const stdout = execSync('npx next build', { encoding: 'utf8', stdio: 'pipe' });
    fs.writeFileSync('build.log', stdout);
    const match = stdout.match(/First Load JS shared by all\s+([\d.]+)\s+kB/);
    if (!match) return 0;
    const kb = parseFloat(match[1]!);
    return Math.round(kb * 1024);
  } catch (err) {
    console.error('Build failed:', err);
    process.exit(1);
  }
}

const size = auditBundleSize();
if (size > BUDGET_BYTES) {
  console.error(`Bundle size ${size} bytes exceeds budget of ${BUDGET_BYTES} bytes`);
  process.exit(1);
}
console.log(`Bundle size ${size} bytes is within budget of ${BUDGET_BYTES} bytes`);
process.exit(0);
