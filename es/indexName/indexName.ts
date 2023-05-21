/**
 * Given index info, get the index name
 * @param {Object}
 * @property {String} prefix  The app prefix such as bw
 * @property {String} index  The index base name
 * @property {Number} version  The version number for this index
 * @property {String} language  The indexing language
 * @returns {string}
 */
function build({
 prefix,
 language,
 index,
 version
}: any) {
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
function alias({
 prefix,
 language,
 index
}: any) {
  return `${prefix}-${language}-${index}`;
}

/**
 * Given an index name, split into parts
 * @param {String} name  A name such as bw-englishplus-login_history-v1
 * @returns {{prefix: String, language: String, index: String, version: Number}}
 */
function parse(name: any) {
  const [prefix, language, index, versionString] = name.split('-');
  const version = parseInt(versionString.slice(1)); // remove leading v
  return { prefix, language, index, version };
}

// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'indexName'... Remove this comment to see the full error message
const indexName = { build, alias, parse };

// @ts-expect-error TS(2580): Cannot find name 'module'. Do you need to install ... Remove this comment to see the full error message
module.exports = indexName;
