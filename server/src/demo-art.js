/**
 * Illustrated court "photos" for the demo data (`npm run cli -- demo`): top-down pickleball court surfaces with
 * grain, lines, perforated balls, paddles and low-sun shadows, rendered from SVG to PNG with sharp.
 * Deterministic per seed so the demo looks the same on every run.
 */
import sharp from "sharp";

/** mulberry32: small seeded PRNG. */
export function seededRandom(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    random: next,
    range: (lo, hi) => lo + next() * (hi - lo),
    randint: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    choice: (items) => items[Math.floor(next() * items.length)],
  };
}

// Surface colours: [court, surround]. Pickleball courts are typically painted blue inside a green surround.
const PALETTES = [
  ["#2c62a8", "#3f7d55"],
  ["#2f7a52", "#235a3d"],
  ["#1f4f7c", "#2b7d82"],
  ["#c4643f", "#3a7550"],
  ["#4a8bd2", "#5f9e66"],
  ["#2a5597", "#1f6b4b"],
];
const PADDLES = ["#0e3b2c", "#d7f23b", "#ffffff", "#e26d3d", "#10233f", "#f2c94c"];

const W = 1600;
const H = 1000;

function defs(id) {
  return `
  <filter id="grain${id}" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="${id}" result="n"/>
    <feColorMatrix type="saturate" values="0"/>
    <feComponentTransfer><feFuncA type="table" tableValues="0 0.16"/></feComponentTransfer>
  </filter>
  <filter id="mottle${id}" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.018 0.03" numOctaves="3" seed="${id + 7}"/>
    <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.9 -0.35"/>
  </filter>
  <filter id="soft${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9"/></filter>
  <filter id="softer${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="26"/></filter>
  <radialGradient id="vig${id}" cx="50%" cy="45%" r="75%">
    <stop offset="55%" stop-color="#000" stop-opacity="0"/>
    <stop offset="100%" stop-color="#000" stop-opacity="0.42"/>
  </radialGradient>
  <radialGradient id="ballg${id}" cx="38%" cy="32%" r="70%">
    <stop offset="0%" stop-color="#f6ff9a"/>
    <stop offset="55%" stop-color="#d7f23b"/>
    <stop offset="100%" stop-color="#9fb81a"/>
  </radialGradient>
  <linearGradient id="sun${id}" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#fff" stop-opacity="0.16"/>
    <stop offset="0.6" stop-color="#fff" stop-opacity="0"/>
  </linearGradient>`;
}

/** A pickleball (perforated) of radius r at (x, y), with a long low-sun shadow toward (dx, dy). */
function ball(id, x, y, r, dx, dy) {
  const holes = [];
  const pattern = [[0, 0], [0.55, 0.05], [-0.5, 0.1], [0.1, 0.55], [0.05, -0.55], [-0.35, -0.45], [0.45, -0.4], [-0.4, 0.5], [0.5, 0.45]];
  for (const [hx, hy] of pattern) holes.push(`<circle cx="${x + hx * r}" cy="${y + hy * r}" r="${r * 0.11}" fill="#7f9612" opacity="0.55"/>`);
  const len = Math.hypot(dx, dy);
  const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
  return `
    <ellipse cx="${x + dx * 0.5}" cy="${y + dy * 0.5}" rx="${len * 0.55 + r}" ry="${r * 0.82}" transform="rotate(${ang} ${x + dx * 0.5} ${y + dy * 0.5})" fill="#000" opacity="0.32" filter="url(#soft${id})"/>
    <circle cx="${x}" cy="${y}" r="${r}" fill="url(#ballg${id})"/>
    ${holes.join("")}
    <circle cx="${x - r * 0.3}" cy="${y - r * 0.35}" r="${r * 0.28}" fill="#fff" opacity="0.35"/>`;
}

/** A paddle lying on the court: face, edge guard, taped handle, cast shadow. */
function paddle(id, x, y, scale, angle, color) {
  const face = `M -95 -150 Q -95 -205 -40 -205 L 40 -205 Q 95 -205 95 -150 L 95 75 Q 95 120 45 128 L -45 128 Q -95 120 -95 75 Z`;
  const tape = color === "#ffffff" ? "#0e3b2c" : "#151a18";
  return `
  <g transform="translate(${x} ${y}) rotate(${angle}) scale(${scale})">
    <g transform="translate(34 30)" opacity="0.38" filter="url(#soft${id})"><path d="${face}" fill="#000"/><rect x="-22" y="120" width="44" height="150" rx="16" fill="#000"/></g>
    <rect x="-22" y="118" width="44" height="150" rx="16" fill="${tape}"/>
    ${[140, 168, 196, 224, 252].map((ty) => `<rect x="-22" y="${ty}" width="44" height="5" fill="#fff" opacity="0.12"/>`).join("")}
    <path d="${face}" fill="${color}"/>
    <path d="${face}" fill="none" stroke="#0b0f0d" stroke-opacity="0.75" stroke-width="10"/>
    <path d="M -70 -170 Q -70 -185 -50 -185 L 30 -185" stroke="#fff" stroke-opacity="0.25" stroke-width="6" fill="none" stroke-linecap="round"/>
    <circle cx="0" cy="-30" r="26" fill="none" stroke="${color === "#d7f23b" || color === "#ffffff" || color === "#f2c94c" ? "#0e3b2c" : "#d7f23b"}" stroke-width="8" opacity="0.9"/>
  </g>`;
}

function finish(id) {
  return `
  <rect width="${W}" height="${H}" filter="url(#mottle${id})" opacity="0.16"/>
  <rect width="${W}" height="${H}" filter="url(#grain${id})"/>
  <rect width="${W}" height="${H}" fill="url(#sun${id})"/>
  <rect width="${W}" height="${H}" fill="url(#vig${id})"/>`;
}

/** Whole court from above, slightly rotated and cropped like a drone shot. */
function aerial(id, rnd, [court, surround]) {
  const s = rnd.range(24, 30); // px per foot
  const rot = rnd.range(-14, 14);
  const cx = W / 2 + rnd.range(-120, 120);
  const cy = H / 2 + rnd.range(-60, 60);
  const lw = 0.32;
  // Court 20 x 44 ft; kitchen 7 ft each side of the net.
  const lines = `
    <rect x="0" y="0" width="44" height="20" fill="${court}"/>
    <g stroke="#f4f6f1" stroke-width="${lw}" fill="none">
      <rect x="0" y="0" width="44" height="20"/>
      <line x1="15" y1="0" x2="15" y2="20"/><line x1="29" y1="0" x2="29" y2="20"/>
      <line x1="0" y1="10" x2="15" y2="10"/><line x1="29" y1="10" x2="44" y2="10"/>
    </g>
    <line x1="22" y1="-1.2" x2="22" y2="21.2" stroke="#0b0f0d" stroke-width="0.45"/>
    <line x1="22.9" y1="-1" x2="23.6" y2="21.4" stroke="#000" stroke-opacity="0.28" stroke-width="1.1"/>`;
  const balls = [];
  for (let i = 0; i < rnd.randint(2, 3); i += 1) {
    balls.push(ball(id, rnd.range(200, W - 200), rnd.range(150, H - 150), rnd.range(15, 22), 60, 34));
  }
  const p = rnd.random() < 0.6 ? paddle(id, rnd.range(260, W - 260), rnd.range(250, H - 250), 0.62, rnd.range(-60, 60), rnd.choice(PADDLES)) : "";
  return `
  <rect width="${W}" height="${H}" fill="${surround}"/>
  <g transform="translate(${cx} ${cy}) rotate(${rot}) scale(${s}) translate(-22 -10)">
    ${lines}
    <rect x="-40" y="23.5" width="124" height="2.2" fill="#000" opacity="0.12"/>
  </g>
  ${p}${balls.join("")}`;
}

/** Close-up of a court corner with a ball and its long evening shadow. */
function corner(id, rnd, [court, surround]) {
  const lx = rnd.range(W * 0.25, W * 0.6);
  const ly = rnd.range(H * 0.35, H * 0.6);
  const lw = rnd.range(46, 64);
  const tilt = rnd.range(-22, 22);
  const bx = lx + rnd.range(-140, 260);
  const by = ly + rnd.range(-230, -90);
  return `
  <rect width="${W}" height="${H}" fill="${surround}"/>
  <g transform="rotate(${tilt} ${lx} ${ly})">
    <rect x="${lx}" y="${-H}" width="${W * 2}" height="${ly + H}" fill="${court}"/>
    <rect x="${lx - lw / 2}" y="${-H}" width="${lw}" height="${ly + H + lw / 2}" fill="#f2f4ee"/>
    <rect x="${lx - lw / 2}" y="${ly - lw / 2}" width="${W * 2}" height="${lw}" fill="#f2f4ee"/>
  </g>
  ${ball(id, bx, by, rnd.range(70, 92), 260, 150)}`;
}

/** Net from above: a band of dark diamond mesh with its white tape, court on both sides, a ball resting below. */
function net(id, rnd, [court]) {
  const tilt = rnd.range(-16, -6);
  const ny = rnd.range(H * 0.22, H * 0.36);
  const band = 230;
  const mesh = [];
  for (let x = -W; x < W * 2; x += 30) {
    mesh.push(`<line x1="${x}" y1="${ny}" x2="${x + band}" y2="${ny + band}" stroke="#0b0f0d" stroke-opacity="0.8" stroke-width="2.4"/>`);
    mesh.push(`<line x1="${x}" y1="${ny + band}" x2="${x + band}" y2="${ny}" stroke="#0b0f0d" stroke-opacity="0.8" stroke-width="2.4"/>`);
  }
  const shadow = mesh.map((l) => l.replace('stroke-opacity="0.8"', 'stroke-opacity="0.35"')).join("");
  return `
  <rect width="${W}" height="${H}" fill="${court}"/>
  <g transform="rotate(${tilt} ${W / 2} ${ny})">
    <rect x="${-W}" y="${ny + band + 250}" width="${W * 3}" height="44" fill="#f2f4ee"/>
    <g transform="translate(70 120)" filter="url(#soft${id})" opacity="0.7">${shadow}</g>
    <rect x="${-W}" y="${ny}" width="${W * 3}" height="${band}" fill="#000" opacity="0.08"/>
    ${mesh.join("")}
    <rect x="${-W}" y="${ny - 24}" width="${W * 3}" height="34" fill="#f6f7f2"/>
    <rect x="${-W}" y="${ny + band - 6}" width="${W * 3}" height="10" fill="#0b0f0d" opacity="0.85"/>
  </g>
  ${ball(id, rnd.range(W * 0.35, W * 0.72), rnd.range(H * 0.7, H * 0.84), rnd.range(54, 66), 210, 100)}`;
}

/** Flat-lay: a paddle and balls on the court next to a line. */
function flatlay(id, rnd, [court]) {
  const lineX = rnd.range(W * 0.15, W * 0.35);
  const tilt = rnd.range(-12, 12);
  const color = rnd.choice(PADDLES);
  return `
  <rect width="${W}" height="${H}" fill="${court}"/>
  <g transform="rotate(${tilt} ${W / 2} ${H / 2})"><rect x="${lineX}" y="${-H}" width="58" height="${H * 3}" fill="#f2f4ee"/></g>
  ${paddle(id, rnd.range(W * 0.5, W * 0.68), rnd.range(H * 0.42, H * 0.55), rnd.range(1.25, 1.5), rnd.range(-70, -20), color)}
  ${ball(id, rnd.range(W * 0.75, W * 0.86), rnd.range(H * 0.2, H * 0.35), 66, 170, 95)}
  ${rnd.random() < 0.6 ? ball(id, rnd.range(W * 0.3, W * 0.4), rnd.range(H * 0.7, H * 0.82), 60, 170, 95) : ""}`;
}

const SCENES = { aerial, corner, net, flatlay };

/**
 * Render one demo image. `scene` is aerial | corner | net | flatlay (or omitted: picked from the seed).
 * Returns a PNG buffer (1600 x 1000).
 */
export async function courtPhoto(seed, scene) {
  const rnd = seededRandom(seed * 7919 + 13);
  const palette = PALETTES[seed % PALETTES.length];
  const kind = scene ?? ["aerial", "corner", "net", "flatlay"][seed % 4];
  const body = SCENES[kind](seed, rnd, palette);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>${defs(seed)}</defs>
  ${body}
  ${finish(seed)}
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

