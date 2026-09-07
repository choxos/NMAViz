/* The lenses, in the order they are offered.
 *
 * Each one is a different published reading of the same fitted model, so they
 * share the treatment positions and the node drawing and differ only in what
 * they say about the edges.
 */

import { network } from "./network.js";
import { flow } from "./flow.js";
import { contributions } from "./contributions.js";
import { diffusionLens } from "./diffusion.js";
import { springs } from "./springs.js";
import { hodgeLens } from "./hodge.js";
import { reconstruction } from "./reconstruction.js";
import { bipartite } from "./bipartite.js";
import { populationLens } from "./population.js";

export const LENSES = [
  network,
  bipartite,
  flow,
  contributions,
  reconstruction,
  hodgeLens,
  diffusionLens,
  springs,
  populationLens,
];
