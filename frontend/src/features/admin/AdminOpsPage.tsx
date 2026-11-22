import { useState } from 'react';
import { label } from '../../shared/format';
import { LiveEditor, RankPerksEditor } from './AdminPlanTabs';
import { Queue, who } from './AdminQueue';
import type { Person, Status } from './AdminQueue';

interface Claim {
  id: string;
  rank: string;
  status: Status;
  createdAt: string;
  user: Person;
}

type Tab = 'perks' | 'live';

/** The extras: rank perks (and the claims members send) and live trainings. */
export default function AdminOpsPage() {
  const [tab, setTab] = useState<Tab>('perks');
  const tabs: [Tab, string][] = [
    ['perks', 'Rank perks'],
    ['live', 'Live trainings']
  ];

  return (
    <>
      <h1>Rank perks &amp; live trainings</h1>
      <div className="dash-tabs ops-tabs">
        {tabs.map(([k, name]) => (
          <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>
            {name}
          </button>
        ))}
      </div>

      {tab === 'perks' && (
        <>
          <Queue<Claim>
            path="/admin/perk-claims"
            row={(r) => (
              <>
                {who(r.user)}
                <small>
                  Wants the <b>{label(r.rank)}</b> perk
                </small>
              </>
            )}
          />
          <RankPerksEditor />
        </>
      )}
      {tab === 'live' && <LiveEditor />}
    </>
  );
}
