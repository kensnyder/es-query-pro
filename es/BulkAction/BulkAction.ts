// @ts-expect-error TS(2307): Cannot find module '../isEmptyObject/isEmptyObject... Remove this comment to see the full error message
import isEmptyObject from '../isEmptyObject/isEmptyObject';
// @ts-expect-error TS(2307): Cannot find module '../TextProcessor/TextProcessor... Remove this comment to see the full error message
import TextProcessor from '../TextProcessor/TextProcessor';

class BulkAction {
// @ts-expect-error TS(7006): Parameter 'name' implicitly has an 'any' type.
	setIndex(name) {
// @ts-expect-error TS(2339): Property '_index' does not exist on type 'BulkActi... Remove this comment to see the full error message
		this._index = name;
		return this;
	}
// @ts-expect-error TS(7006): Parameter 'client' implicitly has an 'any' type.
	setClient(client) {
// @ts-expect-error TS(2339): Property '_client' does not exist on type 'BulkAct... Remove this comment to see the full error message
		this._client = client;
		return this;
	}
// @ts-expect-error TS(7006): Parameter 'name' implicitly has an 'any' type.
	setField(name) {
// @ts-expect-error TS(2339): Property '_field' does not exist on type 'BulkActi... Remove this comment to see the full error message
		this._field = name;
		return this;
	}
	addCriteria() {}
	setPainless() {}
// @ts-expect-error TS(7006): Parameter 'docs' implicitly has an 'any' type.
	insert(docs) {}
// @ts-expect-error TS(7006): Parameter 'set' implicitly has an 'any' type.
	update(set, criteria) {
// @ts-expect-error TS(2339): Property '_client' does not exist on type 'BulkAct... Remove this comment to see the full error message
		if (!this._client) {
			throw new Error(
				'QueryBuilder.update() requires setClient(client) be called first'
			);
		}
// @ts-expect-error TS(2339): Property '_index' does not exist on type 'BulkActi... Remove this comment to see the full error message
		if (!this._index) {
			throw new Error(
				'QueryBuilder.update() requires setIndex(name) be called first'
			);
		}
	}
// @ts-expect-error TS(7006): Parameter 'docId' implicitly has an 'any' type.
	delete(docId) {}
// @ts-expect-error TS(7006): Parameter 'tagName' implicitly has an 'any' type.
	insertTag(tagName) {}
// @ts-expect-error TS(7006): Parameter 'oldName' implicitly has an 'any' type.
	renameTag(oldName, newName) {}
// @ts-expect-error TS(7006): Parameter 'tagName' implicitly has an 'any' type.
	deleteTag(tagName) {}
}

// @ts-expect-error TS(7006): Parameter 'index' implicitly has an 'any' type.
async function updateRecord(index, id, data) {
	fulltext.processRecord(data);
	dates.processRecord(data);
// @ts-expect-error TS(7006): Parameter 'client' implicitly has an 'any' type.
	const { result, error } = await withEsClient(client => {
		return client.update({ index, id, body: { doc: data } });
	});
	return {
		result: result?.statusCode === 200,
		error,
		details: result || error?.meta,
	};
}
