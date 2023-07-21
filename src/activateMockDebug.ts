/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
/*
 * activateMockDebug.ts containes the shared extension code that can be executed both in node.js and the browser.
 */

"use strict";

import * as vscode from "vscode";
import {
  WorkspaceFolder,
  DebugConfiguration,
  ProviderResult,
  CancellationToken,
} from "vscode";
import { MockDebugSession } from "./mockDebug";
import { FileAccessor } from "./mockRuntime";
import { TextEncoder } from "node:util";

export function activateMockDebug(
  context: vscode.ExtensionContext,
  factory?: vscode.DebugAdapterDescriptorFactory
) {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "extension.oberon-language-server.runEditorContents",
      (resource: vscode.Uri) => {
        let targetResource = resource;
        if (!targetResource && vscode.window.activeTextEditor) {
          targetResource = vscode.window.activeTextEditor.document.uri;
        }
        if (targetResource) {
          vscode.debug.startDebugging(
            undefined,
            {
              type: "mock",
              name: "Run File",
              request: "launch",
              program: targetResource.fsPath,
            },
            { noDebug: true }
          );
        }
      }
    ),
    vscode.commands.registerCommand(
      "extension.oberon-language-server.debugEditorContents",
      (resource: vscode.Uri) => {
        let targetResource = resource;
        if (!targetResource && vscode.window.activeTextEditor) {
          targetResource = vscode.window.activeTextEditor.document.uri;
        }
        if (targetResource) {
          vscode.debug.startDebugging(undefined, {
            type: "mock",
            name: "Debug File",
            request: "launch",
            program: targetResource.fsPath,
            stopOnEntry: true,
          });
        }
      }
    ),
    vscode.commands.registerCommand(
      "extension.oberon-language-server.toggleFormatting",
      (variable) => {
        const ds = vscode.debug.activeDebugSession;
        if (ds) {
          ds.customRequest("toggleFormatting");
        }
      }
    )
  );

  // register a configuration provider for 'mock' debug type
  const provider = new MockConfigurationProvider();
  context.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider("mock", provider)
  );

  // register a dynamic configuration provider for 'mock' debug type
  context.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider(
      "mock",
      {
        provideDebugConfigurations(
          folder: WorkspaceFolder | undefined
        ): ProviderResult<DebugConfiguration[]> {
          return [
            {
              name: "Dynamic Launch",
              request: "launch",
              type: "mock",
              program: "${file}",
            },
            {
              name: "Another Dynamic Launch",
              request: "launch",
              type: "mock",
              program: "${file}",
            },
            {
              name: "Mock Launch",
              request: "launch",
              type: "mock",
              program: "${file}",
            },
          ];
        },
      },
      vscode.DebugConfigurationProviderTriggerKind.Dynamic
    )
  );

  if (!factory) {
    factory = new InlineDebugAdapterFactory();
  }
  context.subscriptions.push(
    vscode.debug.registerDebugAdapterDescriptorFactory("mock", factory)
  );
  if ("dispose" in factory) {
    context.subscriptions.push(factory);
  }
}

class MockConfigurationProvider implements vscode.DebugConfigurationProvider {
  /**
   * Massage a debug configuration just before a debug session is being launched,
   * e.g. add all missing attributes to the debug configuration.
   */
  resolveDebugConfiguration(
    folder: WorkspaceFolder | undefined,
    config: DebugConfiguration,
    token?: CancellationToken
  ): ProviderResult<DebugConfiguration> {
    // if launch.json is missing or empty
    if (!config.type && !config.request && !config.name) {
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.languageId === "oberon") {
        config.type = "mock";
        config.name = "Launch";
        config.request = "launch";
        config.program = "${file}";
        config.stopOnEntry = true;
      }
    }

    if (!config.program) {
      return vscode.window
        .showInformationMessage("Cannot find a program to debug")
        .then((_) => {
          return undefined; // abort launch
        });
    }

    return config;
  }
}

export const workspaceFileAccessor: FileAccessor = {
  isWindows: false,
  async readFile(path: string): Promise<Uint8Array> {
    let uri: vscode.Uri;
    try {
      uri = pathToUri(path);
    } catch (e) {
      return new TextEncoder().encode(`cannot read '${path}'`);
    }

    return await vscode.workspace.fs.readFile(uri);
  },
  async writeFile(path: string, contents: Uint8Array) {
    await vscode.workspace.fs.writeFile(pathToUri(path), contents);
  },
};

function pathToUri(path: string) {
  try {
    return vscode.Uri.file(path);
  } catch (e) {
    return vscode.Uri.parse(path);
  }
}

class InlineDebugAdapterFactory
  implements vscode.DebugAdapterDescriptorFactory
{
  createDebugAdapterDescriptor(
    _session: vscode.DebugSession
  ): ProviderResult<vscode.DebugAdapterDescriptor> {
    return new vscode.DebugAdapterInlineImplementation(
      new MockDebugSession(workspaceFileAccessor)
    );
  }
}
