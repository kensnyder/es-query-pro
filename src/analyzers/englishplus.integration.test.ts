import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  setDefaultTimeout,
} from 'bun:test';
import { createTestKit } from '../testFixtures/esTestKit';
import englishplus from './englishplus';

// remote clusters (e.g. Elastic Cloud) need more than bun's 5s default
setDefaultTimeout(30_000);

const kit = await createTestKit('englishplus');

afterAll(async () => {
  await kit.cleanup();
});

let index = '';

beforeAll(async () => {
  index = await kit.makeIndex({
    index: 'analyzer',
    settings: { analysis: englishplus.analysis },
    mappings: {
      properties: { body: { type: 'text', analyzer: 'englishplus' } },
    },
  });
});

async function tokens(text: string, analyzer = 'englishplus') {
  const result = await kit.client.indices.analyze({ index, analyzer, text });
  return (result.tokens ?? []).map((token) => token.token);
}

describe('englishplus - Integration', () => {
  it('should give accented and unaccented plurals the same token', async () => {
    const accented = await tokens('résumés');
    const plain = await tokens('resumes');
    expect(accented).toEqual(plain);
    expect(accented).toHaveLength(1);
  });

  it('should fold accents before stemming, like the singular', async () => {
    expect(await tokens('café cafés cafe cafes')).toEqual([
      'cafe',
      'cafe',
      'cafe',
      'cafe',
    ]);
  });

  it('should strip English possessives', async () => {
    expect(await tokens("John's")).toEqual(await tokens('John'));
    expect(await tokens("the author's books")).toEqual(['author', 'book']);
  });

  it('should remove stop words, also when written in upper case', async () => {
    expect(await tokens('The Book AND the Shelf')).toEqual(['book', 'shelf']);
  });

  it('should remove stop words written with accents', async () => {
    expect(await tokens('thé bóok ánd thè shélf')).toEqual(['book', 'shelf']);
  });

  it('should match the built-in english analyzer on unaccented text', async () => {
    const text = "The runners' shoes were running quickly";
    expect(await tokens(text)).toEqual(await tokens(text, 'english'));
  });

  it('should match documents across accents and possessives', async () => {
    await kit.client.bulk({
      index,
      refresh: true,
      operations: [
        { index: { _id: '1' } },
        { body: "Résumés of the café's staff" },
        { index: { _id: '2' } },
        { body: 'An unrelated sentence' },
      ],
    });
    const result = await kit.client.search({
      index,
      query: { match: { body: { query: 'resume cafe', operator: 'and' } } },
    });
    expect(result.hits.hits.map((hit) => hit._id)).toEqual(['1']);
  });
});
