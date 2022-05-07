import { readFileSync } from "fs";
import { map as mapAsync, each as eachAsync } from "async";
import { CompletionItem } from "vscode-languageserver/node";
import { URI } from "vscode-uri";
import { GlobSync } from "glob";

export default class TreeNode {
  uri: URI;
  children: TreeNode[];
  parent: TreeNode | null;
  definitions: CompletionItem[];

  constructor(uri: URI) {
    this.uri = uri;
    this.children = [];
    this.parent = null;
    this.definitions = [];
  }

  linkChild = (child: TreeNode) => {
    child.parent = this;
    this.children.push(child);
  };

  readFile = (uri: URI) => {
    return readFileSync(uri.fsPath).toString();
  };

  findFile = (filename: string) => {
    return new GlobSync(`src/**/${filename}`).found[0];
  };

  findChildren = () => {
    const fileContent = this.readFile(this.uri);
    const includes =
      fileContent.match(/#include (["'])(?:(?=(\\?))\2.)*?\1/gm)?.map((include) => include.split(" ")[1].slice(1, -1)) || [];

    const childUris = includes.map(this.findFile);

    childUris.forEach((childUri) => {
      const children = new TreeNode(URI.file(childUri));

      this.linkChild(children);
      children.findChildren();
    });
  };

  getDefinitions = (): CompletionItem[] => {
    return this.definitions.concat(this.children.flatMap((child) => child.getDefinitions()));
  };
}
