import TextProcessor from './TextProcessor.ts';

describe('TextProcessor', () => {
	it('should be a function', () => {
		expect(TextProcessor).toBeInstanceOf(Function);
	});
	it('should process text', () => {
		const proc = new TextProcessor();
		proc.registerPattern(
			{ find: /([a-z])&([a-z0-9])/gi, replace: '$1ε$2' },
			{ find: /([a-z])ε([a-z0-9])/gi, replace: '$1&$2' }
		);
		proc.registerPattern(
			{ find: /\b(Conning)\b/g, replace: '$1ω' },
			{ find: /ω/g, replace: '' }
		);
		expect(proc.processText('AT&T Conning')).toBe('ATεT Conningω');
		expect(proc.unProcessText('ATεT Conningω')).toBe('AT&T Conning');
		// arrays
		expect(proc.processText(['AT&T', 'Conning'])).toEqual(['ATεT', 'Conningω']);
		expect(proc.unProcessText(['ATεT', 'Conningω'])).toEqual([
			'AT&T',
			'Conning',
		]);
	});
	it('should join and split text', () => {
		const proc = new TextProcessor();
		proc.setArrayJoiner('Ξ');
		expect(proc.join(['foo', 'bar'])).toBe('foo Ξ bar');
		expect(proc.split('foo Ξ bar')).toEqual(['foo', 'bar']);
	});
	it('should process records', () => {
		const proc = new TextProcessor();
		proc.registerPattern(
			{ find: /([a-z])&([a-z0-9])/gi, replace: '$1ε$2' },
			{ find: /([a-z])ε([a-z0-9])/gi, replace: '$1&$2' }
		);
		proc.registerField(/^fulltext_/);
		proc.registerField('brand');
		const records = [
			{
				brand: 'AT&T',
				fulltext_body: 'AT&T launches new ad',
				type: 'AT&T Press Release',
			},
		];
		const expectedProcRecords = [
			{
				brand: 'ATεT',
				fulltext_body: 'ATεT launches new ad',
				type: 'AT&T Press Release',
			},
		];
		const actualProcRecords = proc.processRecords(records);
		expect(actualProcRecords).toEqual(expectedProcRecords);
		const unProcRecords = proc.unProcessRecords(actualProcRecords);
		expect(unProcRecords).toEqual(records);
	});
});
