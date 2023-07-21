/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
/*
 * mockDebug.ts implements the Debug Adapter that "adapts" or translates the Debug Adapter Protocol (DAP) used by the client (e.g. VS Code)
 * into requests and events of the real "execution engine" or "debugger" (here: class MockRuntime).
 * When implementing your own debugger extension for VS Code, most of the work will go into the Debug Adapter.
 * Since the Debug Adapter is independent from VS Code, it can be used in any client (IDE) supporting the Debug Adapter Protocol.
 *
 * The most important class of the Debug Adapter is the MockDebugSession which implements many DAP requests by talking to the MockRuntime.
 */

import {
  Logger,
  logger,
  LoggingDebugSession,
  InitializedEvent,
  TerminatedEvent,
  StoppedEvent,
  BreakpointEvent,
  OutputEvent,
  ProgressStartEvent,
  ProgressUpdateEvent,
  ProgressEndEvent,
  InvalidatedEvent,
  Thread,
  StackFrame,
  Scope,
  Source,
  Handles,
  Breakpoint,
  MemoryEvent,
} from "@vscode/debugadapter";
import { DebugProtocol } from "@vscode/debugprotocol";
import { basename } from "path-browserify";
import {
  MockRuntime,
  IRuntimeBreakpoint,
  FileAccessor,
  RuntimeVariable,
  timeout,
  IRuntimeVariableType,
} from "./mockRuntime";
import { Subject } from "await-notify";
import * as base64 from "base64-js";

/**
 * This interface describes the mock-debug specific launch attributes
 * (which are not part of the Debug Adapter Protocol).
 * The schema for these attributes lives in the package.json of the mock-debug extension.
 * The interface should always match this schema.
 */
interface ILaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
  /** An absolute path to the "program" to debug. */
  program: string;
  /** Automatically stop target after launch. If not specified, target does not stop. */
  stopOnEntry?: boolean;
  /** enable logging the Debug Adapter Protocol */
  trace?: boolean;
  /** run without debugging */
  noDebug?: boolean;
  /** if specified, results in a simulated compile error in launch. */
  compileError?: "default" | "show" | "hide";
}

interface IAttachRequestArguments extends ILaunchRequestArguments {}

export class MockDebugSession extends LoggingDebugSession {
  private static threadID = 1;

  private _runtime: MockRuntime;

  private _variableHandles = new Handles<
    "locals" | "globals" | RuntimeVariable
  >();

  private _configurationDone = new Subject();

  private _cancellationTokens = new Map<number, boolean>();

  private _reportProgress = false;
  private _progressId = 10000;
  private _cancelledProgressId: string | undefined = undefined;
  private _isProgressCancellable = true;

  private _valuesInHex = false;
  private _useInvalidatedEvent = false;

  private _addressesInHex = true;

  /**
   * Creates a new debug adapter that is used for one debug session.
   * We configure the default implementation of a debug adapter here.
   */
  public constructor(fileAccessor: FileAccessor) {
    super("mock-debug.txt");

    this.setDebuggerLinesStartAt1(false);
    this.setDebuggerColumnsStartAt1(false);

    this._runtime = new MockRuntime(fileAccessor);

    this._runtime.on("stopOnException", (exception) => {
      if (exception) {
        this.sendEvent(
          new StoppedEvent(`exception(${exception})`, MockDebugSession.threadID)
        );
      } else {
        this.sendEvent(
          new StoppedEvent("exception", MockDebugSession.threadID)
        );
      }
    });
    this._runtime.on("breakpointValidated", (bp: IRuntimeBreakpoint) => {
      this.sendEvent(
        new BreakpointEvent("changed", {
          verified: bp.verified,
          id: bp.id,
        } as DebugProtocol.Breakpoint)
      );
    });
    this._runtime.on("output", (type, text, filePath, line, column) => {
      let category: string;
      switch (type) {
        case "prio":
          category = "important";
          break;
        case "out":
          category = "stdout";
          break;
        case "err":
          category = "stderr";
          break;
        default:
          category = "console";
          break;
      }
      const e: DebugProtocol.OutputEvent = new OutputEvent(
        `${text}\n`,
        category
      );

      if (text === "start" || text === "startCollapsed" || text === "end") {
        e.body.group = text;
        e.body.output = `group-${text}\n`;
      }

      e.body.source = this.createSource(filePath);
      e.body.line = this.convertDebuggerLineToClient(line);
      e.body.column = this.convertDebuggerColumnToClient(column);
      this.sendEvent(e);
    });
    this._runtime.on("end", () => {
      this.sendEvent(new TerminatedEvent());
    });
  }

  /**
   * The 'initialize' request is the first request called by the frontend
   * to interrogate the features the debug adapter provides.
   */
  protected initializeRequest(
    response: DebugProtocol.InitializeResponse,
    args: DebugProtocol.InitializeRequestArguments
  ): void {
    if (args.supportsProgressReporting) {
      this._reportProgress = true;
    }
    if (args.supportsInvalidatedEvent) {
      this._useInvalidatedEvent = true;
    }

    response.body = response.body || {};

    response.body.supportsConfigurationDoneRequest = true;

    response.body.supportsEvaluateForHovers = true;

    response.body.supportsStepBack = false;

    response.body.supportsDataBreakpoints = true;

    response.body.supportsCompletionsRequest = true;
    response.body.completionTriggerCharacters = [".", "["];

    response.body.supportsCancelRequest = true;

    response.body.supportsBreakpointLocationsRequest = false;

    response.body.supportsStepInTargetsRequest = false;

    response.body.supportsExceptionFilterOptions = true;
    response.body.exceptionBreakpointFilters = [
      {
        filter: "namedException",
        label: "Named Exception",
        description: `Break on named exceptions. Enter the exception's name as the Condition.`,
        default: false,
        supportsCondition: true,
        conditionDescription: `Enter the exception's name`,
      },
      {
        filter: "otherExceptions",
        label: "Other Exceptions",
        description: "This is a other exception",
        default: true,
        supportsCondition: false,
      },
    ];

    response.body.supportsExceptionInfoRequest = true;

    response.body.supportsSetVariable = true;

    response.body.supportsSetExpression = true;

    response.body.supportsDisassembleRequest = true;
    response.body.supportsSteppingGranularity = true;
    response.body.supportsInstructionBreakpoints = true;

    response.body.supportsReadMemoryRequest = true;
    response.body.supportsWriteMemoryRequest = true;

    response.body.supportSuspendDebuggee = true;
    response.body.supportTerminateDebuggee = true;
    response.body.supportsFunctionBreakpoints = true;
    response.body.supportsDelayedStackTraceLoading = true;

    this.sendResponse(response);

    this.sendEvent(new InitializedEvent());
  }

  /**
   * Called at the end of the configuration sequence.
   * Indicates that all breakpoints etc. have been sent to the DA and that the 'launch' can start.
   */
  protected configurationDoneRequest(
    response: DebugProtocol.ConfigurationDoneResponse,
    args: DebugProtocol.ConfigurationDoneArguments
  ): void {
    super.configurationDoneRequest(response, args);

    this._configurationDone.notify();
  }

  protected disconnectRequest(
    response: DebugProtocol.DisconnectResponse,
    args: DebugProtocol.DisconnectArguments,
    request?: DebugProtocol.Request
  ): void {
    this._runtime.stop();
    console.log(
      `disconnectRequest suspend: ${args.suspendDebuggee}, terminate: ${args.terminateDebuggee}`
    );
  }

  protected async attachRequest(
    response: DebugProtocol.AttachResponse,
    args: IAttachRequestArguments
  ) {
    return this.launchRequest(response, args);
  }

  protected async launchRequest(
    response: DebugProtocol.LaunchResponse,
    args: ILaunchRequestArguments
  ) {
    logger.setup(
      args.trace ? Logger.LogLevel.Verbose : Logger.LogLevel.Stop,
      false
    );

    await this._configurationDone.wait(1000);

    await this._runtime.start(args.program, !!args.stopOnEntry, !args.noDebug);

    if (args.compileError) {
      this.sendErrorResponse(response, {
        id: 1001,
        format: `compile error: some fake error.`,
        showUser:
          args.compileError === "show"
            ? true
            : args.compileError === "hide"
            ? false
            : undefined,
      });
    } else {
      this.sendResponse(response);
    }
  }
  protected exceptionInfoRequest(
    response: DebugProtocol.ExceptionInfoResponse,
    args: DebugProtocol.ExceptionInfoArguments
  ) {
    response.body = {
      exceptionId: "Exception ID",
      description: "This is a descriptive description of the exception.",
      breakMode: "always",
      details: {
        message: "Message contained in the exception.",
        typeName: "Short type name of the exception object",
        stackTrace: "stack frame 1\nstack frame 2",
      },
    };
    this.sendResponse(response);
  }

  protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
    response.body = {
      threads: [
        new Thread(MockDebugSession.threadID, "thread 1"),
        new Thread(MockDebugSession.threadID + 1, "thread 2"),
      ],
    };
    this.sendResponse(response);
  }

  protected scopesRequest(
    response: DebugProtocol.ScopesResponse,
    args: DebugProtocol.ScopesArguments
  ): void {
    response.body = {
      scopes: [
        new Scope("Locals", this._variableHandles.create("locals"), false),
        new Scope("Globals", this._variableHandles.create("globals"), true),
      ],
    };
    this.sendResponse(response);
  }

  protected async writeMemoryRequest(
    response: DebugProtocol.WriteMemoryResponse,
    { data, memoryReference, offset = 0 }: DebugProtocol.WriteMemoryArguments
  ) {
    const variable = this._variableHandles.get(Number(memoryReference));
    if (typeof variable === "object") {
      const decoded = base64.toByteArray(data);
      variable.setMemory(decoded, offset);
      response.body = { bytesWritten: decoded.length };
    } else {
      response.body = { bytesWritten: 0 };
    }

    this.sendResponse(response);
    this.sendEvent(new InvalidatedEvent(["variables"]));
  }

  protected async readMemoryRequest(
    response: DebugProtocol.ReadMemoryResponse,
    { offset = 0, count, memoryReference }: DebugProtocol.ReadMemoryArguments
  ) {
    const variable = this._variableHandles.get(Number(memoryReference));
    if (typeof variable === "object" && variable.memory) {
      const memory = variable.memory.subarray(
        Math.min(offset, variable.memory.length),
        Math.min(offset + count, variable.memory.length)
      );

      response.body = {
        address: offset.toString(),
        data: base64.fromByteArray(memory),
        unreadableBytes: count - memory.length,
      };
    } else {
      response.body = {
        address: offset.toString(),
        data: "",
        unreadableBytes: count,
      };
    }

    this.sendResponse(response);
  }

  protected async variablesRequest(
    response: DebugProtocol.VariablesResponse,
    args: DebugProtocol.VariablesArguments,
    request?: DebugProtocol.Request
  ): Promise<void> {
    let vs: RuntimeVariable[] = [];

    const v = this._variableHandles.get(args.variablesReference);
    if (v === "locals") {
      vs = this._runtime.getLocalVariables();
    } else if (v === "globals") {
      if (request) {
        this._cancellationTokens.set(request.seq, false);
        vs = await this._runtime.getGlobalVariables(
          () => !!this._cancellationTokens.get(request.seq)
        );
        this._cancellationTokens.delete(request.seq);
      } else {
        vs = await this._runtime.getGlobalVariables();
      }
    } else if (v && Array.isArray(v.value)) {
      vs = v.value;
    }

    response.body = {
      variables: vs.map((v) => this.convertFromRuntime(v)),
    };
    this.sendResponse(response);
  }

  protected setVariableRequest(
    response: DebugProtocol.SetVariableResponse,
    args: DebugProtocol.SetVariableArguments
  ): void {
    const container = this._variableHandles.get(args.variablesReference);
    const rv =
      container === "locals"
        ? this._runtime.getLocalVariable(args.name)
        : container instanceof RuntimeVariable &&
          container.value instanceof Array
        ? container.value.find((v) => v.name === args.name)
        : undefined;

    if (rv) {
      rv.value = this.convertToRuntime(args.value);
      response.body = this.convertFromRuntime(rv);

      if (rv.memory && rv.reference) {
        this.sendEvent(
          new MemoryEvent(String(rv.reference), 0, rv.memory.length)
        );
      }
    }

    this.sendResponse(response);
  }

  protected cancelRequest(
    response: DebugProtocol.CancelResponse,
    args: DebugProtocol.CancelArguments
  ) {
    if (args.requestId) {
      this._cancellationTokens.set(args.requestId, true);
    }
    if (args.progressId) {
      this._cancelledProgressId = args.progressId;
    }
  }

  private createSource(filePath: string): Source {
    return new Source(
      basename(filePath),
      this.convertDebuggerPathToClient(filePath),
      undefined,
      undefined,
      "mock-adapter-data"
    );
  }
}
