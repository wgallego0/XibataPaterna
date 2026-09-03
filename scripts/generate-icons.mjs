// Gera os ícones PNG do PWA sem dependências externas (zlib + escrita manual de PNG).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const OUT = path.join(process.cwd(), 'public', 'icons');
fs.mkdirSync(OUT, { recursive: true });

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = Array.from({ length: 256 }, (_, n) => {
    c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  }));
  let crc = 0xffffffff;
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function writePng(file, size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0; // filtro "none"
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, png);
}

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

/** Ponto dentro de um polígono (ray casting). */
function inPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function roundedRectAlpha(x, y, size, inset, radius) {
  const min = inset;
  const max = size - inset;
  if (x < min || x > max || y < min || y > max) return 0;
  const cx = Math.min(Math.max(x, min + radius), max - radius);
  const cy = Math.min(Math.max(y, min + radius), max - radius);
  const dist = Math.hypot(x - cx, y - cy);
  return dist <= radius ? 1 : Math.max(0, 1 - (dist - radius));
}

/**
 * Desenha o ícone: fundo arredondado com gradiente + glifo branco.
 * `variant` escolhe o glifo (casinha para o painel, crachá para a carteirinha).
 */
function render(size, { from, to, variant, maskable }) {
  const pixels = Buffer.alloc(size * size * 4);
  const c1 = hexToRgb(from);
  const c2 = hexToRgb(to);
  // Ícones maskable precisam de margem segura: o glifo ocupa menos área.
  const inset = maskable ? 0 : Math.round(size * 0.06);
  const radius = maskable ? 0 : Math.round(size * 0.22);
  const scale = maskable ? 0.66 : 0.82;

  const glyph = (px, py) => {
    // Coordenadas normalizadas (0..1) centradas no glifo.
    const u = (px / size - 0.5) / scale + 0.5;
    const v = (py / size - 0.5) / scale + 0.5;
    if (u < 0 || u > 1 || v < 0 || v > 1) return false;

    if (variant === 'house') {
      const roof = [[0.5, 0.14], [0.9, 0.46], [0.1, 0.46]];
      const body = u >= 0.2 && u <= 0.8 && v >= 0.44 && v <= 0.84;
      const door = u >= 0.42 && u <= 0.58 && v >= 0.62 && v <= 0.84;
      const window = u >= 0.28 && u <= 0.38 && v >= 0.54 && v <= 0.64;
      return (inPolygon(u, v, roof) || body) && !door && !window;
    }
    // Crachá: cartão com um "check".
    const card = u >= 0.16 && u <= 0.84 && v >= 0.2 && v <= 0.8;
    const inner = u >= 0.24 && u <= 0.76 && v >= 0.28 && v <= 0.72;
    const check = inPolygon(u, v, [
      [0.34, 0.5], [0.42, 0.42], [0.47, 0.52], [0.62, 0.34], [0.7, 0.42], [0.47, 0.68],
    ]);
    return (card && !inner) || check;
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const alpha = roundedRectAlpha(x, y, size, inset, radius);
      if (alpha <= 0) continue;
      const [r, g, b] = mix(c1, c2, (x + y) / (size * 2));
      const white = glyph(x, y);
      pixels[i] = white ? 255 : r;
      pixels[i + 1] = white ? 255 : g;
      pixels[i + 2] = white ? 255 : b;
      pixels[i + 3] = Math.round(alpha * 255);
    }
  }
  return pixels;
}

const jobs = [
  ['icon-192.png', 192, { from: '#4f8cff', to: '#7b5cff', variant: 'house' }],
  ['icon-512.png', 512, { from: '#4f8cff', to: '#7b5cff', variant: 'house' }],
  ['icon-180.png', 180, { from: '#4f8cff', to: '#7b5cff', variant: 'house' }],
  ['carteirinha-192.png', 192, { from: '#f6a623', to: '#f2622e', variant: 'badge' }],
  ['carteirinha-512.png', 512, { from: '#f6a623', to: '#f2622e', variant: 'badge' }],
];

for (const [name, size, opts] of jobs) {
  writePng(path.join(OUT, name), size, render(size, opts));
  console.log('gerado', name);
}
