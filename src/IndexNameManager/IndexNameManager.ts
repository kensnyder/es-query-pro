export type IndexName = string;

export type IndexNameAttributes = {
  name: IndexName;
  separator?: string;
  version?: number | string;
  prefix?: string;
  language?: string;
};

/**
 * How one parsed index name relates to another (see
 * `IndexNameManager.compare()`):
 * - `same`: same prefix, language, name, separator and version
 * - `older` / `newer`: same prefix, language, name and separator; the
 *   version is a lower / higher non-negative integer
 * - `unrelated`: the prefix, language, name or separator differs
 * - `incomparable`: same prefix, language, name and separator, but the
 *   versions differ and at least one is not a plain non-negative integer
 *   (e.g. `2024a` or `03`), so they have no order
 */
export type IndexNameRelation =
  | 'same'
  | 'older'
  | 'newer'
  | 'unrelated'
  | 'incomparable';

/** Elasticsearch's limit on index and alias names, in UTF-8 bytes */
const MAX_NAME_BYTES = 255;

/** Characters Elasticsearch does not allow in an index name */
const FORBIDDEN_CHARS = [...'\\/*?"<>|,#:'];

/** A version that orders numerically: `0` or digits without a leading 0 */
const NUMERIC_VERSION = /^(0|[1-9][0-9]*)$/;

/**
 * Explain which Elasticsearch index-name rule `name` breaks, or return null
 * when it breaks none. Stricter than Elasticsearch in two ways: whitespace
 * and control characters are rejected (ES lists only the space), and so is
 * a leading `.` (reserved for hidden and system indexes).
 */
function getEsNameProblem(name: string): string | null {
  if (typeof name !== 'string' || name.length === 0) {
    return 'must be a non-empty string';
  }
  if (name !== name.toLowerCase()) {
    return 'must be lowercase';
  }
  for (const char of FORBIDDEN_CHARS) {
    if (name.includes(char)) {
      return `must not contain "${char}"`;
    }
  }
  // whitespace and control characters (U+0000 to U+001F, U+007F)
  if (/[\s\p{Cc}]/u.test(name)) {
    return 'must not contain whitespace or control characters';
  }
  if (/^[-_+.]/.test(name)) {
    return 'must not start with "-", "_", "+" or "."';
  }
  if (new TextEncoder().encode(name).length > MAX_NAME_BYTES) {
    return `must be at most ${MAX_NAME_BYTES} bytes long`;
  }
  return null;
}

/**
 * Order two version strings that both match `NUMERIC_VERSION`, without
 * converting them to numbers (so it works beyond the safe integer range)
 */
function compareNumericVersions(a: string, b: string) {
  if (a.length !== b.length) {
    return a.length < b.length ? -1 : 1;
  }
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

export default class IndexNameManager {
  /**
   * The name of the index
   */
  name: IndexName;
  /**
   * The separator for prefix, analyzer, index, and version (default=~)
   */
  separator: string;
  /**
   * The version of the index (default=1)
   */
  version: number | string;
  /**
   * The prefix such as "prod" or "app1"
   */
  prefix: string;
  /**
   * The primary analyzer of the documents in this index
   */
  language: string;

  /**
   * Define the index with the given configuration. Every part is validated
   * so that `getFullName()` and `getAliasName()` are valid Elasticsearch
   * index names and `parseByName()` can split the full name again.
   * @param name  The logical index name: lowercase letters, digits, `_` and
   *   `-`, not starting with `_` or `-`
   * @param separator  Joins the parts (default `~`); non-empty, and every
   *   character must be allowed in an index name
   * @param version  A non-negative integer or a non-empty string (default 1)
   * @param prefix  First part, such as `prod` (default none)
   * @param language  Language part (default `english`); non-empty
   * @throws {RangeError} When a part is invalid, a part other than the
   *   separator contains the separator, or the full name is not a valid
   *   Elasticsearch index name (lowercase; none of `\ / * ? " < > | , # :`
   *   or whitespace; not starting with `- _ + .`; at most 255 bytes)
   */
  constructor({
    name,
    separator = '~',
    version = 1,
    prefix = '',
    language = 'english',
  }: IndexNameAttributes) {
    this.name = name;
    this.version = version;
    this.prefix = prefix;
    this.language = language;
    this.separator = separator;
    this._validate();
  }

  /**
   * Throw a `RangeError` describing the first invalid part
   */
  private _validate() {
    const { separator, prefix, language, version } = this;
    if (typeof separator !== 'string' || separator === '') {
      throw new RangeError(
        'IndexNameManager: separator must be a non-empty string',
      );
    }
    if (getEsNameProblem(`a${separator}`) !== null) {
      throw new RangeError(
        `IndexNameManager: separator "${separator}" is not allowed in an ` +
          `index name (${getEsNameProblem(`a${separator}`)})`,
      );
    }
    if (!this.isValidIndexName(this.name)) {
      throw new RangeError(
        'Index name is too short, too long, or contains invalid characters: ' +
          `"${this.name}"`,
      );
    }
    if (typeof prefix !== 'string') {
      throw new RangeError('IndexNameManager: prefix must be a string');
    }
    if (typeof language !== 'string' || language === '') {
      throw new RangeError(
        'IndexNameManager: language must be a non-empty string',
      );
    }
    if (typeof version === 'number') {
      if (!Number.isSafeInteger(version) || version < 0) {
        throw new RangeError(
          'IndexNameManager: a numeric version must be a non-negative ' +
            `integer; got ${version}`,
        );
      }
    } else if (typeof version !== 'string' || version === '') {
      throw new RangeError(
        'IndexNameManager: version must be a non-negative integer or a ' +
          'non-empty string',
      );
    }
    const parts: [string, string][] = [
      ['prefix', prefix],
      ['language', language],
      ['version', `v${version}`],
    ];
    for (const [label, value] of parts) {
      if (value.includes(separator)) {
        throw new RangeError(
          `IndexNameManager: ${label} "${value}" must not contain the ` +
            `separator "${separator}"`,
        );
      }
    }
    for (const fullName of [this.getFullName(), this.getAliasName()]) {
      const problem = getEsNameProblem(fullName);
      if (problem !== null) {
        throw new RangeError(
          `IndexNameManager: "${fullName}" is not a valid Elasticsearch ` +
            `index name: it ${problem}`,
        );
      }
    }
  }

  getFullName() {
    const parts = [this.prefix, this.language, this.name, `v${this.version}`];
    if (!this.prefix) {
      parts.shift();
    }
    return parts.join(this.separator);
  }

  getAliasName() {
    const parts = [this.prefix, this.language, this.name];
    if (!this.prefix) {
      parts.shift();
    }
    return parts.join(this.separator);
  }

  /**
   * Check the logical index name (the `name` part): 1 to 255 characters of
   * lowercase letters, digits, `_` and `-`, starting with a letter or digit,
   * and not containing this manager's separator
   * @see https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-indices-create
   * @param name
   */
  isValidIndexName(name: string) {
    return (
      typeof name === 'string' &&
      name.length >= 1 &&
      name.length <= MAX_NAME_BYTES &&
      !name.includes(this.separator) &&
      /^[a-z0-9][a-z0-9_-]*$/.test(name)
    );
  }

  /**
   * Whether `name` is a valid Elasticsearch index or alias name: non-empty,
   * lowercase, none of `\ / * ? " < > | , # :` or whitespace or control
   * characters, not starting with `- _ + .`, at most 255 UTF-8 bytes.
   * (A leading `.` and non-space whitespace are allowed by Elasticsearch but
   * rejected here.)
   * @param name  A complete index name
   */
  static isValidEsIndexName(name: string) {
    return getEsNameProblem(name) === null;
  }

  /**
   * Split a full index name (`[prefix~]language~name~v<version>`) back into
   * its parts. A version made only of digits (without a leading zero) comes
   * back as a number; any other version stays a string.
   * @param fullName  A name produced by `getFullName()`
   * @param separator  The separator it was built with (default `~`)
   * @throws {RangeError} When the name does not have 3 or 4 parts, the last
   *   part is not `v<version>`, or a part is invalid (see the constructor)
   */
  static parseByName(fullName: string, separator = '~') {
    if (typeof separator !== 'string' || separator === '') {
      throw new RangeError(
        'IndexNameManager.parseByName: separator must be a non-empty string',
      );
    }
    const parts = String(fullName).split(separator);
    if (parts.length !== 3 && parts.length !== 4) {
      throw new RangeError(
        `IndexNameManager.parseByName: "${fullName}" must have 3 or 4 parts ` +
          `separated by "${separator}"; found ${parts.length}`,
      );
    }
    const versionPart = parts[parts.length - 1];
    if (!versionPart.startsWith('v') || versionPart.length < 2) {
      throw new RangeError(
        `IndexNameManager.parseByName: "${fullName}" must end with a ` +
          `version such as "v1"; found "${versionPart}"`,
      );
    }
    const rawVersion = versionPart.slice(1);
    let version: number | string = rawVersion;
    if (
      NUMERIC_VERSION.test(rawVersion) &&
      Number.isSafeInteger(Number(rawVersion))
    ) {
      version = Number(rawVersion);
    }
    let prefix = '';
    if (parts.length === 4) {
      prefix = parts[0];
      if (prefix === '') {
        throw new RangeError(
          `IndexNameManager.parseByName: "${fullName}" has an empty prefix`,
        );
      }
    }
    return new IndexNameManager({
      separator,
      prefix,
      language: parts[parts.length - 3],
      name: parts[parts.length - 2],
      version,
    });
  }

  /**
   * Like `parseByName()`, but returns null instead of throwing, e.g. for an
   * index attached to an alias that was not created by an IndexManager
   * @param fullName  An index name
   * @param separator  The separator to split on (default `~`)
   */
  static tryParseByName(
    fullName: string,
    separator = '~',
  ): IndexNameManager | null {
    try {
      return IndexNameManager.parseByName(fullName, separator);
    } catch {
      return null;
    }
  }

  /**
   * Classify `other` relative to `base`: `older`, `newer`, `same`,
   * `unrelated` (prefix, language, name or separator differs) or
   * `incomparable` (versions differ and at least one is not a plain
   * non-negative integer). Versions compare numerically, so `v10` is newer
   * than `v9`, and version `3` equals version `'3'`.
   * @param base  The reference name, e.g. this IndexManager's `index`
   * @param other  The name to classify, e.g. a parsed sibling index
   * @example
   * const mine = new IndexNameManager({ name: 'books', version: 2 });
   * const sibling = IndexNameManager.tryParseByName('english~books~v1');
   * sibling && IndexNameManager.compare(mine, sibling); // 'older'
   */
  static compare(
    base: IndexNameManager,
    other: IndexNameManager,
  ): IndexNameRelation {
    if (
      base.separator !== other.separator ||
      base.prefix !== other.prefix ||
      base.language !== other.language ||
      base.name !== other.name
    ) {
      return 'unrelated';
    }
    const a = String(base.version);
    const b = String(other.version);
    if (a === b) {
      return 'same';
    }
    if (!NUMERIC_VERSION.test(a) || !NUMERIC_VERSION.test(b)) {
      return 'incomparable';
    }
    if (compareNumericVersions(b, a) < 0) {
      return 'older';
    }
    return 'newer';
  }
}
