/*!
 * NWScript EE Language Server
 * Copyright (c) 2022-2026 Philippe Chabot and contributors
 * https://github.com/PhilippeChab/nwscript-ee-language-server
 * Licensed under GPL-3.0-only with the additional terms in the root NOTICE file.
 */

export default class Dictionnary<K extends string, V> {
  private readonly _dict: Record<K, V>;

  constructor() {
    this._dict = {} as Record<K, V>;
  }

  protected add(key: K, value: V) {
    if (!this.exists(key)) {
      this._dict[key] = value;
    }
  }

  protected overwrite(key: K, value: V) {
    this._dict[key] = value;
  }

  public get(key: K): V | undefined {
    return this._dict[key];
  }

  public exists(key: K) {
    return Boolean(this._dict[key]);
  }

  public forEach(cb: (value: V) => void) {
    Object.values<V>(this._dict).forEach((value) => cb(value));
  }

  public debug() {
    console.log(JSON.stringify(Object.keys(this._dict), null, 2));
  }
}
