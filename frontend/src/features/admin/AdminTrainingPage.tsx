import TrainingEditor from './TrainingEditor';

/** Add, order and remove the lessons members see in their Training Library, and choose which package unlocks each one. */
export default function AdminTrainingPage() {
  return (
    <>
      <h1>Training library</h1>
      <p className="muted">Members see these lessons in their Training Library. A lesson with a PRO or ELITE tier stays locked until the member has that package.</p>
      <TrainingEditor />
    </>
  );
}
