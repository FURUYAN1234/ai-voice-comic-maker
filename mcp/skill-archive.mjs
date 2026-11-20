import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export async function makeSkillArchive(root) {
  const skills = path.join(root, 'mcp', 'skills');
  const entries = await readdir(skills, { withFileTypes: true });
  if (entries.length !== 1 || !entries[0].isDirectory() || !/^[a-z0-9-]+$/.test(entries[0].name)) {
    throw new Error('Expected exactly one named MCP skill.');
  }
  const skill = entries[0].name;
  const body = [];
  const central = [];
  let offset = 0;
  for (const relative of ['SKILL.md', 'agents/openai.yaml']) {
    const name = Buffer.from(skill + '/' + relative);
    const content = await readFile(path.join(skills, skill, relative));
    const checksum = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(33, 12); // 1980-01-01, for reproducible output.
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);

    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(33, 14);
    record.writeUInt32LE(checksum, 16);
    record.writeUInt32LE(content.length, 20);
    record.writeUInt32LE(content.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(offset, 42);

    body.push(local, name, content);
    central.push(record, name);
    offset += local.length + name.length + content.length;
  }

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(2, 8);
  end.writeUInt16LE(2, 10);
  end.writeUInt32LE(central.reduce((total, part) => total + part.length, 0), 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...body, ...central, end]);
}
