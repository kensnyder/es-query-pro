import { afterAll, describe, expect, it, setDefaultTimeout } from 'bun:test';
import { createTestKit } from '../testFixtures/esTestKit';
import IndexNameManager, { type IndexNameAttributes } from './IndexNameManager';

// remote clusters (e.g. Elastic Cloud) need more than bun's 5s default
setDefaultTimeout(30_000);

const kit = await createTestKit('indexname');

// every index below starts with kit.prefix, so cleanup() finds it
afterAll(async () => {
  await kit.cleanup();
});

const p = kit.prefix;

/** UTF-8 length of a string */
function bytes(value: string) {
  return new TextEncoder().encode(value).length;
}

/** `[prefix~]language~name~v<version>`, as getFullName() should build it */
function expectedFullName(attrs: IndexNameAttributes) {
  const {
    separator = '~',
    prefix = '',
    language = 'english',
    version = 1,
  } = attrs;
  const parts = [prefix, language, attrs.name, `v${version}`];
  return parts.filter((part) => part !== '').join(separator);
}

/** A prefix that makes the full name of `{ prefix, name: 'books' }` `size` bytes */
function prefixForSize(size: number, filler = 'x') {
  const rest = bytes('~english~books~v1');
  const fill = size - rest - bytes(p);
  return (
    p +
    filler.repeat(Math.floor(fill / bytes(filler))) +
    'y'.repeat(fill % bytes(filler))
  );
}

/**
 * Delete one index by exact name. Refuses anything Elasticsearch could read
 * as a pattern or as several names, so nothing outside this run is touched.
 */
async function deleteExact(index: string) {
  if (!index.startsWith(p) || /[*?,]/.test(index)) {
    return;
  }
  await kit.client.indices.delete({ index, ignore_unavailable: true });
}

/** The error the server raised when creating `index`, or null on success */
async function tryCreate(index: string, alias?: string) {
  try {
    await kit.client.indices.create({
      index,
      aliases: alias ? { [alias]: {} } : undefined,
    });
    return null;
  } catch (e) {
    return e as Error & { meta?: { statusCode?: number } };
  }
}

const accepted: [string, IndexNameAttributes][] = [
  ['defaults with a prefix', { prefix: p, name: 'books' }],
  ['no prefix (language first)', { language: p, name: 'books' }],
  ['a one-character name', { prefix: p, name: 'a' }],
  ['a name with a leading digit', { prefix: p, name: '2024_books' }],
  ['a name with a dash', { prefix: p, name: 'wild-animals' }],
  [
    'separator "." and other options',
    { prefix: p, separator: '.', version: 3, language: 'french', name: 'b' },
  ],
  ['separator "@"', { prefix: p, separator: '@', name: 'books' }],
  ['separator "+"', { prefix: p, separator: '+', name: 'books' }],
  ['separator "--"', { prefix: p, separator: '--', name: 'books' }],
  ['version 0', { prefix: p, name: 'books', version: 0 }],
  ['a string version', { prefix: p, name: 'books', version: '2024a' }],
  ['allowed punctuation', { prefix: `${p}-a_b+c.d`, name: 'books' }],
  ['lowercase non-ASCII', { prefix: `${p}-büro`, name: 'books' }],
  ['exactly 255 bytes', { prefix: prefixForSize(255), name: 'books' }],
  [
    'exactly 255 bytes with 2-byte characters',
    { prefix: prefixForSize(255, 'é'), name: 'books' },
  ],
];

const rejected: [string, IndexNameAttributes][] = [
  ['an uppercase prefix', { prefix: `${p}-Prod`, name: 'books' }],
  ['an uppercase language', { prefix: p, language: 'English', name: 'b' }],
  ['a space', { prefix: `${p} x`, name: 'books' }],
  ...[...'\\/*?"<>|,#:'].map((char): [string, IndexNameAttributes] => [
    `"${char}"`,
    { prefix: `${p}${char}x`, name: 'books' },
  ]),
  ['a leading "-"', { prefix: `-${p}`, name: 'books' }],
  ['a leading "_"', { prefix: `_${p}`, name: 'books' }],
  ['a leading "+"', { prefix: `+${p}`, name: 'books' }],
  ['256 bytes', { prefix: prefixForSize(256), name: 'books' }],
  [
    '256 bytes with 2-byte characters',
    { prefix: prefixForSize(256, 'é'), name: 'books' },
  ],
];

describe('IndexNameManager - Integration', () => {
  describe('names the validator accepts are created by the server', () => {
    for (const [label, attrs] of accepted) {
      it(label, async () => {
        const manager = new IndexNameManager(attrs);
        const index = manager.getFullName();
        const alias = manager.getAliasName();
        expect(index).toBe(expectedFullName(attrs));
        expect(index.startsWith(p)).toBe(true);
        expect(bytes(index)).toBeLessThanOrEqual(255);
        try {
          const error = await tryCreate(index, alias);
          expect(error).toBe(null);
          const exists = await kit.client.indices.exists({ index });
          expect(exists).toBe(true);
          const aliased = await kit.client.indices.getAlias({ name: alias });
          expect(Object.keys(aliased)).toEqual([index]);
          // a name read back from the server parses to the same parts
          const parsed = IndexNameManager.parseByName(
            Object.keys(aliased)[0],
            manager.separator,
          );
          expect(IndexNameManager.compare(manager, parsed)).toBe('same');
        } finally {
          await deleteExact(index);
        }
      });
    }
  });

  describe('names the validator rejects are rejected by the server', () => {
    for (const [label, attrs] of rejected) {
      it(label, async () => {
        expect(() => new IndexNameManager(attrs)).toThrow(RangeError);
        const index = expectedFullName(attrs);
        expect(IndexNameManager.isValidEsIndexName(index)).toBe(false);
        const error = await tryCreate(index);
        if (error === null) {
          await deleteExact(index);
        }
        expect(error).not.toBe(null);
        expect(error?.name).toBe('ResponseError');
        expect(error?.meta?.statusCode).toBe(400);
      });
    }
  });
});
