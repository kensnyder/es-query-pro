import { describe, expect, it } from 'bun:test';
import IndexNameManager, {
  type IndexNameAttributes,
  type IndexNameRelation,
} from './IndexNameManager';

function make(attrs: Partial<IndexNameAttributes>) {
  return new IndexNameManager({ name: 'books', ...attrs });
}

describe('IndexNameManager defaults (S-011)', () => {
  it('composes names without a prefix', () => {
    const index = new IndexNameManager({ name: 'books' });
    expect(index.prefix).toBe('');
    expect(index.separator).toBe('~');
    expect(index.language).toBe('english');
    expect(index.version).toBe(1);
    expect(index.getFullName()).toBe('english~books~v1');
    expect(index.getAliasName()).toBe('english~books');
  });
});

describe('IndexNameManager.parseByName (B-024)', () => {
  it('defaults the separator to "~"', () => {
    const parsed = IndexNameManager.parseByName('prod~english~books~v1');
    expect(parsed.prefix).toBe('prod');
    expect(parsed.language).toBe('english');
    expect(parsed.name).toBe('books');
    expect(parsed.separator).toBe('~');
    expect(parsed.getFullName()).toBe('prod~english~books~v1');
  });

  it('parses a name without a prefix and without a separator argument', () => {
    const parsed = IndexNameManager.parseByName('english~books~v1');
    expect(parsed.prefix).toBe('');
    expect(parsed.language).toBe('english');
    expect(parsed.getFullName()).toBe('english~books~v1');
  });

  it('returns numeric versions as numbers', () => {
    expect(IndexNameManager.parseByName('english~books~v5').version).toBe(5);
    expect(IndexNameManager.parseByName('english~books~v0').version).toBe(0);
  });

  it('keeps non-numeric versions as strings, so names round-trip', () => {
    const cases = ['2024a', '05', '1.5'];
    for (const version of cases) {
      const fullName = `english~books~v${version}`;
      const parsed = IndexNameManager.parseByName(fullName);
      expect(parsed.version).toBe(version);
      expect(parsed.getFullName()).toBe(fullName);
    }
  });

  it('throws when the name has more than 4 parts', () => {
    expect(() => {
      return IndexNameManager.parseByName('a~b~english~books~v1');
    }).toThrow(/a~b~english~books~v1/);
  });

  it('throws when the name has fewer than 3 parts', () => {
    expect(() => IndexNameManager.parseByName('books~v1')).toThrow(RangeError);
    expect(() => IndexNameManager.parseByName('books')).toThrow(RangeError);
    expect(() => IndexNameManager.parseByName('')).toThrow(RangeError);
  });

  it('throws when the last part is not a version', () => {
    expect(() => {
      return IndexNameManager.parseByName('english~books~1');
    }).toThrow(/version/);
    expect(() => {
      return IndexNameManager.parseByName('english~books~v');
    }).toThrow(RangeError);
  });

  it('throws with another separator than the one used', () => {
    expect(() => {
      return IndexNameManager.parseByName('prod.english.books.v1');
    }).toThrow(RangeError);
  });

  it('round-trips every option combination', () => {
    const cases: Partial<IndexNameAttributes>[] = [
      { separator: '.', version: 3, prefix: 'prod', language: 'french' },
      { separator: '@', version: '2024a' },
      { separator: '--', prefix: 'app1' },
      { prefix: 'büro', version: 12 },
    ];
    for (const attrs of cases) {
      const original = make(attrs);
      const parsed = IndexNameManager.parseByName(
        original.getFullName(),
        original.separator,
      );
      expect(parsed.getFullName()).toBe(original.getFullName());
      expect(parsed.getAliasName()).toBe(original.getAliasName());
      expect(parsed.version).toBe(original.version);
      expect(parsed.prefix).toBe(original.prefix);
    }
  });
});

describe('IndexNameManager.tryParseByName', () => {
  it('returns the parsed name', () => {
    const parsed = IndexNameManager.tryParseByName(
      'prod.english.books.v2',
      '.',
    );
    expect(parsed?.getFullName()).toBe('prod.english.books.v2');
  });

  it('returns null instead of throwing', () => {
    expect(IndexNameManager.tryParseByName('books')).toBe(null);
    expect(IndexNameManager.tryParseByName('a~b~c~books~v1')).toBe(null);
    expect(IndexNameManager.tryParseByName('English~books~v1')).toBe(null);
    expect(IndexNameManager.tryParseByName('english~books~v1', '')).toBe(null);
  });
});

describe('IndexNameManager validation of all parts (B-025)', () => {
  it('rejects an uppercase prefix', () => {
    expect(() => make({ prefix: 'Prod' })).toThrow(/lowercase/);
  });

  it('rejects characters Elasticsearch does not allow', () => {
    const bad = ['\\', '/', '*', '?', '"', '<', '>', '|', ',', '#', ':', ' '];
    for (const char of bad) {
      expect(() => make({ prefix: `a${char}b` })).toThrow(RangeError);
      expect(() => make({ language: `en${char}` })).toThrow(RangeError);
    }
    expect(() => make({ prefix: 'a b,c*' })).toThrow(RangeError);
  });

  it('rejects whitespace and control characters', () => {
    expect(() => make({ prefix: 'a\tb' })).toThrow(RangeError);
    expect(() => make({ prefix: 'a\nb' })).toThrow(RangeError);
    expect(() => make({ prefix: 'a\u0000b' })).toThrow(RangeError);
  });

  it('rejects a leading "-", "_", "+" or "."', () => {
    for (const lead of ['-', '_', '+', '.']) {
      expect(() => make({ prefix: `${lead}x` })).toThrow(/start/);
      expect(() => make({ language: `${lead}en` })).toThrow(/start/);
    }
  });

  it('allows "-", "_", "+" and "." after the first character', () => {
    const index = make({ prefix: 'a-b_c+d.e' });
    expect(index.getFullName()).toBe('a-b_c+d.e~english~books~v1');
  });

  it('rejects separators Elasticsearch does not allow', () => {
    for (const separator of [',', ' ', '*', '#', ':', '/', 'X']) {
      expect(() => make({ separator })).toThrow(/separator/);
    }
  });

  it('rejects an empty separator with a separator message', () => {
    expect(() => make({ separator: '' })).toThrow(/separator/);
  });

  it('rejects a non-string separator', () => {
    expect(() => make({ separator: 1 as unknown as string })).toThrow(
      /separator/,
    );
  });

  it('rejects an empty language', () => {
    expect(() => make({ language: '' })).toThrow(/language/);
  });

  it('rejects a prefix, language or version containing the separator', () => {
    expect(() => make({ prefix: 'a~b' })).toThrow(/prefix/);
    expect(() => make({ language: 'en~gb' })).toThrow(/language/);
    expect(() => make({ version: '1~2' })).toThrow(/version/);
    expect(() => make({ separator: 'v' })).toThrow(/version/);
  });

  it('rejects invalid versions', () => {
    expect(() => make({ version: 'X Y' })).toThrow(RangeError);
    expect(() => make({ version: '' })).toThrow(/version/);
    expect(() => make({ version: -1 })).toThrow(/version/);
    expect(() => make({ version: 1.5 })).toThrow(/version/);
    expect(() => make({ version: Number.NaN })).toThrow(/version/);
    expect(() => make({ version: Number.POSITIVE_INFINITY })).toThrow(
      /version/,
    );
  });

  it('accepts version 0, numeric strings and other string versions', () => {
    expect(make({ version: 0 }).getFullName()).toBe('english~books~v0');
    expect(make({ version: '7' }).getFullName()).toBe('english~books~v7');
    expect(make({ version: '2024a' }).getFullName()).toBe(
      'english~books~v2024a',
    );
  });

  it('limits the full name to 255 bytes', () => {
    // "~english~books~v1" is 17 bytes
    const fits = make({ prefix: 'p'.repeat(255 - 17) });
    expect(new TextEncoder().encode(fits.getFullName()).length).toBe(255);
    expect(() => make({ prefix: 'p'.repeat(256 - 17) })).toThrow(/255 bytes/);
  });

  it('counts bytes, not characters', () => {
    // "é" is 2 bytes in UTF-8: 119 * 2 + 17 = 255
    expect(() => make({ prefix: 'é'.repeat(119) })).not.toThrow();
    expect(() => make({ prefix: `x${'é'.repeat(119)}` })).toThrow(/255 bytes/);
  });

  it('accepts lowercase non-ASCII letters', () => {
    expect(make({ prefix: 'büro' }).getFullName()).toBe(
      'büro~english~books~v1',
    );
  });

  it('rejects uppercase non-ASCII letters', () => {
    expect(() => make({ prefix: 'Büro' })).toThrow(/lowercase/);
  });

  it('names the offending full name in the error', () => {
    expect(() => make({ prefix: 'Prod' })).toThrow('Prod~english~books~v1');
  });
});

describe('IndexNameManager.isValidEsIndexName', () => {
  it('accepts names Elasticsearch allows', () => {
    const good = ['a', 'books', '2024_books', 'wild-animals', 'a.b', 'a+b'];
    for (const name of good) {
      expect(IndexNameManager.isValidEsIndexName(name)).toBe(true);
    }
  });

  it('rejects names Elasticsearch does not allow', () => {
    const bad = [
      '',
      '.',
      '..',
      '.hidden',
      '-a',
      '_a',
      '+a',
      'A',
      'a b',
      'a,b',
      'a#b',
      'a:b',
      'x'.repeat(256),
    ];
    for (const name of bad) {
      expect(IndexNameManager.isValidEsIndexName(name)).toBe(false);
    }
  });

  it('rejects non-strings', () => {
    expect(IndexNameManager.isValidEsIndexName(1 as unknown as string)).toBe(
      false,
    );
  });
});

describe('IndexNameManager name rules (B-067)', () => {
  it('accepts a single-character name', () => {
    expect(make({ name: 'a' }).getFullName()).toBe('english~a~v1');
    expect(make({ name: '7' }).getFullName()).toBe('english~7~v1');
  });

  it('accepts a dash and a leading digit', () => {
    expect(make({ name: 'wild-animals' }).name).toBe('wild-animals');
    expect(make({ name: '2024_books' }).name).toBe('2024_books');
  });

  it('still rejects a leading "-" or "_" and other characters', () => {
    for (const name of ['-books', '_books', 'Books', 'bo.oks', 'bo+oks']) {
      expect(() => make({ name })).toThrow(/Index name/);
    }
  });

  it('rejects a non-string name', () => {
    expect(() => make({ name: undefined as unknown as string })).toThrow(
      /Index name/,
    );
  });

  it('has no isValidColumnName (it was never called)', () => {
    expect('isValidColumnName' in make({})).toBe(false);
  });
});

describe('IndexNameManager.compare', () => {
  const base = make({ prefix: 'prod', version: 3 });
  const cases: [string, Partial<IndexNameAttributes>, IndexNameRelation][] = [
    ['same version', { prefix: 'prod', version: 3 }, 'same'],
    ['same version as a string', { prefix: 'prod', version: '3' }, 'same'],
    ['lower version', { prefix: 'prod', version: 2 }, 'older'],
    ['numeric, not string order', { prefix: 'prod', version: 10 }, 'newer'],
    ['higher version', { prefix: 'prod', version: 4 }, 'newer'],
    ['other prefix', { prefix: 'staging', version: 2 }, 'unrelated'],
    ['no prefix', { version: 2 }, 'unrelated'],
    ['other language', { prefix: 'prod', language: 'french' }, 'unrelated'],
    ['other name', { prefix: 'prod', name: 'authors' }, 'unrelated'],
    ['other separator', { prefix: 'prod', separator: '.' }, 'unrelated'],
    [
      'non-numeric version',
      { prefix: 'prod', version: '2024a' },
      'incomparable',
    ],
    ['leading zero', { prefix: 'prod', version: '03' }, 'incomparable'],
  ];
  for (const [label, attrs, relation] of cases) {
    it(`classifies ${label} as ${relation}`, () => {
      expect(IndexNameManager.compare(base, make(attrs))).toBe(relation);
    });
  }

  it('is symmetric for older and newer', () => {
    const v1 = make({ version: 1 });
    const v2 = make({ version: 2 });
    expect(IndexNameManager.compare(v1, v2)).toBe('newer');
    expect(IndexNameManager.compare(v2, v1)).toBe('older');
  });

  it('treats identical non-numeric versions as the same', () => {
    const a = make({ version: '2024a' });
    const b = make({ version: '2024a' });
    expect(IndexNameManager.compare(a, b)).toBe('same');
  });

  it('orders versions beyond the safe integer range', () => {
    const big = make({ version: '90071992547409930' });
    const bigger = make({ version: '90071992547409931' });
    expect(IndexNameManager.compare(big, bigger)).toBe('newer');
    expect(IndexNameManager.compare(bigger, big)).toBe('older');
  });

  it('classifies parsed sibling names', () => {
    const mine = make({ prefix: 'prod', version: 2 });
    const siblings = [
      'prod~english~books~v1',
      'prod~english~books~v10',
      'prod~english~authors~v1',
      'legacy-books',
    ];
    const relations = siblings.map((name) => {
      const parsed = IndexNameManager.tryParseByName(name, mine.separator);
      if (!parsed) {
        return 'unrelated';
      }
      return IndexNameManager.compare(mine, parsed);
    });
    expect(relations).toEqual(['older', 'newer', 'unrelated', 'unrelated']);
  });
});
