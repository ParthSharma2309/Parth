import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

function getFilesRecursively(dir: string): string[] {
  let results: string[] = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getFilesRecursively(fullPath));
    } else if (file.endsWith('.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

describe('Zero Auth Bypass Guardrail', () => {
  it('fails if any server/ TypeScript file contains dev/test auth bypasses or unsigned token decoding', () => {
    const serverDir = path.resolve(__dirname, '../../server');
    const tsFiles = getFilesRecursively(serverDir);
    expect(tsFiles.length).toBeGreaterThan(0);

    const forbiddenPatterns = [
      'test-token',
      'test-user-token',
      'dev_user_',
      'Buffer.from(parts[1]',
    ];

    for (const filePath of tsFiles) {
      const content = fs.readFileSync(filePath, 'utf8');
      const relPath = path.relative(serverDir, filePath);
      for (const pattern of forbiddenPatterns) {
        const found = content.includes(pattern);
        expect(
          found,
          `File server/${relPath} contains forbidden auth bypass pattern "${pattern}"`
        ).toBe(false);
      }
    }
  });
});
