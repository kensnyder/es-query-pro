// @ts-expect-error TS(2580): Cannot find name 'require'. Do you need to install... Remove this comment to see the full error message
import dateParser from 'any-date-parser';

function _isDateField(field: any) {
  return /(^date$|^date_.|._date$|._at$)/.test(field);
}

export function dateToNumber(date: any) {
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

export function processRecord(record: any) {
  for (const field of Object.keys(record)) {
    if (_isDateField(field) && typeof record[field] === 'string') {
      record[field] = dateToNumber(record[field]);
    }
  }
}

export function unixToDate(timestamp: any) {
  if (typeof timestamp === 'number' && timestamp > 0) {
    return new Date(timestamp);
  }
  return timestamp;
}

export function unProcessRecord(record: any) {
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

export default dates;
