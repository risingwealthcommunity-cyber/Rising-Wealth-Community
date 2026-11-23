import { Link } from 'react-router-dom';
import { DEFAULT_CONTACT, DEFAULT_MILESTONES, useSiteContent } from '../site';
import ContactEditor from './ContactEditor';
import PageTextEditor from './PageTextEditor';
import PaymentEditor from './PaymentEditor';
import ImageSlot from './ImageSlot';
import ListEditor from './ListEditor';
import MilestonesEditor from './MilestonesEditor';

const PAGE_IMAGES = [
  { key: 'about-image', title: 'About section image', hint: 'Shown beside the About text. Landscape works best, e.g. 1200 x 800.' },
  { key: 'certificate', title: 'Registration certificate', hint: 'Opens in the "View document" viewer. Use a clear scan or photo.' },
  { key: 'feature-1', title: 'Card 1: Start free', hint: 'Optional top image. Wide images (16:9) look best.' },
  { key: 'feature-2', title: 'Card 2: Build your team', hint: 'Optional top image.' },
  { key: 'feature-3', title: 'Card 3: Passive levels', hint: 'Optional top image.' },
  { key: 'feature-4', title: 'Card 4: Weekly payouts', hint: 'Optional top image.' }
];

/** Everything an admin can change on the public home page, in one place. */
export default function SiteContentPage() {
  const { content, loaded, failed, reload } = useSiteContent();

  return (
    <>
      <div>
        <Link to="/admin" className="muted">
          {'←'} Back to admin
        </Link>
        <h1>Website content</h1>
        <p className="muted">Changes go live on the home page as soon as you save or upload.</p>
        <nav className="jump" aria-label="What you can change">
          <a href="#sec-text">Written content</a>
          <a href="#sec-images">Page images</a>
          <a href="#sec-numbers">Numbers (milestones)</a>
          <a href="#sec-team">Team members</a>
          <a href="#sec-reviews">Reviews</a>
          <a href="#sec-payment">Payment QR</a>
          <a href="#sec-contact">Contact &amp; social links</a>
        </nav>
      </div>

      {!loaded ? (
        <div className="muted">Loading...</div>
      ) : failed ? (
        <div className="alert error">
          Could not load the website content. Make sure the backend is running (<b>npm run dev</b> in the backend folder)
          and that you ran <b>npx prisma db push</b> once, then refresh this page.
        </div>
      ) : (
        <>
          <div id="sec-text">
            <PageTextEditor saved={content.pageText?.texts ?? {}} onSaved={reload} />
          </div>

          <div className="card" id="sec-images">
            <h2>Page images</h2>
            <p className="muted">PNG, JPEG or WebP, up to 6 MB each.</p>
            <div className="site-imgs">
              {PAGE_IMAGES.map((img) => (
                <ImageSlot
                  key={img.key}
                  title={img.title}
                  hint={img.hint}
                  assetKey={img.key}
                  asset={content.assets[img.key]}
                  onChanged={reload}
                />
              ))}
            </div>
          </div>

          <div id="sec-numbers">
            <MilestonesEditor saved={content.milestones ?? DEFAULT_MILESTONES} assets={content.assets} onSaved={reload} />
          </div>

          <div id="sec-team" />
          <ListEditor
            block="team"
            title="Team"
            description="Shown under Meet Our Team. Add a member with their photo in one go, edit anyone, reorder, or remove. The section stays hidden when the list is empty."
            noun="member"
            photoPrefix="team"
            photoLabel="Photo"
            maxItems={12}
            fields={[
              { key: 'name', label: 'Name', max: 60, required: true },
              { key: 'role', label: 'Role', max: 60, required: true },
              { key: 'bio', label: 'About (a few lines)', max: 400, multiline: true }
            ]}
            items={content.team ?? []}
            assets={content.assets}
            onSaved={reload}
          />

          <div id="sec-reviews" />
          <ListEditor
            block="reviews"
            title="Reviews"
            description="Add each review with its screenshot in one go. Only reviews that have a screenshot appear on the website, and the section stays hidden if there are none."
            noun="review"
            photoPrefix="review"
            photoLabel="Review screenshot"
            photoRequired
            maxItems={30}
            fields={[
              { key: 'name', label: 'Member name', max: 60, required: true },
              { key: 'tag', label: 'Tag under the name (e.g. Verified Member)', max: 40 }
            ]}
            items={content.reviews ?? []}
            assets={content.assets}
            onSaved={reload}
          />


          <div id="sec-payment" />
          <PaymentEditor asset={content.assets['payment-qr']} onChanged={reload} />

          <div id="sec-contact" />
          <ContactEditor saved={{ ...DEFAULT_CONTACT, ...(content.contact ?? {}) }} onSaved={reload} />
        </>
      )}
    </>
  );
}
