/**
 * Given index info, get the index name
 * @param {Object}
 * @property {String} prefix  The app prefix such as bw
 * @property {String} index  The index base name
 * @property {Number} version  The version number for this index
 * @property {String} language  The indexing language
 * @returns {string}
 */
function build({ prefix, language, index, version }) {
  return `${prefix}-${language}-${index}-v${version}`;
}

/**
 * Given index info, get the alias name (i.e. build() without the version number)
 * @param {Object}
 * @property {String} prefix  The app prefix such as bw
 * @property {String} index  The index base name
 * @property {String} language  The indexing language
 * @returns {string}
 */
function alias({ prefix, language, index }) {
  return `${prefix}-${language}-${index}`;
}

/**
 * Given an index name, split into parts
 * @param {String} name  A name such as bw-englishplus-login_history-v1
 * @returns {{prefix: String, language: String, index: String, version: Number}}
 */
function parse(name) {
  const [prefix, language, index, versionString] = name.split('-');
  const version = parseInt(versionString.slice(1)); // remove leading v
  return { prefix, language, index, version };
}

const indexName = { build, alias, parse };

module.exports = indexName;