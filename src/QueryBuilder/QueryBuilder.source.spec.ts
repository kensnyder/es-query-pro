import { describe, expect, it } from 'bun:test';
import { getRecordingClient } from '../testFixtures/recordingClient';
import QueryBuilder, { getDefaultHighlighter } from './QueryBuilder';

/** The JSON body of a toKibana() string */
function kibanaBody(qb: QueryBuilder) {
  const kibana = qb.toKibana();
  return JSON.parse(kibana.slice(kibana.indexOf('\n') + 1));
}

describe('QueryBuilder _source emission', () => {
  it('defaults to all fields', () => {
    const qb = new QueryBuilder();
    expect(qb.getQuery()._source).toEqual(['*']);
  });

  it('emits includes alone as an array', () => {
    const qb = new QueryBuilder().fields(['id', 'title']);
    expect(qb.getQuery()._source).toEqual(['id', 'title']);
  });

  it('emits includes and excludes together in one _source object (B-011)', () => {
    const qb = new QueryBuilder({ index: 'books' });
    qb.fields(['id', 'title', 'secret']);
    qb.excludeFields(['secret']);
    const query = qb.getQuery();
    expect(query._source).toEqual({
      includes: ['id', 'title', 'secret'],
      excludes: ['secret'],
    });
    expect('_source_excludes' in query).toBe(false);
  });

  it('emits excludes alone with the default includes', () => {
    const qb = new QueryBuilder().sourceExcludes(['private.*']);
    expect(qb.getQuery()._source).toEqual({
      includes: ['*'],
      excludes: ['private.*'],
    });
  });

  it('sends the excludes in the body, not the URL (B-011)', async () => {
    const { client, sent } = getRecordingClient();
    const qb = new QueryBuilder({ index: 'books' });
    qb.fields(['id', 'title']).excludeFields(['title']);
    await client.search(qb.getQuery());
    expect(sent).toHaveLength(1);
    expect(sent[0].querystring ?? '').not.toContain('_source');
    expect((sent[0].body as Record<string, unknown>)._source).toEqual({
      includes: ['id', 'title'],
      excludes: ['title'],
    });
  });

  it('toKibana() emits a valid _source and no _source_excludes (B-011)', () => {
    const qb = new QueryBuilder({ index: 'books' });
    qb.fields(['id']).excludeFields(['secret']);
    const body = kibanaBody(qb);
    expect(body._source).toEqual({ includes: ['id'], excludes: ['secret'] });
    expect(body).not.toHaveProperty('_source_excludes');
  });

  it('fields([]) emits _source: false (S-049)', () => {
    const qb = new QueryBuilder().fields([]);
    expect(qb.getQuery()._source).toBe(false);
    expect(kibanaBody(qb)._source).toBe(false);
  });

  it('fields([]) wins over excludes', () => {
    const qb = new QueryBuilder().fields([]).excludeFields(['secret']);
    expect(qb.getQuery()._source).toBe(false);
  });

  it('aliases set the same state', () => {
    const qb = new QueryBuilder();
    qb.sourceIncludes(['a']).sourceExcludes(['b']);
    expect(qb.getFields()).toEqual(['a']);
    expect(qb.getSourceIncludes()).toEqual(['a']);
    expect(qb.getExcludeFields()).toEqual(['b']);
    expect(qb.getSourceExcludes()).toEqual(['b']);
  });

  it('rejects non-array and non-string field lists', () => {
    const qb = new QueryBuilder();
    // @ts-expect-error  a single string is not a list
    expect(() => qb.fields('title')).toThrow(TypeError);
    // @ts-expect-error  a non-string entry
    expect(() => qb.sourceIncludes(['a', 1])).toThrow(TypeError);
    // @ts-expect-error  a single string is not a list
    expect(() => qb.excludeFields('title')).toThrow(TypeError);
    // @ts-expect-error  a non-string entry
    expect(() => qb.sourceExcludes([null])).toThrow(TypeError);
  });
});

describe('QueryBuilder arrays and objects are copied (B-090)', () => {
  it('copies field lists on input', () => {
    const include = ['a'];
    const exclude = ['b'];
    const qb = new QueryBuilder().fields(include).excludeFields(exclude);
    include.push('x');
    exclude.push('y');
    expect(qb.getQuery()._source).toEqual({ includes: ['a'], excludes: ['b'] });
  });

  it('copies field lists on output', () => {
    const qb = new QueryBuilder().fields(['a']).excludeFields(['b']);
    qb.getFields().push('x');
    qb.getSourceIncludes().push('x');
    qb.getExcludeFields().push('y');
    qb.getSourceExcludes().push('y');
    const source = qb.getQuery()._source as { includes: string[] };
    source.includes.push('z');
    expect(qb.getQuery()._source).toEqual({ includes: ['a'], excludes: ['b'] });
    const array = new QueryBuilder().fields(['a']);
    (array.getQuery()._source as string[]).push('z');
    expect(array.getQuery()._source).toEqual(['a']);
  });

  it('copies highlightField() options on input', () => {
    const options = { number_of_fragments: 1 };
    const qb = new QueryBuilder().highlightField('title', options);
    options.number_of_fragments = 9;
    expect(qb.getHighlighter().fields.title).toEqual({
      number_of_fragments: 1,
    });
  });

  it('copies highlighterOptions() on input', () => {
    const options = { pre_tags: ['<b>'] };
    const qb = new QueryBuilder().highlighterOptions(options);
    options.pre_tags.push('<i>');
    expect(qb.getHighlighter().pre_tags).toEqual(['<b>']);
  });

  it('returns a copy from getHighlighter() and getBody()', () => {
    const qb = new QueryBuilder().highlightField('title');
    qb.getHighlighter().fields.injected = {};
    const body = qb.getBody();
    if (body.highlight?.fields && !Array.isArray(body.highlight.fields)) {
      body.highlight.fields.injected = {};
    }
    expect(Object.keys(qb.getHighlighter().fields)).toEqual(['title']);
    expect(qb.getBody().highlight?.fields).toEqual({ title: {} });
  });

  it('copies searchAfter() values on input and output', () => {
    const values = [1, 'a'];
    const qb = new QueryBuilder().searchAfter(values);
    values.push('x');
    qb.getSearchAfter()?.push('y');
    qb.getOptions().search_after?.push('z');
    expect(qb.getSearchAfter()).toEqual([1, 'a']);
    expect(qb.getQuery().search_after).toEqual([1, 'a']);
  });
});

describe('QueryBuilder default highlighter (B-044)', () => {
  it('is unified', () => {
    expect(getDefaultHighlighter()).toEqual({
      type: 'unified',
      number_of_fragments: 3,
      fragment_size: 150,
      tags_schema: 'styled',
      fields: {},
    });
  });

  it('is what getBody() emits', () => {
    const qb = new QueryBuilder().highlightField('title');
    expect(qb.getBody().highlight).toEqual({
      type: 'unified',
      number_of_fragments: 3,
      fragment_size: 150,
      tags_schema: 'styled',
      fields: { title: {} },
    });
  });

  it('omits highlight when no field is highlighted', () => {
    const qb = new QueryBuilder().highlighterOptions({ type: 'plain' });
    expect(qb.getBody().highlight).toBeUndefined();
  });

  it('allows a per-field type override', () => {
    const qb = new QueryBuilder().highlightField('title.fvh', { type: 'fvh' });
    expect(qb.getBody().highlight?.fields).toEqual({
      'title.fvh': { type: 'fvh' },
    });
  });
});

describe('QueryBuilder.highlighterOptions() merges (S-043)', () => {
  it('keeps defaults that are not overridden', () => {
    const qb = new QueryBuilder();
    qb.highlightField('title');
    qb.highlighterOptions({ number_of_fragments: 1 });
    expect(qb.getHighlighter()).toEqual({
      type: 'unified',
      number_of_fragments: 1,
      fragment_size: 150,
      tags_schema: 'styled',
      fields: { title: {} },
    });
  });

  it('merges successive calls', () => {
    const qb = new QueryBuilder();
    qb.highlighterOptions({ type: 'plain' });
    qb.highlighterOptions({ fragment_size: 50 });
    expect(qb.getHighlighter().type).toBe('plain');
    expect(qb.getHighlighter().fragment_size).toBe(50);
  });

  it('removes an option set to undefined', () => {
    const qb = new QueryBuilder();
    qb.highlighterOptions({ tags_schema: undefined });
    expect(qb.getHighlighter()).toEqual({
      type: 'unified',
      number_of_fragments: 3,
      fragment_size: 150,
      fields: {},
    });
    expect('tags_schema' in qb.getHighlighter()).toBe(false);
  });

  it('ignores a fields key passed at runtime', () => {
    const qb = new QueryBuilder().highlightField('title');
    // @ts-expect-error  fields are set with highlightField()
    qb.highlighterOptions({ fields: { other: {} } });
    expect(qb.getHighlighter().fields).toEqual({ title: {} });
  });

  it('reset() restores the defaults', () => {
    const qb = new QueryBuilder().highlighterOptions({ type: 'plain' });
    qb.highlightField('title');
    qb.reset('highlighter');
    expect(qb.getHighlighter()).toEqual(getDefaultHighlighter());
  });
});

describe('QueryBuilder numeric setters (S-044)', () => {
  it('has numeric rank defaults and undefined optional settings', () => {
    const qb = new QueryBuilder();
    expect(qb.getRankWindowSize()).toBe(50);
    expect(qb.getRankConstant()).toBe(20);
    expect(qb.getMinScore()).toBeUndefined();
    expect(qb.getSearchAfter()).toBeUndefined();
    expect(qb.getTrackTotalHits()).toBeUndefined();
  });

  it('accepts valid values', () => {
    const qb = new QueryBuilder();
    qb.rankWindowSize(1).rankConstant(1).minScore(-0.5).trackTotalHits(0);
    expect(qb.getRankWindowSize()).toBe(1);
    expect(qb.getRankConstant()).toBe(1);
    expect(qb.getMinScore()).toBe(-0.5);
    expect(qb.getTrackTotalHits()).toBe(0);
    qb.trackTotalHits(false);
    expect(qb.getOptions().track_total_hits).toBe(false);
    qb.trackTotalHits(true).minScore(0);
    expect(qb.getOptions()).toEqual({ min_score: 0, track_total_hits: true });
  });

  it('rankWindowSize() rejects values below 1, fractions and non-finite', () => {
    const qb = new QueryBuilder();
    expect(() => qb.rankWindowSize(0)).toThrow(RangeError);
    expect(() => qb.rankWindowSize(1.5)).toThrow(RangeError);
    expect(() => qb.rankWindowSize(Number.NaN)).toThrow(RangeError);
    expect(() => qb.rankWindowSize(Infinity)).toThrow(RangeError);
    // @ts-expect-error  not a number
    expect(() => qb.rankWindowSize('10')).toThrow(TypeError);
    expect(qb.getRankWindowSize()).toBe(50);
  });

  it('rankConstant() rejects values below 1, fractions and non-finite', () => {
    const qb = new QueryBuilder();
    expect(() => qb.rankConstant(0)).toThrow(RangeError);
    expect(() => qb.rankConstant(2.5)).toThrow(RangeError);
    expect(() => qb.rankConstant(Number.NaN)).toThrow(RangeError);
    // @ts-expect-error  not a number
    expect(() => qb.rankConstant(null)).toThrow(TypeError);
    expect(qb.getRankConstant()).toBe(20);
  });

  it('minScore() rejects non-finite values', () => {
    const qb = new QueryBuilder();
    expect(() => qb.minScore(Number.NaN)).toThrow(RangeError);
    expect(() => qb.minScore(-Infinity)).toThrow(RangeError);
    // @ts-expect-error  not a number
    expect(() => qb.minScore('1')).toThrow(TypeError);
    expect(qb.getOptions()).toEqual({});
  });

  it('trackTotalHits() rejects negative, fractional and non-finite numbers', () => {
    const qb = new QueryBuilder();
    expect(() => qb.trackTotalHits(-1)).toThrow(RangeError);
    expect(() => qb.trackTotalHits(1.5)).toThrow(RangeError);
    expect(() => qb.trackTotalHits(Number.NaN)).toThrow(RangeError);
    // @ts-expect-error  not a number or boolean
    expect(() => qb.trackTotalHits('1000')).toThrow(TypeError);
    expect(qb.getTrackTotalHits()).toBeUndefined();
  });

  it('searchAfter() rejects a non-array', () => {
    const qb = new QueryBuilder();
    // @ts-expect-error  not an array
    expect(() => qb.searchAfter(5)).toThrow(TypeError);
    expect(qb.getSearchAfter()).toBeUndefined();
  });
});
