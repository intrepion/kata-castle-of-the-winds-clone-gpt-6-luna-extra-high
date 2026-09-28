# The Windglass Keep

A small, self-contained browser dungeon crawler inspired by classic turn-based tile RPGs. Explore four hand-shaped-by-procedure floors, fight monsters one turn at a time, learn spells, manage equipment and carrying weight, and take on the Gale Warden. The setting, writing, and graphics are original.

## Play

Open `index.html` in a modern browser. For a local web server, run:

```sh
python3 -m http.server 8000
```

Then visit <http://localhost:8000>.

Choose a Sentinel, Arcanist, or Wayfarer to begin. Progress saves automatically in the current browser.

## Controls

- Arrow keys or WASD: move one tile
- Click a visible tile: walk there, one turn at a time
- 1: Frost Dart · 2: Mend · 3: Storm Lash · 4: Wind Ward
- G: gather items at your feet
- E: descend when standing on the stairway
- I: focus the satchel
- Esc: pause

Everything runs locally in the browser; the game has no build step or runtime dependencies.
