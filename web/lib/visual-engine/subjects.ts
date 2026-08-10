/**
 * Router — classify a query into { subject, course? } with zero latency (keyword regex).
 *
 * The model also self-declares subject/course/template in its JSON; a mismatch triggers one
 * reroute (counted as a repair attempt) in produceDoc. Because generic templates are always in
 * the prompt, a wrong regex route still yields a valid diagram — false positives degrade to
 * generic, not failure. A course/subject hint (from the UI dropdown or AiTeacher's active
 * course) overrides the regex entirely.
 *
 * Framework-agnostic; merges into AiTeacher's lib/ unchanged.
 */
import { type CourseId, type SubjectId, type TemplateId, subjectOf } from "./schema";

export interface RouteHint {
  course?: CourseId;
  subject?: SubjectId;
}

export interface Route {
  subject: SubjectId;
  course?: CourseId;
}

/** Subject for a CourseId (first dotted segment). */
export function courseSubject(course: CourseId): SubjectId {
  return subjectOf(course);
}

/** The known CS course sequences (UI selector + hint validation). */
export const CS_COURSES = [
  "cs.prog1",
  "cs.prog2",
  "cs.cybersecurity",
  "cs.systems",
  "cs.math1",
  "cs.math2",
  "cs.math3",
  "cs.hmi1",
  "cs.hmi2",
  "cs.hmi3",
] as const;

interface Rule {
  course: CourseId;
  re: RegExp;
}

// High-recall keyword rules -> specific CS course. Order matters only for the first match.
const RULES: Rule[] = [
  {
    course: "cs.prog1",
    re: /\b(binary tree|binary search tree|bst|recursion|recursive|call stack|stack frame|ast|abstract syntax tree|parse tree|parser|lexer|lexical|proof tree|induction|sml|standard ml|functional programming|higher-order|closure|interpreter|stack machine|signature|functor)\b/i,
  },
  {
    course: "cs.prog2",
    re: /\b(class hierarchy|inheritance|polymorphism|dynamic binding|virtual method|object(?:-|\s)oriented|oop|interface|generics|method dispatch|memory layout|c pointer|heap and stack|sequence diagram|lifeline)\b/i,
  },
  {
    course: "cs.cybersecurity",
    re: /\b(crypto|cryptography|cipher|aes|des|rsa|hash|mac|hmac|digital signature|key exchange|tls|ssl|handshake|protocol|xss|csrf|sql injection|sqli|injection|threat model|attack tree|attack surface|vulnerability|exploit|buffer overflow|rop|network security|firewall|access control|capability|trust boundary|data flow diagram)\b/i,
  },
  {
    course: "cs.systems",
    re: /\b(cpu pipeline|pipeline|pipeline hazard|forwarding|branch prediction|datapath|alu|isa|instruction set|microarchitecture|cache|l1|l2|lru|set(?:-|\s)associative|mmu|tlb|page table|page fault|virtual memory|process state|scheduling|round robin|gantt|deadlock|file system|operating system|kernel|syscall|system call|interrupt|boolean algebra|circuit)\b/i,
  },
  {
    course: "cs.math1",
    re: /\b(set theory|venn|truth table|proof|induction|number line|big-?o|convergence|sequence|series|limit|derivative|differentiat|integral|taylor|mean value theorem|l'hôpital|continuity|riemann)\b/i,
  },
  {
    course: "cs.math2",
    re: /\b(vector space|basis|linear algebra|linear map|matrix|matrices|determinant|eigenvalue|eigenvector|gaussian elimination|orthogonal|fourier|quadratic form|quadric|group|ring|field|algebraic structure)\b/i,
  },
  {
    course: "cs.math3",
    re: /\b(probability|distribution|random variable|expected value|variance|markov chain|monte carlo|confidence interval|hypothesis test|newton(?:'s)? method|gradient|lagrangian|constrained optimization|spline|interpolation|multivariate|surface|contour)\b/i,
  },
  {
    course: "cs.hmi1",
    re: /\b(norman|gulf of execution|gulf of evaluation|usability|heuristic|user.?centered|ucd|prototyping|think.?aloud|interaction style|goms|human processor)\b/i,
  },
  {
    course: "cs.hmi2",
    re: /\b(event loop|mvc|model.?view.?controller|sensor|actuator|microcontroller|touch|gesture|iot|ubiquitous|tangible|wearable|augmented reality|virtual reality|ar\/?vr)\b/i,
  },
  {
    course: "cs.hmi3",
    re: /\b(milgram|reality.?virtuality continuum|haptic|eye tracking|gaze|multimodal|physiological|brain.?computer|embodied|motion capture)\b/i,
  },
];

/**
 * Classify a query. A hint (UI course selector / AiTeacher active course) wins; otherwise the
 * first matching keyword rule; otherwise generic.
 */
export function classifySubject(query: string, hint?: RouteHint): Route {
  if (hint?.course) return { subject: courseSubject(hint.course), course: hint.course };
  if (hint?.subject) return { subject: hint.subject };
  for (const rule of RULES) {
    if (rule.re.test(query)) return { subject: "cs", course: rule.course };
  }
  return { subject: "generic" };
}

/** Resolve a template id to the course it serves, for reroute checks. */
export function templateCourse(template?: TemplateId): CourseId | undefined {
  if (!template) return undefined;
  const parts = template.split(".");
  return parts.length >= 3 ? parts.slice(0, 2).join(".") : undefined;
}