export function indexRowsByKey<Row, Key>(
  rows: Iterable<Row>,
  keyFor: (row: Row) => Key,
): Map<Key, Row[]> {
  const indexed = new Map<Key, Row[]>();
  for (const row of rows) {
    const key = keyFor(row);
    const matches = indexed.get(key);
    if (matches) matches.push(row);
    else indexed.set(key, [row]);
  }
  return indexed;
}
