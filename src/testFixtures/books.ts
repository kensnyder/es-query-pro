import type { estypes } from '@elastic/elasticsearch';
import getEsClient from '../getEsClient/getEsClient';
import type { SchemaShape } from '../types';

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
      price: { type: 'integer' },
      published_at: { type: 'date' },
    },
  };
}
export function getBooksSchema(): SchemaShape {
  return {
    id: 'integer',
    title: 'text',
    premise: 'text',
    country: 'keyword',
    categories: {
      id: 'integer',
      name: 'text',
    },
    author: 'keyword',
    publishing: {
      author: 'keyword',
      series: 'text',
      organization: 'text',
      year: 'integer',
      movieYear: 'integer',
    },
    heroes: 'keyword',
    price: 'integer',
  };
}
export function getBooksData(): any {
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
export function createBooksIndex(index: string) {
  const client = getEsClient();
  return client.indices.create({
    index,
    mappings: getBooksMappings(),
  });
}
export async function insertBooksData(index: string) {
  const client = getEsClient();
  const operations = [];

  for (const doc of getBooksData()) {
    operations.push({ index: { _index: index, _id: doc.id } });
    operations.push(doc);
  }

  await client.bulk({
    body: operations,
    refresh: 'wait_for',
  });
}
export async function deleteBooksIndex(index: string) {
  const client = getEsClient();
  try {
    await client.indices.delete({ index });
  } catch (_error) {
    // Ignore if index doesn't exist
  }
}
