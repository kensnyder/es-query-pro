const doesIndexExist = require('./doesIndexExist.js');

describe('doesIndexExist', () => {
  it('should return false for missing tables', async () => {
    const { result, error, details } = await doesIndexExist('nothing_at_all');
    expect(result).toBe(false);
    expect(error).toBe(null);
    expect(typeof details).toBe('object');
  });
});
