/** Read a value that an earlier construction step guarantees is present. */
export function requiredMapValue<K, V>(map: ReadonlyMap<K, V>, key: K): V {
  const value = map.get(key);
  if (value === undefined) throw new Error(`Missing required map value: ${String(key)}`);
  return value;
}
