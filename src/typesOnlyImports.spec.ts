import { describe, expect, it } from 'bun:test';
import path from 'node:path';

/**
 * Library code may use `@elastic/*` packages for their types only, so the
 * built bundle never loads the client at runtime (the application brings its
 * own). Tests and test fixtures may import the client at runtime.
 */

const root = path.resolve(import.meta.dir, '..');

const transpiler = new Bun.Transpiler({ loader: 'ts' });

/**
 * List the `@elastic/*` modules a TypeScript source still loads once types
 * are erased: static imports and re-exports that are not type-only (including
 * mixed forms such as `import { type Client, errors }`), side-effect imports,
 * dynamic `import()` and `require()`. Imports inside comments and
 * `import('…')` types are not counted.
 */
function findRuntimeElasticImports(source: string): string[] {
  return transpiler
    .scanImports(source)
    .filter((imported) => imported.path.startsWith('@elastic/'))
    .map((imported) => `${imported.kind} ${imported.path}`);
}

/**
 * Library files: `index.ts` plus every `.ts` file under `src/` that is not a
 * test (`*.spec.ts`, `*.integration.test.ts`) or a test fixture.
 */
async function getLibraryFiles() {
  const files = ['index.ts'];
  const glob = new Bun.Glob('src/**/*.ts');
  for await (const file of glob.scan({ cwd: root })) {
    const normalized = file.split(path.sep).join('/');
    if (
      normalized.endsWith('.spec.ts') ||
      normalized.endsWith('.test.ts') ||
      normalized.startsWith('src/testFixtures/')
    ) {
      continue;
    }
    files.push(normalized);
  }
  return files.sort();
}

describe('findRuntimeElasticImports (self-test)', () => {
  const allowed = {
    'import type': `import type { Client, estypes } from '@elastic/elasticsearch';
let c: Client;`,
    'import type namespace': `import type * as es from '@elastic/elasticsearch';
let c: es.Client;`,
    'only type specifiers': `import { type Client } from '@elastic/elasticsearch';
let c: Client;`,
    'export type': `export type { estypes } from '@elastic/elasticsearch';`,
    'export type star': `export type * from '@elastic/elasticsearch';`,
    'import() type': `type C = import('@elastic/elasticsearch').Client;`,
    'block comment': `/*
import { Client } from '@elastic/elasticsearch';
const client = new Client({ node: 'x' });
*/
const x = 1;`,
    'line comment': `// import { errors } from '@elastic/elasticsearch';
const x = 1;`,
    'other package': `import { Client } from 'some-other-client';
new Client();`,
  };
  for (const [name, source] of Object.entries(allowed)) {
    it(`accepts ${name}`, () => {
      expect(findRuntimeElasticImports(source)).toEqual([]);
    });
  }

  const rejected = {
    'value import': `import { Client } from '@elastic/elasticsearch';
new Client({ node: 'x' });`,
    'value import used only as a type': `import { Client } from '@elastic/elasticsearch';
let c: Client;`,
    'mixed type and value specifiers': `import { type Client, errors } from '@elastic/elasticsearch';
let c: Client;`,
    'mixed specifiers over several lines': `import {
  type Client,
  errors,
} from '@elastic/elasticsearch';`,
    'default import': `import elastic from '@elastic/elasticsearch';`,
    'namespace import': `import * as es from '@elastic/elasticsearch';`,
    'side-effect import': `import '@elastic/elasticsearch';`,
    'value re-export': `export { errors } from '@elastic/elasticsearch';`,
    'star re-export': `export * from '@elastic/elasticsearch';`,
    'dynamic import()': `const es = await import('@elastic/elasticsearch');`,
    'require()': `const es = require('@elastic/elasticsearch');`,
    'another @elastic package': `import { BaseConnection } from '@elastic/transport';`,
  };
  for (const [name, source] of Object.entries(rejected)) {
    it(`rejects ${name}`, () => {
      expect(findRuntimeElasticImports(source).length).toBeGreaterThan(0);
    });
  }
});

describe('library files import @elastic/* as types only', () => {
  it('scans index.ts and the library sources (not tests or fixtures)', async () => {
    const files = await getLibraryFiles();
    expect(files).toContain('index.ts');
    expect(files).toContain('src/IndexManager/IndexManager.ts');
    expect(files).toContain('src/QueryBuilder/QueryBuilder.ts');
    expect(files).not.toContain('src/testFixtures/testClient.ts');
    expect(files).not.toContain('src/IndexManager/IndexManager.spec.ts');
    expect(files.some((file) => file.endsWith('.integration.test.ts'))).toBe(
      false,
    );
  });

  it('finds no runtime @elastic/* import in any library file', async () => {
    const offenders: string[] = [];
    for (const file of await getLibraryFiles()) {
      const source = await Bun.file(path.join(root, file)).text();
      for (const found of findRuntimeElasticImports(source)) {
        offenders.push(`${file}: ${found}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
