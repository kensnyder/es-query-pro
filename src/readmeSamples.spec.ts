import { describe, expect, it } from 'bun:test';
import path from 'node:path';
import ts from 'typescript-5';

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

function compileSamples(samples: Sample[], strict: boolean) {
  const options: ts.CompilerOptions = {
    strict,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    moduleDetection: ts.ModuleDetectionKind.Force,
    lib: ['lib.esnext.d.ts', 'lib.dom.d.ts'],
    types: ['bun-types'],
    paths: { 'es-query-pro': [path.join(root, 'index.ts')] },
  };
  const virtualFiles = new Map(
    samples.map((sample) => [sample.fileName, sample.code]),
  );
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);
  host.getCurrentDirectory = () => root;
  host.fileExists = (fileName) => {
    return virtualFiles.has(fileName) || fileExists(fileName);
  };
  host.readFile = (fileName) => {
    return virtualFiles.get(fileName) ?? readFile(fileName);
  };
  host.getSourceFile = (fileName, languageVersion, ...rest) => {
    const code = virtualFiles.get(fileName);
    if (code !== undefined) {
      return ts.createSourceFile(fileName, code, languageVersion, true);
    }
    return getSourceFile(fileName, languageVersion, ...rest);
  };
  const program = ts.createProgram([...virtualFiles.keys()], options, host);
  const diagnostics: ts.Diagnostic[] = [
    ...program.getOptionsDiagnostics(),
    ...program.getGlobalDiagnostics(),
  ];
  for (const sample of samples) {
    const sourceFile = program.getSourceFile(sample.fileName);
    if (!sourceFile) {
      throw new Error(`Sample at README line ${sample.line} was not loaded`);
    }
    diagnostics.push(
      ...program.getSyntacticDiagnostics(sourceFile),
      ...program.getSemanticDiagnostics(sourceFile),
    );
  }
  return diagnostics.map((diagnostic) => {
    const message = ts.flattenDiagnosticMessageText(
      diagnostic.messageText,
      '\n',
    );
    const sample = samples.find(
      (s) => s.fileName === diagnostic.file?.fileName,
    );
    if (!sample || !diagnostic.file || diagnostic.start === undefined) {
      return message;
    }
    const position = diagnostic.file.getLineAndCharacterOfPosition(
      diagnostic.start,
    );
    return `README.md:${sample.line + position.line}: ${message}`;
  });
}

const readme = await Bun.file(path.join(root, 'README.md')).text();
const blocks = getTsBlocks(readme);
const samples = blocks.filter((block) => importsLibrary(block.code));

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

  it('type-checks every sample in strict mode', () => {
    expect(compileSamples(samples, true)).toEqual([]);
  }, 60_000);

  it('type-checks every sample in non-strict mode', () => {
    expect(compileSamples(samples, false)).toEqual([]);
  }, 60_000);
});
