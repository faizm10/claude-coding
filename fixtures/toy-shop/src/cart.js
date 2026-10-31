/** Sum of price × quantity for every line item. */
export function total(items) {
  return items.reduce((sum, item) => sum + item.price, 0);
}

export function itemCount(items) {
  return items.reduce((n, item) => n + item.quantity, 0);
}
