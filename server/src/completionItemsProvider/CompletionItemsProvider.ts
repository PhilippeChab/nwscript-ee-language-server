import { URI } from "vscode-uri";

import Tree from "../tree/Tree";

export default class CompletionItemsProvider {
  static buildItems = (documentUri: URI) => {
    return new Tree(documentUri).build().retrieveItems();
  };
}
