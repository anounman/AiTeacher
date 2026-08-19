// Ambient declaration for the `cytoscape-fcose` layout extension, which ships
// no type declarations of its own. It is a standard Cytoscape extension:
// imported for its side-effect registration via `cytoscape.use(fcose)`, after
// which `name: "fcose"` is a valid layout option.
//
// The `import type` is INSIDE the `declare module` block on purpose: a
// top-level import would turn this file into a module (an augmentation that
// has nothing to augment, since the package is untyped). Kept inside, the file
// stays a global script and this is a true ambient module declaration.
declare module "cytoscape-fcose" {
  import type cytoscape from "cytoscape";
  const ext: cytoscape.Ext;
  export default ext;
}