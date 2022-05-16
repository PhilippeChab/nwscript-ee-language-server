import { LanguageTypes } from "../../Tokenizer/constants";

export default class Builder {
  protected static prependStruct(type: string) {
    if (!(type in LanguageTypes)) {
      return "struct ";
    }

    return "";
  }
}
