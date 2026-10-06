import { describe, expect, it } from "vitest";

import { DUTY_ROTATIONS, dutyStatusAt, dutyWeekAt, findDutyRotation, type DutyRotation } from "../server/duty-roster";
import { sortOnDutyFirst, withDutyStatus, type CachedHealthPlace } from "../server/pharmagarde-cache";
import { placeStatusLabel, sortPlacesByOpenThenDistance } from "../lib/pharmagarde/place-ordering";

const ouaga = findDutyRotation("Ouagadougou")!;
const bobo = findDutyRotation("bobo dioulasso")!;

describe("programmation des gardes", () => {
  it("part de la base communiquée : groupe 4 du samedi 3 au samedi 10 octobre 2026, 8 h", () => {
    for (const rotation of [ouaga, bobo]) {
      const week = dutyWeekAt(rotation, new Date("2026-10-06T12:00:00Z"));
      expect(week.turn.dutyGroup).toBe(4);
      expect(week.start.toISOString()).toBe("2026-10-03T08:00:00.000Z");
      expect(week.end.toISOString()).toBe("2026-10-10T08:00:00.000Z");
    }
  });

  it("change de groupe le samedi à 8 h précises, dans l'ordre 1 → 2 → 3 → 4", () => {
    expect(dutyWeekAt(ouaga, new Date("2026-10-10T07:59:59Z")).turn.dutyGroup).toBe(4);
    expect(dutyWeekAt(ouaga, new Date("2026-10-10T08:00:00Z")).turn.dutyGroup).toBe(1);
    expect(dutyWeekAt(ouaga, new Date("2026-10-17T08:00:00Z")).turn.dutyGroup).toBe(2);
    expect(dutyWeekAt(ouaga, new Date("2026-10-06T12:00:00Z"), 3).turn.dutyGroup).toBe(3);
  });

  it("retrouve le programme 2026 publié par l'Ordre pour Ouagadougou, y compris avant la base", () => {
    // Programme ONPBF : 03/01/2026 → groupe 1, 26/09/2026 → groupe 3, 19/12/2026 → groupe 3.
    expect(dutyWeekAt(ouaga, new Date("2026-01-05T10:00:00Z")).turn.dutyGroup).toBe(1);
    expect(dutyWeekAt(ouaga, new Date("2026-09-30T10:00:00Z")).turn.dutyGroup).toBe(3);
    expect(dutyWeekAt(ouaga, new Date("2026-12-20T10:00:00Z")).turn.dutyGroup).toBe(3);
  });

  it("commence chaque rotation un samedi", () => {
    for (const rotation of DUTY_ROTATIONS) {
      expect(new Date(`${rotation.reference.start}T00:00:00Z`).getUTCDay()).toBe(6);
    }
  });

  it("gère les villes à listes de pharmacies et les villes sans programmation", () => {
    const koudougou: DutyRotation = {
      city: "Koudougou",
      reference: { start: "2026-10-03", turnIndex: 0 },
      turns: [{ label: "Liste A", pharmacyIds: ["ph-a"] }, { label: "Liste B", pharmacyIds: ["ph-b"] }],
    };
    const at = new Date("2026-10-12T10:00:00Z");
    expect(dutyStatusAt({ id: "ph-b", city: "Koudougou" }, at, [koudougou])?.onDuty).toBe(true);
    expect(dutyStatusAt({ id: "ph-a", city: "Koudougou" }, at, [koudougou])?.onDuty).toBe(false);
    expect(dutyStatusAt({ id: "ph-x", city: "Kaya", dutyGroup: 4 }, at)).toBeNull();
  });
});

describe("publication du statut de garde", () => {
  const at = new Date("2026-10-06T12:00:00Z");
  const items: CachedHealthPlace[] = [
    { id: "g2-proche", type: "Pharmacie", category: "pharmacy", name: "Proche", city: "Ouagadougou", dutyGroup: 2 },
    { id: "g4-loin", type: "Pharmacie", category: "pharmacy", name: "Loin", city: "Ouagadougou", dutyGroup: 4 },
    { id: "kaya", type: "Pharmacie", category: "pharmacy", name: "Kaya", city: "Kaya", dutyGroup: 4 },
  ];

  it("marque les pharmacies de garde et les place devant, sans toucher aux villes non programmées", () => {
    const published = sortOnDutyFirst(withDutyStatus(items, at));
    expect(published.map((item) => [item.id, item.onDuty])).toEqual([
      ["g4-loin", true],
      ["g2-proche", false],
      ["kaya", undefined],
    ]);
    expect(published[0]).toMatchObject({ dutyStart: "2026-10-03T08:00:00.000Z", dutyEnd: "2026-10-10T08:00:00.000Z" });
  });

  it("affiche « De garde » dans l'application et trie la garde en premier", () => {
    expect(placeStatusLabel({ onDuty: true, isOpen: false })).toBe("De garde");
    expect(placeStatusLabel({ isOpen: true })).toBe("Ouvert");
    const sorted = sortPlacesByOpenThenDistance([
      { id: "ouvert", type: "pharmacy", name: "Ouverte", isOpen: true, distanceKm: 0.2 },
      { id: "garde", type: "pharmacy", name: "De garde", onDuty: true, distanceKm: 4 },
    ]);
    expect(sorted.map((place) => place.id)).toEqual(["garde", "ouvert"]);
  });
});
