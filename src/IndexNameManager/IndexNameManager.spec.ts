import { describe, expect, it } from 'bun:test';
import IndexNameManager from './IndexNameManager';

describe('IndexNameManager', () => {
  it('should compose an index name and an alias name', () => {
    const index = new IndexNameManager({
      prefix: 'staging',
      language: 'english',
      name: 'wild_animals',
      version: 5,
      separator: '~',
    });
    expect(index.getFullName()).toBe('staging~english~wild_animals~v5');
    expect(index.getAliasName()).toBe('staging~english~wild_animals');
  });
  it('should parse from an index name', () => {
    const index = IndexNameManager.parseByName(
      'staging~english~wild_animals~v5',
      '~'
    );
    expect(index.getFullName()).toBe('staging~english~wild_animals~v5');
  });
  it('should parse index with no prefix', () => {
    const index = IndexNameManager.parseByName('english@wild_animals@v5', '@');
    expect(index.getFullName()).toBe('english@wild_animals@v5');
  });
  it('should throw when contains separator', () => {
    const toThrow = () =>
      new IndexNameManager({
        prefix: 'staging',
        language: 'english',
        name: 'wild~animals',
        version: 5,
        separator: '~',
      });
    expect(toThrow).toThrowError(/Index name/);
  });
  it('should throw on invalid start character', () => {
    const toThrow = () =>
      new IndexNameManager({
        prefix: 'staging',
        language: 'english',
        name: '-wild_animals',
        version: 5,
        separator: '~',
      });
    expect(toThrow).toThrowError(/Index name/);
  });
  it('should throw on invalid uppercase characters', () => {
    const toThrow = () =>
      new IndexNameManager({
        prefix: 'staging',
        language: 'english',
        // @ts-expect-error  This is a test of an invalid name
        name: 'WildAnimals',
        version: 5,
        separator: '~',
      });
    expect(toThrow).toThrowError(/Index name/);
  });
  it('should throw empty name', () => {
    const toThrow = () =>
      new IndexNameManager({
        prefix: 'staging',
        language: 'english',
        // @ts-expect-error  This is a test of an invalid name
        name: '',
        version: 5,
        separator: '~',
      });
    expect(toThrow).toThrowError(/Index name/);
  });
  it('should throw too long name', () => {
    const toThrow = () =>
      new IndexNameManager({
        prefix: 'staging',
        language: 'english',
        // @ts-expect-error  This is a test of an invalid name
        name: 'a'.repeat(256),
        version: 5,
        separator: '~',
      });
    expect(toThrow).toThrowError(/Index name/);
  });
});
