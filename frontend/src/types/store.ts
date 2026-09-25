/** Compatibility exports; the active store owns its state contract. */
export type { AppState } from '../stores/appStore';
import type { WorkflowType } from './models';

/**
 * 游客模式配置
 */
export interface GuestConfig {
  currentWorkflow: WorkflowType;
  prompt: string;
  loraPrompt: string;
  strength: number;
  count: number;
  imagesPerRow: number;
  referenceImage: string | null;
  referenceImage2: string | null;
  referenceImage3: string | null;
}
