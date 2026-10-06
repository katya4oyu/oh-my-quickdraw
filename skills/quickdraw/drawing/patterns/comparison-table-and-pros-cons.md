# Comparison table and pros / cons

Coordinates are offsets from an origin you pick in free space (`../visual-thinking.md`, Place): add its x and y to every `at`.

Options side by side over the same points. A bento grid with one column per option plus one for the point names reads as a table:

```sh
omq bento --cols 3 --width 900            # points | option A | option B
omq frame "Point" --in GRID --auto        # then one cell per point and option, row by row
```

or, for a few rows, a `markdown` card with a table. Pros / cons: two columns (green: for, red: against), one keyword per line, and the conclusion under both. The winner of each row: `pen circle` on it.
