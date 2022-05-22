import ConfigurationProvider from "./ConfigurationProvider";
import WorkspaceProvider from "./WorkspaceProvider";
import CompletionItemsProvider from "./CompletionItemsProvider";
import GotoDefinitionProvider from "./GotoDefinitionProvider";
import HoverContentProvider from "./HoverContentProvider";
import SignatureHelpProvider from "./SignatureHelpProvider";
import DocumentFormatingProvider from "./DocumentFormattingProvider";
import DocumentRangeFormattingProvider from "./DocumentRangeFormattingProvider";

export enum TriggerCharacters {
  dot = ".",
  leftRoundBracket = "(",
  comma = ",",
}

export {
  ConfigurationProvider,
  WorkspaceProvider,
  CompletionItemsProvider,
  GotoDefinitionProvider,
  HoverContentProvider,
  SignatureHelpProvider,
  DocumentFormatingProvider,
  DocumentRangeFormattingProvider,
};
