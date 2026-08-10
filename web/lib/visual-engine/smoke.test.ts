/**
 * Smoke test — exercises every registered CS template's algorithm/data-structure graph through the
 * full deterministic path (validate -> layout -> render) and asserts it produces a valid,
 * non-overlapping, non-throwing graph. This is the model-independent verification from the plan:
 * scripted IR -> deterministic layout/render, so a weak model can't mask a broken template.
 *
 * It also runs an end-to-end pipeline smoke (produceDoc with a fakeClient that returns scripted
 * JSON -> layout -> render) for a few representative CS algorithm graphs, to confirm the
 * classify -> getTemplates -> decompose -> validate -> layout wiring.
 *
 * Data-driven over allTemplates(), so new CS templates (cs.prog2/cybersecurity/systems/math/hmi)
 * are covered automatically as they're registered.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

import type { Template } from "./registry";
import type { ConceptDoc } from "./schema";
import type { ChatMessage, CompleteOptions, CompleteResult, LLMClient } from "./decompose";

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: "http://localhost/" });
(globalThis as unknown as { document: Document }).document = dom.window.document;
(globalThis as unknown as { window: Window }).window = dom.window as unknown as Window;

// Side-effect: register all packs + render primitives.
await import("./packs/generic.js");
await import("./packs/cs.js");
const { allTemplates, getTemplate } = await import("./registry.js");
const { layout } = await import("./layout.js");
const { drawConcept } = await import("./render.js");
const { validate } = await import("./schema.js");
const { produceDoc } = await import("./repair.js");

function makeSvg(): SVGSVGElement {
  return dom.window.document.createElementNS("http://www.w3.org/2000/svg", "svg") as unknown as SVGSVGElement;
}

function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return Math.abs(a.x - b.x) * 2 < a.w + b.w - 2 && Math.abs(a.y - b.y) * 2 < a.h + b.h - 2;
}

/**
 * Representative algorithm/data-structure IR per template. Templates with a few-shot use it; the
 * rest get a hand-authored minimal graph matching the template's genre. No-edge multi-node
 * templates (stacks, memory) use diagramType "mindmap" to satisfy the schema while the template
 * id dispatches to the right layout.
 */
const FIXTURES: Record<string, ConceptDoc> = {
  // --- cs.prog1 (Programming 1) algorithm graphs ---
  "cs.prog1.recursionTree": {
    title: "Recursion tree",
    summary: "Divide-and-conquer recurrence T(n)=2T(n/2)+n branches into two subcalls per call.",
    diagramType: "hierarchy",
    template: "cs.prog1.recursionTree",
    subject: "cs",
    course: "cs.prog1",
    domain: { root: "tn" },
    nodes: [
      { id: "tn", label: "T(n)", kind: "box", note: "T(n)=2T(n/2)+n" },
      { id: "l", label: "T(n/2)", kind: "box" },
      { id: "r", label: "T(n/2)", kind: "box" },
      { id: "ll", label: "T(n/4)", kind: "box" },
      { id: "lr", label: "T(n/4)", kind: "box" },
      { id: "rl", label: "T(n/4)", kind: "box" },
      { id: "rr", label: "T(n/4)", kind: "box" },
    ],
    edges: [
      { from: "tn", to: "l", label: "left" },
      { from: "tn", to: "r", label: "right" },
      { from: "l", to: "ll", label: "left" },
      { from: "l", to: "lr", label: "right" },
      { from: "r", to: "rl", label: "left" },
      { from: "r", to: "rr", label: "right" },
    ],
  } as ConceptDoc,
  "cs.prog1.ast": {
    title: "AST of (1+2)*3",
    summary: "Abstract syntax tree: * at the root, with + and 3 as operands; + has 1 and 2.",
    diagramType: "hierarchy",
    template: "cs.prog1.ast",
    subject: "cs",
    course: "cs.prog1",
    nodes: [
      { id: "mul", label: "*", kind: "box" },
      { id: "add", label: "+", kind: "box" },
      { id: "three", label: "3", kind: "box" },
      { id: "one", label: "1", kind: "box" },
      { id: "two", label: "2", kind: "box" },
    ],
    edges: [
      { from: "mul", to: "add" },
      { from: "mul", to: "three" },
      { from: "add", to: "one" },
      { from: "add", to: "two" },
    ],
  } as ConceptDoc,
  "cs.prog1.proofTree": {
    title: "Induction proof tree",
    summary: "Proof by induction: the conclusion S(n) follows from the base case and the inductive step.",
    diagramType: "hierarchy",
    template: "cs.prog1.proofTree",
    subject: "cs",
    course: "cs.prog1",
    nodes: [
      { id: "conc", label: "S(n) holds", kind: "box" },
      { id: "base", label: "S(0): base case", kind: "box" },
      { id: "step", label: "S(k)->S(k+1): step", kind: "box" },
      { id: "ih", label: "induction hypothesis", kind: "box" },
    ],
    edges: [
      { from: "conc", to: "base", label: "base" },
      { from: "conc", to: "step", label: "step" },
      { from: "step", to: "ih", label: "assumes" },
    ],
  } as ConceptDoc,
  "cs.prog1.interpreterPipeline": {
    title: "Interpreter pipeline",
    summary: "A term flows source -> elaborate -> evaluate -> value through the interpreter.",
    diagramType: "flow",
    template: "cs.prog1.interpreterPipeline",
    subject: "cs",
    course: "cs.prog1",
    nodes: [
      { id: "src", label: "source term", kind: "box" },
      { id: "elab", label: "elaborate", kind: "box" },
      { id: "eval", label: "evaluate", kind: "box" },
      { id: "val", label: "value", kind: "pill" },
    ],
    edges: [
      { from: "src", to: "elab" },
      { from: "elab", to: "eval" },
      { from: "eval", to: "val" },
    ],
  } as ConceptDoc,
  "cs.prog1.parserPipeline": {
    title: "Parser pipeline",
    summary: "Lexing and parsing: source -> tokens -> parse tree -> AST.",
    diagramType: "flow",
    template: "cs.prog1.parserPipeline",
    subject: "cs",
    course: "cs.prog1",
    nodes: [
      { id: "src", label: "source", kind: "box" },
      { id: "tok", label: "tokens", kind: "box" },
      { id: "pt", label: "parse tree", kind: "box" },
      { id: "ast", label: "AST", kind: "pill" },
    ],
    edges: [
      { from: "src", to: "tok", label: "lex" },
      { from: "tok", to: "pt", label: "parse" },
      { from: "pt", to: "ast", label: "build" },
    ],
  } as ConceptDoc,
  "cs.prog1.callStack": {
    title: "Call stack",
    summary: "The call stack of recursive factorial(3): frames stacked top to bottom.",
    diagramType: "mindmap",
    template: "cs.prog1.callStack",
    subject: "cs",
    course: "cs.prog1",
    domain: { order: ["fact3", "fact2", "fact1", "main"] },
    nodes: [
      { id: "fact3", label: "fact(3)", kind: "box" },
      { id: "fact2", label: "fact(2)", kind: "box" },
      { id: "fact1", label: "fact(1)", kind: "box" },
      { id: "main", label: "main", kind: "box" },
    ],
    edges: [],
  } as ConceptDoc,
  "cs.prog1.stackMachine": {
    title: "Operand stack",
    summary: "A stack machine evaluating 3 4 +: operands pushed, then + pops and pushes 7.",
    diagramType: "mindmap",
    template: "cs.prog1.stackMachine",
    subject: "cs",
    course: "cs.prog1",
    domain: { order: ["plus", "four", "three"] },
    nodes: [
      { id: "plus", label: "+ (top)", kind: "box" },
      { id: "four", label: "4", kind: "box" },
      { id: "three", label: "3", kind: "box" },
    ],
    edges: [],
  } as ConceptDoc,
  "cs.prog1.moduleStructure": {
    title: "SML module structure",
    summary: "A structure ascribes a signature; a functor applies a signature to produce a structure.",
    diagramType: "hierarchy",
    template: "cs.prog1.moduleStructure",
    subject: "cs",
    course: "cs.prog1",
    nodes: [
      { id: "sig", label: "signature LIST", kind: "box" },
      { id: "str", label: "structure List", kind: "box" },
      { id: "fn", label: "functor MakeSet", kind: "box" },
      { id: "out", label: "structure Set", kind: "box" },
    ],
    edges: [
      { from: "str", to: "sig", label: "ascribes" },
      { from: "fn", to: "sig", label: "takes" },
      { from: "fn", to: "out", label: "produces" },
    ],
  } as ConceptDoc,
  "cs.prog1.memoryLinear": {
    title: "Memory layout",
    summary: "Linear memory picture: stack, heap, and data segments with addresses in notes.",
    diagramType: "mindmap",
    template: "cs.prog1.memoryLinear",
    subject: "cs",
    course: "cs.prog1",
    nodes: [
      { id: "stack", label: "Stack", kind: "box", note: "grows down; local refs" },
      { id: "heap", label: "Heap", kind: "box", note: "allocated arrays/refs" },
      { id: "data", label: "Data", kind: "box", note: "globals" },
    ],
    edges: [],
  } as ConceptDoc,

  // --- cs.prog2 (Programming 2) algorithm graphs ---
  "cs.prog2.classHierarchy": {
    title: "Class hierarchy",
    summary: "Animal is the base class; Dog and Cat extend it; Dog is extended by Puppy.",
    diagramType: "hierarchy",
    template: "cs.prog2.classHierarchy",
    subject: "cs",
    course: "cs.prog2",
    nodes: [
      { id: "animal", label: "Animal", kind: "box" },
      { id: "dog", label: "Dog", kind: "box" },
      { id: "cat", label: "Cat", kind: "box" },
      { id: "puppy", label: "Puppy", kind: "box" },
    ],
    edges: [
      { from: "dog", to: "animal" },
      { from: "cat", to: "animal" },
      { from: "puppy", to: "dog" },
    ],
  } as ConceptDoc,
  "cs.prog2.objectInteraction": {
    title: "Object interaction",
    summary: "A client calls service.process(), which calls repo.save(); control returns in order.",
    diagramType: "flow",
    template: "cs.prog2.objectInteraction",
    subject: "cs",
    course: "cs.prog2",
    domain: { order: ["client", "service", "repo"] },
    nodes: [
      { id: "client", label: "Client", kind: "box" },
      { id: "service", label: "Service", kind: "box" },
      { id: "repo", label: "Repo", kind: "box" },
    ],
    edges: [
      { from: "client", to: "service", label: "process()" },
      { from: "service", to: "repo", label: "save()" },
      { from: "repo", to: "service", label: "ok" },
      { from: "service", to: "client", label: "return" },
    ],
  } as ConceptDoc,
  "cs.prog2.dynamicBinding": {
    title: "Dynamic binding",
    summary: "A call on a Shape reference dispatches to Circle.draw() at runtime via the vtable.",
    diagramType: "flow",
    template: "cs.prog2.dynamicBinding",
    subject: "cs",
    course: "cs.prog2",
    nodes: [
      { id: "call", label: "shape.draw()", kind: "box" },
      { id: "vtable", label: "vtable", kind: "box" },
      { id: "circle", label: "Circle.draw()", kind: "box" },
      { id: "square", label: "Square.draw()", kind: "box" },
    ],
    edges: [
      { from: "call", to: "vtable", label: "lookup" },
      { from: "vtable", to: "circle", label: "dispatches to" },
    ],
  } as ConceptDoc,
  "cs.prog2.controlFlow": {
    title: "Control-flow graph",
    summary: "CFG of a while loop: entry -> condition -> body -> back-edge; exit on false.",
    diagramType: "flow",
    template: "cs.prog2.controlFlow",
    subject: "cs",
    course: "cs.prog2",
    nodes: [
      { id: "entry", label: "entry", kind: "box" },
      { id: "cond", label: "while (c)", kind: "box", note: "invariant: 0<=i<=n" },
      { id: "body", label: "body", kind: "box" },
      { id: "exit", label: "exit", kind: "pill" },
    ],
    edges: [
      { from: "entry", to: "cond" },
      { from: "cond", to: "body", label: "true" },
      { from: "body", to: "cond", label: "loop" },
      { from: "cond", to: "exit", label: "false" },
    ],
  } as ConceptDoc,
  "cs.prog2.memoryLayout": {
    title: "C memory layout",
    summary: "A C process: stack, heap, and data segments with a pointer from stack to heap.",
    diagramType: "mindmap",
    template: "cs.prog2.memoryLayout",
    subject: "cs",
    course: "cs.prog2",
    nodes: [
      { id: "stack", label: "Stack", kind: "box", note: "locals; grows down" },
      { id: "heap", label: "Heap", kind: "box", note: "malloc'd blocks" },
      { id: "data", label: ".data", kind: "box", note: "globals" },
      { id: "text", label: ".text", kind: "box", note: "code" },
    ],
    edges: [],
  } as ConceptDoc,

  // --- cs.cybersecurity (CISPA) algorithm graphs ---
  "cs.cybersecurity.cryptoRounds": {
    title: "AES round",
    summary: "One AES round: AddRoundKey, SubBytes, ShiftRows, MixColumns (last round omits MixColumns).",
    diagramType: "flow",
    template: "cs.cybersecurity.cryptoRounds",
    subject: "cs",
    course: "cs.cybersecurity",
    domain: { order: ["ark", "sub", "shift", "mix"] },
    nodes: [
      { id: "ark", label: "AddRoundKey", kind: "box" },
      { id: "sub", label: "SubBytes", kind: "box" },
      { id: "shift", label: "ShiftRows", kind: "box" },
      { id: "mix", label: "MixColumns", kind: "box" },
    ],
    edges: [
      { from: "ark", to: "sub" },
      { from: "sub", to: "shift" },
      { from: "shift", to: "mix" },
    ],
  } as ConceptDoc,
  "cs.cybersecurity.protocolSequence": {
    title: "TLS handshake",
    summary: "TLS 1.2 handshake: ClientHello, ServerHello + certificate, key exchange, Finished.",
    diagramType: "flow",
    template: "cs.cybersecurity.protocolSequence",
    subject: "cs",
    course: "cs.cybersecurity",
    domain: { order: ["client", "server"] },
    nodes: [
      { id: "client", label: "Client", kind: "box" },
      { id: "server", label: "Server", kind: "box" },
    ],
    edges: [
      { from: "client", to: "server", label: "ClientHello" },
      { from: "server", to: "client", label: "ServerHello + cert" },
      { from: "client", to: "server", label: "KeyExchange" },
      { from: "server", to: "client", label: "Finished" },
    ],
  } as ConceptDoc,
  "cs.cybersecurity.threatModel": {
    title: "Threat model",
    summary: "An attacker exploits a threat against an asset; a control mitigates the threat.",
    diagramType: "hierarchy",
    template: "cs.cybersecurity.threatModel",
    subject: "cs",
    course: "cs.cybersecurity",
    nodes: [
      { id: "asset", label: "Asset", kind: "box" },
      { id: "threat", label: "Threat", kind: "box" },
      { id: "attacker", label: "Attacker", kind: "box" },
      { id: "control", label: "Control", kind: "box" },
    ],
    edges: [
      { from: "threat", to: "asset", label: "targets" },
      { from: "attacker", to: "threat", label: "exploits" },
      { from: "control", to: "threat", label: "mitigates" },
    ],
  } as ConceptDoc,
  "cs.cybersecurity.attackTree": {
    title: "Attack tree",
    summary: "Goal 'steal credentials' decomposes into two sub-goals; phishing branches further.",
    diagramType: "hierarchy",
    template: "cs.cybersecurity.attackTree",
    subject: "cs",
    course: "cs.cybersecurity",
    domain: { root: "goal" },
    nodes: [
      { id: "goal", label: "steal creds", kind: "box" },
      { id: "phish", label: "phishing", kind: "box" },
      { id: "malware", label: "malware", kind: "box" },
      { id: "spear", label: "spear email", kind: "box" },
      { id: "whale", label: "whaling", kind: "box" },
    ],
    edges: [
      { from: "goal", to: "phish", label: "left" },
      { from: "goal", to: "malware", label: "right" },
      { from: "phish", to: "spear", label: "left" },
      { from: "phish", to: "whale", label: "right" },
    ],
  } as ConceptDoc,
  "cs.cybersecurity.networkStack": {
    title: "Network stack",
    summary: "TCP/IP layers with security protocols: TLS over TCP over IP over the link layer.",
    diagramType: "hierarchy",
    template: "cs.cybersecurity.networkStack",
    subject: "cs",
    course: "cs.cybersecurity",
    nodes: [
      { id: "app", label: "Application", kind: "box" },
      { id: "tls", label: "TLS", kind: "box" },
      { id: "tcp", label: "TCP", kind: "box" },
      { id: "ip", label: "IP", kind: "box" },
      { id: "link", label: "Link", kind: "box" },
    ],
    edges: [
      { from: "tls", to: "app", label: "secures" },
      { from: "tcp", to: "tls", label: "carries" },
      { from: "ip", to: "tcp", label: "carries" },
      { from: "link", to: "ip", label: "carries" },
    ],
  } as ConceptDoc,
  "cs.cybersecurity.webAttackFlow": {
    title: "SQL injection flow",
    summary: "Browser sends a crafted input; server forwards it to the DB, which leaks data.",
    diagramType: "flow",
    template: "cs.cybersecurity.webAttackFlow",
    subject: "cs",
    course: "cs.cybersecurity",
    domain: { order: ["browser", "server", "db"] },
    nodes: [
      { id: "browser", label: "Browser", kind: "box" },
      { id: "server", label: "App server", kind: "box" },
      { id: "db", label: "Database", kind: "box" },
    ],
    edges: [
      { from: "browser", to: "server", label: "GET /?id=' OR 1" },
      { from: "server", to: "db", label: "query" },
      { from: "db", to: "server", label: "leaked rows" },
    ],
  } as ConceptDoc,
  "cs.cybersecurity.accessMatrix": {
    title: "Access-control matrix",
    summary: "Subjects (alice, bob) × objects (f1, f2): cells hold permissions r/w/rw/-.",
    diagramType: "mindmap",
    template: "cs.cybersecurity.accessMatrix",
    subject: "cs",
    course: "cs.cybersecurity",
    domain: {
      grid: {
        cols: 3,
        positions: {
          corner: { r: 0, c: 0 },
          f1h: { r: 0, c: 1 },
          f2h: { r: 0, c: 2 },
          alice: { r: 1, c: 0 },
          af1: { r: 1, c: 1 },
          af2: { r: 1, c: 2 },
          bob: { r: 2, c: 0 },
          bf1: { r: 2, c: 1 },
          bf2: { r: 2, c: 2 },
        },
      },
    },
    nodes: [
      { id: "corner", label: "S \\ O", kind: "box" },
      { id: "f1h", label: "f1", kind: "box" },
      { id: "f2h", label: "f2", kind: "box" },
      { id: "alice", label: "alice", kind: "box" },
      { id: "af1", label: "rw", kind: "box" },
      { id: "af2", label: "r", kind: "box" },
      { id: "bob", label: "bob", kind: "box" },
      { id: "bf1", label: "r", kind: "box" },
      { id: "bf2", label: "-", kind: "box" },
    ],
    edges: [],
  } as ConceptDoc,
  "cs.cybersecurity.trustBoundary": {
    title: "Trust boundary",
    summary: "A DFD with user and kernel trust zones; the syscall crosses the boundary.",
    diagramType: "flow",
    template: "cs.cybersecurity.trustBoundary",
    subject: "cs",
    course: "cs.cybersecurity",
    nodes: [
      { id: "app", label: "App", kind: "box" },
      { id: "syscall", label: "syscall", kind: "box" },
      { id: "kernel", label: "Kernel", kind: "box" },
      { id: "drv", label: "Driver", kind: "box" },
    ],
    edges: [
      { from: "app", to: "syscall", label: "calls" },
      { from: "syscall", to: "kernel", label: "enters" },
      { from: "kernel", to: "drv", label: "invokes" },
    ],
    groups: [
      { id: "user", label: "User space", members: ["app"] },
      { id: "kspace", label: "Kernel space", members: ["kernel", "drv"] },
    ],
  } as ConceptDoc,
  "cs.cybersecurity.exploitChain": {
    title: "Exploit chain",
    summary: "Buffer overflow overwrites the saved return address; the ROP gadget chain runs.",
    diagramType: "mindmap",
    template: "cs.cybersecurity.exploitChain",
    subject: "cs",
    course: "cs.cybersecurity",
    nodes: [
      { id: "buf", label: "buffer", kind: "box", note: "input overflow" },
      { id: "ret", label: "saved ret addr", kind: "box", note: "overwritten" },
      { id: "rop", label: "ROP chain", kind: "box", note: "gadgets" },
      { id: "shell", label: "shell", kind: "box", note: "payload" },
    ],
    edges: [],
  } as ConceptDoc,

  // --- cs.systems (Systems Architecture) algorithm graphs ---
  "cs.systems.pipeline": {
    title: "CPU pipeline",
    summary: "5-stage DLX pipeline: IF, ID, EX, MEM, WB; forwarding from MEM to EX avoids a stall.",
    diagramType: "flow",
    template: "cs.systems.pipeline",
    subject: "cs",
    course: "cs.systems",
    domain: { order: ["if", "id", "ex", "mem", "wb"] },
    nodes: [
      { id: "if", label: "IF", kind: "box" },
      { id: "id", label: "ID", kind: "box" },
      { id: "ex", label: "EX", kind: "box" },
      { id: "mem", label: "MEM", kind: "box" },
      { id: "wb", label: "WB", kind: "box" },
    ],
    edges: [
      { from: "if", to: "id" },
      { from: "id", to: "ex" },
      { from: "ex", to: "mem" },
      { from: "mem", to: "wb" },
      { from: "mem", to: "ex", label: "forward" },
    ],
  } as ConceptDoc,
  "cs.systems.datapath": {
    title: "DLX datapath",
    summary: "Datapath: PC -> instruction memory -> register file -> ALU -> data memory -> writeback.",
    diagramType: "hierarchy",
    template: "cs.systems.datapath",
    subject: "cs",
    course: "cs.systems",
    nodes: [
      { id: "pc", label: "PC", kind: "box" },
      { id: "imem", label: "Instr mem", kind: "box" },
      { id: "rf", label: "Register file", kind: "box" },
      { id: "alu", label: "ALU", kind: "box" },
      { id: "dmem", label: "Data mem", kind: "box" },
    ],
    edges: [
      { from: "pc", to: "imem", label: "addr" },
      { from: "imem", to: "rf", label: "decode" },
      { from: "rf", to: "alu", label: "operands" },
      { from: "alu", to: "dmem", label: "addr/data" },
    ],
  } as ConceptDoc,
  "cs.systems.cacheHierarchy": {
    title: "Cache hierarchy",
    summary: "Memory hierarchy: CPU regs -> L1 -> L2 -> L3 -> DRAM; each level backs the one above.",
    diagramType: "hierarchy",
    template: "cs.systems.cacheHierarchy",
    subject: "cs",
    course: "cs.systems",
    nodes: [
      { id: "reg", label: "Registers", kind: "box" },
      { id: "l1", label: "L1", kind: "box" },
      { id: "l2", label: "L2", kind: "box" },
      { id: "l3", label: "L3", kind: "box" },
      { id: "dram", label: "DRAM", kind: "box" },
    ],
    edges: [
      { from: "l1", to: "reg", label: "misses to" },
      { from: "l2", to: "l1", label: "misses to" },
      { from: "l3", to: "l2", label: "misses to" },
      { from: "dram", to: "l3", label: "misses to" },
    ],
  } as ConceptDoc,
  "cs.systems.cacheSetAssoc": {
    title: "2-way set-associative cache",
    summary: "Two sets, two ways each; cells hold tag/valid, empty lines are blank.",
    diagramType: "mindmap",
    template: "cs.systems.cacheSetAssoc",
    subject: "cs",
    course: "cs.systems",
    domain: {
      grid: {
        cols: 3,
        positions: {
          corner: { r: 0, c: 0 },
          w0: { r: 0, c: 1 },
          w1: { r: 0, c: 2 },
          s0: { r: 1, c: 0 },
          s0w0: { r: 1, c: 1 },
          s0w1: { r: 1, c: 2 },
          s1: { r: 2, c: 0 },
          s1w0: { r: 2, c: 1 },
          s1w1: { r: 2, c: 2 },
        },
      },
    },
    nodes: [
      { id: "corner", label: "set\\way", kind: "box" },
      { id: "w0", label: "way 0", kind: "box" },
      { id: "w1", label: "way 1", kind: "box" },
      { id: "s0", label: "set 0", kind: "box" },
      { id: "s0w0", label: "tag=A v=1", kind: "box" },
      { id: "s0w1", label: "empty", kind: "box" },
      { id: "s1", label: "set 1", kind: "box" },
      { id: "s1w0", label: "tag=B v=1", kind: "box" },
      { id: "s1w1", label: "tag=C v=1", kind: "box" },
    ],
    edges: [],
  } as ConceptDoc,
  "cs.systems.mmu": {
    title: "MMU translation",
    summary: "Virtual address -> TLB lookup -> page table walk -> physical frame.",
    diagramType: "flow",
    template: "cs.systems.mmu",
    subject: "cs",
    course: "cs.systems",
    nodes: [
      { id: "va", label: "Virtual addr", kind: "box" },
      { id: "tlb", label: "TLB", kind: "box" },
      { id: "pt", label: "Page table", kind: "box" },
      { id: "frame", label: "Physical frame", kind: "pill" },
    ],
    edges: [
      { from: "va", to: "tlb", label: "lookup" },
      { from: "tlb", to: "pt", label: "miss -> walk" },
      { from: "pt", to: "frame", label: "maps to" },
    ],
  } as ConceptDoc,
  "cs.systems.processStates": {
    title: "Process state machine",
    summary: "OS process states: new -> ready -> running -> (waiting) -> ready; running -> terminated.",
    diagramType: "flow",
    template: "cs.systems.processStates",
    subject: "cs",
    course: "cs.systems",
    domain: { accepting: ["term"] },
    nodes: [
      { id: "new", label: "new", kind: "ellipse" },
      { id: "ready", label: "ready", kind: "ellipse" },
      { id: "run", label: "running", kind: "ellipse" },
      { id: "wait", label: "waiting", kind: "ellipse" },
      { id: "term", label: "terminated", kind: "ellipse" },
    ],
    edges: [
      { from: "new", to: "ready", label: "admit" },
      { from: "ready", to: "run", label: "dispatch" },
      { from: "run", to: "wait", label: "block" },
      { from: "wait", to: "ready", label: "wake" },
      { from: "run", to: "term", label: "exit" },
      { from: "run", to: "run", label: "quantum" },
    ],
  } as ConceptDoc,
  "cs.systems.schedulingGantt": {
    title: "Round-robin Gantt",
    summary: "Round-robin schedule: P1, P2, P1, P3, P2 time slices along the timeline.",
    diagramType: "timeline",
    template: "cs.systems.schedulingGantt",
    subject: "cs",
    course: "cs.systems",
    nodes: [
      { id: "s1", label: "P1", kind: "box", note: "0-2" },
      { id: "s2", label: "P2", kind: "box", note: "2-4" },
      { id: "s3", label: "P1", kind: "box", note: "4-6" },
      { id: "s4", label: "P3", kind: "box", note: "6-8" },
    ],
    edges: [
      { from: "s1", to: "s2" },
      { from: "s2", to: "s3" },
      { from: "s3", to: "s4" },
    ],
    steps: [
      { id: "s1", label: "P1", at: 0 },
      { id: "s2", label: "P2", at: 2 },
      { id: "s3", label: "P1", at: 4 },
      { id: "s4", label: "P3", at: 6 },
    ],
  } as ConceptDoc,
  "cs.systems.deadlockGraph": {
    title: "Resource-allocation graph",
    summary: "P1 holds R1 and requests R2; P2 holds R2 and requests R1 — a cycle means deadlock.",
    diagramType: "flow",
    template: "cs.systems.deadlockGraph",
    subject: "cs",
    course: "cs.systems",
    nodes: [
      { id: "p1", label: "P1", kind: "box" },
      { id: "r1", label: "R1", kind: "ellipse" },
      { id: "p2", label: "P2", kind: "box" },
      { id: "r2", label: "R2", kind: "ellipse" },
    ],
    edges: [
      { from: "p1", to: "r2", label: "requests" },
      { from: "r2", to: "p2", label: "holds" },
      { from: "p2", to: "r1", label: "requests" },
      { from: "r1", to: "p1", label: "holds" },
    ],
  } as ConceptDoc,
  "cs.systems.virtualMemory": {
    title: "Virtual memory paging",
    summary: "Page table entries map to physical frames; present/dirty bits live in notes.",
    diagramType: "mindmap",
    template: "cs.systems.virtualMemory",
    subject: "cs",
    course: "cs.systems",
    nodes: [
      { id: "pt", label: "Page table", kind: "box", note: "VPN -> PFN" },
      { id: "p0", label: "page 0", kind: "box", note: "present=1 dirty=0" },
      { id: "p1", label: "page 1", kind: "box", note: "present=0 (swapped)" },
      { id: "frame", label: "Frame 12", kind: "box", note: "holds page 0" },
    ],
    edges: [],
  } as ConceptDoc,
  "cs.systems.fileSystemTree": {
    title: "File-system tree",
    summary: "Root directory contains home and etc; home contains user files.",
    diagramType: "hierarchy",
    template: "cs.systems.fileSystemTree",
    subject: "cs",
    course: "cs.systems",
    nodes: [
      { id: "root", label: "/", kind: "box" },
      { id: "home", label: "home", kind: "box" },
      { id: "etc", label: "etc", kind: "box" },
      { id: "user", label: "alice.txt", kind: "pill" },
      { id: "conf", label: "hosts", kind: "pill" },
    ],
    edges: [
      { from: "root", to: "home" },
      { from: "root", to: "etc" },
      { from: "home", to: "user" },
      { from: "etc", to: "conf" },
    ],
  } as ConceptDoc,
  "cs.systems.osLayers": {
    title: "OS layers",
    summary: "User app -> libc -> syscall interface -> kernel services -> drivers -> hardware.",
    diagramType: "hierarchy",
    template: "cs.systems.osLayers",
    subject: "cs",
    course: "cs.systems",
    nodes: [
      { id: "app", label: "Application", kind: "box" },
      { id: "libc", label: "libc", kind: "box" },
      { id: "sc", label: "Syscall iface", kind: "box" },
      { id: "kern", label: "Kernel services", kind: "box" },
      { id: "drv", label: "Drivers", kind: "box" },
      { id: "hw", label: "Hardware", kind: "box" },
    ],
    edges: [
      { from: "app", to: "libc", label: "calls" },
      { from: "libc", to: "sc", label: "wraps" },
      { from: "sc", to: "kern", label: "trap" },
      { from: "kern", to: "drv", label: "uses" },
      { from: "drv", to: "hw", label: "drives" },
    ],
    groups: [
      { id: "user", label: "User", members: ["app", "libc"] },
      { id: "kernel", label: "Kernel", members: ["kern", "drv", "sc"] },
    ],
  } as ConceptDoc,

  // --- generic fallback templates (baseline) ---
  "generic.hierarchy": {
    title: "Taxonomy",
    summary: "A small hierarchy: root with two children.",
    diagramType: "hierarchy",
    template: "generic.hierarchy",
    nodes: [
      { id: "r", label: "root", kind: "box" },
      { id: "a", label: "child a", kind: "box" },
      { id: "b", label: "child b", kind: "box" },
    ],
    edges: [{ from: "r", to: "a" }, { from: "r", to: "b" }],
  } as ConceptDoc,
  "generic.timeline": {
    title: "Timeline",
    summary: "A chronological chain of events.",
    diagramType: "timeline",
    template: "generic.timeline",
    nodes: [
      { id: "e1", label: "1900", kind: "box" },
      { id: "e2", label: "1920", kind: "box" },
      { id: "e3", label: "1940", kind: "box" },
    ],
    edges: [{ from: "e1", to: "e2" }, { from: "e2", to: "e3" }],
    steps: [
      { id: "e1", label: "1900", at: 1900 },
      { id: "e2", label: "1920", at: 1920 },
      { id: "e3", label: "1940", at: 1940 },
    ],
  } as ConceptDoc,
  "generic.comparison": {
    title: "A vs B",
    summary: "Side-by-side comparison of two groups.",
    diagramType: "comparison",
    template: "generic.comparison",
    nodes: [
      { id: "a1", label: "A point 1", kind: "box" },
      { id: "a2", label: "A point 2", kind: "box" },
      { id: "b1", label: "B point 1", kind: "box" },
    ],
    edges: [{ from: "a1", to: "b1", label: "vs" }],
    groups: [
      { id: "A", label: "A", members: ["a1", "a2"] },
      { id: "B", label: "B", members: ["b1"] },
    ],
  } as ConceptDoc,
  "generic.mindmap": {
    title: "Concept map",
    summary: "A radial concept map around a central idea.",
    diagramType: "mindmap",
    template: "generic.mindmap",
    nodes: [
      { id: "core", label: "core idea", kind: "box" },
      { id: "b1", label: "branch 1", kind: "box" },
      { id: "b2", label: "branch 2", kind: "box" },
    ],
    edges: [{ from: "core", to: "b1" }, { from: "core", to: "b2" }],
  } as ConceptDoc,
};

/** Resolve a representative IR for a template: few-shot doc, then the FIXTURES map. */
function fixtureFor(t: Template): ConceptDoc {
  if (t.fewShot) return t.fewShot.doc as ConceptDoc;
  const fx = FIXTURES[t.id];
  if (fx) return fx;
  throw new Error(`no fixture for template ${t.id} — add one to FIXTURES`);
}

test("every registered template has a fixture (none silently skipped)", () => {
  for (const t of allTemplates()) {
    assert.ok(t.fewShot || FIXTURES[t.id], `template ${t.id} has no fixture`);
  }
});

test("every CS template: validate -> layout -> render, no overlap, valid edges", () => {
  const csTemplates = allTemplates().filter((t) => t.subject === "cs");
  assert.ok(csTemplates.length >= 10, `expected >=10 cs templates, got ${csTemplates.length}`);
  for (const t of csTemplates) {
    const doc = fixtureFor(t);
    const v = validate(doc);
    assert.ok(v.ok, `${t.id}: fixture failed validation: ${!v.ok ? JSON.stringify(v.errors) : ""}`);
    const g = layout(v.doc);
    assert.ok(g.width > 0 && g.height > 0, `${t.id}: non-positive bounds`);
    assert.equal(g.nodes.length, v.doc.nodes.length, `${t.id}: node count changed`);
    // no overlaps
    for (let i = 0; i < g.nodes.length; i++)
      for (let j = i + 1; j < g.nodes.length; j++)
        assert.ok(!overlaps(g.nodes[i], g.nodes[j]), `${t.id}: nodes ${g.nodes[i].id} & ${g.nodes[j].id} overlap`);
    // edges valid
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const e of g.edges) {
      assert.ok(ids.has(e.from) && ids.has(e.to), `${t.id}: edge references missing node`);
      assert.ok(e.points.length >= 2, `${t.id}: edge needs >=2 points`);
    }
    // render doesn't throw
    const svg = makeSvg();
    drawConcept(svg, g);
    assert.ok(svg.getAttribute("viewBox"), `${t.id}: viewBox set`);
    assert.ok(svg.childNodes.length > 0, `${t.id}: rendered no children`);
  }
});

test("every generic template: validate -> layout -> render, no overlap", () => {
  const genTemplates = allTemplates().filter((t) => t.subject === "generic");
  assert.equal(genTemplates.length, 6, "6 generic templates");
  for (const t of genTemplates) {
    const doc = fixtureFor(t);
    const v = validate(doc);
    assert.ok(v.ok, `${t.id}: fixture failed validation: ${!v.ok ? JSON.stringify(v.errors) : ""}`);
    const g = layout(v.doc);
    assert.ok(g.width > 0 && g.height > 0, `${t.id}: non-positive bounds`);
    for (let i = 0; i < g.nodes.length; i++)
      for (let j = i + 1; j < g.nodes.length; j++)
        assert.ok(!overlaps(g.nodes[i], g.nodes[j]), `${t.id}: nodes ${g.nodes[i].id} & ${g.nodes[j].id} overlap`);
    const svg = makeSvg();
    drawConcept(svg, g);
    assert.ok(svg.childNodes.length > 0, `${t.id}: rendered no children`);
  }
});

test("layout dispatches cs.prog1.binaryTree through the template (not the diagramType switch)", () => {
  const t = getTemplate("cs.prog1.binaryTree")!;
  const g = layout(fixtureFor(t));
  assert.equal(g.nodes.every((n) => n.primitive === "treeNode"), true);
  assert.equal(g.edges.every((e) => e.primitive === "branchEdge"), true);
});

/* ---------------------- end-to-end pipeline smoke (fakeClient) ---------------------- */

function fakeClient(output: string): LLMClient {
  return {
    async complete(_msgs: ChatMessage[], _opts?: CompleteOptions): Promise<CompleteResult> {
      return { text: output, truncated: false };
    },
  };
}

test("end-to-end: binary tree scripted IR -> produceDoc -> layout -> render", async () => {
  const t = getTemplate("cs.prog1.binaryTree")!;
  const res = await produceDoc("draw a binary tree", fakeClient(JSON.stringify(fixtureFor(t))), {
    courseHint: "cs.prog1",
  });
  assert.equal(res.fellBack, false);
  assert.equal(res.doc.template, "cs.prog1.binaryTree");
  const g = layout(res.doc);
  assert.ok(g.nodes.length === 7);
  const svg = makeSvg();
  drawConcept(svg, g);
  assert.ok(svg.childNodes.length > 0);
});

test("end-to-end: parser pipeline scripted IR routes via cs.prog1 hint", async () => {
  const t = getTemplate("cs.prog1.parserPipeline")!;
  const res = await produceDoc("lexing and parsing", fakeClient(JSON.stringify(fixtureFor(t))), {
    courseHint: "cs.prog1",
  });
  assert.equal(res.fellBack, false);
  assert.equal(res.route.course, "cs.prog1");
  const g = layout(res.doc);
  assert.equal(g.diagramType, "flow");
  const svg = makeSvg();
  drawConcept(svg, g);
  assert.ok(svg.childNodes.length > 0);
});

test("end-to-end: call stack scripted IR -> stack layout", async () => {
  const t = getTemplate("cs.prog1.callStack")!;
  const res = await produceDoc("call stack of factorial", fakeClient(JSON.stringify(fixtureFor(t))));
  assert.equal(res.fellBack, false);
  const g = layout(res.doc);
  // stack frames are stacked vertically: distinct y per frame, shared x
  const ys = new Set(g.nodes.map((n) => Math.round(n.y)));
  assert.equal(ys.size, g.nodes.length, "each frame on its own row");
  const svg = makeSvg();
  drawConcept(svg, g);
  assert.ok(svg.childNodes.length > 0);
});