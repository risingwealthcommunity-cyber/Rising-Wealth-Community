import type { Contact } from '../site';
import ContactForm from './ContactForm';

/**
 * Get in touch: the message form. It is always shown; until a Web3Forms key is set it politely
 * points people to WhatsApp or email instead of failing silently. Phone and email live in the footer.
 */
export default function ContactSection({ contact, isAdmin }: { contact: Contact; isAdmin: boolean }) {
  return (
    <section className="lp-section" id="contact">
      <h2>Get in touch</h2>
      <p className="lp-section-sub">Have questions? We would love to hear from you.</p>
      <div className="lp-contact-grid">
        <ContactForm accessKey={contact.formKey} isAdmin={isAdmin} />
      </div>
    </section>
  );
}
