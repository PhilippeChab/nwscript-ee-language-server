import { ClientCapabilities, ServerCapabilities, TextDocumentSyncKind, MarkupKind } from "vscode-languageserver";
import { TriggerCharacters } from "../Providers";

export default class CapabilitiesHandler {
  public capabilities: ServerCapabilities;

  constructor(private readonly clientCapabilities: ClientCapabilities) {
    this.clientCapabilities = clientCapabilities;
    this.capabilities = this.initializeServerCapabilities();
  }

  public getSupportsWorkspaceFolders(): boolean {
    return (this.clientCapabilities.workspace && !!this.clientCapabilities.workspace.workspaceFolders) || false;
  }

  public getSupportsMarkdownHover(): boolean {
    return this.clientCapabilities.textDocument?.hover?.contentFormat?.includes(MarkupKind.Markdown) === true;
  }

  public getSupportsHierarchicalSymbols(): boolean {
    return this.clientCapabilities.textDocument?.documentSymbol?.hierarchicalDocumentSymbolSupport === true;
  }

  public getSupportsConfigurationRegistration(): boolean {
    return this.clientCapabilities.workspace?.didChangeConfiguration?.dynamicRegistration === true;
  }

  public getSupportsWorkspaceConfiguration(): boolean {
    return (this.clientCapabilities.workspace && !!this.clientCapabilities.workspace.configuration) || false;
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
}
