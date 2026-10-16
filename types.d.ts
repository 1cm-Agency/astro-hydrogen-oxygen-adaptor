// Injected into `.astro/` by the adapter so `Astro.locals` is typed in every project.
declare namespace App {
  type HydrogenLocals = import('astro-hydrogen/config').HydrogenLocals;
  interface Locals extends HydrogenLocals {}
}
