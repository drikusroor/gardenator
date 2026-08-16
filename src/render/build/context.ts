/** Everything a builder needs to know that is not on the object itself. */

import type { GardenDoc } from '../../core/types';

export interface BuildContext {
  quality: 'low' | 'medium' | 'high';
  showGrass: boolean;
  /** True once the sun is down, so lamps light up and bulbs glow. */
  night: boolean;
  /**
   * Draw order index for coplanar ground surfaces. Each object gets a
   * sub-millimetre lift so overlapping flat polygons never z-fight.
   */
  layer: number;
  doc: GardenDoc;
}

export const LAYER_LIFT = 0.0016;

/** Tuft/detail density multiplier per quality setting. */
export const DETAIL: Record<BuildContext['quality'], number> = {
  low: 0.35,
  medium: 0.7,
  high: 1,
};
