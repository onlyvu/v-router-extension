import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const width = 128;
const height = 128;
const rgba = Buffer.alloc(width * height * 4);

for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const i = (y * width + x) * 4;
    const inside = x >= 14 && x <= 114 && y >= 14 && y <= 114;
    const border = inside && (x < 20 || x > 108 || y < 20 || y > 108);
    const route = (x > 34 && x < 81 && y > 36 && y < 51) ||
      (x > 74 && x < 91 && y > 44 && y < 76) ||
      (x > 46 && x < 91 && y > 70 && y < 86) ||
      (x > 42 && x < 57 && y > 77 && y < 100) ||
      (x > 54 && x < 94 && y > 94 && y < 109);
    const arrow = (x > 88 && x < 105 && y > 30 && y < 47) && Math.abs((x - 97) - (y - 38)) < 8;
    const on = border || route || arrow;
    rgba[i] = on ? 30 : 0;
    rgba[i + 1] = on ? 170 : 0;
    rgba[i + 2] = on ? 120 : 0;
    rgba[i + 3] = on ? 255 : 0;
  }
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

const scanlines = Buffer.alloc((width * 4 + 1) * height);
for (let y = 0; y < height; y += 1) {
  const rowStart = y * (width * 4 + 1);
  scanlines[rowStart] = 0;
  rgba.copy(scanlines, rowStart + 1, y * width * 4, (y + 1) * width * 4);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(width, 0);
ihdr.writeUInt32BE(height, 4);
ihdr[8] = 8;
ihdr[9] = 6;
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(scanlines)),
  chunk("IEND", Buffer.alloc(0))
]);

writeFileSync("media/vrouter-icon.png", png);
