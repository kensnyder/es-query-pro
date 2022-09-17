const isEmptyObject = require('./isEmptyObject.js');

describe('isEmptyObject', () => {
	it('should be a function', () => {
		expect(isEmptyObject).toBeInstanceOf(Function);
	});

	it('should reject falsy objects', () => {
		expect(isEmptyObject(false)).toBe(false);
	});

	it('should identify empty literals', () => {
		expect(isEmptyObject({})).toBe(true);
	});

	it('should identify non-empty literals', () => {
		expect(isEmptyObject({ a: 1 })).toBe(false);
	});

	it('should identify instances of empty functions', () => {
		const f = function () {};
		expect(isEmptyObject(new f())).toBe(true);
	});
});
