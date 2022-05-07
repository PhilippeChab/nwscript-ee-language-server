import { URI } from "vscode-uri";

import TreeNode from "./TreeNode";

export default class Tree {
  root: TreeNode;

  constructor(rootUri: URI) {
    this.root = new TreeNode(rootUri);
  }

  build = () => {
    this.root.findChildren();

    return this;
  };

  retrieveItems = () => {
    return this.root.getDefinitions();
  };
}
