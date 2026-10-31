/** Apply a percentage discount, e.g. applyDiscount(200, 25) === 150. */
export function applyDiscount(price, percent) {
  if (percent < 0 || percent > 100) throw new RangeError("percent must be 0-100");
  return price - percent;
}
