type Transformer = {
  test: (value: any, separator: string) => boolean;
  transform: (value: any, separator: string) => any;
};

function insideOut(path: string[], inside: any) {
  while (path.length > 1) {
    path.pop();
    inside = {
      nested: {
        path: path.join('.'),
        ignore_unmapped: true,
        query: inside,
      },
    };
  }
  return inside;
}

function insideOutSort(path: string[], inside: any) {
  while (path.length > 1) {
    path.pop();
    inside = {
      nested: {
        path: path.join('.'),
        sort: inside,
      },
    };
  }
  return inside;
}

function groupByPath(fields: string[], separator: string, _level = 0) {
  const root: string[] = [];
  const groupsByPath: Record<string, string[]> = {};
  for (const field of fields) {
    const parts = field.split(separator);
    if (parts.length > _level + 1) {
      const path = parts.slice(0, _level + 1).join('.');
      if (!groupsByPath[path]) {
        groupsByPath[path] = [];
      }
      groupsByPath[path].push(field);
    } else {
      root.push(field);
    }
  }
  const groups = Object.entries(groupsByPath).map(([path, fields]) => ({
    path,
    fields,
  }));
  return { root, groups };
}

const templates: Record<string, Transformer> = {
  term: {
    test: (value: any, separator: string) => {
      const keys = Object.keys(value);
      return keys.length === 1 && keys[0].includes(separator);
    },
    // e.g. { 'category/tag': 'Mystery' }
    transform: (value: any, separator: string) => {
      const keys = Object.keys(value);
      const path = keys[0].split(separator);
      return insideOut(path, { term: { [path.join('.')]: value[keys[0]] } });
    },
  },
  sort: {
    test: (sortsArray: any[], separator: string) => {
      return sortsArray.some(s => Object.keys(s)[0]?.includes(separator));
    },
    // e.g. [{ price: { order: 'desc' } }, { 'publishing/year': { order; 'desc' } }]
    transform: (sortsArray: any[], separator: string) => {
      const newArray = [];
      for (const sort of sortsArray) {
        const [key, value] = Object.entries(sort)[0] || [];
        if (!key || !value) {
          continue;
        }
        if (key?.includes(separator)) {
          const path = key.split(separator);
          newArray.push(insideOutSort(path, { [path.join('.')]: value }));
        } else {
          newArray.push(sort);
        }
      }
      return { sort: newArray };
    },
  },
  match: {
    test: (value: any, separator: string) => {
      const keys = Object.keys(value);
      return keys.length === 1 && keys[0].includes(separator);
    },
    // e.g. { 'category/tag': 'Mystery' }
    transform: (value: any, separator: string) => {
      const keys = Object.keys(value);
      const path = keys[0].split(separator);
      return insideOut(path, { match: { [path.join('.')]: value[keys[0]] } });
    },
  },
  match_phrase: {
    test: (value: any, separator: string) => {
      const keys = Object.keys(value);
      return keys.some(k => k.includes(separator));
    },
    // e.g. { 'category/tag': { query: 'Mystery', slop: 3 } }
    transform: (value: any, separator: string) => {
      const keys = Object.keys(value);
      const path = keys[0].split(separator);
      return insideOut(path, {
        match_phrase: { [path.join('.')]: value[keys[0]] },
      });
    },
  },
  exists: {
    test: (value: any, separator: string) => {
      return typeof value.field === 'string' && value.field.includes(separator);
    },
    // e.g. { field: 'category/tag' }
    transform: (value: any, separator: string) => {
      const path = value.field.split(separator);
      return insideOut(path, { exists: { field: path.join('.') } });
    },
  },
  range: {
    test: (value: any, separator: string) => {
      const keys = Object.keys(value);
      return (
        [1, 2].includes(keys.length) && keys.every(k => k.includes(separator))
      );
    },
    // e.g. { gte: 100, lt: 200 }
    transform: (value: any, separator: string) => {
      const keys = Object.keys(value);
      const path = keys[0].split(separator);
      const range: Record<string, any> = {};
      for (const [prop, criteria] of Object.entries(value)) {
        range[prop.split(separator).join('.')] = criteria;
      }
      return insideOut(path, { range });
    },
  },
  multi_match: {
    test: (value: any, separator: string) => {
      return (
        typeof value.query === 'string' &&
        Array.isArray(value.fields) &&
        value.fields.every(f => typeof f === 'string') &&
        value.fields.some(f => f.includes(separator))
      );
    },
    // e.g. { fields: ['characters/name','tags/name'], query: 'Batman' }
    transform: (value: any, separator: string) => {
      const should = [];
      const { root, groups } = groupByPath(value.fields, separator);
      if (root.length > 0) {
        should.push({
          multi_match: {
            ...value,
            fields: root,
            query: value.query,
          },
        });
      }
      for (const group of groups) {
        should.push(
          insideOut(group.fields[0].split(separator), {
            multi_match: {
              ...value,
              fields: group.fields.map(f => f.split(separator).join('.')),
              query: value.query,
            },
          })
        );
      }
      if (should.length === 0) {
        return {};
      }
      if (should.length === 1) {
        return should[0];
      }
      return { bool: { should } };
    },
  },
};
// Need to be able to specify the key to use in the terms.transform function
// templates.terms = templates.term;

/**
 * Processes nested fields in Elasticsearch queries by converting '->' notation to nested queries
 */
export default class NestedFieldsProcessor {
  public fieldSeparator: string;

  /**
   * Creates a new NestedFieldsProcessor
   * @param fieldSeparator The separator used to denote nested fields (default: '->')
   */
  constructor(fieldSeparator: string = '/') {
    this.fieldSeparator = fieldSeparator;
  }

  process(query: any): any {
    const copy = {};
    for (const [key, value] of Object.entries(query)) {
      // apply template
      if (key in templates && templates[key].test(value, this.fieldSeparator)) {
        Object.assign(
          copy,
          templates[key].transform(value, this.fieldSeparator)
        );
      } else if (
        // recurse into array
        Array.isArray(value) &&
        value.every(v => typeof v === 'object')
      ) {
        copy[key] = value.map(v => this.process(v));
      } else if (
        // recurse into object
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value)
      ) {
        copy[key] = this.process(value);
      } else {
        // keep value as is
        copy[key] = value;
      }
    }
    return copy;
  }
}
