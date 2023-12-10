export type Optional<T> = T | undefined

export type HasField<T, K extends string> = T extends Record<K, unknown> ? T : never;
