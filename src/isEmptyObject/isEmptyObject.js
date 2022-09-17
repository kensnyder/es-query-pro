function isEmptyObject(obj) {
	if (!obj) {
		// not an object
		return false;
	}
	for (const prop in obj) {
		if (Object.prototype.hasOwnProperty.call(obj, prop)) {
			// not empty
			return false;
		}
	}
	return true;
}

module.exports = isEmptyObject;
