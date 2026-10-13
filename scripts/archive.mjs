import { deflateRawSync, inflateRawSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

export function crc32(data) {
  let value = 0xffffffff;
  for (const byte of data) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

// Small, deterministic ZIP writer: UTF-8 names, deflate, fixed 1980 timestamp,
// no file-system metadata, no external tools and no package dependencies.
export function makeZip(files) {
  const records = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of files) {
    if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new Error(`Unsafe archive path: ${name}`);
    const filename = Buffer.from(name);
    const source = Buffer.from(data);
    const compressed = deflateRawSync(source, { level: 9 });
    const crc = crc32(source);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(source.length, 22);
    local.writeUInt16LE(filename.length, 26);
    records.push(local, filename, compressed);

    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(0x314, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x800, 8);
    directory.writeUInt16LE(8, 10);
    directory.writeUInt16LE(0x21, 14);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(compressed.length, 20);
    directory.writeUInt32LE(source.length, 24);
    directory.writeUInt16LE(filename.length, 28);
    directory.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, filename);
    offset += local.length + filename.length + compressed.length;
  }
  if (files.length > 0xffff || offset > 0xffffffff) throw new Error('Archive exceeds ZIP32 limits.');
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...records, directory, end]);
}

// Inspect both the central directory and every local entry, including CRC, to
// verify the actual release bytes rather than trusting a packaging command.
export function readZip(archive) {
  const buffer = Buffer.from(archive);
  const end = buffer.length - 22;
  if (end < 0 || buffer.readUInt32LE(end) !== 0x06054b50) throw new Error('Invalid ZIP end record.');
  const count = buffer.readUInt16LE(end + 10);
  let position = buffer.readUInt32LE(end + 16);
  const start = position;
  const entries = [];
  for (let index = 0; index < count; index++) {
    if (buffer.readUInt32LE(position) !== 0x02014b50) throw new Error('Invalid ZIP central directory.');
    const filenameLength = buffer.readUInt16LE(position + 28);
    const extraLength = buffer.readUInt16LE(position + 30);
    const commentLength = buffer.readUInt16LE(position + 32);
    const name = buffer.subarray(position + 46, position + 46 + filenameLength).toString('utf8');
    const crc = buffer.readUInt32LE(position + 16);
    const compressedSize = buffer.readUInt32LE(position + 20);
    const originalSize = buffer.readUInt32LE(position + 24);
    const local = buffer.readUInt32LE(position + 42);
    if (buffer.readUInt32LE(local) !== 0x04034b50 || buffer.readUInt16LE(local + 8) !== 8) throw new Error(`Invalid ZIP local record: ${name}`);
    const localNameLength = buffer.readUInt16LE(local + 26);
    const localExtraLength = buffer.readUInt16LE(local + 28);
    const localName = buffer.subarray(local + 30, local + 30 + localNameLength).toString('utf8');
    if (localName !== name || buffer.readUInt32LE(local + 14) !== crc || buffer.readUInt32LE(local + 18) !== compressedSize || buffer.readUInt32LE(local + 22) !== originalSize) {
      throw new Error(`ZIP local and central records differ: ${name}`);
    }
    const dataStart = local + 30 + localNameLength + localExtraLength;
    const data = inflateRawSync(buffer.subarray(dataStart, dataStart + compressedSize));
    if (data.length !== originalSize || crc32(data) !== crc) throw new Error(`ZIP content integrity failed: ${name}`);
    entries.push({ name, data });
    position += 46 + filenameLength + extraLength + commentLength;
  }
  if (position !== end || position - start !== buffer.readUInt32LE(end + 12)) throw new Error('ZIP central directory size differs.');
  if (new Set(entries.map(entry => entry.name)).size !== entries.length) throw new Error('Duplicate ZIP entry.');
  return entries;
}
