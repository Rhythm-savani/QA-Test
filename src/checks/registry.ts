// One line per check: this is the only place a new check has to be registered (NFR-3).
import type { Check } from '../shared/types';
import { chk01 } from './chk01-runtime-errors';
import { chk02 } from './chk02-network';
import { chk03 } from './chk03-media';
import { chk04 } from './chk04-links';
import { chk05 } from './chk05-template-leftovers';
import { chk06 } from './chk06-empty-content';
import { chk07 } from './chk07-fonts';
import { chk08 } from './chk08-layout';
import { chk09 } from './chk09-interactions';
import { chk10 } from './chk10-a11y';
import { chk11 } from './chk11-performance';
import { chk12 } from './chk12-page-basics';
import { chk13 } from './chk13-variants';
import { chk14 } from './chk14-cart-badge';
import { chk15 } from './chk15-search';
import { chk16 } from './chk16-newsletter';
import { chk17 } from './chk17-cart-actions';
import { chk18 } from './chk18-custom-rules';

// Each check is typed with its own data shape; the registry erases it to `unknown` because
// collect() and analyze() are only ever paired by id at runtime.
export const CHECKS = [
  chk01,
  chk02,
  chk03,
  chk04,
  chk05,
  chk06,
  chk07,
  chk08,
  chk09,
  chk10,
  chk11,
  chk12,
  chk13,
  chk14,
  chk15,
  chk16,
  chk17,
  chk18,
] as unknown as Check[];

export function checkById(id: string): Check | undefined {
  return CHECKS.find((c) => c.id === id);
}
