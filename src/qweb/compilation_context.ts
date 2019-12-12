import { compileExpr, QWebVar } from "./expression_parser";

export const INTERP_REGEXP = /\{\{.*?\}\}/g;
//------------------------------------------------------------------------------
// Compilation Context
//------------------------------------------------------------------------------

export class CompilationContext {
  static nextID: number = 1;
  code: string[] = [];
  variables: { [key: string]: QWebVar } = {};
  escaping: boolean = false;
  parentNode: number | null | string = null;
  parentTextNode: number | null = null;
  rootNode: number | null = null;
  indentLevel: number = 0;
  rootContext: CompilationContext;
  shouldDefineParent: boolean = false;
  shouldDefineScope: boolean = false;
  shouldDefineQWeb: boolean = false;
  shouldDefineUtils: boolean = false;
  shouldDefineRefs: boolean = false;
  shouldDefineResult: boolean = true;
  loopNumber: number = 0;
  inPreTag: boolean = false;
  templateName: string;
  allowMultipleRoots: boolean = false;
  hasParentWidget: boolean = false;
  currentKey: string = "";

  constructor(name?: string) {
    this.rootContext = this;
    this.templateName = name || "noname";
    this.addLine("var h = this.h;");
  }

  generateID(): number {
    return CompilationContext.nextID++;
  }

  /**
   * This method generates a "template key", which is basically a unique key
   * which depends on the currently set keys, and on the iteration numbers (if
   * we are in a loop).
   *
   * Such a key is necessary when we need to associate an id to some element
   * generated by a template (for example, a component)
   */
  generateTemplateKey(): string {
    const id = this.generateID();
    if (this.loopNumber === 0 && !this.currentKey) {
      return `'__${id}__'`;
    }
    let locationExpr = `\`__${id}__`;
    for (let i = 0; i < this.loopNumber - 1; i++) {
      locationExpr += `\${i${i + 1}}__`;
    }
    if (this.currentKey) {
      const k = this.currentKey;
      this.addLine(`let k${id} = ${locationExpr}\` + ${k};`);
    } else {
      locationExpr += this.loopNumber ? `\${i${this.loopNumber}}__\`` : "`";
      this.addLine(`let k${id} = ${locationExpr};`);
    }
    return `k${id}`;
  }

  generateCode(): string[] {
    if (this.shouldDefineResult) {
      this.code.unshift("    let result;");
    }

    if (this.shouldDefineScope) {
      this.code.unshift("    let scope = Object.create(context);");
    }
    if (this.shouldDefineRefs) {
      this.code.unshift("    context.__owl__.refs = context.__owl__.refs || {};");
    }
    if (this.shouldDefineParent) {
      if (this.hasParentWidget) {
        this.code.unshift("    let parent = extra.parent;");
      } else {
        this.code.unshift("    let parent = context;");
      }
    }
    if (this.shouldDefineQWeb) {
      this.code.unshift("    let QWeb = this.constructor;");
    }
    if (this.shouldDefineUtils) {
      this.code.unshift("    let utils = this.constructor.utils;");
    }
    return this.code;
  }

  withParent(node: number): CompilationContext {
    if (
      !this.allowMultipleRoots &&
      this === this.rootContext &&
      (this.parentNode || this.parentTextNode)
    ) {
      throw new Error("A template should not have more than one root node");
    }
    if (!this.rootContext.rootNode) {
      this.rootContext.rootNode = node;
    }
    if (!this.parentNode && this.rootContext.shouldDefineResult) {
      this.addLine(`result = vn${node};`);
    }
    return this.subContext("parentNode", node);
  }

  subContext(key: keyof CompilationContext, value: any): CompilationContext {
    const newContext = Object.create(this);
    newContext[key] = value;
    return newContext;
  }

  indent() {
    this.indentLevel++;
  }

  dedent() {
    this.indentLevel--;
  }

  addLine(line: string): number {
    const prefix = new Array(this.indentLevel + 2).join("    ");
    this.code.push(prefix + line);
    return this.code.length - 1;
  }

  addIf(condition: string) {
    this.addLine(`if (${condition}) {`);
    this.indent();
  }

  addElse() {
    this.dedent();
    this.addLine("} else {");
    this.indent();
  }

  closeIf() {
    this.dedent();
    this.addLine("}");
  }

  getValue(val: any): QWebVar | string {
    return val in this.variables ? this.getValue(this.variables[val]) : val;
  }

  /**
   * Prepare an expression for being consumed at render time.  Its main job
   * is to
   * - replace unknown variables by a lookup in the context
   * - replace already defined variables by their internal name
   */
  formatExpression(expr: string): string {
    this.rootContext.shouldDefineScope = true;
    return compileExpr(expr, this.variables);
  }

  /**
   * Perform string interpolation on the given string. Note that if the whole
   * string is an expression, it simply returns it (formatted and enclosed in
   * parentheses).
   * For instance:
   *   'Hello {{x}}!' -> `Hello ${x}`
   *   '{{x ? 'a': 'b'}}' -> (x ? 'a' : 'b')
   */
  interpolate(s: string): string {
    let matches = s.match(INTERP_REGEXP);
    if (matches && matches[0].length === s.length) {
      return `(${this.formatExpression(s.slice(2, -2))})`;
    }

    let r = s.replace(/\{\{.*?\}\}/g, s => "${" + this.formatExpression(s.slice(2, -2)) + "}");
    return "`" + r + "`";
  }
  startProtectScope(): number {
    const protectID = this.generateID();
    this.rootContext.shouldDefineScope = true;
    this.addLine(`const _origScope${protectID} = scope;`);
    this.addLine(`scope = Object.assign(Object.create(context), scope);`);
    return protectID;
  }
  stopProtectScope(protectID: number) {
    this.addLine(`scope = _origScope${protectID};`);
  }
}
