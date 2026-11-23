import { prisma } from '../../config/database';
import { deleteStored } from '../../shared/storage';

/** The proof (photo or video) of an approved report is kept this long after approval, then removed from storage. */
export const KEEP_PROOF_DAYS = 60;

/**
 * Removes the proof of every report that was approved more than KEEP_PROOF_DAYS ago: the file leaves the object storage (or the
 * database) and the report keeps its record. Reports that are waiting, rejected or sent back are not touched. Safe to run often.
 */
export async function removeOldProofs(now = new Date(), batch = 200): Promise<number> {
  const before = new Date(now.getTime() - KEEP_PROOF_DAYS * 86_400_000);
  const rows = await prisma.campaignReport.findMany({
    where: { status: 'APPROVED', processedAt: { lt: before }, fileData: { not: null } },
    select: { id: true, fileData: true },
    take: batch
  });
  let removed = 0;
  for (const r of rows) {
    try {
      if (r.fileData) await deleteStored(r.fileData);
    } catch (e) {
      console.error('[Proof cleanup] could not delete a stored file, it will be tried again:', (e as Error).message);
      continue; // keep the pointer, so the next run tries again
    }
    await prisma.campaignReport.update({ where: { id: r.id }, data: { fileData: null, fileMime: null, fileName: null } });
    removed++;
  }
  return removed;
}

/** Runs the cleanup now and then every few hours. */
export function startProofCleanup(everyMs = 6 * 3_600_000): () => void {
  const tick = () =>
    removeOldProofs()
      .then((n) => {
        if (n > 0) console.log(`Proof cleanup: removed ${n} file${n === 1 ? '' : 's'} approved more than ${KEEP_PROOF_DAYS} days ago`);
      })
      .catch((err) => console.error('Proof cleanup failed:', err));
  void tick();
  const timer = setInterval(tick, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
