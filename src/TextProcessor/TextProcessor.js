class TextProcessor {
	constructor() {
		this._processors = [];
		this._unProcessors = [];
		this._arrayJoiner = null;
		this._fields = [];
	}
	setArrayJoiner(char) {}
	registerPattern(processor, unProcessor) {
		this._processors.push(processor);
		this._unProcessors.push(unProcessor);
	}
	registerField(nameOrRegExp) {}
	processText(text) {
		for (const { find, replace } of this._processors) {
			text = text.replace(find, replace);
		}
		return text;
	}
	unProcessText(text) {
		for (const { find, replace } of this._unProcessors) {
			text = text.replace(find, replace);
		}
		return text;
	}
	processArray(texts) {}
	unProcessArray(texts) {}
	processRecord(record) {}
	unProcessRecord(record) {}
}

const textProcessor = new TextProcessor();
textProcessor.setArrayJoiner('ψ');
textProcessor.registerPattern(
	{ find: /([a-z])&([a-z0-9])/gi, replace: '$1ε$2' },
	{ find: /([a-z])ε([a-z0-9])/gi, replace: '$1&$2' }
);
textProcessor.registerPattern(
	{ find: /\b(Conning)\b/g, replace: '$1ᛤ' },
	{ find: /ᛤ/g, replace: '' }
);
textProcessor.registerField(/^fulltext_/);
QueryBuilder.registerProcessor(textProcessor);

// Apply an array of find/replace values to all records before saving
const _processors = [
	// regular ampersand for Greek lowercase epsilon
	// allows searching for AT&T
	[/([a-z])&([a-z0-9])/gi, '$1ε$2'],
];

// Apply the reverse find and replace operations to all records after fetching
const _unProcessors = [
	// turn Greek lowercase epsilon back into regular ampersand
	[/([a-z])ε([a-z0-9])/gi, '$1&$2'],
];

/**
 * Process text for a record before saving
 * @param {String} text  The text going into the database
 * @returns {String}
 */
function processText(text) {
	for (const [find, replace] of _processors) {
		text = text.replace(find, replace);
	}
	return text;
}

/**
 * Process all content_* fields with the processText() function
 * @param {Object} record  A record with field-value pairs
 */
function processRecord(record) {
	for (const field of Object.keys(record)) {
		if (/^content_/.test(field) && typeof record[field] === 'string') {
			record[field] = processText(record[field]);
		}
	}
}

/**
 * Reverse text processing from text coming from a saved record
 * @param {String} text  The text coming from the database
 * @returns {String}
 */
function unProcessText(text) {
	for (const [find, replace] of _unProcessors) {
		text = text.replace(find, replace);
	}
	return text;
}

/**
 * Process all content_* fields with the unProcessText() function
 * @param {Object} record  A record with field-value pairs
 */
function unProcessRecord(record) {
	for (const field of Object.keys(record)) {
		if (/^content_/.test(field) && typeof record[field] === 'string') {
			record[field] = unProcessText(record[field]);
		}
	}
}

// use Greek lowercase phi to join an array of keywords to a fulltext field
// That way a list like "Spectrum ψ Mobile" will not match "spectrum mobile"
const _joinString = ' ψ ';

/**
 * Join an array of items for use in a full text field
 * For example: you may have a keyword field that is an array of tags:
 * {
 *   tags: ['foo', 'bar', 'baz'],
 *   content_tags: 'foo ψ bar ψ baz',
 * }
 * @param {Array} array  The items
 * @returns {String}
 */
function joinArray(array) {
	if (Array.isArray(array)) {
		return array.join(_joinString);
	}
	return '';
}

/**
 * Reverse the joining described above for a full text field
 * @param {String} string  The string to split
 * @returns {Array}
 */
function splitToArray(string) {
	if (typeof string === 'string') {
		return string.split(_joinString);
	}
	return [];
}

const fulltext = {
	processText,
	processRecord,
	unProcessText,
	unProcessRecord,
	joinArray,
	splitToArray,
};

module.exports = fulltext;
