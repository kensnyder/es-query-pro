const QueryBuilder = require('./QueryBuilder.js');

describe('QueryBuilder', () => {
	it('should be a function', () => {
		expect(QueryBuilder).toBeInstanceOf(Function);
	});
	it('should start empty', () => {
		const query = new QueryBuilder();
		expect(query.getQuery()).toEqual({
			_source: ['*'],
		});
	});
	it('should build fields', () => {
		const query = new QueryBuilder();
		query.fields(['title', 'body']);
		expect(query.getQuery()).toEqual({
			_source: ['title', 'body'],
		});
	});
	it('should fulltext match single value', () => {
		const query = new QueryBuilder();
		query.match('headline', 'News');
		expect(query.getBody().query).toEqual({
			bool: {
				must: [
					{
						match: {
							headline: 'News',
						},
					},
				],
			},
		});
	});
	it('should fulltext match array of values with OR', () => {
		const query = new QueryBuilder();
		query.match('headline', ['Tech', 'Sports']);
		expect(query.getBody().query).toEqual({
			bool: {
				must: [
					{
						bool: {
							should: [
								{
									match: {
										headline: 'Tech',
									},
								},
								{
									match: {
										headline: 'Sports',
									},
								},
							],
						},
					},
				],
			},
		});
	});
	it('should fulltext match array of values with AND', () => {
		const query = new QueryBuilder();
		query.match('headline', ['Tech', 'Sports'], 'ALL');
		expect(query.getBody().query).toEqual({
			bool: {
				must: [
					{
						match: {
							headline: 'Tech',
						},
					},
					{
						match: {
							headline: 'Sports',
						},
					},
				],
			},
		});
	});
	it('should fulltext match single phrase', () => {
		const query = new QueryBuilder();
		query.matchPhrase('headline', 'Sports medicine');
		expect(query.getBody().query).toEqual({
			bool: {
				must: [
					{
						match_phrase: {
							headline: 'Sports medicine',
						},
					},
				],
			},
		});
	});
	it('should fulltext match array of phrases', () => {
		const query = new QueryBuilder();
		query.matchPhrase('headline', [
			'Sports medicine',
			'technology breakthrough',
		]);
		expect(query.getBody().query).toEqual({
			bool: {
				must: [
					{
						bool: {
							should: [
								{
									match_phrase: {
										headline: 'Sports medicine',
									},
								},
								{
									match_phrase: {
										headline: 'technology breakthrough',
									},
								},
							],
						},
					},
				],
			},
		});
	});
	it('should fulltext match single phrasePrefix against single field', () => {
		const query = new QueryBuilder();
		query.matchPhrasePrefix('headline', 'ElasticSearch query');
		expect(query.getBody().query).toEqual({
			bool: {
				must: [
					{
						match_phrase_prefix: {
							headline: 'ElasticSearch query',
						},
					},
				],
			},
		});
	});
	it('should fulltext match single phrasePrefix against multiple fields', () => {
		const query = new QueryBuilder();
		query.matchPhrasePrefix(['headline', 'body'], 'ElasticSearch query');
		expect(query.getBody().query).toEqual({
			bool: {
				must: [
					{
						multi_match: {
							fields: ['headline', 'body'],
							type: 'phrase_prefix',
							query: 'ElasticSearch query',
						},
					},
				],
			},
		});
	});
	it('should fulltext match multiple phrasePrefix against multiple fields', () => {
		const query = new QueryBuilder();
		query.matchPhrasePrefix(
			['headline', 'body'],
			['ElasticSearch query', 'ElasticSearch tool']
		);
		expect(query.getBody().query).toEqual({
			bool: {
				must: [
					{
						bool: {
							should: [
								{
									multi_match: {
										fields: ['headline', 'body'],
										type: 'phrase_prefix',
										query: 'ElasticSearch query',
									},
								},
								{
									multi_match: {
										fields: ['headline', 'body'],
										type: 'phrase_prefix',
										query: 'ElasticSearch tool',
									},
								},
							],
						},
					},
				],
			},
		});
	});
	it('should fulltext match multiple phrasePrefix against single field', () => {
		const query = new QueryBuilder();
		query.matchPhrasePrefix('headline', [
			'ElasticSearch query',
			'ElasticSearch tool',
		]);
		expect(query.getBody().query).toEqual({
			bool: {
				must: [
					{
						bool: {
							should: [
								{
									match_phrase_prefix: {
										headline: 'ElasticSearch query',
									},
								},
								{
									match_phrase_prefix: {
										headline: 'ElasticSearch tool',
									},
								},
							],
						},
					},
				],
			},
		});
	});
	it('should fulltext match single boostedPhrase against single field', () => {
		const query = new QueryBuilder();
		query.matchBoostedPhrase('body', 'Sports medicine doctor', {
			expand: true,
			boosts: [2, 4, 7],
		});
		expect(query.getBody().query).toEqual({
			bool: {
				must: [
					{
						bool: {
							should: [
								{
									multi_match: {
										fields: ['body'],
										operator: 'or',
										query: 'Sports medicine doctor',
										boost: 2,
									},
								},
								{
									multi_match: {
										fields: ['body'],
										operator: 'and',
										query: 'Sports medicine doctor',
										boost: 4,
									},
								},
								{
									multi_match: {
										fields: ['body'],
										type: 'phrase',
										query: 'Sports medicine doctor',
										boost: 7,
									},
								},
							],
						},
					},
				],
			},
		});
	});
	it('should fulltext match single boostedPhrase against multiple fields', () => {
		const query = new QueryBuilder();
		query.matchBoostedPhrase(['headline', 'body'], 'Sports medicine doctor', {
			expand: false,
		});
		expect(query.getBody().query).toEqual({
			bool: {
				must: [
					{
						bool: {
							should: [
								{
									multi_match: {
										fields: ['headline', 'body'],
										operator: 'and',
										query: 'Sports medicine doctor',
										boost: 3,
									},
								},
								{
									multi_match: {
										fields: ['headline', 'body'],
										type: 'phrase',
										query: 'Sports medicine doctor',
										boost: 5,
									},
								},
							],
						},
					},
				],
			},
		});
	});
	it('should fulltext multi match with phrase using OR', () => {
		const query = new QueryBuilder();
		query.multiTerm(['category', 'tag'], 'Sports');
		expect(query.getBody().query).toEqual({
			bool: {
				must: [
					{
						bool: {
							should: [
								{
									term: {
										category: 'Sports',
									},
								},
								{
									term: {
										tag: 'Sports',
									},
								},
							],
						},
					},
				],
			},
		});
	});
	it('should fulltext multi match with phrase using AND', () => {
		const query = new QueryBuilder();
		query.multiMatch(['category', 'tag'], 'Sports', 'ALL');
		expect(query.getBody().query).toEqual({
			bool: {
				must: [
					{
						multi_match: {
							fields: ['category', 'tag'],
							query: 'Sports',
						},
					},
				],
			},
		});
	});
	it('should fulltext NOT match single value', () => {
		const query = new QueryBuilder();
		query.notMatch('headline', 'News');
		expect(query.getBody().query).toEqual({
			bool: {
				must_not: [
					{
						match: {
							headline: 'News',
						},
					},
				],
			},
		});
	});
	it('should fulltext NOT multi match with phrase using AND', () => {
		const query = new QueryBuilder();
		query.notMultiMatch(['category', 'tag'], 'Sports', 'ALL');
		expect(query.getBody().query).toEqual({
			bool: {
				must_not: [
					{
						multi_match: {
							fields: ['category', 'tag'],
							query: 'Sports',
						},
					},
				],
			},
		});
	});
	it('should exact match single value', () => {
		const query = new QueryBuilder();
		query.term('tag', 'News');
		expect(query.getBody().query).toEqual({
			bool: {
				must: [
					{
						term: {
							tag: 'News',
						},
					},
				],
			},
		});
	});
	it('should exact match multiple values ANY', () => {
		const query = new QueryBuilder();
		query.term('tag', ['News', 'Entertainment']);
		expect(query.getBody().query).toEqual({
			bool: {
				must: [
					{
						terms: {
							tag: ['News', 'Entertainment'],
						},
					},
				],
			},
		});
	});
	it('should exact match multiple values ALL', () => {
		const query = new QueryBuilder();
		query.term('tag', ['News', 'Entertainment'], 'ALL');
		expect(query.getBody().query).toEqual({
			bool: {
				must: [
					{
						term: {
							tag: 'News',
						},
					},
					{
						term: {
							tag: 'Entertainment',
						},
					},
				],
			},
		});
	});
});
