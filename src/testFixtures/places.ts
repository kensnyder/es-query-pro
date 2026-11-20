import type { estypes } from '@elastic/elasticsearch';

/** One document of the places fixture (`getPlacesData()`). */
export type PlaceRecord = {
  id: string;
  name: string;
  category: string;
  description: string;
  /** `{ lat, lon }`; each place is in its own geotile at precision 4 */
  location: { lat: number; lon: number };
  /** 3 dims, cosine; near one axis per category (see `getPlacesData()`) */
  embedding: number[];
  rating: number;
  visited_at: string;
  reviews: { author: string; stars: number; comment: string }[];
};

/** Dimensions of the places `embedding` field */
export const PLACES_VECTOR_DIMS = 3;

/**
 * Creation request for the places fixture: a `geo_point` (`location`), a
 * `dense_vector` (`embedding`, 3 dims, cosine, indexed for knn) and a
 * `nested` array (`reviews`), plus `name` (text with keyword `name.raw`),
 * `category` (keyword), `description` (text), `rating` (float) and
 * `visited_at` (date).
 */
export function getPlacesCreateRequest(
  index: string,
): estypes.IndicesCreateRequest {
  return {
    index,
    mappings: {
      properties: {
        id: { type: 'keyword' },
        name: {
          type: 'text',
          fields: { raw: { type: 'keyword' } },
        },
        category: { type: 'keyword' },
        description: { type: 'text', analyzer: 'english' },
        location: { type: 'geo_point' },
        embedding: {
          type: 'dense_vector',
          dims: PLACES_VECTOR_DIMS,
          index: true,
          similarity: 'cosine',
        },
        rating: { type: 'float' },
        visited_at: { type: 'date' },
        reviews: {
          type: 'nested',
          properties: {
            author: { type: 'keyword' },
            stars: { type: 'integer' },
            comment: { type: 'text', analyzer: 'english' },
          },
        },
      },
    },
  };
}

/**
 * Six places. Embeddings point near x for museums ('1', '2'), near y for
 * parks ('3', '4') and near z for markets ('5', '6'), so a knn query for
 * `[1, 0, 0]` ranks '1' then '2' first. Reviews: '1' has a 5-star review by
 * 'ana' and a 2-star by 'bo'; '3' has a 5-star by 'bo'; others have one
 * 3- or 4-star review; '6' has none.
 */
export function getPlacesData(): PlaceRecord[] {
  return [
    {
      id: '1',
      name: 'Louvre Museum',
      category: 'museum',
      description: 'A vast art museum with paintings and ancient sculpture',
      location: { lat: 48.8606, lon: 2.3376 },
      embedding: [0.99, 0.1, 0.05],
      rating: 4.8,
      visited_at: '2024-05-02T10:00:00Z',
      reviews: [
        { author: 'ana', stars: 5, comment: 'Wonderful paintings' },
        { author: 'bo', stars: 2, comment: 'Too crowded to enjoy' },
      ],
    },
    {
      id: '2',
      name: 'British Museum',
      category: 'museum',
      description: 'A museum of human history, art and culture',
      location: { lat: 51.5194, lon: -0.127 },
      embedding: [0.9, 0.3, 0.1],
      rating: 4.7,
      visited_at: '2024-06-15T14:30:00Z',
      reviews: [{ author: 'cy', stars: 4, comment: 'Great ancient history' }],
    },
    {
      id: '3',
      name: 'Central Park',
      category: 'park',
      description: 'A large urban park with lakes, meadows and walking paths',
      location: { lat: 40.7829, lon: -73.9654 },
      embedding: [0.1, 0.99, 0.05],
      rating: 4.9,
      visited_at: '2023-09-10T09:00:00Z',
      reviews: [{ author: 'bo', stars: 5, comment: 'Lovely walking paths' }],
    },
    {
      id: '4',
      name: 'Ueno Park',
      category: 'park',
      description: 'A public park with museums, a zoo and cherry blossoms',
      location: { lat: 35.7156, lon: 139.7745 },
      embedding: [0.3, 0.9, 0.1],
      rating: 4.4,
      visited_at: '2025-03-28T08:15:00Z',
      reviews: [{ author: 'ana', stars: 4, comment: 'Cherry blossoms' }],
    },
    {
      id: '5',
      name: 'Queen Victoria Market',
      category: 'market',
      description: 'An open air market selling fresh food and clothing',
      location: { lat: -37.8076, lon: 144.9568 },
      embedding: [0.05, 0.1, 0.99],
      rating: 4.3,
      visited_at: '2022-12-01T11:00:00Z',
      reviews: [{ author: 'cy', stars: 3, comment: 'Busy but fresh food' }],
    },
    {
      id: '6',
      name: 'Mercado de San Miguel',
      category: 'market',
      description: 'A covered food market with tapas and wine',
      location: { lat: 40.4153, lon: -3.709 },
      embedding: [0.1, 0.3, 0.9],
      rating: 4.5,
      visited_at: '2025-07-20T19:45:00Z',
      reviews: [],
    },
  ];
}
