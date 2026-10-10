import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const out = mkdtempSync(join(tmpdir(), 'sqa-prod-'));
const outE2e = mkdtempSync(join(tmpdir(), 'sqa-e2e-build-'));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

afterAll(() => {
  rmSync(out, { recursive: true, force: true });
  rmSync(outE2e, { recursive: true, force: true });
});

describe('production build', () => {
  it('contains no E2E hooks and keeps debugger/host access optional', () => {
    execFileSync('node', ['scripts/build.mjs', `--out=${out}`], { cwd: root, stdio: 'pipe' });
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).not.toContain('debugger');
    expect(manifest.optional_permissions).toContain('debugger');
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.optional_host_permissions?.length).toBeGreaterThan(0);
    expect(manifest.content_security_policy.extension_pages).toBe(
      "script-src 'self'; object-src 'self'",
    );
    const js = walk(out).filter((p) => p.endsWith('.js') && !p.endsWith('axe.js'));
    expect(js.length).toBeGreaterThan(3);
    for (const file of js) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toContain('__sqaE2E');
      expect(text, file).not.toContain('SQA_E2E_HOOK');
    }
    // no eval and no remote script URLs in our own code
    for (const file of js) {
      const text = readFileSync(file, 'utf8');
      expect(/\beval\s*\(/.test(text), file).toBe(false);
      expect(/<script[^>]+src=["']https?:/.test(text), file).toBe(false);
    }
  }, 120_000);

  it('the E2E build does contain the hook (so the previous test is meaningful)', () => {
    execFileSync('node', ['scripts/build.mjs', '--e2e', `--out=${outE2e}`], {
      cwd: root,
      stdio: 'pipe',
    });
    const report = readFileSync(join(outE2e, 'report.js'), 'utf8');
    expect(report).toContain('__sqaE2E');
    const manifest = JSON.parse(readFileSync(join(outE2e, 'manifest.json'), 'utf8'));
    expect(manifest.permissions).toContain('debugger');
    expect(existsSync(join(outE2e, 'inject', 'page.js'))).toBe(true);
  }, 120_000);
});
