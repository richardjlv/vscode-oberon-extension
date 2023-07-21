/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
/*
 * extension.ts (and activateMockDebug.ts) forms the "plugin" that plugs into VS Code and contains the code that
 * connects VS Code with the debug adapter.
 *
 * extension.ts contains code for launching the debug adapter in three different ways:
 * - as an external program communicating with VS Code via stdin/stdout,
 * - as a server process communicating with VS Code via sockets or named pipes, or
 * - as inlined code running in the extension itself (default).
 *
 * Since the code in extension.ts uses node.js APIs it cannot run in the browser.
 */

"use strict";

import * as Net from "net";
import * as vscode from "vscode";
import { randomBytes } from "crypto";
import { tmpdir } from "os";
import { join } from "path";
import { platform } from "process";
import { exec } from "child_process";
import { ProviderResult } from "vscode";
import { MockDebugSession } from "./mockDebug";
import { activateMockDebug, workspaceFileAccessor } from "./activateMockDebug";

const runMode: "external" | "server" | "namedPipeServer" | "inline" = "inline";

export function activate(context: vscode.ExtensionContext) {
  let complete = vscode.languages.registerCompletionItemProvider("oberon", {
    provideCompletionItems(
      document: vscode.TextDocument,
      position: vscode.Position
    ) {
      const lineText = document.lineAt(position.line).text;
      const prefix = lineText.slice(0, position.character).toLowerCase();

      const suggestions = [
        "BEGIN",
        "END",
        "IF",
        "FOR",
        "REPEAT",
        "ELSIF",
        "UNTIL",
        "WHILE",
        "DO",
        "ELSE",
        "THEN",
        "CASE",
        "BY",
        "RETURN",
        "TO",
        "IS",
        "DIV",
        "MOD",
        "OR",
        "IN",
        "IMPORT",
        "BEGIN",
        "TYPE",
        "CONST",
        "MODULE",
        "VAR",
        "PROCEDURE",
        "END",
        "FALSE",
        "NIL",
        "TRUE",
        "POINTER",
        "RECORD",
        "ARRAY",
        "MAP",
        "OF",
      ];

      const filteredSuggestions = suggestions.filter((suggestion) =>
        suggestion.toLowerCase().startsWith(prefix)
      );

      const completionItems = filteredSuggestions.map((suggestion) => {
        const completionItem = new vscode.CompletionItem(suggestion);
        return completionItem;
      });

      return completionItems;
    },
  });

  let repl = vscode.commands.registerCommand(
    "extension.oberon-language-server.repl",
    () => {
      const terminalName = "Oberon REPL";
      const terminal =
        vscode.window.terminals.find((term) => term.name === terminalName) ??
        vscode.window.createTerminal(terminalName);
      terminal.show();

      const dllPath = vscode.extensions.getExtension(
        context.extension.id
      )?.extensionPath;
      const commandToExecute = `java -jar ${dllPath}/oberon-lang-assembly-0.1.1.jar repl`;

      terminal.sendText(commandToExecute);
    }
  );

  let typeChecker = vscode.commands.registerCommand(
    "extension.oberon-language-server.typeChecker",
    () => {
      if (vscode.debug.activeDebugSession) {
        vscode.commands.executeCommand(
          "extension.oberon-language-server.typeCheck"
        );
      } else {
        vscode.window.showErrorMessage(
          "É necessário estar executando o 'Debug Oberon' para executar esse comando."
        );
      }
    }
  );

  let typeCheck = vscode.commands.registerCommand(
    "extension.oberon-language-server.typeCheck",
    () => {
      const debugConsole = vscode.debug.activeDebugConsole;

      const dllPath = vscode.extensions.getExtension(
        context.extension.id
      )?.extensionPath;
      const commandToExecute = `java -jar ${dllPath}/oberon-lang-assembly-0.1.1.jar typeChecker -i ${vscode.workspace.rootPath}/main.oberon`;

      exec(commandToExecute, (error, stdout, stderr) => {
        if (error !== null) {
          console.log(`Error: ${error}`);
          debugConsole.appendLine(`${error}`);
        } else {
          console.log("stdout", stdout);
          debugConsole.appendLine(stdout);
        }
      });
    }
  );

  vscode.workspace.onDidSaveTextDocument((event) => {
    const launchConfiguration = vscode.workspace.getConfiguration("launch");
    const fileName = launchConfiguration.configurations[0].program;

    if (fileName.split("/").pop() === event.fileName.split("/").pop()) {
      vscode.commands.executeCommand(
        "extension.oberon-language-server.typeCheck"
      );
    }
  });

  context.subscriptions.push(complete, repl, typeCheck, typeChecker);

  switch (runMode) {
    case "server":
      activateMockDebug(
        context,
        new MockDebugAdapterServerDescriptorFactory(context.extension.id)
      );
      break;

    case "namedPipeServer":
      activateMockDebug(
        context,
        new MockDebugAdapterNamedPipeServerDescriptorFactory(
          context.extension.id
        )
      );
      break;

    case "external":
    default:
      activateMockDebug(context, new DebugAdapterExecutableFactory());
      break;

    case "inline":
      activateMockDebug(context);
      break;
  }
}

export function deactivate() {}

class DebugAdapterExecutableFactory
  implements vscode.DebugAdapterDescriptorFactory
{
  createDebugAdapterDescriptor(
    _session: vscode.DebugSession,
    executable: vscode.DebugAdapterExecutable | undefined
  ): ProviderResult<vscode.DebugAdapterDescriptor> {
    if (!executable) {
      const command = "absolute path to my DA executable";
      const args = ["some args", "another arg"];
      const options = {
        cwd: "working directory for executable",
        env: { envVariable: "some value" },
      };
      executable = new vscode.DebugAdapterExecutable(command, args, options);
    }

    return executable;
  }
}

class MockDebugAdapterServerDescriptorFactory
  implements vscode.DebugAdapterDescriptorFactory
{
  private server?: Net.Server;
  constructor(private readonly id: string) {}

  createDebugAdapterDescriptor(
    session: vscode.DebugSession,
    executable: vscode.DebugAdapterExecutable | undefined
  ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
    if (!this.server) {
      this.server = Net.createServer((socket) => {
        const session = new MockDebugSession(workspaceFileAccessor, this.id);
        session.setRunAsServer(true);
        session.start(socket as NodeJS.ReadableStream, socket);
      }).listen(0);
    }

    return new vscode.DebugAdapterServer(
      (this.server.address() as Net.AddressInfo).port
    );
  }

  dispose() {
    if (this.server) {
      this.server.close();
    }
  }
}

class MockDebugAdapterNamedPipeServerDescriptorFactory
  implements vscode.DebugAdapterDescriptorFactory
{
  private server?: Net.Server;
  constructor(private readonly id: string) {}

  createDebugAdapterDescriptor(
    session: vscode.DebugSession,
    executable: vscode.DebugAdapterExecutable | undefined
  ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
    if (!this.server) {
      const pipeName = randomBytes(10).toString("utf8");
      const pipePath =
        platform === "win32"
          ? join("\\\\.\\pipe\\", pipeName)
          : join(tmpdir(), pipeName);
      this.server = Net.createServer((socket) => {
        const session = new MockDebugSession(workspaceFileAccessor);
        session.setRunAsServer(true);
        session.start(<NodeJS.ReadableStream>socket, socket);
      }).listen(pipePath);
    }

    return new vscode.DebugAdapterNamedPipeServer(
      this.server.address() as string
    );
  }

  dispose() {
    if (this.server) {
      this.server.close();
    }
  }
}
