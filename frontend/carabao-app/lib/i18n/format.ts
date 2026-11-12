// Fills "{name}" placeholders in a UI string: fmt(t.cart.itemCount, { count: 3 }).
export function fmt(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

/** Picks the singular or plural form by count, then fills placeholders. */
export function plural(
  count: number,
  one: string,
  many: string,
  values: Record<string, string | number> = {},
): string {
  return fmt(count === 1 ? one : many, { count, ...values });
}
