const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});

const compactCurrencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 0
});

export function formatMoney(value) {
  const numericValue = Number(value || 0);
  return currencyFormatter.format(Number.isFinite(numericValue) ? numericValue : 0);
}

export function formatCompactMoney(value) {
  const numericValue = Number(value || 0);
  return compactCurrencyFormatter.format(Number.isFinite(numericValue) ? numericValue : 0);
}
