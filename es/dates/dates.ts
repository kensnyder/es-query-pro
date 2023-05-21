// @ts-expect-error TS(2580): Cannot find name 'require'. Do you need to install... Remove this comment to see the full error message
const dateParser = require('any-date-parser');

function _isDateField(field: any) {
  return /(^date$|^date_.|._date$|._at$)/.test(field);
}

// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'dateToNumb... Remove this comment to see the full error message
function dateToNumber(date: any) {
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

// @ts-expect-error TS(2393): Duplicate function implementation.
function processRecord(record: any) {
  for (const field of Object.keys(record)) {
    if (_isDateField(field) && typeof record[field] === 'string') {
      record[field] = dateToNumber(record[field]);
    }
  }
}

// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'unixToDate... Remove this comment to see the full error message
function unixToDate(timestamp: any) {
  if (typeof timestamp === 'number' && timestamp > 0) {
    return new Date(timestamp);
  }
  return timestamp;
}

// @ts-expect-error TS(2393): Duplicate function implementation.
function unProcessRecord(record: any) {
  for (const field of Object.keys(record)) {
    if (_isDateField(field) && typeof record[field] === 'number') {
      record[field] = unixToDate(record[field]);
    }
  }
}

// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'dates'.
const dates = {
  dateToNumber,
  processRecord,
  unixToDate,
  unProcessRecord,
};

// @ts-expect-error TS(2580): Cannot find name 'module'. Do you need to install ... Remove this comment to see the full error message
module.exports = dates;
