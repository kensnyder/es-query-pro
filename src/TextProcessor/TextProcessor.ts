export default class TextProcessor {
	/**
	 * Find-and-replace pairs converting from English to Elasticsearch
	 */
	#processors : Array<{
		find: RegExp | string;
		replace: string;
	}> = [];

	/**
	 * Find-and-replace pairs converting from Elasticsearch to English
	 */
	#unProcessors : Array<{
		find: RegExp | string;
		replace: string;
	}> = [];

	/**
	 * The character used to join arrays of text (defaults to ᛞ)
	 */
	#arrayJoiner : string = 'ᛞ';

	/**
	 * The fields that need processing
	 */
	#fields : Array<string | RegExp> = [];

	/**
	 * Set the character used to join arrays of text (e.g. ᛞ)
	 * @param char
	 */
	setArrayJoiner(char) {
		this.#arrayJoiner = char;
		return this;
	}

	/**
	 * Register find-and-replace pairs to process and unprocess text
	 * @param processor  Convert from English to Elasticsearch
	 * @param unProcessor  Convert from Elasticsearch to English
	 */
	registerPattern(processor, unProcessor) {
		this.#processors.push(processor);
		this.#unProcessors.push(unProcessor);
		return this;
	}

	/**
	 * Register a field to process (e.g. /^fulltext_/)
	 * @param nameOrRegExp
	 */
	registerField(nameOrRegExp) {
		this.#fields.push(nameOrRegExp);
		return this;
	}

	/**
	 * Run the given text through all processors
	 * @param text
	 */
	processText(text) {
		if (Array.isArray(text)) {
			return text.map(t => this.processText(t));
		}
		for (const { find, replace } of this.#processors) {
			text = text.replace(find, replace);
		}
		return text;
	}

	/**
	 * Run the given text through all un-processors
	 * @param text
	 */
	unProcessText(text) {
		if (Array.isArray(text)) {
			return text.map(t => this.unProcessText(t));
		}
		for (const { find, replace } of this.#unProcessors) {
			text = text.replace(find, replace);
		}
		return text;
	}

	/**
	 * Join an array of text with the array joiner
	 * @param texts
	 */
	join(texts) {
		return texts.join(` ${this.#arrayJoiner} `);
	}

	/**
	 * Split text into an array using the array joiner
	 * @param text
	 */
	split(text) {
		return text.split(` ${this.#arrayJoiner} `);
	}

	/**
	 * Check if a field should be processed
	 * @param fieldName
	 */
	shouldProcessField(fieldName) {
		for (const field of this.#fields) {
			if (field instanceof RegExp) {
				if (field.test(fieldName)) {
					return true;
				}
			} else {
				if (field === fieldName) {
					return true;
				}
			}
		}
		return false;
	}

	/**
	 * Process a single record before inserting into Elasticsearch
	 * @param record
	 */
	processRecord = record => {
		const newRec = {};
		for (const [field, value] of Object.entries(record)) {
			newRec[field] = this.shouldProcessField(field)
				? this.processText(value)
				: value;
		}
		return newRec;
	};

	/**
	 * Process a single record after fetching from Elasticsearch
	 * @param record
	 */
	unProcessRecord = record => {
		const newRec = {};
		for (const [field, value] of Object.entries(record)) {
			newRec[field] = this.shouldProcessField(field)
				? this.unProcessText(value)
				: value;
		}
		return newRec;
	};

	/**
	 * Process an array of records before inserting into Elasticsearch
	 * @param records
	 */
	processRecords(records) {
		return records.map(this.processRecord);
	}

	/**
	 * Process an array of records after fetching from Elasticsearch
	 * @param records
	 */
	unProcessRecords(records) {
		return records.map(this.unProcessRecord);
	}
}
