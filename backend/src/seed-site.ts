/**
 * Puts the starting team text on the home page (names, roles, short bios). Photos are NOT included:
 * an admin uploads them from Admin > Website content. Safe to run again: it does nothing if a team
 * has already been saved.
 * Usage: npm run seed:site
 */
import { randomBytes } from 'node:crypto';
import { prisma } from './config/database';

const TEAM = [
  {
    name: 'Janvi Sharma',
    role: 'CEO',
    bio: 'Leading the company with a strategic vision for the future, ensuring growth and innovation across all fronts. They are responsible for steering the company towards its strategic goals, fostering a culture of collaboration, and driving market leadership.'
  },
  {
    name: 'Abhishek Pratap Singh',
    role: 'Founder & Visionary',
    bio: 'With over a decade of experience in network marketing and digital platforms, Abhishek is the driving force behind our community. His vision is to create a sustainable and empowering ecosystem for everyone.'
  },
  {
    name: 'Dheeraj Yadav',
    role: 'Co-founder & Strategist',
    bio: 'Dheeraj orchestrates the strategic direction of the community. His expertise in market analysis and community management ensures our platform stays ahead of the curve, offering maximum value to our members.'
  },
  {
    name: 'Suhani Singh',
    role: 'Ads Expert & Growth Hacker',
    bio: "Suhani is a master of digital advertising and user acquisition. She architects the campaigns that fuel our members' success, ensuring a steady stream of opportunities for growth and income."
  }
];

async function main() {
  const existing = await prisma.siteSetting.findUnique({ where: { key: 'team' } });
  if (existing) {
    console.log('A team is already saved; nothing to do.');
    return;
  }
  const value = TEAM.map((m) => ({ id: randomBytes(5).toString('hex'), ...m }));
  await prisma.siteSetting.create({ data: { key: 'team', value } });
  console.log(`Added ${value.length} team members. Upload their photos in Admin > Website content.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
