const dateParser = require('any-date-parser');

function _isDateField(field) {
  return /(^date$|^date_.|._date$|._at$)/.test(field);
}

function dateToNumber(date) {
  if (typeof date === 'number') {
    return date;
  } else if (typeof date === 'string' || date instanceof Date) {
    const parsed = dateParser.fromAny(date);
    if (parsed instanceof Date) {
      return parsed.valueOf();
    }
  }
  return null;
}

function processRecord(record) {
  for (const field of Object.keys(record)) {
    if (_isDateField(field) && typeof record[field] === 'string') {
      record[field] = dateToNumber(record[field]);
    }
  }
}

function unixToDate(timestamp) {
  if (typeof timestamp === 'number' && timestamp > 0) {
    return new Date(timestamp);
  }
  return timestamp;
}

function unProcessRecord(record) {
  for (const field of Object.keys(record)) {
    if (_isDateField(field) && typeof record[field] === 'number') {
      record[field] = unixToDate(record[field]);
    }
  }
}

const dates = {
  dateToNumber,
  processRecord,
  unixToDate,
  unProcessRecord,
};

module.exports = dates;
