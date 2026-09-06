/* The lenses, in the order they are offered.
 *
 * Each one is a different published reading of the same fitted model, so they
 * share the treatment positions and the node drawing and differ only in what
 * they say about the edges.
 */

import { network } from "./network.js";
import { flow } from "./flow.js";
import { contributions } from "./contributions.js";

export const LENSES = [network, flow, contributions];
