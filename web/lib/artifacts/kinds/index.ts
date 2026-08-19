// Side-effect import: each kind module calls `registerKind` at module-eval
// time. Importing this file from `../schema` ensures every native kind is
// registered before `classifyArtifact` runs. Add new kinds here.
// Registration order matters for alias candidate ordering: kinds registered
// earlier get pushed into an shared alias's candidate list first, so the
// earlier kind gets first crack. `figure` is imported BEFORE `diagram` so an
// `erm` alias (carried by both) resolves to candidates [figure, diagram] —
// figure (notation-faithful DSL) tries first, diagram (Mermaid) is the
// fallback when the model emitted Mermaid content.
import "./figure";
import "./diagram";
import "./table";
import "./comparison";
import "./steps";
import "./callout";
import "./chart";
