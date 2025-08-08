import IndexManager from '../IndexManager/IndexManager';

export default class SchemaRegistry {
  // Yes, I know the proper term is "indices"
  public indexes: IndexManager[];

  constructor(indexes: IndexManager[] = []) {
    this.indexes = indexes;
  }

  register(index: IndexManager) {
    this.indexes.push(index);
    return this;
  }

  registerAll(indexes: IndexManager[]) {
    this.indexes.push(...indexes);
    return this;
  }

  private chunkify<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  async migrateIfNeeded(concurrency = 2) {
    const groups = this.chunkify(this.indexes, concurrency);
    for (const group of groups) {
      await Promise.all(group.map(i => i.migrateIfNeeded()));
    }
    return this;
  }
}
