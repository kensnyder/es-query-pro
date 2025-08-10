/**
 * Given index info, get the index name
 * @param spec
 * @property prefix  The app prefix such as bw
 * @property index  The index base name
 * @property version  The version number for this index
 * @property language  The indexing language
 */
function build({
 prefix,
 language,
 index,
 version
}: {
  prefix: string;
  language: string;
  index: string;
  version: number | string;
}) {
  return `${prefix}-${language}-${index}-v${version}`;
}

/**
 * Given index info, get the alias name (i.e. build() without the version number)
 * @param spec
 * @property prefix  The app prefix such as bw
 * @property index  The index base name
 * @property language  The indexing language
 */
function alias({
 prefix,
 language,
 index
}: {
  prefix: string;
  language: string;
  index: string;
}) {
  return `${prefix}-${language}-${index}`;
}

/**
 * Given an index name, split into parts
 * @param {String} name  A name such as prod-englishplus-loginHistory-v1
 * @returns {{prefix: String, language: String, index: String, version: Number}}
 */
function parse(name: string) {
  const [prefix, language, index, versionString] = name.split('-');
  const version = parseInt(versionString.slice(1)); // remove leading v
  return { prefix, language, index, version };
}

const indexName = { build, alias, parse };

export default indexName;
