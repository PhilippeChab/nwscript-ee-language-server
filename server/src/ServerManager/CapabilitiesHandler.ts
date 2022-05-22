import { ClientCapabilities, ServerCapabilities, TextDocumentSyncKind } from "vscode-languageserver";
import { TriggerCharacters } from "../Providers";

export default class CapabilitiesHandler {
  public clientCapabilities: ClientCapabilities;
  public capabilities: ServerCapabilities;

  constructor(clientCapabilities: ClientCapabilities) {
    this.clientCapabilities = clientCapabilities;
    this.capabilities = this.initializeServerCapabilties();
  }

  public get supportsWorkspaceFolders(): boolean {
    return (this.clientCapabilities.workspace && !!this.clientCapabilities.workspace.workspaceFolders) || false;
  }

  public get supportsWorkspaceConfiguration(): boolean {
    return (this.clientCapabilities.workspace && !!this.clientCapabilities.workspace.configuration) || false;
  }

  private initializeServerCapabilties(): ServerCapabilities {
    const capabilities: ServerCapabilities = {
      textDocumentSync: TextDocumentSyncKind.Incremental as TextDocumentSyncKind,
      documentFormattingProvider: true,
      documentRangeFormattingProvider: true,
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

    if (this.clientCapabilities.workspace && this.clientCapabilities.workspace.workspaceFolders) {
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
