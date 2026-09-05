import { executeDeletion, makeDeletionPlan } from '../src/lib/file-deletion.ts';
import { deletionFixture } from '../tests/deletion-fixture.ts';

// Synthetic in-memory handles ONLY. No filesystem writes or actual file deletion.
// RPC delay models asynchronous browser/OS round trips; NOT a client-machine SLA.
for (const scenario of [
  { name: '250 files / 125 groups', groupCount: 125, selectedCount: 2, retainedCount: 1 },
  { name: '250 files / 1 group', groupCount: 1, selectedCount: 250, retainedCount: 1 },
  { name: '25 deletions / 25 keepers', groupCount: 1, selectedCount: 25, retainedCount: 25 },
]) {
  const measurements = [];
  for (const parallel of [false, true]) {
    const f = await deletionFixture({ ...scenario, delayMs: 2, depth: 2, bytes: 64 * 1024 });
    const plan = makeDeletionPlan(f.groups, f.groups.map((group) => group.id),
      f.groups.flatMap((group) => group.files.filter((file) => file.selected).map((file) => file.id)), f.access);
    let metrics;
    const result = await executeDeletion(f.access, plan, { cancelled: false }, undefined, {
      groupConcurrency: parallel ? 4 : 1, verificationConcurrency: parallel ? 4 : 1,
      onMetrics: (value) => { metrics = value; },
    });
    if (result.some((item) => item.status !== 'deleted')) throw new Error('Synthetic benchmark failed');
    if (f.files.size !== scenario.groupCount * scenario.retainedCount) throw new Error('Keeper count changed');
    measurements.push({ mode: parallel ? 'bounded-parallel' : 'serial-baseline', ...metrics });
  }
  console.log(JSON.stringify({ scenario: scenario.name, synthetic: true, rpcDelayMs: 2,
    inputBytesPerFile: 64 * 1024, measurements,
    speedup: Number((measurements[0].elapsedMs / measurements[1].elapsedMs).toFixed(2)),
  }));
}
