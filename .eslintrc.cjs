/** @type {import('@types/eslint').Linter.BaseConfig} */
module.exports = {
	extends: [
		require('prettier'),
	],
	env: {
		node: true,
	}
};