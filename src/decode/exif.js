'use strict';

// Reads the Orientation tag (0x0112) from a TIFF/Exif block. Returns 1..8, or 0 if absent.
function readExifOrientation(tiff) {
  if (tiff.length < 8) return 0;
  const order = tiff.toString('latin1', 0, 2);
  let le;
  if (order === 'II') le = true;
  else if (order === 'MM') le = false;
  else return 0;
  const u16 = (o) => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const u32 = (o) => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
  if (u16(2) !== 42) return 0;
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return 0;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > tiff.length) return 0;
    if (u16(e) === 0x0112) {
      const type = u16(e + 2);
      const v = type === 3 ? u16(e + 8) : type === 4 ? u32(e + 8) : 0;
      return v >= 1 && v <= 8 ? v : 0;
    }
  }
  return 0;
}

module.exports = { readExifOrientation };
