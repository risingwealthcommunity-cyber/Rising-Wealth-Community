import { useEffect, useState } from 'react';
import { api } from '../../shared/api/apiClient';

export interface Lesson {
  title: string;
  description: string;
  url: string;
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
        <p className="muted">Lessons from the RWC team to help you learn, refer and grow.</p>
      </div>

      {failed && <div className="alert error">Could not load the lessons. Please try again.</div>}
      {!failed && !lessons && <p className="muted">Loading...</p>}

      {lessons && lessons.length === 0 && (
        <div className="card empty-state">
          <strong>Lessons are coming soon</strong>
          The team has not added any training yet. Check back shortly.
        </div>
      )}

      {lessons && lessons.length > 0 && (
        <div className="lessons">
          {lessons.map((l, i) => (
            <div className="card lesson" key={`${l.url}-${i}`}>
              <span className="lesson-no">{i + 1}</span>
              <h3>{l.title}</h3>
              {l.description && <p className="muted">{l.description}</p>}
              <a className="btn" href={l.url} target="_blank" rel="noopener noreferrer">
                Open lesson
              </a>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
