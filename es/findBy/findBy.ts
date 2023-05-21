// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'withEsClie... Remove this comment to see the full error message
const withEsClient = require('../withEsClient/withEsClient.js');
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'dates'.
const dates = require('../dates/dates.js');
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'fulltext'.
const fulltext = require('../fulltext/fulltext.js');

/**
 * Return records matching simple field-value pairs
 * @param {String} index  The name of the index
 * @param {Object} criteria  Some simple field-value pairs
 * @param {Object} [moreBody]  Additional options such as size and from
 * @returns {Promise<{result: {records: Object[], total: Number}, details: Object, error:Error}>}
 */
async function criteria(index: any, criteria: any, moreBody = {}) {
  const musts: any = [];
  // @ts-expect-error TS(2550): Property 'entries' does not exist on type 'ObjectC... Remove this comment to see the full error message
  for (const [field, value] of Object.entries(criteria)) {
    musts.push({ match: { [field]: value } });
  }
  const { result, error } = await withEsClient((client: any) => {
    return client.search({
      index,
      body: {
        query: {
          bool: {
            must: musts,
          },
        },
        ...moreBody,
      },
    });
  });
  return {
    result: _formatRecords(result),
    error,
    details: result || error?.meta,
  };
}

/**
 * Return the record with the given id, or null
 * @param {String} index  The name of the index
 * @param {String} id  The document id
 * @returns {Promise<{result: (Object|null), details: *, error}>}
 */
async function id(index: any, id: any) {
  const { result, error, details } = await criteria(index, { id });
  return { result: result?.records?.[0] || null, error, details };
}

/**
 * Find records that match the given term or phrase
 * @param {String} index  The name of the index
 * @param {String} phrase  The term or phrase to search for
 * @param {Object} [criteria]  Some simple field-value pairs
 * @param {Object} [moreBody]  Additional options such as size and from
 * @returns {Promise<{result: {records: Object[], total: Number}, details: Object, error:Error}>}
 */
async function phrase(index: any, phrase: any, criteria = {}, moreBody = {}) {
  phrase = fulltext.processText(phrase);
  const musts = [];
  // @ts-expect-error TS(2550): Property 'entries' does not exist on type 'ObjectC... Remove this comment to see the full error message
  for (const [field, value] of Object.entries(criteria)) {
    musts.push({ match: { [field]: value } });
  }
  const shoulds = [
    {
      multi_match: {
        fields: ['content_*'],
        query: phrase,
        boost: 1,
      },
    },
    {
      multi_match: {
        fields: ['content_*'],
        query: phrase,
        boost: 3,
        operator: 'and',
      },
    },
    {
      multi_match: {
        type: 'phrase',
        fields: ['content_*'],
        query: phrase,
        boost: 5,
      },
    },
  ];

  const { result, error } = await withEsClient((client: any) => {
    return client.search({
      index,
      body: {
        query: {
          bool: {
            // must: musts,
            should: shoulds,
          },
        },
        ...moreBody,
      },
    });
  });
  return {
    result: _formatRecords(result),
    error,
    details: result || error?.meta,
  };
}

/**
 * Return results from a QueryBuilder object
 * @param {String} index  The name of the index
 * @param {QueryBuilder} query  The query object
 * @returns {Promise<{result: {records: Object[], total: Number}, details: Object, error:Error}>}
 */
async function query(index: any, query: any) {
  const { result, error } = await withEsClient((client: any) => {
    return client.search({
      index,
      body: query.getQuery(),
    });
  });
  return {
    result: _formatRecords(result),
    error,
    details: result || error?.meta,
  };
}

/**
 * return the returned _source for each hit
 * @param {Object} result  The result from withEsClient()
 * @returns {Object}
 * @private
 */
function _formatRecords(result: any) {
  if (result?.body?.hits?.hits) {
    const records = [];
    for (const hit of result.body.hits.hits) {
      fulltext.unProcessRecord(hit._source);
      dates.unProcessRecord(hit._source);
      if (hit.highlight) {
        hit._source.$highlight = hit.highlight;
      }
      records.push(hit._source);
    }
    return {
      records,
      total: result.body.hits.total?.value || 0,
      took: result.body.took,
      aggregations: result.aggregations,
    };
  }
  return { records: [], total: null, took: result?.took, aggregations: null };
}

// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'findBy'.
const findBy = { criteria, id, phrase, query };

// @ts-expect-error TS(2580): Cannot find name 'module'. Do you need to install ... Remove this comment to see the full error message
module.exports = findBy;
