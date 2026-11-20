import type { Client, estypes } from '@elastic/elasticsearch';
import { getTestClient } from './testClient';

/** One document of the books fixture (`getBooksData()`). */
export type BookRecord = {
  id: string;
  title: string;
  premise: string;
  country: string;
  categories: { id: number; name: string }[];
  publishing: {
    author: string;
    series: string;
    organization: string;
    year: number;
    movieYear?: number;
  };
  heroes: string[];
  price: number;
  published_at: string;
  /** Present on book 3 only and not in the mapping (dynamic); for `exists` */
  extra?: string;
};

/**
 * Mappings of the books fixture. `categories` and `publishing` are `nested`;
 * `title.fvh` has term vectors; `price` is a `scaled_float` (cents).
 */
export function getBooksMappings(): estypes.MappingTypeMapping {
  return {
    properties: {
      id: { type: 'keyword' },
      title: {
        type: 'text',
        analyzer: 'english',
        search_analyzer: 'english',
        fields: {
          fvh: {
            type: 'text',
            term_vector: 'with_positions_offsets',
          },
        },
      },
      premise: {
        type: 'text',
        analyzer: 'english',
        search_analyzer: 'english',
      },
      country: { type: 'keyword' },
      categories: {
        type: 'nested',
        properties: {
          id: { type: 'integer' },
          name: {
            type: 'text',
            analyzer: 'english',
            search_analyzer: 'english',
          },
        },
      },
      author: {
        type: 'keyword',
      },
      publishing: {
        type: 'nested',
        properties: {
          author: { type: 'keyword' },
          organization: {
            type: 'text',
            analyzer: 'english',
            search_analyzer: 'english',
          },
          series: {
            type: 'text',
            analyzer: 'english',
            search_analyzer: 'english',
          },
          year: { type: 'integer' },
          movieYear: { type: 'integer' },
        },
      },
      heroes: { type: 'keyword' },
      price: { type: 'scaled_float', scaling_factor: 100 },
      published_at: { type: 'date' },
    },
  };
}

/**
 * Creation request for the books fixture. `index` is the logical name; pass
 * it to `new IndexManager()` or `kit.makeIndex()`, which add the run prefix.
 */
export function getBooksCreateRequest(
  index: string,
): estypes.IndicesCreateRequest {
  return {
    index,
    mappings: getBooksMappings(),
  };
}

/** The three books: ids '1' and '2' (UK, Harry Potter) and '3' (US, Skyward) */
export function getBooksData(): BookRecord[] {
  return [
    {
      id: '1',
      title: "Harry Potter and the Sorcerer's Stone",
      premise:
        'A young boy discovers he’s a wizard and must confront a dark sorcerer while uncovering the truth about his own mysterious past.',
      country: 'United Kingdom',
      categories: [
        {
          id: 101,
          name: 'Fantasy',
        },
        {
          id: 102,
          name: 'Coming of Age',
        },
        {
          id: 104,
          name: 'Uncovering mystery',
        },
      ],
      publishing: {
        author: 'JK Rowling',
        series: 'First book of the Harry Potter series',
        organization: 'Bloomsbury Publishing',
        year: 1998,
        movieYear: 2001,
      },
      heroes: ['Harry Potter', 'Hermione Granger', 'Ron Weasley'],
      price: 24.99,
      published_at: '1998-06-26T00:00:00Z',
    },
    {
      id: '2',
      title: 'Harry Potter and the Chamber of Secrets',
      premise:
        'At Hogwarts, Harry uncovers the mystery behind a mysterious hidden chamber',
      country: 'United Kingdom',
      categories: [
        {
          id: 101,
          name: 'Fantasy',
        },
        {
          id: 102,
          name: 'Coming of Age',
        },
      ],
      publishing: {
        author: 'JK Rowling',
        series: 'Second book of the Harry Potter series',
        organization: 'Bloomsbury Publishing',
        year: 1999,
        movieYear: 2002,
      },
      heroes: ['Harry Potter', 'Hermione Granger', 'Ron Weasley'],
      price: 22.99,
      published_at: '1999-07-02T00:00:00Z',
    },
    {
      id: '3',
      title: 'Skyward',
      premise:
        'A determined young pilot-in-training fights to prove herself worthy in a world under constant alien attack',
      country: 'United States of America',
      categories: [
        {
          id: 101,
          name: 'Fantasy',
        },
        {
          id: 103,
          name: 'Military',
        },
        {
          id: 104,
          name: 'Uncovering mystery',
        },
      ],
      publishing: {
        author: 'Brandon Sanderson',
        series: 'First book of the Skyward series',
        organization: 'Delacorte Press',
        year: 2018,
      },
      heroes: ['Spensa'],
      price: 18.99,
      published_at: '2018-11-06T00:00:00Z',
      extra: 'data',
    },
  ];
}
/**
 * Bulk-load `getBooksData()` into `index` (ids are the books' `id`) and
 * refresh. Throws if any row fails. Most tests should prefer
 * `kit.makeIndex(getBooksCreateRequest('books'), getBooksData())`.
 */
export async function insertBooksData(
  index: string,
  client: Client = getTestClient(),
) {
  const operations: object[] = [];
  for (const doc of getBooksData()) {
    operations.push({ index: { _index: index, _id: doc.id } });
    operations.push(doc);
  }
  const res = await client.bulk({ operations, refresh: true });
  if (res.errors) {
    const reasons = res.items
      .map((item) => Object.values(item)[0]?.error?.reason)
      .filter(Boolean);
    throw new Error(`insertBooksData failed: ${reasons.join('; ')}`);
  }
}
