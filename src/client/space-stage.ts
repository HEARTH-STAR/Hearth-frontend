import type { SpaceStage } from '../shared/types';
// How a Space's container stage reads in the app.

export const STAGE_LABEL: Record<SpaceStage, string> = {
  none: 'Not started',
  creating: 'Creating container…',
  booting: 'Starting Hearth-Core…',
  ready: 'Running',
  stopped: 'Stopped',
  missing: 'Container missing',
  failed: 'Did not start',
  unknown: 'Hearth-backend not answering',
};
/** The container needs a start from the owner. */
export const startable = (stage: SpaceStage) =>
  stage === 'none' ||
  stage === 'stopped' ||
  stage === 'missing' ||
  stage === 'failed';
/** The container is on its way up by itself. */
export const working = (stage: SpaceStage) =>
  stage === 'creating' || stage === 'booting';
