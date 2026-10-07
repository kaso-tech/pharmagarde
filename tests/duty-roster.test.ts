import { describe, expect, it } from "vitest";

import { DUTY_ROTATIONS, dutyStatusAt, dutyWeekAt, findDutyRotation, type DutyRotation } from "../server/duty-roster";
import { sortInServiceFirst, withDutyStatus, withServiceStatus, type CachedHealthPlace } from "../server/pharmagarde-cache";
import { DEFAULT_WEEKLY_HOURS } from "../lib/pharmagarde/opening-hours";
import { placeStatusLabel, resolvePlaceStatus, sortPlacesByOpenThenDistance } from "../lib/pharmagarde/place-ordering";

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

  it("applique les groupes communiqués pour la semaine du 3 au 10 octobre 2026 dans les autres villes", () => {
    const base = new Date("2026-10-06T12:00:00Z");
    const next = new Date("2026-10-13T12:00:00Z");
    const expected: Record<string, [number, number, number]> = {
      // ville : [nombre de groupes, groupe de garde du 3 au 10 octobre, groupe de la semaine suivante]
      Kaya: [2, 2, 1],
      Tenkodogo: [2, 1, 2],
      Koudougou: [3, 3, 1],
      Ouahigouya: [2, 1, 2],
      Banfora: [3, 3, 1],
    };
    for (const [city, [count, current, following]] of Object.entries(expected)) {
      const rotation = findDutyRotation(city)!;
      expect(rotation.turns).toHaveLength(count);
      expect(dutyWeekAt(rotation, base).turn.dutyGroup).toBe(current);
      expect(dutyWeekAt(rotation, next).turn.dutyGroup).toBe(following);
    }
    expect(dutyStatusAt({ id: "ph-kaya-salus-mater", city: "Kaya", dutyGroup: 2 }, base)?.onDuty).toBe(true);
    for (const city of ["Dédougou", "Dori", "Fada N'gourma", "Gaoua", "Ziniaré"]) expect(findDutyRotation(city)).toBeUndefined();
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
    expect(dutyStatusAt({ id: "ph-x", city: "Dori", dutyGroup: 1 }, at)).toBeNull();
  });
});

describe("publication du statut de garde", () => {
  const at = new Date("2026-10-06T12:00:00Z");
  const items: CachedHealthPlace[] = [
    { id: "g2-proche", type: "Pharmacie", category: "pharmacy", name: "Proche", city: "Ouagadougou", dutyGroup: 2 },
    { id: "g4-loin", type: "Pharmacie", category: "pharmacy", name: "Loin", city: "Ouagadougou", dutyGroup: 4 },
    { id: "dori", type: "Pharmacie", category: "pharmacy", name: "Dori", city: "Dori", dutyGroup: 4 },
  ];

  it("marque les pharmacies de garde, sans toucher aux villes non programmées", () => {
    const published = withDutyStatus(items, at);
    expect(published.map((item) => [item.id, item.onDuty])).toEqual([
      ["g2-proche", false],
      ["g4-loin", true],
      ["dori", undefined],
    ]);
    expect(published[1]).toMatchObject({ dutyStart: "2026-10-03T08:00:00.000Z", dutyEnd: "2026-10-10T08:00:00.000Z" });
  });

  it("place devant la pharmacie en service la plus proche, de garde ou non", () => {
    // Mardi midi : tout est ouvert, l’ordre par distance est conservé.
    const daytime = sortInServiceFirst(withServiceStatus(items, at, () => DEFAULT_WEEKLY_HOURS));
    expect(daytime.map((item) => item.id)).toEqual(["g2-proche", "g4-loin", "dori"]);
    // Mardi 23 h : seule la pharmacie de garde est en service.
    const night = sortInServiceFirst(withServiceStatus(items, new Date("2026-10-06T23:00:00Z"), () => DEFAULT_WEEKLY_HOURS));
    expect(night.map((item) => [item.id, item.status])).toEqual([["g4-loin", "on_duty"], ["g2-proche", "closed"], ["dori", "closed"]]);
  });

  it("affiche « Garde » dans l'application et trie la plus proche en service en premier", () => {
    expect(placeStatusLabel({ onDuty: true, isOpen: false })).toBe("Garde");
    expect(placeStatusLabel({ isOpen: true })).toBe("Ouvert");
    const sorted = sortPlacesByOpenThenDistance([
      { id: "fermee", type: "pharmacy", name: "Fermée", isOpen: false, distanceKm: 0.1 },
      { id: "garde", type: "pharmacy", name: "Garde", onDuty: true, distanceKm: 4 },
      { id: "ouvert", type: "pharmacy", name: "Ouverte", isOpen: true, distanceKm: 0.2 },
    ]);
    expect(sorted.map((place) => place.id)).toEqual(["ouvert", "garde", "fermee"]);
  });

  it("recalcule le statut sur le téléphone à partir des horaires et de la fin de garde reçus", () => {
    const fromCache = { id: "p", type: "pharmacy" as const, name: "P", onDuty: true, isOpen: true, dutyStart: "2026-10-03T08:00:00.000Z", dutyEnd: "2026-10-10T08:00:00.000Z", serviceHours: DEFAULT_WEEKLY_HOURS };
    expect(resolvePlaceStatus(fromCache, new Date("2026-10-09T23:00:00Z"))).toMatchObject({ onDuty: true, isOpen: true });
    // Garde terminée samedi 10 octobre à 8 h : ouverte selon ses horaires jusqu'à midi, fermée ensuite.
    expect(resolvePlaceStatus(fromCache, new Date("2026-10-10T09:00:00Z"))).toMatchObject({ onDuty: false, isOpen: true });
    expect(resolvePlaceStatus(fromCache, new Date("2026-10-10T13:00:00Z"))).toMatchObject({ onDuty: false, isOpen: false });
  });
});
