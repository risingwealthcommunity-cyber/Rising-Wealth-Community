import type { SiteAssets, TeamMember } from '../site';
import { initials } from './initials';
import { useT } from './pageText';

/** Hidden until an admin adds at least one member, so the page never shows made-up people. */
export default function TeamSection({ team, assets }: { team: TeamMember[] | null; assets: SiteAssets }) {
  const t = useT();
  if (!team || team.length === 0) return null;

  return (
    <section className="lp-section" id="team">
      <h2>{t('team.title')}</h2>
      <p className="lp-section-sub">{t('team.sub')}</p>
      <div className="lp-team">
        {team.map((m) => {
          const photo = m.id ? assets[`team-${m.id}`] : undefined;
          return (
            <article className="lp-member" key={m.id ?? m.name}>
              <div className="lp-member-photo">
                {photo ? (
                  <img src={photo.url} alt={m.name} loading="lazy" decoding="async" />
                ) : (
                  <span aria-hidden="true">{initials(m.name)}</span>
                )}
              </div>
              <div className="lp-member-body">
                <h3>{m.name}</h3>
                <b>{m.role}</b>
                {m.bio && <p>{m.bio}</p>}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
