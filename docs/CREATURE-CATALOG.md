# Creature catalog

Each catalog record is ready to place without setup: name, family/type, size, average HP, hit dice, armor class, challenge rating, and walk/fly/swim/climb/burrow speeds. Placing a creature initializes current and maximum HP to its average HP.

Metadata for standard creatures is derived from the open D&D System Reference Document. All creature artwork in this project is newly generated for this catalog and must not reproduce published monster illustrations.

This work includes material from the System Reference Document 5.1/5.2 by Wizards of the Coast LLC, available under the [Creative Commons Attribution 4.0 International License](https://creativecommons.org/licenses/by/4.0/legalcode).

Production imports use `scripts/import-creature-batch.mjs`, one to ten creatures per manifest. `CATALOG_IMPORT_TOKEN` is a Sites secret and must never be written to the repository.
