const encoder = new TextEncoder();
const decoder = new TextDecoder();

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function u16(value) {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function u32(value) {
  return [
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff
  ];
}

function concat(parts) {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: day };
}

export function createZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { time, date } = dosDateTime();

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = typeof file.data === "string" ? encoder.encode(file.data) : file.data;
    const crc = crc32(data);
    const local = new Uint8Array([
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(0x0800),
      ...u16(0),
      ...u16(time),
      ...u16(date),
      ...u32(crc),
      ...u32(data.length),
      ...u32(data.length),
      ...u16(name.length),
      ...u16(0)
    ]);
    localParts.push(local, name, data);
    const central = new Uint8Array([
      ...u32(0x02014b50),
      ...u16(20),
      ...u16(20),
      ...u16(0x0800),
      ...u16(0),
      ...u16(time),
      ...u16(date),
      ...u32(crc),
      ...u32(data.length),
      ...u32(data.length),
      ...u16(name.length),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(offset)
    ]);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }

  const centralOffset = offset;
  const centralLength = centralParts.reduce((total, part) => total + part.length, 0);
  const end = new Uint8Array([
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(files.length),
    ...u16(files.length),
    ...u32(centralLength),
    ...u32(centralOffset),
    ...u16(0)
  ]);
  return concat([...localParts, ...centralParts, end]);
}

function dataViewU16(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);
}

function dataViewU32(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("当前浏览器不支持读取压缩的 .xlsx 文件，请使用最新版 Chrome 或 Edge。");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readZip(buffer) {
  const bytes = new Uint8Array(buffer);
  let eocd = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65557); index -= 1) {
    if (dataViewU32(bytes, index) === 0x06054b50) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) throw new Error("不是有效的 .xlsx 文件。");
  const count = dataViewU16(bytes, eocd + 10);
  const centralOffset = dataViewU32(bytes, eocd + 16);
  const files = new Map();
  let cursor = centralOffset;

  for (let index = 0; index < count; index += 1) {
    if (dataViewU32(bytes, cursor) !== 0x02014b50) throw new Error("Excel 压缩目录损坏。");
    const method = dataViewU16(bytes, cursor + 10);
    const compressedSize = dataViewU32(bytes, cursor + 20);
    const nameLength = dataViewU16(bytes, cursor + 28);
    const extraLength = dataViewU16(bytes, cursor + 30);
    const commentLength = dataViewU16(bytes, cursor + 32);
    const localOffset = dataViewU32(bytes, cursor + 42);
    const name = decoder.decode(bytes.slice(cursor + 46, cursor + 46 + nameLength));
    const localNameLength = dataViewU16(bytes, localOffset + 26);
    const localExtraLength = dataViewU16(bytes, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);
    if (method === 0) files.set(name, compressed);
    else if (method === 8) files.set(name, await inflateRaw(compressed));
    else throw new Error(`Excel 文件使用了不支持的压缩方式 ${method}。`);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function columnName(index) {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function worksheetXml(rows) {
  const rowXml = rows
    .map((row, rowIndex) => {
      const cells = (row ?? [])
        .map((value, columnIndex) => {
          if (value === null || value === undefined || value === "") return "";
          const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
          const styleAttribute = rowIndex === 0 ? ' s="1"' : "";
          if (typeof value === "number" && Number.isFinite(value)) {
            return `<c r="${ref}"${styleAttribute}><v>${value}</v></c>`;
          }
          return `<c r="${ref}" t="inlineStr"${styleAttribute}><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols><col min="1" max="1" width="16" customWidth="1"/><col min="2" max="2" width="24" customWidth="1"/><col min="3" max="8" width="18" customWidth="1"/></cols>
  <sheetData>${rowXml}</sheetData>
  <autoFilter ref="A1:${columnName(Math.max(0, (rows[0]?.length ?? 1) - 1))}${Math.max(1, rows.length)}"/>
</worksheet>`;
}

export function createWorkbook(sheets) {
  const safeSheets = sheets.map((sheet, index) => ({
    name: String(sheet.name ?? `Sheet${index + 1}`).replace(/[\\/?*[\]:]/g, " ").slice(0, 31),
    rows: sheet.rows ?? []
  }));
  const files = [];
  const contentTypeOverrides = safeSheets
    .map(
      (_, index) =>
        `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    )
    .join("");
  files.push({
    name: "[Content_Types].xml",
    data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${contentTypeOverrides}
</Types>`
  });
  files.push({
    name: "_rels/.rels",
    data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
  });
  files.push({
    name: "xl/workbook.xml",
    data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${safeSheets
    .map(
      (sheet, index) =>
        `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
    )
    .join("")}</sheets>
</workbook>`
  });
  files.push({
    name: "xl/_rels/workbook.xml.rels",
    data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${safeSheets
    .map(
      (_, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
    )
    .join("")}
  <Relationship Id="rId${safeSheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
  });
  files.push({
    name: "xl/styles.xml",
    data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font></fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF5B3F8C"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`
  });
  safeSheets.forEach((sheet, index) => {
    files.push({ name: `xl/worksheets/sheet${index + 1}.xml`, data: worksheetXml(sheet.rows) });
  });
  return createZip(files);
}

function textContent(node) {
  return [...node.querySelectorAll("t")].map((entry) => entry.textContent ?? "").join("");
}

function cellColumn(ref) {
  const letters = String(ref).match(/[A-Z]+/)?.[0] ?? "";
  let value = 0;
  for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64;
  return value - 1;
}

export async function parseRosterWorkbook(file) {
  const files = await readZip(await file.arrayBuffer());
  const text = (name) => {
    const data = files.get(name);
    if (!data) return null;
    return decoder.decode(data);
  };
  const workbookText = text("xl/workbook.xml");
  const relsText = text("xl/_rels/workbook.xml.rels");
  if (!workbookText || !relsText) throw new Error("Excel 缺少工作簿结构。");
  const parser = new DOMParser();
  const workbook = parser.parseFromString(workbookText, "application/xml");
  const rels = parser.parseFromString(relsText, "application/xml");
  const firstSheet = workbook.querySelector("sheet");
  const relationshipId = firstSheet?.getAttribute("r:id");
  const relationship = [...rels.querySelectorAll("Relationship")].find(
    (entry) => entry.getAttribute("Id") === relationshipId
  );
  let target = relationship?.getAttribute("Target") ?? "worksheets/sheet1.xml";
  target = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  const sheetText = text(target);
  if (!sheetText) throw new Error("未找到 Excel 的第一个工作表。");

  const sharedText = text("xl/sharedStrings.xml");
  const sharedStrings = sharedText
    ? [...parser.parseFromString(sharedText, "application/xml").querySelectorAll("si")].map(textContent)
    : [];
  const sheet = parser.parseFromString(sheetText, "application/xml");
  const rows = [];
  for (const rowNode of sheet.querySelectorAll("sheetData row")) {
    const row = [];
    for (const cell of rowNode.querySelectorAll("c")) {
      const column = cellColumn(cell.getAttribute("r"));
      const type = cell.getAttribute("t");
      const valueNode = cell.querySelector("v");
      let value = "";
      if (type === "inlineStr") value = textContent(cell);
      else if (type === "s") value = sharedStrings[Number(valueNode?.textContent ?? -1)] ?? "";
      else value = valueNode?.textContent ?? cell.textContent ?? "";
      row[column] = String(value).trim();
    }
    if (row.some((value) => String(value ?? "").trim())) rows.push(row);
  }

  if (!rows.length) throw new Error("Excel 中没有数据。");
  const headers = rows[0].map((value) => String(value ?? "").trim());
  const findColumn = (...names) =>
    headers.findIndex((header) => names.some((name) => header.replace(/\s/g, "") === name));
  const nameIndex = findColumn("选手姓名", "姓名");
  const departmentIndex = findColumn("院系", "院系/单位", "参赛单位");
  const groupIndex = findColumn("组别", "参赛组别");
  if ([nameIndex, departmentIndex, groupIndex].some((index) => index < 0)) {
    throw new Error("表头必须包含“选手姓名”“院系”“组别”三列。");
  }
  return rows
    .slice(1)
    .map((row) => ({
      name: String(row[nameIndex] ?? "").trim(),
      department: String(row[departmentIndex] ?? "").trim(),
      group: String(row[groupIndex] ?? "").trim()
    }))
    .filter((row) => row.name || row.department || row.group);
}

export function downloadBytes(bytes, filename, mime = "application/octet-stream") {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadWorkbook(sheets, filename) {
  downloadBytes(
    createWorkbook(sheets),
    filename,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
}

export function downloadText(text, filename, mime = "text/plain;charset=utf-8") {
  downloadBytes(encoder.encode(text), filename, mime);
}
