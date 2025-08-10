import { SchemaShape } from '../types';

export type FindAndReplace = {
  find: RegExp | string;
  replace: string;
};

export default class TextProcessor<Path = string[]> {
  /**
   * Find-and-replace pairs converting from English to Elasticsearch
   */
  private processors: FindAndReplace[] = [];

  /**
   * Find-and-replace pairs converting from Elasticsearch to English
   */
  private unProcessors: FindAndReplace[] = [];

  /**
   * The fields that need processing
   */
  private paths: Path[][] = [];
  
  /**
   * The string used to join array elements when converting to text
   */
  private arrayJoiner = ' | ';

  /**
   * Set the string used to join array elements when converting to text
   * @param joiner The string to use as a joiner
   */
  setArrayJoiner(joiner: string) {
    this.arrayJoiner = joiner;
    return this;
  }

  /**
   * Join an array of strings using the configured joiner with spaces around it
   * @param arr The array to join
   */
  join(arr: string[]) {
    return arr.join(` ${this.arrayJoiner} `);
  }

  /**
   * Split a string into an array using the configured joiner
   * @param str The string to split
   */
  split(str: string) {
    return str.split(new RegExp(`\\s*${this.escapeRegExp(this.arrayJoiner)}\\s*`));
  }

  /**
   * Escape special characters in a string to be used in a regular expression
   * @param str The string to escape
   */
  private escapeRegExp(str: string) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Register paths based on a schema
   * @param schema
   * @param _segments
   */
  registerSchema(schema: SchemaShape, _segments: Path[] = []) {
    for (const [column, type] of Object.entries(schema)) {
      if (type === 'text') {
        this.paths.push([..._segments, column as unknown as Path]);
      } else if (typeof type === 'object') {
        this.registerSchema(type, [..._segments, column as unknown as Path]);
      }
    }
    return this;
  }

  /**
   * Register a field to process (e.g. "title" or "tags.value")
   * @param name Field name as string or regex pattern
   */
  registerField(name: string | RegExp) {
    if (name instanceof RegExp) {
      // For regex patterns, we'll handle them specially in the process methods
      this.paths.push([`${name}` as unknown as Path]);
    } else {
      this.paths.push(name.split('.') as unknown as Path[]);
    }
    return this;
  }

  /**
   * Register find-and-replace pairs to process and unprocess text
   * @param processor  Convert from English to Elasticsearch
   * @param unProcessor  Convert from Elasticsearch to English
   */
  registerPattern(processor: FindAndReplace, unProcessor: FindAndReplace) {
    this.processors.push(processor);
    this.unProcessors.push(unProcessor);
    return this;
  }

  /**
   * Run the given text through all processors
   * @param text
   */
  processText(text: string | string[]) {
    if (Array.isArray(text)) {
      return text.map(item => this.processText(item));
    }
    if (typeof text !== 'string') {
      return text;
    }
    for (const { find, replace } of this.processors) {
      text = text.replace(find, replace);
    }
    return text;
  }

  /**
   * Run the given text through all un-processors
   * @param text
   */
  unProcessText(text: string | string[]) {
    if (Array.isArray(text)) {
      return text.map(item => this.unProcessText(item));
    }
    if (typeof text !== 'string') {
      return text;
    }
    for (const { find, replace } of this.unProcessors) {
      text = text.replace(find, replace);
    }
    return text;
  }

  /**
   * Check if a field name matches a path pattern
   * @param field Field name to check
   * @param path Path pattern (string or regex string)
   */
  private fieldMatches(field: string, path: string): boolean {
    try {
      if (path.startsWith('/') && path.endsWith('/')) {
        // Handle regex pattern
        const regex = new RegExp(path.slice(1, -1));
        return regex.test(field);
      }
      return field === path;
    } catch (e) {
      // If there's an error in the regex, fall back to exact match
      return field === path;
    }
  }

  /**
   * Process a single record before inserting into Elasticsearch
   * @param record
   * @param _segments  Segments for recursive processing
   */
  prepareInsertion<T extends Record<string, any>>(
    record: T,
    _segments: Path[] = []
  ) {
    if (!record || typeof record !== 'object') {
      return record;
    }

    // Handle array of records
    if (Array.isArray(record)) {
      return record.map(item => this.prepareInsertion(item, _segments));
    }

    // If we have segments, we're processing a nested field
    if (_segments.length > 0) {
      const field = _segments[0] as unknown as keyof T;
      if (record[field] !== undefined && record[field] !== null) {
        if (Array.isArray(record[field])) {
          // Handle arrays of values or objects
          record[field] = (record[field] as any).map((item: any) => 
            typeof item === 'object' 
              ? this.prepareInsertion(item, _segments.slice(1))
              : _segments.length === 1 ? this.processText(item) : item
          ) as T[keyof T];
        } else if (typeof record[field] === 'object') {
          // Handle nested objects
          this.prepareInsertion(record[field], _segments.slice(1));
        } else if (_segments.length === 1) {
          // Process leaf value
          record[field] = this.processText(record[field]) as T[keyof T];
        }
      }
      return record;
    }

    // Top-level processing - handle all paths
    for (const path of this.paths) {
      const pathStr = path[0] as unknown as string;
      
      if (pathStr.startsWith('/') && pathStr.endsWith('/')) {
        // Handle regex patterns
        for (const [field, value] of Object.entries(record)) {
          if (this.fieldMatches(field, pathStr)) {
            record[field as keyof T] = this.processText(value) as T[keyof T];
          }
        }
      } else {
        // Handle exact path matches
        const field = path[0] as unknown as keyof T;
        if (record[field] !== undefined && record[field] !== null) {
          if (path.length === 1) {
            record[field] = this.processText(record[field]) as T[keyof T];
          } else {
            this.prepareInsertion(record[field], path.slice(1));
          }
        }
      }
    }
    
    return record;
  }

  /**
   * Process a single record after fetching from Elasticsearch
   * @param record
   * @param _segments  Segments for recursive processing
   */
  prepareResult<T extends Record<string, any>>(
    record: T,
    _segments: Path[] = []
  ) {
    for (const path of this.paths) {
      if (!record[path[0] as unknown as keyof T]) {
        // record does not have this field
        continue;
      }
      const field = path[0] as unknown as keyof T;
      if (path.length === 1) {
        record[field] = this.unProcessText(record[field]) as T[keyof T];
      } else {
        this.prepareResult(record[field], path.slice(1));
      }
    }
    return record;
  }

  /**
   * Process a single record after retrieving from Elasticsearch
   * @param record
   * @param _segments  Segments for recursive processing
   */
  prepareRetrieval<T extends Record<string, any>>(
    record: T,
    _segments: Path[] = []
  ): T {
    if (!record || typeof record !== 'object') {
      return record;
    }

    // Handle array of records
    if (Array.isArray(record)) {
      return record.map(item => this.prepareRetrieval(item, _segments)) as unknown as T;
    }

    // If we have segments, we're processing a nested field
    if (_segments.length > 0) {
      const field = _segments[0] as unknown as keyof T;
      if (record[field] !== undefined && record[field] !== null) {
        if (Array.isArray(record[field])) {
          // Handle arrays of values or objects
          record[field] = (record[field] as any).map((item: any) => 
            typeof item === 'object' 
              ? this.prepareRetrieval(item, _segments.slice(1))
              : _segments.length === 1 ? this.unProcessText(item) : item
          ) as T[keyof T];
        } else if (typeof record[field] === 'object') {
          // Handle nested objects
          this.prepareRetrieval(record[field], _segments.slice(1));
        } else if (_segments.length === 1) {
          // Process leaf value
          record[field] = this.unProcessText(record[field]) as T[keyof T];
        }
      }
      return record;
    }

    // Top-level processing - handle all paths
    for (const path of this.paths) {
      const pathStr = path[0] as unknown as string;
      
      if (pathStr.startsWith('/') && pathStr.endsWith('/')) {
        // Handle regex patterns
        for (const [field, value] of Object.entries(record)) {
          if (this.fieldMatches(field, pathStr)) {
            record[field as keyof T] = this.unProcessText(value) as T[keyof T];
          }
        }
      } else {
        // Handle exact path matches
        const field = path[0] as unknown as keyof T;
        if (record[field] !== undefined && record[field] !== null) {
          if (path.length === 1) {
            record[field] = this.unProcessText(record[field]) as T[keyof T];
          } else {
            this.prepareRetrieval(record[field], path.slice(1));
          }
        }
      }
    }
    
    return record;
  }

  /**
   * Process an array of records for insertion into Elasticsearch
   * @param records Array of records to process
   */
  processRecords<T extends Record<string, any>>(records: T[]): T[] {
    return records.map(record => this.prepareInsertion({ ...record }));
  }

  /**
   * Process an array of records after retrieval from Elasticsearch
   * @param records Array of records to process
   */
  unprocessRecords<T extends Record<string, any>>(records: T[]): T[] {
    return records.map(record => this.prepareRetrieval({ ...record }));
  }

  /**
   * Alias for unprocessRecords for backward compatibility
   * @deprecated Use unprocessRecords instead
   */
  unProcessRecords<T extends Record<string, any>>(records: T[]): T[] {
    return this.unprocessRecords(records);
  }

  /**
   * Process an array of records before inserting into Elasticsearch
   * @param records
   */
  prepareInsertions<T extends Record<string, any>>(records: T[]) {
    return records.map(r => this.prepareInsertion(r));
  }

  /**
   * Process an array of records after fetching from Elasticsearch
   * @param records
   */
  prepareResults<T>(records: T[]) {
    return records.map(r => this.prepareResult(r));
  }
}
