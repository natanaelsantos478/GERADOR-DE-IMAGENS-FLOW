// Graph colouring (DSATUR) with a soft palette so land neighbours never share a colour.
export const PALETTE = [
  [217, 119, 87], [236, 196, 110], [126, 178, 138], [96, 150, 196], [176, 128, 190],
  [222, 142, 170], [142, 196, 196], [170, 186, 100], [196, 160, 120], [130, 130, 190],
];

export function colorGraph(adj) {
  const n = adj.length, col = new Array(n).fill(-1), used = new Array(PALETTE.length).fill(0);
  for (let step = 0; step < n; step++) {
    let best = -1, bs = -1, bd = -1;
    for (let v = 0; v < n; v++) {
      if (col[v] >= 0) continue;
      const sat = new Set([...adj[v]].map((u) => col[u]).filter((c) => c >= 0)).size;
      if (sat > bs || (sat === bs && adj[v].size > bd)) { best = v; bs = sat; bd = adj[v].size; }
    }
    const taken = new Set([...adj[best]].map((u) => col[u]));
    let pick = -1;
    for (let c = 0; c < PALETTE.length; c++) if (!taken.has(c) && (pick < 0 || used[c] < used[pick])) pick = c;
    if (pick < 0) throw new Error('palette exhausted');
    col[best] = pick; used[pick]++;
  }
  return col.map((c) => PALETTE[c]);
}
