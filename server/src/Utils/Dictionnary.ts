import type Logger from "../Logger/Logger";
export default class Dictionnary<K extends string, V> {
  private readonly values = new Map<K, V>();

  public get(key: K): V | undefined {
    return this.values.get(key);
  }

  public exists(key: K) {
    return this.values.has(key);
  }

  public forEach(cb: (value: V) => void) {
    this.values.forEach(cb);
  }

  public debug(logger: Logger) {
    logger.debug(JSON.stringify([...this.values.keys()], null, 2));
  }

  protected add(key: K, value: V) {
    if (!this.exists(key)) this.values.set(key, value);
  }

  protected overwrite(key: K, value: V) {
    this.values.set(key, value);
  }

  protected delete(key: K) {
    this.values.delete(key);
  }
}
