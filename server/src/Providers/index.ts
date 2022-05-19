import ConfigurationProvider from "./ConfigurationProvider";
import CompletionItemsProvider from "./CompletionItemsProvider";
import GotoDefinitionProvider from "./GotoDefinitionProvider";
import HoverContentProvider from "./HoverContentProvider";
import WorkspaceProvider from "./WorkspaceProvider";

export enum TriggerCharacters {
  dot = ".",
}

export { ConfigurationProvider, WorkspaceProvider, CompletionItemsProvider, GotoDefinitionProvider, HoverContentProvider };
