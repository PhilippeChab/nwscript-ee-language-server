export default class Dictionnary<K extends string, V> {
  private readonly _dict: Record<K, V>;

  constructor() {
    this._dict = {} as Record<K, V>;
  }

  protected add(key: K, value: V) {
    if (!this.exist(key)) {
      this._dict[key] = value;
    }
  }

  protected overwrite(key: K, value: V) {
    this._dict[key] = value;
  }

  public get(key: K) {
    return this._dict[key];
  }

  public exist(key: K) {
    return Boolean(this._dict[key]);
  }

  public forEach(cb: (value: V) => void) {
    Object.values<V>(this._dict).forEach((value) => cb(value));
  }
}
