export type IndexNameAttributes = {
  name: IndexName;
  separator?: string;
  version?: number | string;
  prefix?: string;
  language?: string;
};

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
   * Define the index with the given configuration
   * @param name
   * @param separator
   * @param version
   * @param prefix
   * @param language
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
    if (!this.isValidIndexName(name)) {
      throw new Error(
        `Index name is too short, too long, or contains invalid characters: "${name}"`
      );
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
   * Check if an index name has any invalid characters or is too long
   * @see https://discuss.elastic.co/t/index-name-type-name-and-field-name-rules/133039/2
   * @param name
   */
  isValidIndexName(name: string) {
    return (
      typeof name === 'string' &&
      name.length >= 1 &&
      name.length <= 255 &&
      !name.includes(this.separator) &&
      /^[a-z][a-z0-9_]+$/.test(name)
    );
  }

  /**
   * Check if a column name has any invalid characters or is too long
   * @see https://discuss.elastic.co/t/index-name-type-name-and-field-name-rules/133039/2
   * @param name
   */
  isValidColumnName(name: string) {
    return (
      typeof name === 'string' &&
      name.length >= 1 &&
      name.length <= 255 &&
      !name.includes(this.separator) &&
      /^[a-z][a-z0-9_-]+$/i.test(name)
    );
  }

  static parseByName(fullName: string, separator?: string) {
    const parts = fullName.split(separator);
    return new IndexNameManager({
      separator,
      prefix: parts.length === 4 ? parts[0] : '',
      language: parts[parts.length - 3],
      name: parts[parts.length - 2] as IndexName,
      version: parts[parts.length - 1].replace(/^v/, ''),
    });
  }
}

type LowercaseLetter =
  | 'a'
  | 'b'
  | 'c'
  | 'd'
  | 'e'
  | 'f'
  | 'g'
  | 'h'
  | 'i'
  | 'j'
  | 'k'
  | 'l'
  | 'm'
  | 'n'
  | 'o'
  | 'p'
  | 'q'
  | 'r'
  | 's'
  | 't'
  | 'u'
  | 'v'
  | 'w'
  | 'x'
  | 'y'
  | 'z';

type UppercaseLetter = Uppercase<LowercaseLetter>;

// Matches only: a–z, A–Z, 0–9, underscore (_), dash (-)
type AllowedColumnChars = LowercaseLetter | UppercaseLetter | Digit | '_' | '-';

// Matches only: a–z, 0–9, underscore (_), dash (-)
type AllowedIndexChars = LowercaseLetter | Digit | '_' | '-';

type Digit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';

export type IndexName = `${AllowedIndexChars}${string}`;
export type ColumnName = `${AllowedColumnChars}${string}`;
