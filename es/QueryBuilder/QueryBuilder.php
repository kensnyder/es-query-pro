<?php

/**
 * Class NoSql_QueryBuilder
 * Class to build basic NoSql queries
 */
class NoSql_QueryBuilder {
  /**
   * @var array The fields that should return
   */
  protected $_fields = ['_id'];

  /**
   * @var array The must filters
   */
  protected $_must = [];

  /**
   * @var array The must_not filters
   */
  protected $_mustNot = [];

  /**
   * @var array The "aggs" to add to the query
   */
  protected $_aggs = [];

  /**
   * @var array The function score query
   */
  protected $_functionScore = null;

  /**
   * @var array The highlight definition
   */
  protected $_highlighter = null;

  /**
   * @var int The max number of records to return
   */
  protected $_limit = null;

  /**
   * @var int The page to fetch
   */
  protected $_page = 1;

  /**
   * @var array Fields to sort by
   */
  protected $_sorts = [];

  /**
   * @var bool If true, use "random_score" for a function score
   */
  protected $_sortByRandom = false;

  /**
   * Instantiate this class
   * @return static
   */
  public static function init(): NoSql_QueryBuilder {
    return new static();
  }

  /**
   * Set the fields to fetch
   * @param array $fields  The fields
   * @return NoSql_QueryBuilder
   */
  public function fields(array $fields): NoSql_QueryBuilder {
    $this->_fields = $fields;
    return $this;
  }

  /**
   * Append filters to the given filter object (match any of the given values)
   * @param array $filters  Either $this->_must or $this->_mustNot
   * @param string $matchType  Either "match" or "term"
   * @param string $field  The name of the field to search
   * @param $valueOrValues  A value or array of possible values
   */
  public function _addFilterAny(array &$filters, string $matchType, string $field, $valueOrValues) {
    if (!is_array($valueOrValues)) {
      $valueOrValues = [$valueOrValues];
    }
    if ($matchType === 'term' && count($valueOrValues) > 1) {
      $filters[] = ['terms' => [$field => $valueOrValues]];
      return;
    }
    $terms = [];
    foreach ($valueOrValues as $value) {
      $terms[] = [$matchType => [$field => $value]];
    }
    if (count($terms) === 1) {
      $filters[] = $terms[0];
    } else {
      $filters[] = ['bool' => ['should' => $terms]];
    }
  }

  /**
   * Append a multi_match condition to the given filter object (match any of the given values against the given fields)
   * @param array $filters  Either $this->_must or $this->_mustNot
   * @param array $fields  The name of the fields to search
   * @param string|array $valueOrValues  A value or array of possible values
   */
  public function _addMultiMatchAny(array &$filters, array $fields, $valueOrValues) {
    if (!is_array($valueOrValues)) {
      $valueOrValues = [$valueOrValues];
    }
    $terms = [];
    foreach ($valueOrValues as $value) {
      $terms[] = [
        'multi_match' => [
          'fields' => $fields,
          'query' => $value,
        ],
      ];
    }
    if (count($terms) === 1) {
      $filters[] = $terms[0];
    } else {
      $filters[] = ['bool' => ['should' => $terms]];
    }
  }

  /**
   * Add a series of term condition to the given filter object (find full-word matches any of the given values against the given field)
   * @param array $filters  Either $this->_must or $this->_mustNot
   * @param array $fields  The name of the fields to search
   * @param scalar $value  A value
   */
  public function _addMultiTermAny(array &$filters, array $fields, $value) {
    $terms = [];
    foreach ($fields as $field) {
      $terms[] = [
        'term' => [
          $field => $value,
        ],
      ];
    }
    $filters[] = ['bool' => ['should' => $terms]];
  }

  /**
   * Append filters to the given filter object (match all the values given)
   * @param array $filters  Either $this->_must or $this->_mustNot
   * @param string $matchType  Either "match" or "term"
   * @param string|array $fieldOrFields  The name of the field to search (or names for multiMatch)
   * @param $valueOrValues  A value or array of possible values
   */
  public function _addFilterAll(array &$filters, string $matchType, $fieldOrFields, $valueOrValues) {
    if (!is_array($valueOrValues)) {
      $valueOrValues = [$valueOrValues];
    }
    foreach ($valueOrValues as $value) {
      $filters[] = [$matchType => [$fieldOrFields => $value]];
    }
  }

  /**
   * Append a multi_match condition to the given filter object (match any of the given values against the given fields)
   * @param array $filters  Either $this->_must or $this->_mustNot
   * @param array $fields  The name of the fields to search
   * @param string|array $valueOrValues  A value or array of possible values
   */
  public function _addMultiMatchAll(array &$filters, array $fields, $valueOrValues) {
    if (!is_array($valueOrValues)) {
      $valueOrValues = [$valueOrValues];
    }
    foreach ($valueOrValues as $value) {
      $filters[] = [
        'multi_match' => [
          'fields' => $fields,
          'query' => $value,
        ],
      ];
    }
  }

  /**
   * Add a series of term condition to the given filter object (find full-word matches any of the given values against the given field)
   * @param array $filters  Either $this->_must or $this->_mustNot
   * @param array $fields  The name of the fields to search
   * @param scalar $value  A value
   */
  public function _addMultiTermAll(array &$filters, array $fields, $value) {
    foreach ($fields as $field) {
      $filters[] = [
        'term' => [
          $field => $value,
        ],
      ];
    }
  }

  /**
   * Append filters for the given range expression
   * @param array $filters  Either $this->_must or $this->_mustNot
   * @param string $field  The name of the field to search
   * @param string $op  One of the following: > < >= <= gt lt gte lte between
   * @param string|int|string[]|int[] $value
   */
  public function _addRange(array &$filters, string $field, string $op, $value) {
    static $ops = [
      '<' => 'lt',
      '<=' => 'lte',
      '>' => 'gt',
      '>=' => 'gte',
    ];
    if (strtoupper($op) == 'BETWEEN' && is_array($value)) {
      $filters[] = [
        'range' => [
          $field => [
            'gte' => $value[0],
            'lte' => $value[1],
          ],
        ],
      ];
      return;
    }
    $opName = isset($ops[$op]) ? $ops[$op] : strtolower($op);
    $filters[] = [
      'range' => [
        $field => [$opName => $value],
      ],
    ];
  }

  /**
   * Add a full-text matching condition
   * @param string $field  The name of the field to search
   * @param string|int|string[]|int[] $valueOrValues  A value or array of possible values
   * @param string $type  Use "ALL" to require document to contain all values, otherwise match any value
   * @return NoSql_QueryBuilder
   */
  public function match(string $field, $valueOrValues, $type = 'ANY'): NoSql_QueryBuilder {
    if (strtoupper($type) === 'ALL') {
      $this->_addFilterAll($this->_must, 'match', $field, $valueOrValues);
    } else {
      $this->_addFilterAny($this->_must, 'match', $field, $valueOrValues);
    }
    return $this;
  }

  /**
   * Add a full-text phrase matching condition
   * @param string $field  The name of the field to search
   * @param string|array $phraseOrPhrases  A value or array of possible phrase values
   * @return NoSql_QueryBuilder
   */
  public function matchPhrase(string $field, $phraseOrPhrases): NoSql_QueryBuilder {
    if (!is_array($phraseOrPhrases)) {
      $phraseOrPhrases = [$phraseOrPhrases];
    }

    $terms = [];

    foreach ($phraseOrPhrases as $value) {
      $terms[] = ['match_phrase' => [$field => $value]];
    }

    if (count($terms) === 1) {
      $this->_must[] = $terms[0];
    } else {
      $this->_must[] = ['bool' => ['should' => $terms]];
    }

    return $this;
  }

  /**
   * Add a full-text phrase prefix matching condition
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/6.8/query-dsl-match-query-phrase-prefix.html
   * @param string|array $fieldOrFields  The name of the field to search
   * @param string|array $phraseOrPhrases  A value or array of possible phrase values
   * @return NoSql_QueryBuilder
   */
  public function matchPhrasePrefix($fieldOrFields, $phraseOrPhrases): NoSql_QueryBuilder {
    // make sure phrases is an array
    $phrases = is_array($phraseOrPhrases) ? $phraseOrPhrases : [$phraseOrPhrases];

    if (is_array($fieldOrFields)) {
      // we want to do a phrase prefix on more than one fields
      // so we multi_match with a phrase_prefix type
      $clauses = [];
      foreach ($phrases as $value) {
        $clauses[] = [
          'multi_match' => [
            'fields' => $fieldOrFields,
            'type' => 'phrase_prefix',
            'query' => $value,
          ],
        ];
      }
      if (count($clauses) === 1) {
        $this->_must[] = $clauses[0];
      } else {
        $this->_must[] = ['bool' => ['should' => $clauses]];
      }
      return $this;
    }
    // $fieldOrFields is a string so we can use match_phrase_prefix directly
    $clauses = [];
    foreach ($phrases as $value) {
      $clauses[] = ['match_phrase_prefix' => [$fieldOrFields => $value]];
    }
    if (count($clauses) === 1) {
      $this->_must[] = $clauses[0];
    } else {
      $this->_must[] = ['bool' => ['should' => $clauses]];
    }
    return $this;
  }

  /**
   * Match a term with boosted relevancy for exact phrases and AND matches.
   * This approach is described in the "Combining OR, AND, and match phrase queries" section of
   * https://www.elastic.co/blog/how-to-improve-elasticsearch-search-relevance-with-boolean-queries
   * It gives more weight to the phrase as a whole so results with the whole phrase will be higher
   * in the results.
   * @param string[] $fields  The names of the fields to search (often ['content_*.fulltext'])
   * @param string[] $terms  The search phrases (often ['my search here'])
   * @param array $options  Additional options
   * @property bool $options['expand']  If true, also match with OR but at a lower relevance
   * @property array $options['boosts']  The boosts for OR, AND, then phrase; default is [1,2,3]
   * @return NoSql_QueryBuilder
   * @chainable
   */
  public function matchBoostedPhrase(array $fields, array $terms, array $options = []) {
    // enumerate options
    $expand = $options['expand'] ?? false;
    $boosts = $options['boosts'] ?? [1, 2, 3];
    // build subquery
    $subquery = new static();
    if ($expand) {
      $subquery->multiMatchWithPhrase($fields, $terms, [
        'operator' => 'or',
        'boost' => $boosts[0],
      ]);
    }
    $subquery->multiMatchWithPhrase($fields, $terms, [
      'operator' => 'and',
      'boost' => $boosts[1],
    ]);
    $subquery->multiMatchWithPhrase($fields, $terms, [
      'type' => 'phrase',
      'boost' => $boosts[2],
    ]);
    $this->should($subquery);
    return $this;
  }

  /**
   * Add a full-text matching condition across multiple fields
   * @param array $fields  The names of the fields to search. Wildcards such as content_* are allowed.
   * @param string|array $valueOrValues  A value or array of possible values
   * @param string $type  Use "ALL" to require document to contain all values, otherwise match any value
   * @return NoSql_QueryBuilder
   */
  public function multiMatch(array $fields, $valueOrValues, $type = 'ANY'): NoSql_QueryBuilder {
    if (strtoupper($type) === 'ALL') {
      $this->_addMultiMatchAll($this->_must, $fields, $valueOrValues);
    } else {
      $this->_addMultiMatchAny($this->_must, $fields, $valueOrValues);
    }
    return $this;
  }

  /**
   * Create a basic multi_match clause and add any of the available options.
   * than they would be in a regular multi_match query
   * See the "Combining OR, AND, and match phrase queries" section of https://www.elastic.co/blog/how-to-improve-elasticsearch-search-relevance-with-boolean-queries.
   * @param array $fields
   * @param array $valueOrValues
   * @param array $options  Possible keys are `analyzer`, `boost`, `operator`, `minimum_should_match`, `fuzziness`, `lenient`, `prefix_length`, `max_expansions`, `fuzzy_rewrite`, `zero_terms_query`, `cutoff_frequency`, and `fuzzy_transpositions`
   * @return $this
   */
  public function multiMatchWithPhrase(array $fields, array $valueOrValues, array $options = []) {
    foreach ($valueOrValues as $value) {
      $baseMultiMatch = [
        'fields' => $fields,
        'query' => $value,
      ];
      $this->_must[] = [
        'multi_match' => array_merge($baseMultiMatch, $options),
      ];
    }

    return $this;
  }

  /**
   * Add a keyword matching condition across multiple fields
   * @param array $fields  The names of the fields to search. Wildcards are not allowed.
   * @param scalar $value  A value to search for
   * @param string $type  Use "ALL" to require all fields to contain the value, otherwise match any value
   * @return NoSql_QueryBuilder
   */
  public function multiTerm(array $fields, $value, $type = 'ANY'): NoSql_QueryBuilder {
    if (strtoupper($type) === 'ALL') {
      $this->_addMultiTermAll($this->_must, $fields, $value);
    } else {
      $this->_addMultiTermAny($this->_must, $fields, $value);
    }
    return $this;
  }

  /**
   * Add a negative full-text matching condition
   * @param string $field  The name of the field to search
   * @param string|array $valueOrValues  A value or array of possible values to reject
   * @return NoSql_QueryBuilder
   */
  public function notMatch(string $field, $valueOrValues): NoSql_QueryBuilder {
    $this->_addFilterAny($this->_mustNot, 'match', $field, $valueOrValues);
    return $this;
  }

  /**
   * Add a negative full-text matching condition across multiple fields
   * @param array $fields  The names of the fields to search
   * @param string|array $valueOrValues  A value or array of possible values to reject
   * @return NoSql_QueryBuilder
   */
  public function notMultiMatch(array $fields, $valueOrValues): NoSql_QueryBuilder {
    $this->_addMultiMatchAny($this->_mustNot, $fields, $valueOrValues);
    return $this;
  }

  /**
   * Add a negative keyword matching condition across multiple fields
   * @param array $fields  The names of the fields to search. Wildcards are not allowed.
   * @param scalar $value  A value to reject
   * @return NoSql_QueryBuilder
   */
  public function notMultiTerm(array $fields, $value): NoSql_QueryBuilder {
    $this->_addMultiTermAny($this->_mustNot, $fields, $value);
    return $this;
  }

  /**
   * Add an exact matching condition
   * @param string $field  The name of the field to search
   * @param mixed $valueOrValues  A value or array of possible values
   * @param string $type  Use "ALL" to require document to contain all values, otherwise match any value
   * @return NoSql_QueryBuilder
   */
  public function term(string $field, $valueOrValues, $type = 'ANY'): NoSql_QueryBuilder {
    if (strtoupper($type) === 'ALL') {
      $this->_addFilterAll($this->_must, 'term', $field, $valueOrValues);
    } else {
      $this->_addFilterAny($this->_must, 'term', $field, $valueOrValues);
    }
    return $this;
  }

  /**
   * Add a Lucene expression condition
   * @param string|array $fieldOrFields  The name of the field(s) to search
   * @param string $query  A query string containing special operators such as AND, NOT, OR, ~, *
   * @return NoSql_QueryBuilder
   */
  public function queryString($fieldOrFields, string $query): NoSql_QueryBuilder {
    $fields = is_array($fieldOrFields) ? $fieldOrFields : [$fieldOrFields];
    $this->_must[] = [
      'query_string' => [
        'fields' => $fields,
        'query' => $query,
      ],
    ];
    return $this;
  }

  /**
   * Add a negative exact matching condition
   * @param string $field  The name of the field to search
   * @param $valueOrValues  A value or array of possible values to reject
   * @return NoSql_QueryBuilder
   */
  public function notTerm(string $field, $valueOrValues): NoSql_QueryBuilder {
    $this->_addFilterAny($this->_mustNot, 'match', $field, $valueOrValues);
    return $this;
  }

  /**
   * Add a numeric range matching condition
   * @param string $field  The name of the field to search
   * @param string $op  One of the following: > < >= <= gt lt gte lte between
   * @param string|int|string[]|int[] $value  A value to search against
   * @return NoSql_QueryBuilder
   */
  public function range(string $field, string $op, $value): NoSql_QueryBuilder {
    $this->_addRange($this->_must, $field, $op, $value);
    return $this;
  }

  /**
   * Add a numeric range negative matching condition
   * @param string $field  The name of the field to search
   * @param string $op  One of the following: > < >= <= gt lt gte lte between
   * @param string|int|string[]|int[] $value  A value to search against
   * @return NoSql_QueryBuilder
   */
  public function notRange(string $field, string $op, $value): NoSql_QueryBuilder {
    $this->_addRange($this->_mustNot, $field, $op, $value);
    return $this;
  }

  /**
   * Return faceted data using ElasticSearch's "aggregation" feature
   * @param array $forFields  The names of fields to aggregate into buckets. Can be a list of strings or an array of label => field pairs
   * @param int $limit  The maximum number of buckets to return for each facet before an "other" option
   * @return $this
   */
  public function includeFacets(array $forFields, int $limit = 25): NoSql_QueryBuilder {
    $idx = 0;
    foreach ($forFields as $name => $field) {
      // if a list of strings, $idx will be numeric
      // if an associative array, use $name as label
      $label = $name === $idx++ ? $field : $name;
      $this->_aggs[$label] = [
        'terms' => [
          'field' => $field,
          'size' => $limit,
          'show_term_doc_count_error' => true,
          'order' => ['_count' => 'desc'],
        ],
      ];
    }
    return $this;
  }

  /**
   * Add an "aggs" entry for term aggregation. Similar to COUNT(*) with GROUP BY
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/current/search-aggregations-bucket-terms-aggregation.html
   * @param string $field  The field to group by
   * @param int $limit  The maximum number of counts to return
   * @param array $exclusions  Values that should be excluded from the counts
   * @return NoSql_QueryBuilder
   */
  public function aggregateTerm(
    string $field,
    int $limit = 10,
           $exclusions = []
  ): NoSql_QueryBuilder {
    $this->_aggs[$field] = [
      'terms' => [
        'field' => $field,
        'size' => $limit,
        'show_term_doc_count_error' => true,
        'order' => ['_count' => 'desc'],
        'exclude' => $exclusions,
      ],
    ];
    // don't return any records; just aggregates
    $this->limit(0);
    return $this;
  }

  /**
   * Add an "aggs" entry for date histogram aggregation. Similar to COUNT(*) over a timer period with GROUP BY
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/6.3/search-aggregations-bucket-datehistogram-aggregation.html
   * @param string $dateField  The date field
   * @param ReportInterval_Interface $interval  The object representing the interval period
   * @param int|string  The timezone offset (e.g. -360 or "-06:00")
   * @return NoSql_QueryBuilder
   */
  public function dateHistogram(
    string $dateField,
    ReportInterval_Interface $interval,
    $timezone
  ): NoSql_QueryBuilder {
    if (is_int($timezone) || is_float($timezone)) {
      $timezone = static::offsetIntToString($timezone);
    }
    $this->_aggs[$dateField] = [
      'date_histogram' => [
        'field' => $dateField,
        'interval' => $interval->getEsIntervalCode(), // e.g. 1d, 1w, 1M, 1y
        // TODO: get timezone working
        // Error: Field [published_by] of type [integer] does not support custom time zones
        'time_zone' => $timezone, // e.g. -06:00
        'format' => $interval->getEsFormat(), // e.g. yyyy-MM-dd
      ],
    ];
    // don't return any records; just the histogram
    $this->limit(0);
    return $this;
  }

  /**
   * Get a timezone string from integer minutes
   * @example
   * 		360 => -06:00
   * 		-300 => +05:00
   * 		0 => +00:00
   * @param int $timezone
   * @return string
   */
  public static function offsetIntToString(int $timezone): string {
    $timezone *= -1;
    $hour = floor($timezone / 60);
    $min = $timezone % 60;
    $string = sprintf('%+03d:%02d', $hour, $min);
    return $string;
  }

  /**
   * Set the max number of results to return
   * @param int $limit  The max
   * @return NoSql_QueryBuilder
   */
  public function limit(int $limit): NoSql_QueryBuilder {
    $this->_limit = $limit;
    return $this;
  }

  /**
   * Set the page of results to return
   * @param int $page  Where 1 is the first page
   * @return NoSql_QueryBuilder
   */
  public function page(int $page): NoSql_QueryBuilder {
    $this->_page = $page;
    return $this;
  }

  /**
   * Add a sort field
   * @param string $field  The field to sort by
   * @param string|array [$directionOrOptions]  The direction, asc or desc or an array of direction options
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/current/search-request-sort.html
   * @return NoSql_QueryBuilder
   */
  public function sort(string $field, $directionOrOptions = null): NoSql_QueryBuilder {
    if (is_array($directionOrOptions) || preg_match('/^(asc|desc)$/i', $directionOrOptions)) {
      $this->_sorts[] = [$field => $directionOrOptions];
    } else {
      $this->_sorts[] = $field;
    }
    return $this;
  }

  /**
   * Clear out a query property
   * @param string $field  Valid values: sort, page, limit, must, mustNot, aggs, fields, highlighter, functionScore
   */
  public function clear(string $field) {
    if ($field === 'sort') {
      $this->_sorts = [];
      $this->_sortByRandom = false;
    } elseif ($field === 'page') {
      $this->_page = 1;
    } elseif ($field === 'limit') {
      $this->_limit = null;
    } elseif ($field === 'must') {
      $this->_must = [];
    } elseif ($field === 'mustNot') {
      $this->_mustNot = [];
    } elseif ($field === 'aggs') {
      $this->_aggs = [];
    } elseif ($field === 'fields') {
      $this->_fields = [];
    } elseif ($field === 'highlighter') {
      $this->_highlighter = null;
    } elseif ($field === 'functionScore') {
      $this->_functionScore = null;
    }
  }

  /**
   * Enable sorting by random
   */
  public function sortByRandom() {
    $this->_sortByRandom = true;
  }

  /**
   * Add a decay function score query. See https://www.elastic.co/guide/en/elasticsearch/reference/6.8/query-dsl-function-score-query.html#function-decay
   * @param string $field
   * @param string $type
   * @param $offset
   * @param $scale
   * @param $decay
   * @param \NoSql_QueryBuilder $subquery
   * @param $origin
   */
  public function decayFunctionScore(
    string $field,
    string $type,
           $offset,
           $scale,
           $decay,
    NoSql_QueryBuilder $subquery,
    $origin = null
  ) {
    $functions = [
      [
        "$type" => [
          "$field" => [
            'offset' => $offset,
            'scale' => $scale,
            'decay' => $decay,
          ],
        ],
      ],
    ];
    if ($origin) {
      $functions[0]["$type"]["$field"]['origin'] = $origin;
    }
    $this->_functionScore = [
      'functions' => $functions,
      'query' => $subquery->getBody()['query'],
    ];
  }

  /**
   * Get the function score definition
   * @return array|null
   */
  public function getFunctionScore() {
    return $this->_functionScore;
  }

  /**
   * Get the current array of must filters
   * @return array
   */
  public function getMust() {
    return $this->_must;
  }

  /**
   * Require matching of a subquery
   * @param NoSql_QueryBuilder $subquery  The query object
   * @return NoSql_QueryBuilder
   */
  public function should(NoSql_QueryBuilder $subquery): NoSql_QueryBuilder {
    $this->_must[] = [
      'bool' => [
        'should' => $subquery->getMust(),
      ],
    ];
    return $this;
  }

  /**
   * This will build a nested bool must query inside a bool should
   *
   * @param array $subqueries - An array of subqueries to add
   * @return NoSql_QueryBuilder
   */
  public function shouldAny(array $subqueries): NoSql_QueryBuilder {
    $shoulds = [];
    foreach ($subqueries as $query) {
      $shoulds[] = [
        'bool' => [
          'must' => $query->getMust(),
        ],
      ];
    }
    $this->_must[] = [
      'bool' => [
        'should' => $shoulds,
      ],
    ];
    return $this;
  }

  /**
   * Require non matching of a subquery
   * @param NoSql_QueryBuilder $subquery  The query object
   * @return NoSql_QueryBuilder
   */
  public function shouldNot(NoSql_QueryBuilder $subquery): NoSql_QueryBuilder {
    $this->_must[] = [
      'bool' => [
        'should' => [
          'bool' => [
            'must_not' => $subquery->getMust(),
          ],
        ],
      ],
    ];
    return $this;
  }

  /**
   * @param array $value  The value of the "highlight" option
   * @return NoSql_QueryBuilder
   */
  public function useHighlighter(array $value): NoSql_QueryBuilder {
    $this->_highlighter = $value;
    return $this;
  }

  /**
   * Return the fields to fetch
   * @return array
   */
  public function getFields(): array {
    return $this->_fields;
  }

  /**
   * Return the query body
   * @return array
   */
  public function getBody(): array {
    $body = [];
    if (count($this->_must)) {
      $body['query'] = ['bool' => ['must' => $this->_must]];
    }
    if (count($this->_mustNot)) {
      if (!isset($body['query'])) {
        $body = ['query' => ['bool' => []]];
      }
      $body['query']['bool']['must_not'] = $this->_mustNot;
    }
    if (!empty($this->_highlighter)) {
      $body['highlight'] = $this->_highlighter;
    }
    if (count($this->_aggs)) {
      $body['aggs'] = $this->_aggs;
    }
    if ($this->_sortByRandom) {
      $body['query']['function_score'] = [
        'query' => ['bool' => $body['query']['bool']],
        // use stdClass because random_store must be an empty JSON object
        'random_score' => new stdClass(),
      ];
      unset($body['query']['bool']);
    } elseif (!empty($this->_functionScore)) {
      $body['query']['function_score'] = $this->_functionScore;
    }
    return $body;
  }

  /**
   * Return the limit and from based on limit and page
   * @return array
   */
  public function getOptions(): array {
    $options = [];
    if ($this->_limit !== null) {
      $options['size'] = $this->_limit;
      if ($this->_page > 1) {
        $options['from'] = $this->_limit * ($this->_page - 1);
      }
    }
    if (count($this->_sorts)) {
      $options['sort'] = $this->_sorts;
    }
    return $options;
  }

  /**
   * Get a JSON representation of the query body suitable for Kibana
   * @return string
   */
  public function toJson() {
    $root = array_merge(
      empty($this->_fields) ? [] : ['_source' => $this->_fields],
      $this->getBody(),
      $this->getOptions(),
		);
    return json_encode($root, JSON_PRETTY_PRINT);
  }

  /**
   * Get a full Kibana query string for the given model
   * @param NoSql_Model_Abstract $model  The model to pull the name from
   * @return string
   */
  public function toKibana(NoSql_Model_Abstract $model) {
    $json = $this->toJson();
    $prefix = shReadEnv('NOSQL_TABLE_PREFIX', '');
    return "GET $prefix$model->fullName/$model->name/_search\n$json";
  }
}
