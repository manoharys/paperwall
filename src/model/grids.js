// Photo grids: layouts of frames that tile a page, for collages.
// Each cell is [x, y, w, h] as shares of the page.

const cols = (n) => Array.from({ length: n }, (_, i) => [i / n, 0, 1 / n, 1]);
const rows = (n) => Array.from({ length: n }, (_, i) => [0, i / n, 1, 1 / n]);
const tiles = (c, r) => Array.from({ length: c * r }, (_, i) => [(i % c) / c, Math.floor(i / c) / r, 1 / c, 1 / r]);

export const GRIDS = [
  { id: 'two-columns', name: 'Two side by side', cells: cols(2) },
  { id: 'two-rows', name: 'Two stacked', cells: rows(2) },
  { id: 'three-columns', name: 'Three columns', cells: cols(3) },
  { id: 'three-rows', name: 'Three rows', cells: rows(3) },
  { id: 'four', name: 'Four squares', cells: tiles(2, 2) },
  { id: 'six', name: 'Six', cells: tiles(3, 2) },
  { id: 'nine', name: 'Nine', cells: tiles(3, 3) },
  { id: 'big-left', name: 'Big left, two right', cells: [[0, 0, 0.6, 1], [0.6, 0, 0.4, 0.5], [0.6, 0.5, 0.4, 0.5]] },
  { id: 'big-top', name: 'Big top, two below', cells: [[0, 0, 1, 0.6], [0, 0.6, 0.5, 0.4], [0.5, 0.6, 0.5, 0.4]] },
  { id: 'big-top-three', name: 'Big top, three below', cells: [[0, 0, 1, 0.62], [0, 0.62, 1 / 3, 0.38], [1 / 3, 0.62, 1 / 3, 0.38], [2 / 3, 0.62, 1 / 3, 0.38]] },
  { id: 'mosaic', name: 'Mosaic', cells: [[0, 0, 0.5, 0.62], [0.5, 0, 0.5, 0.38], [0.5, 0.38, 0.5, 0.62], [0, 0.62, 0.5, 0.38]] },
  { id: 'feature', name: 'One big, four small', cells: [[0, 0, 0.66, 0.66], [0.66, 0, 0.34, 0.33], [0.66, 0.33, 0.34, 0.33], [0, 0.66, 0.33, 0.34], [0.33, 0.66, 0.33, 0.34], [0.66, 0.66, 0.34, 0.34]] },
];

export function gridById(id) {
  return GRIDS.find((g) => g.id === id) || null;
}

/**
 * Boxes for a grid's cells on a page: inside `margin` from the edges, with
 * `gap` between neighbors. Returns [{ x, y, w, h }] in page pixels.
 */
export function gridBoxes(grid, width, height, { margin = 0, gap = 0 } = {}) {
  const W = width - margin * 2;
  const H = height - margin * 2;
  const r = (n) => Math.round(n);
  return grid.cells.map(([cx, cy, cw, ch]) => {
    const x0 = margin + cx * W + (cx > 0.001 ? gap / 2 : 0);
    const y0 = margin + cy * H + (cy > 0.001 ? gap / 2 : 0);
    const x1 = margin + (cx + cw) * W - (cx + cw < 0.999 ? gap / 2 : 0);
    const y1 = margin + (cy + ch) * H - (cy + ch < 0.999 ? gap / 2 : 0);
    return { x: r(x0), y: r(y0), w: r(x1 - x0), h: r(y1 - y0) };
  });
}
