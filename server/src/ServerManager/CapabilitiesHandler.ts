/*!
 * NWScript EE Language Server
 * Copyright (c) 2022-2026 Philippe Chabot and contributors
 * https://github.com/PhilippeChab/nwscript-ee-language-server
 * Licensed under GPL-3.0-only with the additional terms in the root NOTICE file.
 */

import { ClientCapabilities, ServerCapabilities, TextDocumentSyncKind } from "vscode-languageserver";
import { TriggerCharacters } from "../Providers";

export default class CapabilitiesHandler {
  public capabilities: ServerCapabilities;

  constructor(private readonly clientCapabilities: ClientCapabilities) {
    this.clientCapabilities = clientCapabilities;
    this.capabilities = this.initializeServerCapabilities();
  }

  private initializeServerCapabilities(): ServerCapabilities {
    const capabilities: ServerCapabilities = {
      textDocumentSync: {
        openClose: true,
        willSave: true,
        save: true,
        change: TextDocumentSyncKind.Full,
      },
      documentFormattingProvider: true,
      documentRangeFormattingProvider: true,
      documentSymbolProvider: true,
      definitionProvider: true,
      hoverProvider: true,
      completionProvider: {
        resolveProvider: true,
        triggerCharacters: [TriggerCharacters.dot],
      },
      signatureHelpProvider: {
        triggerCharacters: [TriggerCharacters.leftRoundBracket, TriggerCharacters.comma],
      },
    };

    if (this.clientCapabilities.workspace?.workspaceFolders) {
      capabilities.workspace = {
        workspaceFolders: {
          supported: true,
          changeNotifications: true,
        },
      };
    }

    return capabilities;
  }

  public getSupportsWorkspaceFolders(): boolean {
    return (this.clientCapabilities.workspace && !!this.clientCapabilities.workspace.workspaceFolders) || false;
  }

  public getSupportsWorkspaceConfiguration(): boolean {
    return (this.clientCapabilities.workspace && !!this.clientCapabilities.workspace.configuration) || false;
  }
}
