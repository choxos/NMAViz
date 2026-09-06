# NMAViz

**Read the evidence structure of a network meta-analysis, through the lenses the methods literature
has proposed.**

Upload the data behind an NMA and the site fits the frequentist graph-theoretical model in your
browser, then draws the same fitted network as an electrical circuit, a flow of evidence, a random
walk, a diffusion, a system of springs, a bipartite treatment-trial graph, and a Hodge decomposition
of its inconsistency. There is no backend and no upload: the file is parsed and analyzed on your
machine.

Status: early. The scaffold is in place; the analysis engine and the lenses land next.

## Run

Node.js 22.13 or newer.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:3021.

```sh
npm test
npm run build
npm run preview
```

## License

MIT. Inter is licensed under the SIL Open Font License.
