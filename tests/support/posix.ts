import { it } from "vitest";

/**
 * Every QKERN background runtime is deployed into a Linux container, so the
 * secret-file and evidence contracts deliberately demand POSIX absolute paths
 * and refuse group- or world-accessible files. The tests that exercise those
 * contracts write real files and change their mode, which Windows cannot
 * express: `mkdtemp` never yields a `/`-rooted path and `chmod` does not map to
 * NTFS ACLs.
 *
 * Such cases run on POSIX hosts and are skipped elsewhere. Weakening the
 * production invariant so the assertion passes on a developer workstation would
 * trade a real security boundary for a green local run.
 *
 * The three-OS CI matrix therefore certifies these contracts on Linux and
 * macOS. A Windows run reports them as skipped, never as passed.
 */
export const posix = process.platform !== "win32";

export const itOnPosix = posix ? it : it.skip;
