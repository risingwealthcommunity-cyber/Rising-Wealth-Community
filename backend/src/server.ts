import http from 'node:http';
import app from './app';
import { config } from './config/env';
import { prisma } from './config/database';
import { startPayoutScheduler } from './features/income/payout.scheduler';
import { startProofCleanup } from './features/campaigns/proof.cleanup';

let server: http.Server | undefined;

const start = async () => {
  try {
    await prisma.$connect();
    console.log('Database connected');
    server = app.listen(config.port, () => {
      console.log(`Server running on port ${config.port} (${config.nodeEnv})`);
    });
    startProofCleanup();
    console.log('Proof cleanup is on (approved proofs are removed after 60 days)');
    if (config.autoWeeklyPayout) {
      startPayoutScheduler();
      console.log('Automatic weekly payout is on (Mondays, IST)');
    }
  } catch (error) {
    console.error('Failed to start server:', error);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(1);
  }
};

const shutdown = async (signal: string) => {
  console.log(`${signal} received, shutting down...`);
  server?.close();
  await prisma.$disconnect().catch(() => undefined);
  process.exit(0);
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

void start();
