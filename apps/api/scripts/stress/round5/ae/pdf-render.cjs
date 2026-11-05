// Renders signed-document PDFs with Arabic content through the real function (dist build).
const path = require('path'); const fs = require('fs');
const m = require(path.resolve(__dirname, '../../../../dist/signed-documents/signed-document-pdf.js'));
const out = process.argv[2];
const labels = { member: 'العضو', guest: 'ضيف', signedName: 'وقّع باسم', recordedBy: 'سجّله', signature: 'التوقيع', signedAt: 'وقت التوقيع', version: 'الإصدار', imageMissing: 'الصورة مفقودة', textSigned: 'النص الموقّع', notRecorded: 'غير مسجل', expired: 'منتهي', guardianFor: 'ولي أمر', onPaper: 'ورقي' };
const cases = {
  plain: { signatureText: 'فاطمة بنت محمد المنصوري', memberName: 'فاطمة بنت محمد المنصوري', body: 'أقر أنا الموقعة أدناه بأنني أشارك في حصص المواي تاي على مسؤوليتي.\nرقم الهاتف: +971 50 123 4567 — البريد: fatima@example.ae (فرع دبي 2)' },
  rlm: { signatureText: '‏فاطمة المنصوري', memberName: '‏نورة‏ Al-Mansouri 3', body: '‏النص يبدأ بعلامة RLM كما يلصقها واتساب.' },
  dirham: { signatureText: 'Fatima', memberName: 'Fatima', body: 'Fee: ⃃ 350 per month / الرسوم 350 د.إ شهرياً' },
};
(async () => {
  for (const [k, c] of Object.entries(cases)) {
    const doc = { signerName: c.memberName, byGuardian: false, kind: 'MEMBER', title: 'إقرار المسؤولية', memberName: c.memberName, signatureText: c.signatureText, signedAt: new Date('2026-03-20T15:00:00Z'), version: 1, sha256: 'ab'.repeat(32), body: c.body, onPaper: false, expired: false, image: null, imageMissing: false, signedByGuardian: false };
    const buf = await m.signedDocumentPdf(doc, 'أكاديمية الأمل للمواي تاي', labels);
    fs.writeFileSync(path.join(out, k + '.pdf'), buf);
    console.log(k, buf.length);
  }
})().catch((e) => { console.error(e); process.exit(1); });
