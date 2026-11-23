import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../shared/api/apiClient';
import { Avatar } from '../../shared/components/Avatar';
import { useAuth } from '../auth';
import { date, inr, label } from '../../shared/format';

interface Team {
  rank: string;
  package: string;
  passiveLevels: { level: number; pct: number; earned: number; unlocked: boolean }[];
  points: { left: number; right: number; unmatchedLeft: number; unmatchedRight: number };
  nextRank: { rank: string; requiredEachLeg: number; reward: number } | null;
  directReferrals: { id: string; name: string; avatar: string | null; package: string; leg: string | null; createdAt: string }[];
}

interface TreeNode {
  id: string;
  name: string;
  avatar: string | null;
  package: string;
  rank: string;
  joinedAt: string;
  more: boolean;
  left: TreeNode | null;
  right: TreeNode | null;
}
interface TreeData {
  tree: TreeNode;
  isMe: boolean;
  counts: { left: number; right: number; total: number };
}

const sub = (n: TreeNode) => (n.rank === 'NONE' ? label(n.package) : label(n.rank));

function Slot({ node, onOpen, top, leg }: { node: TreeNode | null; onOpen: (id: string) => void; top?: boolean; leg?: 'LEFT' | 'RIGHT' }) {
  const { user } = useAuth();
  if (!node) {
    return (
      <li>
        {leg && <i className="tn-leg">{leg} team</i>}
        <div className="tnode empty">
          <span className="tn-avatar">+</span>
          <small>Empty</small>
        </div>
      </li>
    );
  }
  const hasKids = !!(node.left || node.right);
  return (
    <li className={top ? 'top' : undefined}>
      {leg && <i className="tn-leg">{leg} team</i>}
      <button
        type="button"
        data-pkg={node.package}
        className={`tnode${top ? ' me' : ''}`}
        onClick={() => !top && (hasKids || node.more) && onOpen(node.id)}
        disabled={top || (!hasKids && !node.more)}
        title={node.more ? 'Open this branch' : node.name}
      >
        <span className="tn-avatar">
          <Avatar avatar={node.avatar} name={top ? (user?.name ?? node.name) : node.name} size={56} />
          {node.more && <i className="tn-more">+</i>}
        </span>
        <b>{node.name}</b>
        <small className="tn-chip">{sub(node)}</small>
      </button>
      {(hasKids || (!node.more && top)) && (
        <ul>
          <Slot node={node.left} onOpen={onOpen} leg={top ? 'LEFT' : undefined} />
          <Slot node={node.right} onOpen={onOpen} leg={top ? 'RIGHT' : undefined} />
        </ul>
      )}
    </li>
  );
}

/** Keeps the empty slots only under members that are drawn with children space (not at the last row). */
function Tree({ node, onOpen }: { node: TreeNode; onOpen: (id: string) => void }) {
  return (
    <div className="tree-scroll">
      <div className="tree">
        <ul>
          <Slot node={node} onOpen={onOpen} top />
        </ul>
      </div>
    </div>
  );
}

export default function TeamPage() {
  const [team, setTeam] = useState<Team | null>(null);
  const [tree, setTree] = useState<TreeData | null>(null);
  const [treeFailed, setTreeFailed] = useState(false);
  const [q, setQ] = useState('');

  useEffect(() => {
    api<Team>('/team/summary').then((r) => setTeam(r.data ?? null)).catch(() => undefined);
    loadTree();
  }, []);

  const loadTree = (root?: string) => {
    setTreeFailed(false);
    api<TreeData>(`/team/tree${root ? `?root=${root}` : ''}`)
      .then((r) => setTree(r.data ?? null))
      .catch(() => setTreeFailed(true));
  };

  if (!team) return <p className="muted">Loading...</p>;
  const direct = team.directReferrals.filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase()));
  const locked = team.passiveLevels.filter((l) => !l.unlocked);

  return (
    <>
      <h1>My team</h1>

      <div className="card">
        <div className="team-head">
          <h2>Direct team ({team.directReferrals.length})</h2>
          <input className="team-search" placeholder="Search by name..." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search your direct team" />
        </div>
        {team.directReferrals.length === 0 && <p className="muted">Share your link from the dashboard to build your team.</p>}
        {team.directReferrals.length > 0 && direct.length === 0 && <p className="muted">No one matches that name.</p>}
        <div className="direct-list">
          {direct.map((r) => (
            <div className="direct-row" key={r.id}>
              <Avatar avatar={r.avatar} name={r.name} size={44} />
              <span className="direct-name">
                {r.name}
                <small>Joined: {date(r.createdAt)}</small>
              </span>
              <span className="badge">{label(r.package)}</span>
              <span className="badge">{r.leg ? label(r.leg) : '-'}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="dash-stats team-counts">
        <div className="card dash-stat">
          <div>
            <span>Left team</span>
            <strong>{tree?.counts.left ?? '...'}</strong>
          </div>
        </div>
        <div className="card dash-stat">
          <div>
            <span>Right team</span>
            <strong>{tree?.counts.right ?? '...'}</strong>
          </div>
        </div>
        <div className="card dash-stat">
          <div>
            <span>Total team</span>
            <strong>{tree?.counts.total ?? '...'}</strong>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="team-head">
          <h2>Team tree</h2>
          {tree && !tree.isMe && (
            <button className="btn ghost" type="button" onClick={() => loadTree()}>
              Back to me
            </button>
          )}
        </div>
        {treeFailed && <p className="muted">Could not load your tree. Please try again.</p>}
        {!tree && !treeFailed && <p className="muted">Loading...</p>}
        {tree && (
          <>
            <Tree node={tree.tree} onOpen={(id) => loadTree(id)} />
            <div className="tree-legend">
              <span><i style={{ background: '#94a3b8' }} />Trainee</span>
              <span><i style={{ background: '#3b82f6' }} />Pro</span>
              <span><i style={{ background: '#8b5cf6' }} />Elite</span>
            </div>
            <p className="muted tree-hint">Tap a member with a + to open their branch. New members are placed on the side their sponsor's code chose.</p>
          </>
        )}
      </div>

      <div className="card">
        <h2>Passive income from team levels</h2>
        <p className="muted">What you have earned from each level of your team, from the package sales of the members below you.</p>
        <div className="levels">
          {team.passiveLevels.map((l) => {
            return (
              <div className={`level${l.unlocked ? '' : ' locked'}`} key={l.level}>
                <small>
                  Level {l.level}
                  {!l.unlocked && <span className="level-lock" aria-label="Locked"> 🔒</span>}
                </small>
                <strong>{inr(l.earned)}</strong>
                <em>earned from level {l.level}</em>
                {!l.unlocked && <span className="level-need">Unlocks with ELITE</span>}
              </div>
            );
          })}
        </div>
        {locked.length > 0 && (
          <p className="levels-note">
            Upgrade to <Link to="/activation">ELITE</Link> to unlock levels {locked[0].level}-{locked[locked.length - 1].level} and earn on the whole 12-level team.
          </p>
        )}
      </div>
    </>
  );
}
