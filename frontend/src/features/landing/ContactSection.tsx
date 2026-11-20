import type { Contact } from '../site';
import ContactForm from './ContactForm';
import { telLink, whatsappLink } from './contactLinks';

/**
 * Get in touch: support details on the left and the message form on the right. Each support
 * detail only appears if the admin filled it in. The form is always shown; until a Web3Forms
 * key is set it politely points people to WhatsApp or email instead of failing silently.
 */
export default function ContactSection({ contact, isAdmin }: { contact: Contact; isAdmin: boolean }) {
  const call = contact.phone ? telLink(contact.phone) : null;
  const wa = contact.whatsapp ? whatsappLink(contact.whatsapp) : null;
  const mail = contact.email ? `mailto:${contact.email}` : null;
  const hasDetails = Boolean(call || wa || mail);

  return (
    <section className="lp-section" id="contact">
      <h2>Get in touch</h2>
      <p className="lp-section-sub">Have questions? We would love to hear from you.</p>

      <div className="lp-contact-grid with-form">
        {hasDetails && (
          <div className="lp-support">
            <h3>Support details</h3>
            {call && (
              <a className="lp-support-row" href={call}>
                <b>Phone</b>
                <span>{contact.phone}</span>
              </a>
            )}
            {mail && (
              <a className="lp-support-row" href={mail}>
                <b>Email</b>
                <span>{contact.email}</span>
              </a>
            )}
            {wa && (
              <a className="lp-support-row" href={wa} target="_blank" rel="noopener noreferrer">
                <b>WhatsApp</b>
                <span>Support available</span>
              </a>
            )}
            {wa && (
              <a className="lp-cta lp-wa" href={wa} target="_blank" rel="noopener noreferrer">
                Chat on WhatsApp
              </a>
            )}
          </div>
        )}

        <ContactForm accessKey={contact.formKey} isAdmin={isAdmin} />
      </div>
    </section>
  );
}
