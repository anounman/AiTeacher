"""Plane A — Knowledge. Sources in, cited evidence out.

etl/       file classifier -> converter (docling | markitdown) -> normalized doc
indexing/  structure-aware chunking, content hashing, embedding, reconcile
retrieval/ two-tier hybrid search (chunk + document), RRF, rerank
store/     postgres + pgvector, workspace-scoped

Ported from SurfSense (Apache-2.0 region only) — see ../../../NOTICE.
"""
