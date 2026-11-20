import type { estypes } from '@elastic/elasticsearch';

/** One document of the articles fixture (`getArticlesData()`). */
export type ArticleRecord = {
  id: string;
  title: string;
  /** Same text as `body_semantic` */
  body: string;
  body_semantic: string;
};

/**
 * Creation request for the articles fixture, for semantic search. Only
 * create it when `kit.caps.inference` is true, passing
 * `kit.caps.inferenceId`. Fields: `title` (text, keyword `title.raw`),
 * `body` (text, english, keyword `body.raw`) and `body_semantic`
 * (`semantic_text` on `inferenceId`). `weightedSemantic` pairs `body` with
 * `body_semantic`; its default exact field is `body.raw`.
 */
export function getArticlesCreateRequest(
  index: string,
  inferenceId: string,
): estypes.IndicesCreateRequest {
  return {
    index,
    mappings: {
      properties: {
        id: { type: 'keyword' },
        title: { type: 'text', fields: { raw: { type: 'keyword' } } },
        body: {
          type: 'text',
          analyzer: 'english',
          fields: { raw: { type: 'keyword', ignore_above: 512 } },
        },
        body_semantic: { type: 'semantic_text', inference_id: inferenceId },
      },
    },
  };
}

const bodies: [string, string, string][] = [
  [
    '1',
    'Baking bread at home',
    'Knead the dough, let it rise overnight, then bake the loaf in a hot oven.',
  ],
  [
    '2',
    'Rockets and orbits',
    'A spacecraft needs enough velocity to reach orbit around the planet.',
  ],
  [
    '3',
    'Growing tomatoes',
    'Plant seedlings in sunny soil and water the garden every morning.',
  ],
  [
    '4',
    'Sourdough starter care',
    'Feed the starter flour and water daily so the yeast stays active.',
  ],
];

/**
 * Four articles on distinct topics: '1' and '4' are about baking bread,
 * '2' about spaceflight, '3' about gardening. A semantic query for
 * "how to make a loaf" should rank '1' or '4' first.
 */
export function getArticlesData(): ArticleRecord[] {
  return bodies.map(([id, title, body]) => ({
    id,
    title,
    body,
    body_semantic: body,
  }));
}
