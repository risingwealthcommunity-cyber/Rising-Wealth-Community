import { Link } from 'react-router-dom';
import { DEFAULT_CONTACT, DEFAULT_MILESTONES, useSiteContent } from '../site';
import ContactEditor from './ContactEditor';
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
  const { content, loaded, reload } = useSiteContent();

  return (
    <>
      <div>
        <Link to="/admin" className="muted">
          {'←'} Back to admin
        </Link>
        <h1>Website content</h1>
        <p className="muted">Changes go live on the home page as soon as you save or upload.</p>
      </div>

      {!loaded ? (
        <div className="muted">Loading...</div>
      ) : (
        <>
          <div className="card">
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

          <MilestonesEditor saved={content.milestones ?? DEFAULT_MILESTONES} assets={content.assets} onSaved={reload} />

          <ListEditor
            block="team"
            title="Team"
            description="Shown under Meet Our Team. The section stays hidden until you add at least one member."
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

          <ListEditor
            block="reviews"
            title="Reviews"
            description="Upload each review as a screenshot. Only reviews that have a screenshot are shown; the section stays hidden if there are none."
            noun="review"
            photoPrefix="review"
            photoLabel="Review screenshot"
            maxItems={30}
            fields={[
              { key: 'name', label: 'Member name', max: 60, required: true },
              { key: 'tag', label: 'Tag under the name (e.g. Verified Member)', max: 40 }
            ]}
            items={content.reviews ?? []}
            assets={content.assets}
            onSaved={reload}
          />

          <ContactEditor saved={{ ...DEFAULT_CONTACT, ...(content.contact ?? {}) }} onSaved={reload} />
        </>
      )}
    </>
  );
}
