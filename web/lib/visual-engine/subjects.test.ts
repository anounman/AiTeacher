import { test } from "node:test";
import assert from "node:assert/strict";
import { classifySubject, courseSubject, templateCourse } from "./subjects";

test("course hint overrides regex routing", () => {
  const r = classifySubject("binary tree", { course: "cs.systems" });
  assert.equal(r.course, "cs.systems");
  assert.equal(r.subject, "cs");
});

test("subject hint overrides regex routing", () => {
  const r = classifySubject("binary tree", { subject: "physics" });
  assert.equal(r.subject, "physics");
  assert.equal(r.course, undefined);
});

test("binary-tree query routes to cs.prog1", () => {
  const r = classifySubject("draw a binary tree");
  assert.equal(r.subject, "cs");
  assert.equal(r.course, "cs.prog1");
});

test("recursion / call-stack keywords route to cs.prog1", () => {
  assert.equal(classifySubject("call stack of recursive factorial").course, "cs.prog1");
  assert.equal(classifySubject("recursion tree for mergesort").course, "cs.prog1");
});

test("crypto / TLS routes to cs.cybersecurity", () => {
  assert.equal(classifySubject("TLS handshake and key exchange").course, "cs.cybersecurity");
  assert.equal(classifySubject("AES cipher rounds").course, "cs.cybersecurity");
});

test("CPU pipeline / cache routes to cs.systems", () => {
  assert.equal(classifySubject("CPU pipeline hazards and forwarding").course, "cs.systems");
  assert.equal(classifySubject("set-associative cache and LRU").course, "cs.systems");
});

test("matrix / eigenvalue routes to cs.math2", () => {
  assert.equal(classifySubject("eigenvalues of a 2x2 matrix").course, "cs.math2");
});

test("Markov chain / distribution routes to cs.math3", () => {
  assert.equal(classifySubject("Markov chain weather model").course, "cs.math3");
});

test("Norman gulfs routes to cs.hmi1", () => {
  assert.equal(classifySubject("Norman's gulfs of execution").course, "cs.hmi1");
});

test("unmatched query falls back to generic", () => {
  const r = classifySubject("photosynthesis");
  assert.equal(r.subject, "generic");
  assert.equal(r.course, undefined);
});

test("courseSubject reads the first dotted segment", () => {
  assert.equal(courseSubject("cs.prog1"), "cs");
  assert.equal(courseSubject("cs.math2"), "cs");
});

test("templateCourse extracts the course from a course-scoped template id", () => {
  assert.equal(templateCourse("cs.prog1.binaryTree"), "cs.prog1");
  assert.equal(templateCourse("generic.flow"), undefined);
});