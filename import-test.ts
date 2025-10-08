import { QueryBuilder } from './dist/index.mjs';

const qb = new QueryBuilder();
qb.matchPhrase('title', 'Harry Potter');

console.log(qb.getQuery());
