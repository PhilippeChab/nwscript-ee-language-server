/*!
 * NWScript EE Language Server
 * Copyright (c) 2022-2026 Philippe Chabot and contributors
 * https://github.com/PhilippeChab/nwscript-ee-language-server
 * Licensed under GPL-3.0-only with the additional terms in the root NOTICE file.
 */

import ConfigurationProvider from "./ConfigurationProvider";
import WorkspaceProvider from "./WorkspaceProvider";
import CompletionItemsProvider from "./CompletionItemsProvider";
import GotoDefinitionProvider from "./GotoDefinitionProvider";
import HoverContentProvider from "./HoverContentProvider";
import SignatureHelpProvider from "./SignatureHelpProvider";
import DocumentFormatingProvider from "./DocumentFormattingProvider";
import DocumentRangeFormattingProvider from "./DocumentRangeFormattingProvider";
import DiagnosticsProvider from "./DiagnosticsProvider";
import SymbolsProvider from "./SymbolsProvider";

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
  DiagnosticsProvider,
  SymbolsProvider,
};
