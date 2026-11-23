import type { Contact } from '../site';
import ContactForm from './ContactForm';
import { useT } from './pageText';

/**
 * Get in touch: the message form. It is always shown; until a Web3Forms key is set it politely
 * points people to WhatsApp or email instead of failing silently. Phone and email live in the footer.
 */
export default function ContactSection({ contact, isAdmin }: { contact: Contact; isAdmin: boolean }) {
  const t = useT();
  return (
    <section className="lp-section" id="contact">
      <h2>{t('contact.title')}</h2>
      <p className="lp-section-sub">{t('contact.sub')}</p>
      <div className="lp-contact-grid">
        <ContactForm accessKey={contact.formKey} isAdmin={isAdmin} />
      </div>
    </section>
  );
}
