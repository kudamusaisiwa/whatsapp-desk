import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
function crc32(b) {
  let c = -1;
  for (const v of b) {
    c ^= v;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type),
    size = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([size, t, data, crc]);
}
function inside(x, y) {
  const cx = Math.max(22, Math.min(106, x)),
    cy = Math.max(22, Math.min(106, y));
  return (x - cx) ** 2 + (y - cy) ** 2 <= 22 ** 2;
}
mkdirSync("public/icons", { recursive: true });
for (const size of [16, 48, 128]) {
  const scale = 4,
    n = size * scale,
    rgba = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    rgba[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let sy = 0; sy < scale; sy++)
        for (let sx = 0; sx < scale; sx++) {
          const xx = ((x * scale + sx + 0.5) / n) * 128,
            yy = ((y * scale + sy + 0.5) / n) * 128;
          if (!inside(xx, yy)) continue;
          let col = [20, 123, 99];
          const d = Math.hypot(xx - 64, yy - 60);
          if (d > 25 && d < 30 && !(xx < 47 && yy > 77)) col = [250, 255, 250];
          if (xx > 37 && xx < 43 && yy > 78 && yy < 94) col = [250, 255, 250];
          if (Math.abs(yy - (-0.6 * xx + 118)) < 2.2 && xx > 39 && xx < 57)
            col = [250, 255, 250];
          if (Math.hypot(xx - 77, yy - 47) < 6) col = [190, 223, 163];
          r += col[0];
          g += col[1];
          b += col[2];
          a++;
        }
      const p = y * (size * 4 + 1) + 1 + x * 4;
      rgba[p] = a ? r / a : 0;
      rgba[p + 1] = a ? g / a : 0;
      rgba[p + 2] = a ? b / a : 0;
      rgba[p + 3] = Math.round((a / (scale * scale)) * 255);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  writeFileSync(
    `public/icons/${size}.png`,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(rgba)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}
