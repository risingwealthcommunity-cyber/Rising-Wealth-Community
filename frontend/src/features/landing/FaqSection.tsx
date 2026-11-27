/**
 * Questions people ask about the community, in plain words. The same questions and answers are in the page's search-engine data
 * (index.html, "FAQPage"), so keep the two in step when you change one.
 */
export const FAQ: { q: string; a: string }[] = [
  {
    q: 'What is Rising Wealth Community?',
    a: 'Rising Wealth Community is a learning-and-earning community in India. Members join free as a Trainee, learn through live trainings and community support, and earn from Demat referrals. PRO and ELITE packages unlock package income, passive levels, bonus pools and rank rewards.'
  },
  {
    q: 'Is it free to join?',
    a: 'Yes. You can join free as a Trainee with a sponsor link. A Trainee earns from Demat referrals. Upgrading to a paid package is optional and you can do it when you are ready.'
  },
  {
    q: 'What do the PRO and ELITE packages cost?',
    a: 'PRO costs ₹2,499 and ELITE costs ₹4,999. PRO unlocks 7 passive levels and ELITE unlocks all 12 passive levels, along with direct income, weekly and performance pools, and rank rewards.'
  },
  {
    q: 'How do members earn?',
    a: "Trainees earn from Demat referrals and 5 passive levels on those referrals. PRO and ELITE members also get 35% direct income on packages sold to their direct members, passive level income, weekly, performance and leadership bonuses, and rank rewards. Income depends on your own activity and your team's activity, and no earnings are guaranteed."
  },
  {
    q: 'Can I see where my income comes from?',
    a: 'Yes. Your wallet, your team tree and every payout are shown in your member dashboard.'
  },
  {
    q: 'How do I contact Rising Wealth Community?',
    a: 'Use the Get in touch section on this page, or the WhatsApp support, phone and email links in the footer.'
  }
];

export default function FaqSection() {
  return (
    <section className="lp-section lp-faq" id="faq">
      <h2>Questions and answers</h2>
      <div className="lp-faq-list">
        {FAQ.map((f) => (
          <details key={f.q}>
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
