import fs from 'fs';

/**
 * Restricts a path to its owner. POSIX only — Windows ACLs do not map onto
 * these bits and `chmod` there is a no-op at best, so it is skipped. Never
 * throws: a data directory on a filesystem that cannot express the mode (a
 * mounted share, for instance) must not stop the Core from starting.
 *
 * Lives here rather than in `DatabaseService` because the migration engine has
 * to apply the same bits to the snapshots it writes — a pre-migration backup is
 * a byte-for-byte copy of an owner-only database and must not be readable by
 * anyone the original was not (DEC-028).
 */
export function enforceOwnerOnly(target: string, mode: number, label = 'Database'): void {
  if (process.platform === 'win32') return;
  try {
    if (!fs.existsSync(target)) return;
    if ((fs.statSync(target).mode & 0o777) === mode) return;
    fs.chmodSync(target, mode);
  } catch (err) {
    console.warn(
      `[${label}] Could not restrict ${target} to ${mode.toString(8)}: ${(err as Error).message}`
    );
  }
}
