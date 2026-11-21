import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../shared/api/apiClient';

export type Tier = 'TRAINEE' | 'PRO' | 'ELITE';

export interface Lesson {
  title: string;
  description: string;
  /** Only present when the lesson is unlocked for you. */
  url?: string;
  tier: Tier;
  unlocked?: boolean;
}

const SECTIONS: { tier: Tier; title: string; note: string }[] = [
  { tier: 'TRAINEE', title: 'Starter lessons', note: 'Open to every member' },
  { tier: 'PRO', title: 'Pro Package', note: 'Unlocks with the PRO package' },
  { tier: 'ELITE', title: 'Elite Package', note: 'Unlocks with the ELITE package' }
];

/** YouTube links get their own cover image; anything else gets a plain play tile. */
function thumbnail(url?: string): string | null {
  if (!url) return null;
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/))([\w-]{11})/);
  return m ? `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg` : null;
}

function Card({ lesson }: { lesson: Lesson }) {
  const cover = thumbnail(lesson.url);
  const open = lesson.unlocked !== false;
  const body = (
    <>
      <div className={`lesson-cover${cover ? '' : ' plain'}`} style={cover ? { backgroundImage: `url(${cover})` } : undefined}>
        {open ? <span className="lesson-play">▶</span> : <span className="lesson-lock">🔒 Locked</span>}
      </div>
      <div className="lesson-body">
        <h3>{lesson.title}</h3>
        {lesson.description && <p className="muted">{lesson.description}</p>}
        <span className="lesson-cta">{open ? 'Open lesson' : `Upgrade to ${lesson.tier} to unlock`}</span>
      </div>
    </>
  );
  return open && lesson.url ? (
    <a className="card lesson" href={lesson.url} target="_blank" rel="noopener noreferrer">
      {body}
    </a>
  ) : (
    <Link className="card lesson locked" to="/activation">
      {body}
    </Link>
  );
}

export default function TrainingPage() {
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api<{ items: Lesson[] }>('/site/training')
      .then((r) => setLessons(r.data?.items ?? []))
      .catch(() => setFailed(true));
  }, []);

  return (
    <>
      <div>
        <h1>Training Library</h1>
        <p className="muted">Lessons from the RWC team. Upgrade your package to unlock the next level.</p>
      </div>

      {failed && <div className="alert error">Could not load the lessons. Please try again.</div>}
      {!failed && !lessons && <p className="muted">Loading...</p>}

      {lessons && lessons.length === 0 && (
        <div className="card empty-state">
          <strong>Lessons are coming soon</strong>
          The team has not added any training yet. Check back shortly.
        </div>
      )}

      {lessons &&
        SECTIONS.map((sec) => {
          const rows = lessons.filter((l) => (l.tier ?? 'TRAINEE') === sec.tier);
          if (rows.length === 0) return null;
          const open = rows.every((l) => l.unlocked !== false);
          return (
            <section className="lesson-section" key={sec.tier}>
              <div className="lesson-head">
                <div>
                  <h2>{sec.title}</h2>
                  <span className="muted">{sec.note}</span>
                </div>
                <span className={`lesson-state${open ? ' open' : ''}`}>{open ? 'Unlocked' : 'Locked'}</span>
              </div>
              <div className="lessons">
                {rows.map((l, i) => (
                  <Card lesson={l} key={`${sec.tier}-${i}`} />
                ))}
              </div>
            </section>
          );
        })}
    </>
  );
}
