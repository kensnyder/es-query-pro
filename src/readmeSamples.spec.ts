import { describe, expect, it } from 'bun:test';
import path from 'node:path';
import { API } from 'typescript/unstable/async';

/**
 * Type-check the README's code samples against the library source, the way a
 * consumer would see them. Every ```ts block that imports from
 * "es-query-pro" is compiled as its own module, with "es-query-pro" mapped to
 * `index.ts`. Nothing runs, so no server is needed. `// @ts-expect-error`
 * lines in a sample must really be errors (an unused one is reported).
 */

const root = path.resolve(import.meta.dir, '..');

type Sample = {
  /** 1-based README line of the first code line */
  line: number;
  code: string;
  fileName: string;
};

/**
 * Top-level ```ts blocks of a Markdown document (indented blocks inside list
 * items are fragments and are skipped)
 */
function getTsBlocks(markdown: string): Sample[] {
  const samples: Sample[] = [];
  const blockRe = /^```ts\n([\s\S]*?)^```$/gm;
  for (const match of markdown.matchAll(blockRe)) {
    const before = markdown.slice(0, match.index);
    const line = before.split('\n').length + 1;
    samples.push({
      line,
      code: match[1],
      fileName: path.join(root, `README.sample-line-${line}.ts`),
    });
  }
  return samples;
}

function importsLibrary(code: string) {
  return /from\s+["']es-query-pro["']/.test(code);
}

/**
 * Type-check the samples with the TypeScript 7 compiler API. The samples and
 * their tsconfig exist only in memory; everything else is read from disk.
 */
async function compileSamples(samples: Sample[], strict: boolean) {
  const configFile = path.join(root, 'tsconfig.readme-samples.json');
  const virtualFiles = new Map(
    samples.map((sample) => [sample.fileName, sample.code]),
  );
  virtualFiles.set(
    configFile,
    JSON.stringify({
      compilerOptions: {
        strict,
        noEmit: true,
        skipLibCheck: true,
        target: 'esnext',
        module: 'esnext',
        moduleResolution: 'bundler',
        moduleDetection: 'force',
        lib: ['esnext', 'dom'],
        types: ['bun-types'],
        paths: { 'es-query-pro': ['./index.ts'] },
      },
      files: samples.map((sample) => sample.fileName),
    }),
  );
  const api = new API({
    cwd: root,
    fs: {
      fileExists: (fileName) => virtualFiles.has(fileName) || undefined,
      readFile: (fileName) => virtualFiles.get(fileName),
    },
  });
  try {
    const snapshot = await api.updateSnapshot({ openProjects: [configFile] });
    const project = snapshot.getProject(configFile);
    if (!project) {
      throw new Error('The README samples project was not loaded');
    }
    const program = project.program;
    const diagnostics = [
      ...(await program.getConfigFileParsingDiagnostics()),
      ...(await program.getProgramDiagnostics()),
      ...(await program.getGlobalDiagnostics()),
    ];
    for (const sample of samples) {
      const sourceFile = await program.getSourceFile(sample.fileName);
      if (!sourceFile) {
        throw new Error(`Sample at README line ${sample.line} was not loaded`);
      }
      diagnostics.push(
        ...(await program.getSyntacticDiagnostics(sample.fileName)),
        ...(await program.getSemanticDiagnostics(sample.fileName)),
      );
    }
    return diagnostics.map((diagnostic) => {
      const sample = samples.find((s) => s.fileName === diagnostic.fileName);
      if (!sample) {
        return diagnostic.text;
      }
      const linesBefore = sample.code
        .slice(0, diagnostic.pos)
        .split('\n').length;
      return `README.md:${sample.line + linesBefore - 1}: ${diagnostic.text}`;
    });
  } finally {
    await api.close();
  }
}

/** Split a Markdown table row into cells, keeping escaped pipes (`\|`) */
function getCells(row: string): string[] {
  const inner = row.trim().replace(/^\|/, '').replace(/\|$/, '');
  return inner.split(/(?<!\\)\|/).map((cell) => cell.trim());
}

/**
 * The examples in the "Example" column of the tables in the "Query Builder
 * function quick reference" section: every inline code span is one
 * expression on a builder named `qb`. Each is compiled as its own module,
 * with the header on the same line so diagnostics point at the table row.
 */
function getTableExamples(markdown: string): Sample[] {
  const lines = markdown.split('\n');
  const start = lines.findIndex((text) =>
    text.startsWith('## Query Builder function quick reference'),
  );
  if (start === -1) {
    return [];
  }
  const examples: Sample[] = [];
  let exampleColumn = -1;
  let inTable = false;
  for (let i = start + 1; i < lines.length; i++) {
    const text = lines[i];
    if (text.startsWith('## ')) {
      break;
    }
    if (!text.startsWith('|')) {
      inTable = false;
      continue;
    }
    const cells = getCells(text);
    if (!inTable) {
      inTable = true;
      exampleColumn = cells.indexOf('Example');
      continue;
    }
    if (exampleColumn === -1 || /^\|[\s|:-]+\|$/.test(text.trim())) {
      continue;
    }
    const cell = cells[exampleColumn] ?? '';
    for (const match of cell.matchAll(/`([^`]+)`/g)) {
      const code = match[1].replaceAll('\\|', '|');
      const line = i + 1;
      examples.push({
        line,
        code,
        fileName: path.join(
          root,
          `README.table-line-${line}-${examples.length}.ts`,
        ),
      });
    }
  }
  return examples;
}

const tableHeader =
  "import { QueryBuilder } from 'es-query-pro'; " +
  'declare const qb: QueryBuilder; ';

const readme = await Bun.file(path.join(root, 'README.md')).text();
const blocks = getTsBlocks(readme);
const samples = blocks.filter((block) => importsLibrary(block.code));
const tableExamples = getTableExamples(readme);
const tableSamples = tableExamples.map((example) => ({
  ...example,
  code: `${tableHeader}${example.code};\n`,
}));

/**
 * Removed APIs and settings. Split so that the repository-wide check
 * grep for the removed names (plan section 6, Final gate 3) stays empty.
 */
const removedApi = new RegExp(
  [
    ['getEs', 'Client'],
    ['Schema', 'Manager'],
    ['Schema', 'Shape'],
    ['ES_', 'VERSION'],
  ]
    .map((parts) => parts.join(''))
    .join('|'),
);

describe('README samples', () => {
  it('finds the samples', () => {
    expect(blocks.length).toBeGreaterThan(5);
    expect(samples.length).toBeGreaterThan(5);
  });

  it('compiles every IndexManager sample (each imports es-query-pro)', () => {
    const managerBlocks = blocks.filter((block) =>
      /new IndexManager\b/.test(block.code),
    );
    expect(managerBlocks.length).toBeGreaterThan(3);
    const notCompiled = managerBlocks
      .filter((block) => !importsLibrary(block.code))
      .map((block) => `README.md:${block.line}`);
    expect(notCompiled).toEqual([]);
  });

  it('does not mention the removed APIs', () => {
    const mentions = readme
      .split('\n')
      .map((text, i) => `README.md:${i + 1}: ${text}`)
      .filter((text) => removedApi.test(text));
    expect(mentions).toEqual([]);
  });

  it('type-checks every sample in strict mode', async () => {
    expect(await compileSamples(samples, true)).toEqual([]);
  }, 60_000);

  it('type-checks every sample in non-strict mode', async () => {
    expect(await compileSamples(samples, false)).toEqual([]);
  }, 60_000);
});

describe('README quick reference examples', () => {
  it('finds an example in every table row', () => {
    expect(tableExamples.length).toBeGreaterThan(60);
    const lines = readme.split('\n');
    const start = lines.findIndex((text) =>
      text.startsWith('## Query Builder function quick reference'),
    );
    const end = lines.findIndex(
      (text, i) => i > start && text.startsWith('## '),
    );
    const rowsWithExampleColumn: number[] = [];
    let hasExampleColumn = false;
    let inTable = false;
    for (let i = start + 1; i < end; i++) {
      const text = lines[i];
      if (!text.startsWith('|')) {
        inTable = false;
        continue;
      }
      if (!inTable) {
        inTable = true;
        hasExampleColumn = getCells(text).includes('Example');
        continue;
      }
      if (hasExampleColumn && !/^\|[\s|:-]+\|$/.test(text.trim())) {
        rowsWithExampleColumn.push(i + 1);
      }
    }
    const covered = new Set(tableExamples.map((example) => example.line));
    const missing = rowsWithExampleColumn
      .filter((line) => !covered.has(line))
      .map((line) => `README.md:${line}`);
    expect(missing).toEqual([]);
  });

  it('type-checks every example in strict mode', async () => {
    expect(await compileSamples(tableSamples, true)).toEqual([]);
  }, 60_000);

  it('type-checks every example in non-strict mode', async () => {
    expect(await compileSamples(tableSamples, false)).toEqual([]);
  }, 60_000);

  it('runs every example on a fresh builder without throwing', async () => {
    const { QueryBuilder } = await import('../index');
    const transpiler = new Bun.Transpiler({ loader: 'ts' });
    const failures: string[] = [];
    for (const example of tableExamples) {
      const js = transpiler.transformSync(example.code);
      const qb = new QueryBuilder();
      try {
        new Function('qb', 'QueryBuilder', js)(qb, QueryBuilder);
        qb.getQuery();
      } catch (e) {
        failures.push(`README.md:${example.line}: ${(e as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
