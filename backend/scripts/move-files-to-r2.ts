/**
 * Moves proof pictures that are still stored inside the database into Cloudflare R2, leaving a short pointer in their place.
 * Safe to run again: rows that already point to R2 are skipped. Run: npx ts-node scripts/move-files-to-r2.ts
 */
import 'dotenv/config';
import { prisma } from '../src/config/database';
import { isR2On, isStoredInR2, storeFile } from '../src/shared/storage';

type Row = { id: string; fileMime: string | null; fileData: Uint8Array | null };

async function move(label: string, folder: string, rows: Row[], save: (id: string, data: Buffer) => Promise<unknown>) {
  let moved = 0;
  for (const r of rows) {
    if (!r.fileData || r.fileData.length === 0 || isStoredInR2(r.fileData)) continue;
    const marker = await storeFile(Buffer.from(r.fileData), r.fileMime ?? 'image/jpeg', folder);
    await save(r.id, marker);
    moved++;
  }
  console.log(`${label}: ${moved} moved, ${rows.length - moved} already there or empty`);
}

async function main() {
  if (!isR2On()) throw new Error('R2 is not set up (R2_* in .env), or NODE_ENV is test. Nothing was changed.');
  const pick = { id: true, fileMime: true, fileData: true } as const;
  await move('Fund requests', 'funds', await prisma.fundRequest.findMany({ select: pick }), (id, d) => prisma.fundRequest.update({ where: { id }, data: { fileData: d } }));
  await move('Package payments', 'purchases', await prisma.packagePurchase.findMany({ select: pick }), (id, d) => prisma.packagePurchase.update({ where: { id }, data: { fileData: d } }));
  await move('Withdrawal payouts', 'payouts', await prisma.withdrawalRequest.findMany({ select: pick }), (id, d) => prisma.withdrawalRequest.update({ where: { id }, data: { fileData: d } }));
  await move('Campaign reports', 'reports', await prisma.campaignReport.findMany({ select: pick }), (id, d) => prisma.campaignReport.update({ where: { id }, data: { fileData: d } }));
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e.message); await prisma.$disconnect(); process.exit(1); });
