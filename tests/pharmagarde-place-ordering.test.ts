import { describe, expect, it } from "vitest";

import { sortPlacesByOpenThenDistance } from "../lib/pharmagarde/place-ordering";
import { HealthPlace } from "../lib/pharmagarde/types";

function place(id: string, name: string, isOpen: boolean | undefined, distanceKm: number | undefined): HealthPlace {
  return {
    id,
    type: "pharmacy",
    name,
    city: "Ouagadougou",
    isOpen,
    distanceKm,
  };
}

describe("tri des établissements PharmaGarde", () => {
  it("affiche les établissements ouverts avant les autres, puis du plus proche au plus loin", () => {
    const sorted = sortPlacesByOpenThenDistance([
      place("closed-near", "Pharmacie fermée proche", false, 0.3),
      place("unknown-near", "Clinique statut inconnu proche", undefined, 0.2),
      place("open-far", "Pharmacie ouverte loin", true, 3.4),
      place("open-near", "Clinique ouverte proche", true, 0.8),
      place("closed-far", "Clinique fermée loin", false, 5.2),
    ]);

    expect(sorted.map((item) => item.id)).toEqual([
      "open-near",
      "open-far",
      "unknown-near",
      "closed-near",
      "closed-far",
    ]);
  });

  it("place les établissements sans distance à la fin de leur groupe et stabilise par nom", () => {
    const sorted = sortPlacesByOpenThenDistance([
      place("open-no-distance-z", "Z Santé", true, undefined),
      place("open-distance", "A Santé", true, 1.5),
      place("open-no-distance-a", "Aide Santé", true, undefined),
      place("closed-distance", "Centre fermé", false, 0.4),
    ]);

    expect(sorted.map((item) => item.id)).toEqual([
      "open-distance",
      "open-no-distance-a",
      "open-no-distance-z",
      "closed-distance",
    ]);
  });
});
