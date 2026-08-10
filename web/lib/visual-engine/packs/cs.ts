/**
 * CS pack — Phase 1–3 course sequences. This file registers templates for the CS-curriculum
 * courses; Phase 1a ships `cs.prog1` (Programming 1, functional/SML) including the binary-tree
 * fix. `cs.prog2`, `cs.cybersecurity`, `cs.systems`, and the math/HCI sequences are added in
 * later sub-stages (their templates reuse the same framework).
 *
 * Grounded in Saarland's real CS-bachelor courses (sources: modules.cs.uni-saarland.de,
 * cysec.uni-saarland.de, embedded.cs.uni-saarland.de, MHB_BA_Info24, Smolka prog textbook).
 */
import type { ConceptDoc } from "../schema";
import type { PositionedGraph } from "../layout";
import { layoutDagre, layoutRadial, layoutTimeline } from "../layout";
import { registerTemplate, type Template } from "../registry";
// Importing the primitives registers their render glyphs at module load — side-effect import.
import { layoutBinaryTree } from "../primitives/tree";
import { layoutStack } from "../primitives/stack";
import { layoutMemory } from "../primitives/container";
import { layoutSequence } from "../primitives/sequence";
import { layoutStages } from "../primitives/stages";
import { layoutGrid } from "../primitives/grid";
import { layoutStateMachine } from "../primitives/stateMachine";

const tmpl = (t: Template): void => registerTemplate(t);

/* ----------------------------- cs.prog1 (Programming 1) ----------------------------- */
// Functional programming with Standard ML: recursion, ASTs, semantics, parsers, memory, stack
// machines. The binary-tree template is THE fix for "draw a binary tree" -> 4 vertical boxes.

tmpl({
  id: "cs.prog1.binaryTree",
  course: "cs.prog1",
  subject: "cs",
  label: "Binary tree",
  description: "A rooted binary tree (data structure, BST, decision tree) — each node has ≤2 children.",
  promptFragment:
    "binaryTree — a rooted tree where EACH node has at most TWO children. Emit a root with NO incoming edge; every other node has exactly one parent. " +
    "Label every child edge `left` or `right` (a node's first child is left, second is right). Show ≥3 levels (a full 3-level tree has 7 nodes). " +
    "A missing child may be shown as a leaf node labeled `⊥`/`null`. Set domain.root to the root id. " +
    "Do NOT emit a flat list — a binary tree BRANCHES: the root has a left and a right subtree.",
  fewShot: {
    query: "Draw a binary tree.",
    doc: {
      title: "Binary Tree",
      summary:
        "A binary tree is a rooted tree where each node has at most two children, labeled left and right. A full 3-level tree has a root, two children, and four grandchildren.",
      diagramType: "hierarchy",
      template: "cs.prog1.binaryTree",
      subject: "cs",
      course: "cs.prog1",
      domain: { root: "root" },
      nodes: [
        { id: "root", label: "root", kind: "box" },
        { id: "L", label: "left child", kind: "box" },
        { id: "R", label: "right child", kind: "box" },
        { id: "LL", label: "left-left", kind: "box" },
        { id: "LR", label: "left-right", kind: "box" },
        { id: "RL", label: "right-left", kind: "box" },
        { id: "RR", label: "right-right", kind: "box" },
      ],
      edges: [
        { from: "root", to: "L", label: "left" },
        { from: "root", to: "R", label: "right" },
        { from: "L", to: "LL", label: "left" },
        { from: "L", to: "LR", label: "right" },
        { from: "R", to: "RL", label: "left" },
        { from: "R", to: "RR", label: "right" },
      ],
    },
  },
  layout: (doc: ConceptDoc): PositionedGraph => layoutBinaryTree(doc),
});

tmpl({
  id: "cs.prog1.recursionTree",
  course: "cs.prog1",
  subject: "cs",
  label: "Recursion tree",
  description: "Recursion / call tree for a divide-and-conquer recurrence (each call spawns ≤2 subcalls).",
  promptFragment:
    "recursionTree — the call tree of a recursive function: each call node has ≤2 children (subcalls), edges labeled left/right. Put the recurrence (e.g. T(n)=2T(n/2)+n) in the root's note. Set domain.root to the top call.",
  layout: (doc: ConceptDoc): PositionedGraph => layoutBinaryTree(doc),
});

tmpl({
  id: "cs.prog1.ast",
  course: "cs.prog1",
  subject: "cs",
  label: "Abstract syntax tree",
  description: "AST of an expression/program: operators as internal nodes, operands as leaves.",
  promptFragment:
    "ast — an abstract syntax tree: operator nodes are internal, operands are leaves, edges unlabeled. Root is the outermost operator.",
  layout: (doc: ConceptDoc): PositionedGraph => layoutDagre(doc, "TB"),
});

tmpl({
  id: "cs.prog1.proofTree",
  course: "cs.prog1",
  subject: "cs",
  label: "Proof tree",
  description: "Inference-rule / inductive proof tree: conclusion at root, premises as children.",
  promptFragment:
    "proofTree — an inference-rule proof: the conclusion is the root, each premise is a child node; label edges with the rule name. Leaves are axioms.",
  layout: (doc: ConceptDoc): PositionedGraph => layoutDagre(doc, "TB"),
});

tmpl({
  id: "cs.prog1.interpreterPipeline",
  course: "cs.prog1",
  subject: "cs",
  label: "Interpreter pipeline",
  description: "elab → eval pipeline: source → elaborated term → value (stages left→right).",
  promptFragment:
    "interpreterPipeline — the stages of evaluating a term left→right (e.g. source → elab → eval → value). Edges show the data flowing between stages.",
  layout: (doc: ConceptDoc): PositionedGraph => layoutDagre(doc, "LR"),
});

tmpl({
  id: "cs.prog1.parserPipeline",
  course: "cs.prog1",
  subject: "cs",
  label: "Parser pipeline",
  description: "lex → parse → AST pipeline (tokens → parse tree → AST), left→right.",
  promptFragment:
    "parserPipeline — lexing/parsing stages left→right (source → tokens → parse tree → AST). Nodes are stages; edges show the flow.",
  layout: (doc: ConceptDoc): PositionedGraph => layoutDagre(doc, "LR"),
});

tmpl({
  id: "cs.prog1.callStack",
  course: "cs.prog1",
  subject: "cs",
  label: "Call stack",
  description: "Call stack of a recursive execution: frames stacked top→bottom (top = current frame).",
  promptFragment:
    "callStack — the call stack of a running program: one node per stack frame, stacked vertically. The current/top frame is first. Set domain.order to the frame ids from top to bottom.",
  layout: (doc: ConceptDoc): PositionedGraph => layoutStack(doc),
});

tmpl({
  id: "cs.prog1.stackMachine",
  course: "cs.prog1",
  subject: "cs",
  label: "Stack machine",
  description: "Operand/stack-machine state: a stack of values with the top operand on top.",
  promptFragment:
    "stackMachine — an operand stack (push/pop machine): one node per stack entry, top entry first. Set domain.order from top to bottom.",
  layout: (doc: ConceptDoc): PositionedGraph => layoutStack(doc),
});

tmpl({
  id: "cs.prog1.moduleStructure",
  course: "cs.prog1",
  subject: "cs",
  label: "Module structure",
  description: "SML signature/functor structure: signatures, structures, functors and their ascription.",
  promptFragment:
    "moduleStructure — SML modules: signatures, structures, functors as nodes; edges show `ascribes`/`applies` relationships.",
  layout: (doc: ConceptDoc): PositionedGraph => layoutDagre(doc, "TB"),
});

tmpl({
  id: "cs.prog1.memoryLinear",
  course: "cs.prog1",
  subject: "cs",
  label: "Memory layout",
  description: "Linear memory picture: stack/heap/data segments, references, arrays.",
  promptFragment:
    "memoryLinear — a linear memory picture: nodes are memory regions (stack, heap, data) or allocated blocks (ref, array). Put addresses/sizes in notes.",
  layout: (doc: ConceptDoc): PositionedGraph => layoutMemory(doc),
});

/* ----------------------------- cs.prog2 (Programming 2) ----------------------------- */
// Imperative + OOP (C + Java, Hack): objects, interaction, inheritance, dynamic binding, C memory.

tmpl({
  id: "cs.prog2.classHierarchy",
  course: "cs.prog2",
  subject: "cs",
  label: "Class hierarchy",
  description: "Inheritance hierarchy: superclass at top, subclasses below (`extends`/`implements`).",
  promptFragment:
    "classHierarchy — an inheritance tree: the base/superclass is the root, subclasses are children; edges are unlabeled `extends`/`implements` arrows (child → parent). Multi-level inheritance reads top→bottom.",
  layout: (doc: ConceptDoc): PositionedGraph => layoutDagre(doc, "TB"),
});

tmpl({
  id: "cs.prog2.objectInteraction",
  course: "cs.prog2",
  subject: "cs",
  label: "Object interaction (sequence)",
  description: "UML sequence diagram: objects as lifelines, method calls as ordered messages.",
  promptFragment:
    "objectInteraction — a UML sequence diagram. Each node is an object/participant; each edge is a method call in chronological order (top→bottom). Label edges with the message name. Set domain.order to the participant ids left→right. A call back to the same object is a self-message.",
  layout: (doc: ConceptDoc): PositionedGraph => layoutSequence(doc),
});

tmpl({
  id: "cs.prog2.dynamicBinding",
  course: "cs.prog2",
  subject: "cs",
  label: "Dynamic binding / dispatch",
  description: "Virtual dispatch: a call resolves to the overridden method at runtime.",
  promptFragment:
    "dynamicBinding — runtime method dispatch: a call node resolves (via a vtable) to the concrete overridden implementation. Show the static type and the dynamic type; edges are `dispatches to`.",
  layout: (doc: ConceptDoc): PositionedGraph => layoutDagre(doc, "LR"),
});

tmpl({
  id: "cs.prog2.controlFlow",
  course: "cs.prog2",
  subject: "cs",
  label: "Control-flow graph",
  description: "CFG of a method: basic blocks + branches/loops, with loop invariants in notes.",
  promptFragment:
    "controlFlow — a control-flow graph of a method: nodes are basic blocks (entry, conditions, bodies, exit); edges are `true`/`false`/`fall-through`. Put loop invariants in block notes.",
  layout: (doc: ConceptDoc): PositionedGraph => layoutDagre(doc, "LR"),
});

tmpl({
  id: "cs.prog2.memoryLayout",
  course: "cs.prog2",
  subject: "cs",
  label: "C memory layout",
  description: "C process memory: stack, heap, globals, code; pointers between regions.",
  promptFragment:
    "memoryLayout — a C process memory picture: nodes are regions (stack, heap, .data, .bss, .text) or allocated blocks; edges are pointer dereferences. Put addresses/sizes in notes.",
  layout: (doc: ConceptDoc): PositionedGraph => layoutMemory(doc),
});

/* --------------------------- cs.cybersecurity (CISPA) --------------------------- */
// CySec1/2 + web + core Security: crypto, protocols, threats, network stack, web attacks, access
// control, trust boundaries, exploit chains.

tmpl({
  id: "cs.cybersecurity.cryptoRounds",
  course: "cs.cybersecurity",
  subject: "cs",
  label: "Cipher rounds (stages)",
  description: "Iterated cipher: rounds + key schedule as a left→right stage pipeline (AES/Feistel).",
  promptFragment:
    "cryptoRounds — an iterated block cipher as a left→right pipeline of rounds (e.g. AddRoundKey→SubBytes→ShiftRows→MixColumns). Each node is one round stage; edges flow between consecutive stages. The first stage is the key+plaintext input, the last is the ciphertext. Set domain.order to the stage ids left→right.",
  layout: (doc: ConceptDoc): PositionedGraph => layoutStages(doc),
});

tmpl({
  id: "cs.cybersecurity.protocolSequence",
  course: "cs.cybersecurity",
  subject: "cs",
  label: "Protocol sequence (handshake)",
  description: "Crypto protocol handshake (TLS/Diffie-Hellman/key exchange) as lifelines + messages.",
  promptFragment:
    "protocolSequence — a cryptographic protocol handshake (e.g. TLS, Diffie–Hellman). Nodes are the parties (client, server, CA); edges are the ordered protocol messages with labels like `ClientHello`, `ServerHello`, `KeyExchange`, `Finished`. Set domain.order to the party ids left→right.",
  layout: (doc: ConceptDoc): PositionedGraph => layoutSequence(doc),
});

tmpl({
  id: "cs.cybersecurity.threatModel",
  course: "cs.cybersecurity",
  subject: "cs",
  label: "Threat model",
  description: "Assets, attackers, threats and their relationships (STRIDE / attacker-goal tree).",
  promptFragment:
    "threatModel — a threat model: assets, threat actors, and threats as nodes; edges are `targets`/`exploits`/`mitigates`. Group related threats; the asset is usually the root or hub.",
  layout: (doc: ConceptDoc): PositionedGraph => layoutDagre(doc, "TB"),
});

tmpl({
  id: "cs.cybersecurity.attackTree",
  course: "cs.cybersecurity",
  subject: "cs",
  label: "Attack tree",
  description: "Attacker-goal decomposition: root = attack goal, children = sub-goals (AND/OR).",
  promptFragment:
    "attackTree — an attack tree: the attacker's goal is the root, sub-goals are children (≤2 per node, labeled left/right for the two sub-attacks); leaf nodes are concrete attacks. Set domain.root to the goal id. Label AND/OR refinement on edges where relevant.",
  layout: (doc: ConceptDoc): PositionedGraph => layoutBinaryTree(doc),
});

tmpl({
  id: "cs.cybersecurity.networkStack",
  course: "cs.cybersecurity",
  subject: "cs",
  label: "Network stack (layers)",
  description: "TCP/IP layer stack with security protocols attached per layer (groups).",
  promptFragment:
    "networkStack — the TCP/IP layer stack. Nodes are layers (Application, Transport, Internet, Link) plus security protocols (TLS, IPsec, WPA). Group each protocol under its layer (domain groups). Edges show `encapsulates`/`runs over`.",
  layout: (doc: ConceptDoc): PositionedGraph => layoutDagre(doc, "TB"),
});

tmpl({
  id: "cs.cybersecurity.webAttackFlow",
  course: "cs.cybersecurity",
  subject: "cs",
  label: "Web attack flow",
  description: "Web attack (XSS/CSRF/SQLi) as a sequence: browser → server → DB request/response.",
  promptFragment:
    "webAttackFlow — a web attack (XSS / CSRF / SQL injection) as a sequence: nodes are the browser, app server, and database; edges are the request/response messages that carry the payload. Label edges with the HTTP step.",
  layout: (doc: ConceptDoc): PositionedGraph => layoutSequence(doc),
});

tmpl({
  id: "cs.cybersecurity.accessMatrix",
  course: "cs.cybersecurity",
  subject: "cs",
  label: "Access-control matrix",
  description: "Access-control / capability matrix: subjects × objects, cells = permissions.",
  promptFragment:
    "accessMatrix — an access-control matrix. Nodes are the cells of a subjects×objects grid (each cell is a permission like `r`, `w`, `rw`, `-`). Put subject labels in the first column and object labels in the first row. Set domain.grid = { cols, positions: { id: {r,c} } } so headers and cells line up.",
  layout: (doc: ConceptDoc): PositionedGraph => layoutGrid(doc),
});

tmpl({
  id: "cs.cybersecurity.trustBoundary",
  course: "cs.cybersecurity",
  subject: "cs",
  label: "Trust boundary (DFD)",
  description: "Data-flow diagram with trust boundaries (user / kernel / TEE) as groups.",
  promptFragment:
    "trustBoundary — a data-flow diagram with trust boundaries. Nodes are processes/data stores/external entities; edges are data flows. Group nodes into trust zones (e.g. user, kernel, TEE) via domain groups so each boundary renders as a box.",
  layout: (doc: ConceptDoc): PositionedGraph => layoutDagre(doc, "TB"),
});

tmpl({
  id: "cs.cybersecurity.exploitChain",
  course: "cs.cybersecurity",
  subject: "cs",
  label: "Exploit chain (memory)",
  description: "Memory exploit chain: buffer overflow → stack corruption → ROP, laid out as memory blocks.",
  promptFragment:
    "exploitChain — a memory-corruption exploit chain as stacked memory blocks (buffer → overflow → saved return address → ROP gadget chain). Nodes are memory regions/blocks; edges show control flow. Put sizes/offsets in notes.",
  layout: (doc: ConceptDoc): PositionedGraph => layoutMemory(doc),
});

/* ------------------------------ cs.systems (Systems Architecture) ------------------------------ */
// Computer architecture + operating systems (Reineke, 9 ECTS combined): pipeline, datapath, caches,
// MMU, process states, scheduling, deadlock, virtual memory, file systems, OS layers.

tmpl({
  id: "cs.systems.pipeline",
  course: "cs.systems",
  subject: "cs",
  label: "CPU pipeline (stages)",
  description: "DLX pipeline IF/ID/EX/MEM/WB with forwarding/hazard annotations.",
  promptFragment:
    "pipeline — a 5-stage CPU pipeline (IF → ID → EX → MEM → WB). Each node is a stage; edges flow left→right. Note forwarding paths and hazards (stalls/bubbles) in the relevant stage notes. Set domain.order to the stage ids left→right.",
  layout: (doc: ConceptDoc): PositionedGraph => layoutStages(doc),
});

tmpl({
  id: "cs.systems.datapath",
  course: "cs.systems",
  subject: "cs",
  label: "Datapath (DLX)",
  description: "DLX datapath: PC, register file, ALU, memory, control signals.",
  promptFragment:
    "datapath — a DLX datapath. Nodes are the functional units (PC, instruction memory, register file, ALU, data memory, sign-extend, muxes); edges are the data/control signal paths. Label edges with the signal/bus name.",
  layout: (doc: ConceptDoc): PositionedGraph => layoutDagre(doc, "TB"),
});

tmpl({
  id: "cs.systems.cacheHierarchy",
  course: "cs.systems",
  subject: "cs",
  label: "Cache hierarchy",
  description: "Memory hierarchy: CPU → L1 → L2 → L3 → main memory.",
  promptFragment:
    "cacheHierarchy — the memory hierarchy: CPU register → L1 → L2 → L3 → DRAM as a top→down chain; edges are `misses to`. Put sizes/latencies in notes.",
  layout: (doc: ConceptDoc): PositionedGraph => layoutDagre(doc, "TB"),
});

tmpl({
  id: "cs.systems.cacheSetAssoc",
  course: "cs.systems",
  subject: "cs",
  label: "k-way cache (set-associative)",
  description: "Set-associative cache table: sets × ways, with tag/valid/LRU per cell.",
  promptFragment:
    "cacheSetAssoc — a k-way set-associative cache as a grid. Rows are sets, columns are ways; each cell is a cache line (tag/valid/data) or `empty`. Put set labels in the first column and way labels in the first row. Set domain.grid = { cols, positions: { id:{r,c} } }.",
  layout: (doc: ConceptDoc): PositionedGraph => layoutGrid(doc),
});

tmpl({
  id: "cs.systems.mmu",
  course: "cs.systems",
  subject: "cs",
  label: "MMU (virtual→physical)",
  description: "Memory-management unit: virtual address → page table / TLB → physical address.",
  promptFragment:
    "mmu — the memory-management unit: virtual address → TLB lookup → page table walk → physical address. Nodes are the components (MMU, TLB, page table, physical frame); edges show the lookup/translation flow left→right.",
  layout: (doc: ConceptDoc): PositionedGraph => layoutDagre(doc, "LR"),
});

tmpl({
  id: "cs.systems.processStates",
  course: "cs.systems",
  subject: "cs",
  label: "Process state machine",
  description: "OS process states: new/ready/running/waiting/terminated + transitions.",
  promptFragment:
    "processStates — the OS process state machine. Nodes are states (new, ready, running, waiting, terminated); edges are the scheduler transitions (`admit`, `dispatch`, `block`, `wake`, `exit`). The `terminated` state is accepting. Set domain.accepting = [\"terminated\"]. A `running → running` self-loop shows CPU quantum renewal.",
  layout: (doc: ConceptDoc): PositionedGraph => layoutStateMachine(doc),
});

tmpl({
  id: "cs.systems.schedulingGantt",
  course: "cs.systems",
  subject: "cs",
  label: "Scheduling Gantt chart",
  description: "Gantt chart of a CPU schedule: per-process lanes along a time axis.",
  promptFragment:
    "schedulingGantt — a Gantt chart of a CPU scheduling run (e.g. round-robin). Nodes are the time slices a process runs on the CPU, ordered along a timeline; label each node with the process id and put the time interval in its note. Consecutive slices of the same process merge visually.",
  layout: (doc: ConceptDoc): PositionedGraph => layoutTimeline(doc),
});

tmpl({
  id: "cs.systems.deadlockGraph",
  course: "cs.systems",
  subject: "cs",
  label: "Resource-allocation / deadlock graph",
  description: "Resource-allocation graph: processes + resources, detect a cycle (deadlock).",
  promptFragment:
    "deadlockGraph — a resource-allocation graph: processes and resources as nodes; edges are `requests` (process → resource) and `holds` (resource → process). A cycle indicates deadlock. Lay resources out radially around the processes.",
  layout: (doc: ConceptDoc): PositionedGraph => layoutRadial(doc),
});

tmpl({
  id: "cs.systems.virtualMemory",
  course: "cs.systems",
  subject: "cs",
  label: "Virtual memory (paging)",
  description: "Paging layout: page table, frames, present/dirty bits as memory blocks.",
  promptFragment:
    "virtualMemory — a paging picture: nodes are the page table entries and the physical frames they map to; edges are the mappings. Mark present/dirty/accessed bits in notes.",
  layout: (doc: ConceptDoc): PositionedGraph => layoutMemory(doc),
});

tmpl({
  id: "cs.systems.fileSystemTree",
  course: "cs.systems",
  subject: "cs",
  label: "File-system tree",
  description: "Directory tree / on-disk FS layout: root dir, subdirs, files (inodes).",
  promptFragment:
    "fileSystemTree — a file-system directory tree: the root directory is the root node, subdirectories and files are children; edges are unlabeled `contains`. Files are leaves.",
  layout: (doc: ConceptDoc): PositionedGraph => layoutDagre(doc, "TB"),
});

tmpl({
  id: "cs.systems.osLayers",
  course: "cs.systems",
  subject: "cs",
  label: "OS layers (user/kernel/hw)",
  description: "OS layer stack with syscall flow, grouped into user/kernel/hardware zones.",
  promptFragment:
    "osLayers — the OS layered architecture. Nodes are layers (applications, libc/syscall interface, kernel services, drivers, hardware); edges show the syscall/trap flow. Group nodes into user / kernel / hardware zones via domain groups.",
  layout: (doc: ConceptDoc): PositionedGraph => layoutDagre(doc, "TB"),
});