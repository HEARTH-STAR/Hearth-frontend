import { z } from 'zod';
import type { SpaceStage } from './types.js';
// A Dot's computer is its folder in its home Space's container, where that Space's Hearth-Core
// runs Claude Code.
export const computerPermissionsSchema = z
  .object({
    files: z.boolean(),
    shell: z.boolean(),
  })
  .strict();
export type ComputerPermissions = z.infer<typeof computerPermissionsSchema>;
export const defaultPermissions: ComputerPermissions = {
  files: true,
  shell: false,
};
export interface ComputerActivity {
  id: string;
  threadId: string | null;
  /** Claude Code tool name: Bash, Write, Edit, Read, … or a page tool. */
  tool: string;
  /** The command or path the call acted on. */
  summary: string;
  /** Trimmed output, or the reason a call was denied. */
  detail: string | null;
  outcome: 'pending' | 'succeeded' | 'failed' | 'denied';
  createdAt: number;
}
export interface ComputerStatus {
  /** Running when Hearth-Core in the home Space's container answers. */
  state: 'running' | 'unavailable';
  directory: string;
  permissions: ComputerPermissions;
  /** The Dot's home Space, whose container this computer is. */
  space: {
    id: string;
    name: string;
    stage: SpaceStage;
    container: string | null;
  };
  activity: ComputerActivity[];
  error?: string;
}
export interface WorkspaceListing {
  directory: string;
  exists: boolean;
  /** POSIX paths relative to the Dot's folder; empty folders end with "/". */
  files: string[];
  truncated: boolean;
}
export interface WorkspaceFile {
  path: string;
  size: number;
  modifiedAt: number;
  binary: boolean;
  truncated: boolean;
  text: string | null;
}
const folderSegment = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
/** A Dot's folder, relative to the workspace root: plain names joined by "/". */
export const folderPath = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(
    (value) => value.split('/').every((part) => folderSegment.test(part)),
    'Use a relative folder path made of letters, digits, ".", "_" and "-".',
  );
/** A file inside a Dot's folder: relative, no "..", no empty segments, no backslashes. */
export const filePath = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !/[\\\0]/.test(value) &&
      value
        .split('/')
        .every((part) => part !== '' && part !== '.' && part !== '..'),
    'Use a path relative to this computer’s folder.',
  );
