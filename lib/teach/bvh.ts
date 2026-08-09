// Minimal bounding-volume hierarchy for board hit-testing. Built fresh per
// query (leaf counts are small — hundreds); median split on the longest axis.

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BVHLeaf<T> {
  box: BBox;
  data: T;
}

interface BVHNode<T> {
  box: BBox;
  left?: BVHNode<T>;
  right?: BVHNode<T>;
  leaves?: BVHLeaf<T>[]; // leaf node payload (≤ LEAF_SIZE entries)
}

const LEAF_SIZE = 4;

function union(a: BBox, b: BBox): BBox {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

export function intersects(a: BBox, b: BBox): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function build<T>(leaves: BVHLeaf<T>[]): BVHNode<T> {
  const box = leaves.reduce((acc, l) => union(acc, l.box), leaves[0]!.box);
  if (leaves.length <= LEAF_SIZE) return { box, leaves };
  const axis: "x" | "y" = box.w >= box.h ? "x" : "y";
  const sorted = [...leaves].sort(
    (a, b) => (axis === "x" ? a.box.x + a.box.w / 2 : a.box.y + a.box.h / 2) -
              (axis === "x" ? b.box.x + b.box.w / 2 : b.box.y + b.box.h / 2),
  );
  const mid = sorted.length >> 1;
  return {
    box,
    left: build(sorted.slice(0, mid)),
    right: build(sorted.slice(mid)),
  };
}

export class BVH<T> {
  private root: BVHNode<T> | null;

  constructor(leaves: BVHLeaf<T>[]) {
    this.root = leaves.length ? build(leaves) : null;
  }

  queryRect(rect: BBox): T[] {
    const out: T[] = [];
    const walk = (n: BVHNode<T> | undefined) => {
      if (!n || !intersects(n.box, rect)) return;
      if (n.leaves) {
        for (const l of n.leaves) if (intersects(l.box, rect)) out.push(l.data);
        return;
      }
      walk(n.left);
      walk(n.right);
    };
    walk(this.root ?? undefined);
    return out;
  }

  queryPoint(x: number, y: number): T[] {
    return this.queryRect({ x, y, w: 0.01, h: 0.01 });
  }
}
