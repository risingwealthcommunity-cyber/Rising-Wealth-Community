import AdminReports from './AdminReports';

export default function AdminReportsPage() {
  return (
    <>
      <h1>Reports</h1>
      <p className="muted">Reports members sent for campaigns. Approve to pay the reward, or mark them incomplete, missing, already existing or rejected.</p>
      <AdminReports />
    </>
  );
}
