const {
  dateToNumber,
  processRecord,
  unixToDate,
  unProcessRecord,
} = require('./dates.js');

describe('dateToNumber', () => {
  it('should pass through numbers', () => {
    const date = 1640712193000;
    expect(dateToNumber(date)).toBe(date);
  });
  it('should parse strings', () => {
    const date = '2021-12-28T10:46:42';
    expect(dateToNumber(date)).toBe(1640688402000);
  });
  it('should handle Date objects', () => {
    const date = new Date(1640688402000);
    expect(dateToNumber(date)).toBe(1640688402000);
  });
  it('should convert other values to null', () => {
    const date = 'foobar';
    expect(dateToNumber(date)).toBe(null);
  });
});

describe('processRecord', () => {
  it('should leave other values alone', () => {
    const record = { foo: 'bar', ticks: 300 };
    processRecord(record);
    expect(record.foo).toBe('bar');
    expect(record.ticks).toBe(300);
  });
  it('should process "date" fields', () => {
    const record = { date: '2021-12-28T10:46:42' };
    processRecord(record);
    expect(record.date).toBe(1640688402000);
  });
  it('should process "date_*" fields', () => {
    const record = { date_before: '2021-12-28T10:46:42' };
    processRecord(record);
    expect(record.date_before).toBe(1640688402000);
  });
  it('should process "*_date" fields', () => {
    const record = { after_date: '2021-12-28T10:46:42' };
    processRecord(record);
    expect(record.after_date).toBe(1640688402000);
  });
  it('should process "*_at" fields', () => {
    const record = { created_at: '2021-12-28T10:46:42' };
    processRecord(record);
    expect(record.created_at).toBe(1640688402000);
  });
});

describe('unixToDate', () => {
  it('should pass through null', () => {
    const date = null;
    expect(unixToDate(date)).toBe(null);
  });
  it('should convert to date', () => {
    const date = 1640712193000;
    expect(unixToDate(date)).toEqual(new Date(date));
  });
});

describe('unProcessRecord', () => {
  it('should pass through null', () => {
    const record = { created_at: null };
    unProcessRecord(record);
    expect(record.created_at).toBe(null);
  });
  it('should convert to date', () => {
    const record = { created_at: 1640688402000 };
    unProcessRecord(record);
    expect(record.created_at).toEqual(new Date(1640688402000));
  });
});
