import type { estypes } from '@elastic/elasticsearch';

/**
 * Mapping types whose fields can be the target of a full-text `match` query.
 */
const FULLTEXT_TYPES = new Set([
  'text',
  'match_only_text',
  'search_as_you_type',
  'semantic_text',
]);

type FieldKind = 'leaf' | 'container' | 'subField' | 'runtime';

type FieldEntry = {
  path: string;
  kind: FieldKind;
  type: string | undefined;
  /** For `alias` fields, the path of the field the alias points at */
  aliasPath: string | undefined;
};

type PlainObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(source: PlainObject, key: string): string | undefined {
  const value = source[key];
  if (typeof value === 'string') {
    return value;
  }
  return undefined;
}

function joinPath(prefix: string, name: string) {
  if (prefix === '') {
    return name;
  }
  return `${prefix}.${name}`;
}

function toEntry(path: string, kind: FieldKind, spec: PlainObject) {
  const entry: FieldEntry = {
    path,
    kind,
    type: readString(spec, 'type'),
    aliasPath: readString(spec, 'path'),
  };
  return entry;
}

/**
 * Walk mapping properties depth-first in declaration order, appending one
 * entry per container, leaf and multi-field sub-field.
 */
function walkProperties(
  properties: PlainObject,
  prefix: string,
  entries: FieldEntry[],
) {
  for (const [name, spec] of Object.entries(properties)) {
    if (!isPlainObject(spec)) {
      continue;
    }
    const path = joinPath(prefix, name);
    if (isPlainObject(spec.properties)) {
      entries.push(toEntry(path, 'container', spec));
      walkProperties(spec.properties, path, entries);
      continue;
    }
    entries.push(toEntry(path, 'leaf', spec));
    if (!isPlainObject(spec.fields)) {
      continue;
    }
    // sub-fields do not nest: their own `fields` are ignored
    for (const [subName, subSpec] of Object.entries(spec.fields)) {
      if (isPlainObject(subSpec)) {
        entries.push(toEntry(joinPath(path, subName), 'subField', subSpec));
      }
    }
  }
}

/**
 * The shared walker: every field described by a creation request, in
 * declaration order, depth-first, followed by runtime fields.
 */
function walkMapping(create: estypes.IndicesCreateRequest) {
  const entries: FieldEntry[] = [];
  if (!isPlainObject(create) || !isPlainObject(create.mappings)) {
    return entries;
  }
  const mappings: PlainObject = create.mappings;
  if (isPlainObject(mappings.properties)) {
    walkProperties(mappings.properties, '', entries);
  }
  if (isPlainObject(mappings.runtime)) {
    for (const [name, spec] of Object.entries(mappings.runtime)) {
      if (isPlainObject(spec)) {
        entries.push(toEntry(name, 'runtime', spec));
      }
    }
  }
  return entries;
}

function uniquePaths(entries: FieldEntry[]) {
  return [...new Set(entries.map((entry) => entry.path))];
}

/**
 * Get the dotted path of every field in a creation request's mapping.
 * Leaf fields and runtime fields are always included; multi-field sub-fields
 * (e.g. `title.exact`) and object/nested containers are opt-in.
 * @param create  The index creation request
 * @param options.subFields  Include multi-field sub-fields (default false)
 * @param options.containers  Include object/nested containers (default false)
 */
export function getAllFields(
  create: estypes.IndicesCreateRequest,
  options: { subFields?: boolean; containers?: boolean } = {},
): string[] {
  const included = walkMapping(create).filter((entry) => {
    if (entry.kind === 'subField') {
      return options.subFields === true;
    }
    if (entry.kind === 'container') {
      return options.containers === true;
    }
    return true;
  });
  return uniquePaths(included);
}

/**
 * Get the dotted path of every full-text field in a creation request's
 * mapping: fields of type `text`, `match_only_text`, `search_as_you_type`
 * or `semantic_text`, plus `alias` fields that point at one of those.
 * @param create  The index creation request
 * @param options.subFields  Include full-text multi-field sub-fields
 *   (default false)
 */
export function getFulltextFields(
  create: estypes.IndicesCreateRequest,
  options: { subFields?: boolean } = {},
): string[] {
  const entries = walkMapping(create);
  const typeByPath = new Map<string, string | undefined>();
  for (const entry of entries) {
    const isField = entry.kind === 'leaf' || entry.kind === 'subField';
    if (isField && !typeByPath.has(entry.path)) {
      typeByPath.set(entry.path, entry.type);
    }
  }
  const isFulltext = (entry: FieldEntry) => {
    if (entry.type === 'alias' && entry.aliasPath !== undefined) {
      return FULLTEXT_TYPES.has(typeByPath.get(entry.aliasPath) ?? '');
    }
    return FULLTEXT_TYPES.has(entry.type ?? '');
  };
  const included = entries.filter((entry) => {
    if (entry.kind === 'subField' && options.subFields !== true) {
      return false;
    }
    if (entry.kind === 'container' || entry.kind === 'runtime') {
      return false;
    }
    return isFulltext(entry);
  });
  return uniquePaths(included);
}
