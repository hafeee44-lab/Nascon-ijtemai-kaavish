import PDFDocument from 'pdfkit';

export const formatPkr = (minor: number) => `PKR ${(minor / 100).toFixed(2)}`;

// FR-2.3: server-side PDF receipt; text must contain the order_id and "PKR 4500.00"-style totals.
export function receiptPdf(p: {
  order_id: string; customer_id: string; items: { variant_id: string; quantity: number; unit_price_minor: number }[];
  subtotal_minor: number; discount_minor: number; total_minor: number; paid_at: string;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A5', margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(16).text('NaSCon Club Store - Receipt');
    doc.moveDown().fontSize(10);
    doc.text(`Order: ${p.order_id}`);
    doc.text(`Customer: ${p.customer_id}`);
    doc.text(`Paid at: ${p.paid_at}`);
    doc.moveDown();
    for (const i of p.items) doc.text(`${i.variant_id} x ${i.quantity} @ ${formatPkr(i.unit_price_minor)}`);
    doc.moveDown();
    doc.text(`Subtotal: ${formatPkr(p.subtotal_minor)}`);
    doc.text(`Discount: ${formatPkr(p.discount_minor)}`);
    doc.fontSize(12).text(`Total: ${formatPkr(p.total_minor)}`);
    doc.end();
  });
}
