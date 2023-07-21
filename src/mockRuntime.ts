import { EventEmitter } from "events";
import { TextEncoder } from "node:util";
import { TextDecoder } from "util";
import * as vscode from "vscode";

export interface FileAccessor {
  isWindows: boolean;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, contents: Uint8Array): Promise<void>;
}

export interface IRuntimeBreakpoint {
  id: number;
  line: number;
  verified: boolean;
}

export type IRuntimeVariableType =
  | number
  | boolean
  | string
  | RuntimeVariable[];

export class RuntimeVariable {
  private _memory?: Uint8Array;

  public reference?: number;

  public get value() {
    return this._value;
  }

  public set value(value: IRuntimeVariableType) {
    this._value = value;
    this._memory = undefined;
  }

  public get memory() {
    if (this._memory === undefined && typeof this._value === "string") {
      this._memory = new TextEncoder().encode(this._value);
    }
    return this._memory;
  }

  constructor(
    public readonly name: string,
    private _value: IRuntimeVariableType
  ) {}

  public setMemory(data: Uint8Array, offset = 0) {
    const memory = this.memory;
    if (!memory) {
      return;
    }

    memory.set(data, offset);
    this._memory = memory;
    this._value = new TextDecoder().decode(memory);
  }
}

interface Word {
  name: string;
  line: number;
  index: number;
}

export function timeout(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MockRuntime extends EventEmitter {
  private _sourceFile: string = "";
  public get sourceFile() {
    return this._sourceFile;
  }

  private variables = new Map<string, RuntimeVariable>();

  private sourceLines: string[] = [];
  private instructions: Word[] = [];
  private starts: number[] = [];
  private ends: number[] = [];

  private _currentLine = 0;
  private get currentLine() {
    return this._currentLine;
  }
  private set currentLine(x) {
    this._currentLine = x;
    this.instruction = this.starts[x];
  }
  public instruction = 0;
  private namedException: string | undefined;
  private otherExceptions = false;
  private terminal: vscode.Terminal =
    vscode.window.createTerminal("Oberon Debug");

  constructor(private fileAccessor: FileAccessor) {
    super();
  }

  /**
   * Start executing the given program.
   */
  public async start(
    program: string,
    stopOnEntry: boolean,
    debug: boolean
  ): Promise<void> {
    await this.loadSource(this.normalizePathAndCasing(program));
    this.terminal.sendText("sbt compile && sbt test");
  }

  public stop(): void {
    this.terminal.sendText("\x03");
    this.terminal.dispose();
  }

  public setExceptionsFilters(
    namedException: string | undefined,
    otherExceptions: boolean
  ): void {
    this.namedException = namedException;
    this.otherExceptions = otherExceptions;
  }

  public async getGlobalVariables(
    cancellationToken?: () => boolean
  ): Promise<RuntimeVariable[]> {
    let a: RuntimeVariable[] = [];

    for (let i = 0; i < 10; i++) {
      a.push(new RuntimeVariable(`global_${i}`, i));
      if (cancellationToken && cancellationToken()) {
        break;
      }
      await timeout(1000);
    }

    return a;
  }

  public getLocalVariables(): RuntimeVariable[] {
    return Array.from(this.variables, ([name, value]) => value);
  }

  public getLocalVariable(name: string): RuntimeVariable | undefined {
    return this.variables.get(name);
  }

  // private methods

  private getLine(line?: number): string {
    return this.sourceLines[
      line === undefined ? this.currentLine : line
    ].trim();
  }

  private getWords(l: number, line: string): Word[] {
    // break line into words
    const WORD_REGEXP = /[a-z]+/gi;
    const words: Word[] = [];
    let match: RegExpExecArray | null;
    while ((match = WORD_REGEXP.exec(line))) {
      words.push({ name: match[0], line: l, index: match.index });
    }
    return words;
  }

  private async loadSource(file: string): Promise<void> {
    if (this._sourceFile !== file) {
      this._sourceFile = this.normalizePathAndCasing(file);
      this.initializeContents(await this.fileAccessor.readFile(file));
    }
  }

  private initializeContents(memory: Uint8Array) {
    this.sourceLines = new TextDecoder().decode(memory).split(/\r?\n/);

    this.instructions = [];

    this.starts = [];
    this.instructions = [];
    this.ends = [];

    for (let l = 0; l < this.sourceLines.length; l++) {
      this.starts.push(this.instructions.length);
      const words = this.getWords(l, this.sourceLines[l]);
      for (let word of words) {
        this.instructions.push(word);
      }
      this.ends.push(this.instructions.length);
    }
  }

  private normalizePathAndCasing(path: string) {
    if (this.fileAccessor.isWindows) {
      return path.replace(/\//g, "\\").toLowerCase();
    } else {
      return path.replace(/\\/g, "/");
    }
  }
}
