import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../shared/api/apiClient';
import { inr } from '../../shared/format';

export interface Campaign {
  id: string;
  title: string;
  description: string;
  reward: number;
  url: string;
  videoUrl: string;
  needsProof: boolean;
  logoUrl?: string | null;
}

/** A YouTube link gets its cover image; anything else is shown as a plain play tile. */
function cover(url: string): string | null {
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/))([\w-]{11})/);
  return m ? `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg` : null;
}

function Card({ c }: { c: Campaign }) {
  const [copied, setCopied] = useState(false);
  const img = c.videoUrl ? cover(c.videoUrl) : null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(c.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <div className="card campaign">
      <div className="campaign-head">
        {c.logoUrl && <img className="campaign-logo" src={c.logoUrl} alt="" width={48} height={48} />}
        <h3>{c.title}</h3>
      </div>
      {c.description && <p className="muted">{c.description}</p>}
      <strong className="campaign-reward">Earn {inr(c.reward)}</strong>
      {c.videoUrl && (
        <a className={`lesson-cover campaign-video${img ? '' : ' plain'}`} style={img ? { backgroundImage: `url(${img})` } : undefined} href={c.videoUrl} target="_blank" rel="noopener noreferrer" aria-label={`Watch the video for ${c.title}`}>
          <span className="lesson-play">▶</span>
        </a>
      )}
      <div className="campaign-actions">
        <button className="btn" type="button" onClick={() => void copy()}>
          {copied ? 'Copied!' : 'Copy referral link'}
        </button>
        <a className="btn ghost" href={c.url} target="_blank" rel="noopener noreferrer" aria-label="Open the link">
          ↗
        </a>
        {c.needsProof && (
          <Link className="btn ghost" to={`/reports?campaign=${c.id}`}>
            Submit report
          </Link>
        )}
      </div>
    </div>
  );
}

export default function CampaignsPage() {
  const [items, setItems] = useState<Campaign[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api<{ items: Campaign[] }>('/campaigns')
      .then((r) => setItems(r.data?.items ?? []))
      .catch(() => setFailed(true));
  }, []);

  const withDocs = items?.filter((c) => c.needsProof) ?? [];
  const without = items?.filter((c) => !c.needsProof) ?? [];

  return (
    <>
      <div>
        <h1>Active campaigns</h1>
        <p className="muted">Promote a campaign and earn the reward. For campaigns with a report, send a screenshot as proof and the reward is paid after approval.</p>
      </div>
      {failed && <div className="alert error">Could not load the campaigns. Please try again.</div>}
      {!failed && !items && <p className="muted">Loading...</p>}
      {items && items.length === 0 && (
        <div className="card empty-state">
          <strong>No active campaigns right now</strong>
          New campaigns appear here as soon as the team adds them.
        </div>
      )}
      {withDocs.length > 0 && (
        <section className="lesson-section">
          <h2>Campaigns with reports</h2>
          <div className="lessons">
            {withDocs.map((c) => (
              <Card c={c} key={c.id} />
            ))}
          </div>
        </section>
      )}
      {without.length > 0 && (
        <section className="lesson-section">
          <h2>Campaigns without documents</h2>
          <div className="lessons">
            {without.map((c) => (
              <Card c={c} key={c.id} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
