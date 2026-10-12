# Wordle Pattern Lab

A playground for the question: **given only the colours of some Wordle rows, can you work out the answer?**

```bash
npm install
npm run dev
```

Then open http://localhost:3000. On first load a Web Worker scores every answer (`words.json`, 2,309 words)
against every valid guess (`validWords.json`, 14,855 words). That's about 34 million comparisons and takes a
second or two. Everything else runs in the browser; there's no server-side logic.

## Pages

- **Explorer** (`/`): build grids by clicking tiles, or paste Wordle share texts (several at once). Shows
  every answer consistent with the rows, ranked by plausibility. Click a word to see guesses that explain each
  row. *Mystery game* picks a secret answer and adds simulated players' grids one at a time.
- **Word lens** (`/word?w=stare`): one answer in depth: which of the 242 non-winning patterns it can
  produce, the fewest rows that single it out, and which words "shadow" it.
- **Theory** (`/theory`): the best case for every answer: the minimum number of rows needed, if you could
  choose the rows.
- **Simulator** (`/simulate`): realistic players (popular openers, sensible follow-ups, optional hard mode)
  share grids for the same answer. How many grids does it take?

The setting **"Players' guesses can be any valid word / only answer words"** is shared by all pages and
matters a lot.

## The model

- Each row is a pattern code `0..242` (base 3: grey 0, yellow 1, green 2). `242` is all green.
- For an answer `A`, `S(A)` is the set of patterns some allowed guess produces against `A`.
- **Normal mode:** rows `P` are consistent with `A` iff `P ⊆ S(A)`. Order and repeats don't matter.
- **Hard mode:** order matters. Revealed letters must be reused (as often as they were revealed) and greens
  stay put. The engine searches for an actual sequence of guesses that obeys this (`Engine.hardWitness`).
- **Never identifiable:** if `S(A) ⊆ S(B)` for some other answer `B`, every set of rows that fits `A` also
  fits `B`.
- **Fewest rows:** pick patterns from `S(A)` so that every other answer `B` is ruled out by at least one
  pattern outside `S(B)`. This is a minimum hitting-set problem, solved exactly by iterative deepening.
- **Plausibility:** `Σ log(#guesses producing the row / #guesses in pool)`. This assumes guesses are random,
  which is crude but useful.

Assumptions: the answer is always from `words.json`; repeated guesses are allowed; the "winning" row is
known (it's always all green) and isn't used as a clue.

## Findings so far

With any valid word allowed as a guess:

- **201 of 2,309 answers (8.7%) can never be deduced** from colours alone. HUMPH, for example, is shadowed
  by 67 words, including HEATH.
- The rest need **2–15 rows** in the best case (median 5).
- Realistic grids are far less informative: one shared grid typically leaves ~1,600 answers possible.

With only answer words as guesses: 85 are never identifiable, the median drops to 3 rows, and pooling
simulated players' grids pins down roughly 40% of answers within 30 grids.

## Code map

- `lib/wordle.ts`: pattern encoding, feedback, share-text parsing.
- `lib/engine.ts`: all the maths (feedback matrix, candidates, hard mode, minimum rows, simulation). No browser
  dependencies, so it runs under Node too.
- `lib/engine.worker.ts` + `lib/engineClient.ts`: runs the engine in a Web Worker and shares it across pages.
- `app/`: the four pages. `components/`: tiles, bar chart, UI bits.
