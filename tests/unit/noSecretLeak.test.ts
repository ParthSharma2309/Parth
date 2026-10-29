import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

function getFilesRecursively(dir: string, extensions: string[]): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getFilesRecursively(fullPath, extensions));
    } else if (extensions.some((ext) => file.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

describe('Zero Secret Leakage Verification (tests/unit/noSecretLeak.test.ts)', () => {
  const forbiddenSecretPatterns = [
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_SECRET_KEY',
    'FIREBASE_SERVICE_ACCOUNT',
    'FIREBASE_PRIVATE_KEY',
  ];

  it('verifies that frontend source files (src/) never reference server-only secrets', () => {
    const srcDir = path.resolve(__dirname, '../../src');
    const srcFiles = getFilesRecursively(srcDir, ['.ts', '.tsx', '.js', '.jsx', '.html', '.css']);
    expect(srcFiles.length).toBeGreaterThan(0);

    for (const filePath of srcFiles) {
      const content = fs.readFileSync(filePath, 'utf8');
      const relPath = path.relative(srcDir, filePath);
      for (const secret of forbiddenSecretPatterns) {
        expect(
          content.includes(secret),
          `Security violation: Frontend source file src/${relPath} references server-only secret "${secret}"`
        ).toBe(false);
      }
    }
  });

  it('verifies that frontend client code only uses VITE_ prefixed environment variables', () => {
    const srcDir = path.resolve(__dirname, '../../src');
    const srcFiles = getFilesRecursively(srcDir, ['.ts', '.tsx']);

    // Check all import.meta.env usages in src/
    const envUsageRegex = /import\.meta\.env\.([A-Z0-9_]+)/g;

    for (const filePath of srcFiles) {
      const content = fs.readFileSync(filePath, 'utf8');
      let match: RegExpExecArray | null;
      while ((match = envUsageRegex.exec(content)) !== null) {
        const varName = match[1];
        // Allow Vite standard built-in variables (MODE, DEV, PROD, SSR, BASE_URL)
        const isStandardVite = ['MODE', 'DEV', 'PROD', 'SSR', 'BASE_URL'].includes(varName);
        const startsWithVite = varName.startsWith('VITE_');
        expect(
          startsWithVite || isStandardVite,
          `Security violation: ${path.relative(srcDir, filePath)} accesses non-VITE client env var "${varName}"`
        ).toBe(true);
      }
    }
  });

  it('verifies that production build output in dist/ does not contain server secret keys', () => {
    const distPath = path.resolve(__dirname, '../../dist');
    if (!fs.existsSync(distPath)) {
      // Build directory not present in this run; skip or check if dist exists
      return;
    }
    const distFiles = getFilesRecursively(distPath, ['.js', '.html']);
    for (const filePath of distFiles) {
      const content = fs.readFileSync(filePath, 'utf8');
      const relPath = path.relative(distPath, filePath);
      for (const secret of forbiddenSecretPatterns) {
        expect(
          content.includes(secret),
          `Security violation: Compiled client bundle dist/${relPath} leaked server secret "${secret}"`
        ).toBe(false);
      }
    }
  });
});
