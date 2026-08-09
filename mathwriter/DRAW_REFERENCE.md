# [DRAW] Tag Reference — Hand-Drawn Vector Drawing Engine

The `[DRAW]...[/DRAW]` tag lets you create arbitrary hand-drawn diagrams
by combining low-level primitives. Every line, circle, and arrow renders
with natural hand tremor — just like real pen on paper.

## Coordinate System

All coordinates are in pixels, relative to the drawing canvas origin (top-left).
The canvas auto-sizes to fit all elements with a 20px margin.
Use coordinates like: 50,100 (x=50, y=100).

## Primitives

### LINE — Straight line
```
LINE x1,y1 x2,y2 [width=N] [style=wobbly|smooth|dashed|rough]
```
Example: `LINE 10,20 100,20 width=2 style=smooth`

### CURVE — Quadratic bezier curve
```
CURVE x1,y1 cx,cy x2,y2 [width=N] [style=wobbly|smooth]
```
Control point (cx,cy) pulls the curve. Example: `CURVE 10,50 55,10 100,50`

### CUBIC — Cubic bezier curve (two control points)
```
CUBIC x1,y1 cx1,cy1 cx2,cy2 x2,y2 [width=N]
```
Example: `CUBIC 10,50 30,10 70,90 100,50`

### RECT — Rectangle
```
RECT x,y w,h [width=N] [style=wobbly|smooth] [fill=none|light]
```
fill=light gives a subtle blue tint. Example: `RECT 10,10 80,40 fill=light`

### CIRCLE — Circle
```
CIRCLE cx,cy r [width=N] [style=wobbly|smooth] [fill=none|light]
```
Example: `CIRCLE 50,50 25 width=2`

### ELLIPSE — Ellipse
```
ELLIPSE cx,cy rx,ry [width=N]
```
Example: `ELLIPSE 100,50 40,20`

### ARROW — Line with arrowhead
```
ARROW x1,y1 x2,y2 [width=N] [style=wobbly|smooth] [head=N]
```
head=N sets arrowhead size. Example: `ARROW 10,50 90,50 head=10`

### PATH — Multi-point open path
```
PATH x1,y1 x2,y2 x3,y3 ... [width=N] [closed=true]
```
Example: `PATH 10,10 50,50 90,10 50,30`

### POLYGON — Closed shape with optional fill
```
POLYGON x1,y1 x2,y2 x3,y3 ... [width=N] [fill=none|light]
```
Example: `POLYGON 50,10 90,50 50,90 10,50 fill=light` (diamond)

### ARC — Circular arc
```
ARC cx,cy r start_deg end_deg [width=N]
```
Angles in degrees. Example: `ARC 50,50 30 0 180` (semicircle)

### GRID — Grid of lines
```
GRID x,y w,h cell_w,cell_h [width=N]
```
Example: `GRID 10,10 200,100 50,40` (4x2 grid of 50x40 cells)

### TEXT — Text label
```
TEXT x,y "text" [scale=S] [center=true|false]
```
If center=true, x,y is the text center. scale defaults to 0.7.
Example: `TEXT 50,30 "Hello" center=true scale=0.8`

### DOT — Filled dot
```
DOT x,y [r=N]
```
Example: `DOT 50,50 r=4`

### BRACKET — Hand-drawn parentheses
```
BRACKET x,y w,h [side=left|right|both] [width=N]
```
Example: `BRACKET 10,10 80,60 side=both`

### BRACE — Curly brace
```
BRACE x,y w,h [side=left|right] [width=N]
```
Example: `BRACE 10,10 10,80 side=left`

### HIGHLIGHT — Yellow highlight rectangle
```
HIGHLIGHT x,y w,h
```
Draws a semi-transparent yellow rectangle. Use behind text to emphasize.
Example: `HIGHLIGHT 45,25 30,20`

## Line Styles

| Style   | Effect |
|---------|--------|
| wobbly  | Natural hand tremor (default) |
| smooth  | Minimal jitter, cleaner |
| dashed  | Hand-drawn dashes |
| rough   | Extra jitter, sketchy |
| thick   | Not a style — use width=5 or width=6 |

## Design Guidelines

1. **Spacing**: Leave 20-30px between elements. Nodes are typically 20-30px radius.
2. **Tree layout**: Parent at (cx, y), left child at (cx-40, y+60), right child at (cx+40, y+60).
3. **Graph layout**: Space nodes 80-120px apart. Place edge labels at midpoints.
4. **Array/Table**: Use GRID for the structure, TEXT for cell values.
5. **Flowchart**: RECT for process boxes, POLYGON for diamonds (decisions), ARROW for flow.
6. **Memory diagrams**: RECT for memory cells, TEXT for values/addresses, ARROW for pointers.
7. **Keep it simple**: 5-15 primitives per diagram. Don't overcomplicate.

## Complete Examples

### Binary Search Tree (7 nodes)
```
[DRAW]
CIRCLE 100,15 18
TEXT 100,15 "8" center=true
LINE 100,33 65,70
LINE 100,33 135,70
CIRCLE 65,80 18
TEXT 65,80 "3" center=true
CIRCLE 135,80 18
TEXT 135,80 "10" center=true
LINE 65,98 45,135
LINE 65,98 85,135
CIRCLE 45,145 18
TEXT 45,145 "1" center=true
CIRCLE 85,145 18
TEXT 85,145 "6" center=true
LINE 135,98 115,135
LINE 135,98 155,135
CIRCLE 115,145 18
TEXT 115,145 "14" center=true
CIRCLE 155,145 18
TEXT 155,145 "null" center=true scale=0.5
[/DRAW]
```

### Flowchart (if-else)
```
[DRAW]
RECT 50,10 100,30 fill=light
TEXT 100,25 "Start" center=true
ARROW 100,40 100,65
POLYGON 50,65 100,50 150,65 100,80 fill=light
TEXT 100,72 "x > 0?" center=true scale=0.6
ARROW 100,80 100,105
LINE 100,105 50,105
LINE 50,105 50,130
TEXT 50,140 "No" center=true
LINE 100,105 150,105
LINE 150,105 150,130
TEXT 150,140 "Yes" center=true
[/DRAW]
```

### DP Table (3x3)
```
[DRAW]
GRID 10,10 150,120 50,40
TEXT 35,30 "0" center=true
TEXT 85,30 "1" center=true
TEXT 135,30 "2" center=true
TEXT 35,70 "1" center=true
TEXT 85,70 "1" center=true
TEXT 135,70 "2" center=true
TEXT 35,110 "2" center=true
TEXT 85,110 "2" center=true
TEXT 135,110 "3" center=true
HIGHLIGHT 60,50 50,40
[/DRAW]
```

### Linked List
```
[DRAW]
RECT 10,20 50,30
TEXT 35,35 "A" center=true
ARROW 60,35 80,35
RECT 80,20 50,30
TEXT 105,35 "B" center=true
ARROW 130,35 150,35
RECT 150,20 50,30
TEXT 175,35 "C" center=true
ARROW 200,35 220,35
RECT 220,20 50,30
TEXT 245,35 "null" center=true
[/DRAW]
```

### Weighted Graph
```
[DRAW]
CIRCLE 50,50 20
TEXT 50,50 "A" center=true
CIRCLE 150,20 20
TEXT 150,20 "B" center=true
CIRCLE 150,80 20
TEXT 150,80 "C" center=true
CIRCLE 250,50 20
TEXT 250,50 "D" center=true
ARROW 70,50 130,25
TEXT 100,30 "3" center=true scale=0.5
ARROW 70,55 130,75
TEXT 100,70 "5" center=true scale=0.5
ARROW 170,25 230,45
TEXT 200,28 "2" center=true scale=0.5
ARROW 170,75 230,55
TEXT 200,72 "1" center=true scale=0.5
[/DRAW]
```

### Stack
```
[DRAW]
RECT 10,10 80,30
TEXT 50,25 "5" center=true
RECT 10,42 80,30
TEXT 50,57 "3" center=true
RECT 10,74 80,30
TEXT 50,89 "8" center=true
LINE 90,25 110,25
TEXT 120,25 "top" center=true scale=0.6
[/DRAW]
```

### Memory Layout
```
[DRAW]
RECT 10,10 70,30
TEXT 45,25 "x = 5" center=true
RECT 10,45 70,30
TEXT 45,60 "p = 0x200" center=true
TEXT 90,25 "0x100" center=false scale=0.5
TEXT 90,60 "0x108" center=false scale=0.5
ARROW 80,60 80,95
RECT 10,80 70,30
TEXT 45,95 "*p = 42" center=true
TEXT 90,95 "0x200" center=false scale=0.5
[/DRAW]
```

### Recursion Tree (fibonacci)
```
[DRAW]
CIRCLE 150,10 22
TEXT 150,10 "fib(4)" center=true scale=0.55
LINE 150,32 80,70
LINE 150,32 220,70
CIRCLE 80,80 22
TEXT 80,80 "fib(3)" center=true scale=0.55
CIRCLE 220,80 22
TEXT 220,80 "fib(2)" center=true scale=0.55
LINE 80,102 50,140
LINE 80,102 110,140
CIRCLE 50,150 22
TEXT 50,150 "fib(2)" center=true scale=0.55
CIRCLE 110,150 22
TEXT 110,150 "fib(1)" center=true scale=0.55
LINE 50,172 30,210
LINE 50,172 70,210
CIRCLE 30,220 22
TEXT 30,220 "fib(1)" center=true scale=0.55
CIRCLE 70,220 22
TEXT 70,220 "fib(0)" center=true scale=0.55
TEXT 30,248 "=1" center=true scale=0.5
TEXT 70,248 "=0" center=true scale=0.5
TEXT 110,178 "=1" center=true scale=0.5
TEXT 50,178 "=1" center=true scale=0.5
LINE 220,102 190,140
LINE 220,102 250,140
CIRCLE 190,150 22
TEXT 190,150 "fib(1)" center=true scale=0.55
CIRCLE 250,150 22
TEXT 250,150 "fib(0)" center=true scale=0.55
TEXT 190,178 "=1" center=true scale=0.5
TEXT 250,178 "=0" center=true scale=0.5
TEXT 220,108 "=1" center=true scale=0.5
TEXT 80,108 "=2" center=true scale=0.5
TEXT 150,38 "=3" center=true scale=0.5
[/DRAW]
```
