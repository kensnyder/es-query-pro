const base51 = '123456789BCDFGHJKLMNPQRSTVWXYZbcdfghjklmnpqrstvwxyz';

/**
 * Create a random string with no symbols, no vowels, and no "0"
 * The number of possible ids will be 51 ** length because our vowel-less alphabet is 51 characters
 * So to have collision less likely than UUIDs, you'll need a minimum length of 23 characters *
 * @param maxLength
 */
export default function createSlug(maxLength: number):string {
  let chars = '';
  for (let i = maxLength; i > 0; i--) {
    chars += base51[Math.floor(Math.random() * 51)];
  }
  return chars;
};


