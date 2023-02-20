import isEmptyObject from '../isEmptyObject/isEmptyObject';
import TextProcessor from '../TextProcessor/TextProcessor';

class BulkAction {
	setIndex(name) {
		this._index = name;
		return this;
	}
	setClient(client) {
		this._client = client;
		return this;
	}
	setField(name) {
		this._field = name;
		return this;
	}
	addCriteria() {}
	setPainless() {}
	insert(docs) {}
	update(set, criteria) {
		if (!this._client) {
			throw new Error(
				'QueryBuilder.update() requires setClient(client) be called first'
			);
		}
		if (!this._index) {
			throw new Error(
				'QueryBuilder.update() requires setIndex(name) be called first'
			);
		}
	}
	delete(docId) {}
	insertTag(tagName) {}
	renameTag(oldName, newName) {}
	deleteTag(tagName) {}
}

async function updateRecord(index, id, data) {
	fulltext.processRecord(data);
	dates.processRecord(data);
	const { result, error } = await withEsClient(client => {
		return client.update({ index, id, body: { doc: data } });
	});
	return {
		result: result?.statusCode === 200,
		error,
		details: result || error?.meta,
	};
}
