import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
const dir = resolve("test-results/fixtures");
mkdirSync(dir, { recursive: true });
writeFileSync(
  `${dir}/sample-knowledge.txt`,
  "TEST DOCUMENT. Business hours are Monday to Friday, 8 am to 5 pm. Ask a colleague to confirm a booking.",
);
const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
];
const stream =
  "BT /F1 12 Tf 50 740 Td (TEST DOCUMENT: Please ask a colleague to confirm prices.) Tj ET";
objects.push(
  `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
);
let pdf = "%PDF-1.4\n";
const offsets = [0];
for (let i = 0; i < objects.length; i++) {
  offsets.push(Buffer.byteLength(pdf));
  pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
}
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (const n of offsets.slice(1))
  pdf += `${String(n).padStart(10, "0")} 00000 n \n`;
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
writeFileSync(`${dir}/sample-knowledge.pdf`, pdf);
const docx = resolve(dir, "docx-source");
mkdirSync(`${docx}/word`, { recursive: true });
mkdirSync(`${docx}/_rels`, { recursive: true });
writeFileSync(
  `${docx}/[Content_Types].xml`,
  '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
);
writeFileSync(
  `${docx}/_rels/.rels`,
  '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
);
writeFileSync(
  `${docx}/word/document.xml`,
  '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>TEST DOCUMENT. Reply warmly and ask which country the business will operate in.</w:t></w:r></w:p></w:body></w:document>',
);
const result = spawnSync(
  "zip",
  ["-q", "-r", `${dir}/sample-knowledge.docx`, "."],
  { cwd: docx },
);
if (result.status) throw new Error("Could not create DOCX fixture.");
console.log("Test fixtures ready.");
