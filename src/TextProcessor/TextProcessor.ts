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
   * @param name
   */
  registerField(name: string) {
    this.paths.push(name.split('.') as unknown as Path[]);
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
  processText(text: string) {
    for (const { find, replace } of this.processors) {
      text = text.replace(find, replace);
    }
    return text;
  }

  /**
   * Run the given text through all un-processors
   * @param text
   */
  unProcessText(text: string) {
    for (const { find, replace } of this.unProcessors) {
      text = text.replace(find, replace);
    }
    return text;
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
    for (const path of this.paths) {
      if (!record[path[0] as unknown as keyof T]) {
        // result does not have this field
        continue;
      }
      const field = path[0] as unknown as keyof T;
      if (path.length === 1) {
        record[field] = this.processText(record[field]) as T[keyof T];
      } else {
        this.prepareInsertion(record[field], path.slice(1));
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
