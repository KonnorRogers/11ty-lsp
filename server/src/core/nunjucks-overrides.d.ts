// import { NunjucksSettings } from '../settings/nunjucksSettings';

interface LexerOptions {
  trimBlock: boolean
  lstripBlocks: boolean
  tags: {
    BLOCK_START: string
    BLOCK_END: string
    VARIABLE_START: string
    VARIABLE_END: string
    COMMENT_START: string
    COMMENT_END: string
  };
}

interface Token {
  type: string,
  value: string,
  lineno: number,
  colno: number
}

declare class _Tokenizer implements LexerOptions {
  str: string
  len: number
  index: number
  lineno: number
  colno: number

  trimBlock: boolean
  lstripBlocks: boolean
  tags: {
    BLOCK_START: string
    BLOCK_END: string
    VARIABLE_START: string
    VARIABLE_END: string
    COMMENT_START: string
    COMMENT_END: string
  };

  nextToken: () => Token
}


declare module 'nunjucks/src/lexer.js' {
  class Tokenizer extends _Tokenizer {}
  export const lex: (src: string, opts?: Partial<LexerOptions>) => Tokenizer
  export const BLOCK_START = '{%';
  export const BLOCK_END = '%}';
  export const VARIABLE_START = '{{';
  export const VARIABLE_END = '}}';
  export const COMMENT_START = '{#';
  export const COMMENT_END = '#}';

  export const TOKEN_STRING = 'string';
  export const TOKEN_WHITESPACE = 'whitespace';
  export const TOKEN_DATA = 'data';
  export const TOKEN_BLOCK_START = 'block-start';
  export const TOKEN_BLOCK_END = 'block-end';
  export const TOKEN_VARIABLE_START = 'variable-start';
  export const TOKEN_VARIABLE_END = 'variable-end';
  export const TOKEN_COMMENT = 'comment';
  export const TOKEN_LEFT_PAREN = 'left-paren';
  export const TOKEN_RIGHT_PAREN = 'right-paren';
  export const TOKEN_LEFT_BRACKET = 'left-bracket';
  export const TOKEN_RIGHT_BRACKET = 'right-bracket';
  export const TOKEN_LEFT_CURLY = 'left-curly';
  export const TOKEN_RIGHT_CURLY = 'right-curly';
  export const TOKEN_OPERATOR = 'operator';
  export const TOKEN_COMMA = 'comma';
  export const TOKEN_COLON = 'colon';
  export const TOKEN_TILDE = 'tilde';
  export const TOKEN_PIPE = 'pipe';
  export const TOKEN_INT = 'int';
  export const TOKEN_FLOAT = 'float';
  export const TOKEN_BOOLEAN = 'boolean';
  export const TOKEN_NONE = 'none';
  export const TOKEN_SYMBOL = 'symbol';
  export const TOKEN_SPECIAL = 'special';
  export const TOKEN_REGEX = 'regex';
}

declare module 'nunjucks/src/parser.js' {
  import { InlineIf, NodeList, Node, Root } from 'nunjucks/src/nodes.js'

  class Parser {
    tokens: _Tokenizer
    peeked: boolean | null;
    breakOnBlocks: boolean | null;
    dropLeadingWhitespace: boolean
    extensions: Object[];
    constructor (tokenizer: _Tokenizer)
    init (tokenizer: _Tokenizer): void
    nextToken (withWhitespace?: boolean): Token
    peekToken (): Token
    pushToken (token: Token): void
    error (msg: string, lineno: number, colno: number): any // TemplateError
    fail (msg: string, lineno: number, colno: number): void
    skip (type: Token["type"]): boolean
    expect (type: Token["type"]): Token
    skipValue (type: Token["type"], val: Token["value"]): boolean
    skipSymbol (val: Token["value"]): boolean
    advanceAfterBlockEnd (name?: Token["type"]): Token
    advanceAfterVariableEnd (): void
    parseAsRoot (...args: any[]): Root
    // TODO: these are incomplete
    parseFor(): void
    parseMacro(): void
    parseCall(): void
    parseWithContext(): void
    parseImport(): void
    parseFrom(): void
    parseBlock(): void
    parseExtends(): void
    parseInclude(): void
    parseIf(): void
    parseSet(): void
    parseSwitch(): void
    parseStatement(): Node
    parseRaw(): void
    parsePostfix(): void
    parseExpression(): InlineIf
    parseOr(): void
    parseAnd(): void
    parseNot(): void
    parseIn(): void
    parseIs(): void
    parseCompare(): void
    parseConcat(): void
    parseAdd(): void
    parseSub(): void
    parseMul(): void
    parseDiv(): void
    parseFloorDiv(): void
    parseMod(): void
    parsePow(): void
    parseUnary(): void
    parsePrimary(): void
    parseFilterName(): void
    parseFilterArgs(): void
    parseFilter(): void
    parseFilterStatement(): void
    parseAggregate(): void
    parseSignature(): void
    parseUntilBlocks(): void
    parseNodes(): void
    parse(): void
  }

  function parse(src: string, extensions: any, opts: LexerOptions): any
  export {
    parse,
    Parser
  }
}

declare module 'nunjucks/src/nodes.js' {
  class Node<T extends string = "Node"> extends Object {
      get typename(): T
      get fields(): string[]
      lineno: number
      colno: number
      init<T extends typeof Node>(this: T, lineno: number, colno: number, ...args: any[]): T
      constructor(lineno: number, colno: number, ...args: any[])
      findAll<T extends {new (...args: any[]): any}>(type: T, results?: (InstanceType<T>)[]): InstanceType<T>[]
      iterFields(callback: (value: this[keyof this], field: keyof this) => void): void
  }
  class NodeList<T extends string = "NodeList"> extends Node<T> {
    get typename(): T
    init<T extends typeof Node<U>, U extends string>(this: T, lineno: number, colno: number, nodes?: Array<AnyNode>): T
    constructor(lineno: number, colno: number, nodes?: Array<AnyNode>)
    get fields(): ["children"]
    children: AnyNode[]
    addChild(node: AnyNode): void
  }
  class Root<T extends string = "Root"> extends NodeList<T> {}
  class Value<T extends string = "Value"> extends Node<T> {
    get fields(): ["value"]
    get value(): string
  }
  class Literal<T extends string = "Literal"> extends Value<T> {}
  class Symbol<T extends string = "Symbol"> extends Value<T> {}
  class Group<T extends string = "Group"> extends NodeList<T> {}
  class ArrayNode<T extends string = "ArrayNode"> extends NodeList<T> {}
  class Pair<T extends string = "Pair"> extends Node<T> {
    get fields(): ["key", "value"]
    key: string
    value: string
  }
  class Dict<T extends string = "Dict"> extends NodeList<T> {}
  class Output<T extends string = "Output"> extends NodeList<T> {}
  class Capture<T extends string = "Capture"> extends Node<T> {}
  class TemplateData<T extends string = "TemplateData"> extends Literal<T> {}
  class If<T extends string = "If"> extends Node<T> {
    get fields(): ['cond', 'body', 'else_']
  }
  class IfAsync<T extends string = "IfAsync"> extends If<T> {}
  class InlineIf<T extends string = "InlineIf"> extends Node<T> {}
  class For<T extends string = "For"> extends Node<T> {
    get fields(): ['arr', 'name', 'body', 'else_']
  }
  class AsyncEach<T extends string = "AsyncEach"> extends For<T> {}
  class AsyncAll<T extends string = "AsyncAll"> extends For<T> {}
  class Macro<T extends string = "Macro"> extends Node<T> {
    get fields(): ['name', 'args', 'body']
  }
  class Caller<T extends string = "Caller"> extends Macro<T> {}
  class Import<T extends string = "Import"> extends Node<T> {
    get fields(): ['template', 'target', 'withContext']
  }
  class FromImport<T extends string = "FromImport"> extends Node<T> {
    get fields(): ['template', 'names', 'withContext']
    init<T extends typeof Node, U extends NodeList = NodeList>(lineno: number, colno: number, template: string, names: U | undefined, withContext: any): T
  }
  class FunCall<T extends string = "FunCall"> extends Node<T> {
    get fields(): ['name', 'args']
  }
  class Filter<T extends string = "Filter"> extends FunCall<T> {}
  class FilterAsync<T extends string = "FilterAsync"> extends Node<T> {
    get fields(): ['name', 'args', 'symbol']
  }
  class KeywordArgs<T extends string = "KeywordArgs"> extends Dict<T> {}
  class Block<T extends string = "Block"> extends Node<T> {
    get fields(): ['name', 'body']
  }
  class Super<T extends string = "Super"> extends Node<T> {
    get fields(): ['blockName', 'symbol']
  }
  class TemplateRef<T extends string = "TemplateRef"> extends Node<T> {
    get fields(): ['template']
  }
  class Extends<T extends string = "Extends"> extends TemplateRef<T> {}
  class Include<T extends string = "Include"> extends Node<T> {}
  class Set<T extends string = "Set"> extends Node<T> {}
  class Switch<T extends string = "Switch"> extends Node<T> {}
  class Case<T extends string = "Case"> extends Node<T> {}
  class LookupVal<T extends string = "LookupVal"> extends Node<T> {
    get fields(): ['target', 'val']
  }
  class BinOp<T extends string = "BinOp"> extends Node<T> {}
  class In<T extends string = "In"> extends Node<T> {}
  class Is<T extends string = "Is"> extends Node<T> {}
  class Or<T extends string = "Or"> extends Node<T> {}
  class And<T extends string = "And"> extends Node<T> {}
  class Not<T extends string = "Not"> extends Node<T> {}
  class Add<T extends string = "Add"> extends Node<T> {}
  class Concat<T extends string = "Concat"> extends Node<T> {}
  class Sub<T extends string = "Sub"> extends Node<T> {}
  class Mul<T extends string = "Mul"> extends Node<T> {}
  class Div<T extends string = "Div"> extends Node<T> {}
  class FloorDiv<T extends string = "FloorDiv"> extends Node<T> {}
  class Mod<T extends string = "Mod"> extends Node<T> {}
  class Pow<T extends string = "Pow"> extends Node<T> {}
  class Neg<T extends string = "Neg"> extends Node<T> {}
  class Pos<T extends string = "Pos"> extends Node<T> {}
  class Compare<T extends string = "Compare"> extends Node<T> {}
  class CompareOperand<T extends string = "CompareOperand"> extends Node<T> {}
  class CallExtension<T extends string = "CallExtension"> extends Node<T> {}
  class CallExtensionAsync<T extends string = "CallExtensionAsync"> extends Node<T> {}

  function print(str: string, indent: string, line: number): void
  function printNodes(node: NodeList, indent?: string): void

  /**
   * Theses types aren't supported by nunjucks, but added to cover all possible nodes which can be needed for some call sites.
   */
  export type AnyNode = AllNodes[keyof AllNodes]
  export type AllNodes = {
    Node: Node<"Node">,
    Root: Root<"Root">,
    NodeList: NodeList<"NodeList">,
    Value: Value<"Value">,
    Literal: Literal<"Literal">,
    Symbol: Symbol<"Symbol">,
    Group: Group<"Group">,
    ArrayNode: ArrayNode<"ArrayNode">,
    Pair: Pair<"Pair">,
    Dict: Dict<"Dict">,
    Output: Output<"Output">,
    Capture: Capture<"Capture">,
    TemplateData: TemplateData<"TemplateData">,
    If: If<"If">,
    IfAsync: IfAsync<"IfAsync">,
    InlineIf: InlineIf<"InlineIf">,
    For: For<"For">,
    AsyncEach: AsyncEach<"AsyncEach">,
    AsyncAll: AsyncAll<"AsyncAll">,
    Macro: Macro<"Macro">,
    Caller: Caller<"Caller">,
    Import: Import<"Import">,
    FromImport: FromImport<"FromImport">,
    FunCall: FunCall<"FunCall">,
    Filter: Filter<"Filter">,
    FilterAsync: FilterAsync<"FilterAsync">,
    KeywordArgs: KeywordArgs<"KeywordArgs">,
    Block: Block<"Block">,
    Super: Super<"Super">,
    TemplateRef: TemplateRef<"TemplateRef">,
    Extends: Extends<"Extends">,
    Include: Include<"Include">,
    Set: Set<"Set">,
    Switch: Switch<"Switch">,
    Case: Case<"Case">,
    LookupVal: LookupVal<"LookupVal">,
    BinOp: BinOp<"BinOp">,
    In: In<"In">,
    Is: Is<"Is">,
    Or: Or<"Or">,
    And: And<"And">,
    Not: Not<"Not">,
    Add: Add<"Add">,
    Concat: Concat<"Concat">,
    Sub: Sub<"Sub">,
    Mul: Mul<"Mul">,
    Div: Div<"Div">,
    FloorDiv: FloorDiv<"FloorDiv">,
    Mod: Mod<"Mod">,
    Pow: Pow<"Pow">,
    Neg: Neg<"Neg">,
    Pos: Pos<"Pos">,
    Compare: Compare<"Compare">,
    CompareOperand: CompareOperand<"CompareOperand">,
    CallExtension: CallExtension<"CallExtension">,
    CallExtensionAsync: CallExtensionAsync<"CallExtensionAsync">,
  }

  export {
    Node,
    Root,
    NodeList,
    Value,
    Literal,
    Symbol,
    Group,
    ArrayNode,
    Pair,
    Dict,
    Output,
    Capture,
    TemplateData,
    If,
    IfAsync,
    InlineIf,
    For,
    AsyncEach,
    AsyncAll,
    Macro,
    Caller,
    Import,
    FromImport,
    FunCall,
    Filter,
    FilterAsync,
    KeywordArgs,
    Block,
    Super,
    TemplateRef,
    Extends,
    Include,
    Set,
    Switch,
    Case,
    LookupVal,
    BinOp,
    In,
    Is,
    Or,
    And,
    Not,
    Add,
    Concat,
    Sub,
    Mul,
    Div,
    FloorDiv,
    Mod,
    Pow,
    Neg,
    Pos,
    Compare,
    CompareOperand,
    CallExtension,
    CallExtensionAsync,
    print,
    printNodes
  }
}

declare module "nunjucks/src/environment.js" {
  class Template {
    constructor(content: string, env?: Partial<{}>, path?: string, eagerCompile?: boolean)
  }
  export {
    Template
  }
}
