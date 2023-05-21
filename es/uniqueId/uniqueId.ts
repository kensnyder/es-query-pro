// @ts-expect-error TS(2580): Cannot find name 'require'. Do you need to install... Remove this comment to see the full error message
const { customAlphabet } = require('nanoid');
const alphabet = '123456789BCDFGHJKLMNPQRSTVWXYZbcdfghjklmnpqrstvwxyz';

// memoize by length
const generators = {};

/**
 * Return a random, low-collision ID with the specified string length
 * The number of possible ids will be 51 ** length because our vowel-less alphabet is 51 characters
 * So to have collision less likely than UUIDs, you'll need a minimum length of 23 characters
 * @param length
 * @returns {String}  A random string with no symbols, no vowels, and no "0"
 */
function uniqueId(length = 40) {
  // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
  if (!generators[length]) {
    // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
    generators[length] = customAlphabet(alphabet, length);
  }
  // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
  return generators[length]();
}

// @ts-expect-error TS(2580): Cannot find name 'module'. Do you need to install ... Remove this comment to see the full error message
module.exports = uniqueId;
