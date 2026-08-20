/**
 * 持久化端口(runtime contracts §6)。
 * 领域层只依赖接口;首切片实现为原子写 JSON 文件,SQLite 后置且替换时领域层零改动。
 */
export interface ObjectStore<T extends { id: string }> {
  get(id: string): Promise<T | null>;
  put(obj: T): Promise<void>;
  list(filter?: (obj: T) => boolean): Promise<T[]>;
}

/** GrowthEvent 专用:只追加,不修改。 */
export interface EventLog<E> {
  append(event: E): Promise<void>;
  replay(subjectId: string): AsyncIterable<E>;
}
