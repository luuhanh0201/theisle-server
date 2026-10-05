/**
 * Each species' maxima at each growth as the game gives them to a fresh dino
 * whose growth is SET (SetGrowth), measured by SpeciesLab on the test server,
 * 2026-10-01 (mods/SpeciesLab). That is exactly how the garage restores a dino,
 * so these are what an admin-made dino comes out with; the readings of players'
 * dinos (species-stats.ts) can sit higher (mutations, prime, time).
 *
 * Per point: [growth, health, stamina, thirst]. Blood equals health on every
 * species. The stomach is not here: SetGrowth leaves it at the hatchling's
 * until a relog, so it is health x `stomach` (0.33 meat eaters, 0.5 plant
 * eaters, the ratio every live reading shows). Oxygen is left out: one
 * species read odd values (Allosaurus 400 then 1 above 90 percent).
 * Re-measure after a game update (turn SpeciesLab on in the test copy).
 */
import type { Maxima, SpeciesStatsView } from './species-stats.js';

export const SPECIES_LAB_MEASURED = '2026-10-01';

interface LabSpecies { stomach: number; points: ReadonlyArray<readonly [number, number, number, number]> }

const LAB: Readonly<Record<string, LabSpecies>> = {
  BP_Allosaurus_C: { stomach: 0.33, points: [[0.25, 48, 100, 1000], [0.4, 186.12, 370, 1000], [0.5, 1050, 550, 1000], [0.6, 1611.95, 730.0, 1000], [0.75, 2593, 1000, 1000], [0.9, 2593, 1000, 1000], [1, 2593.0, 1000, 1000]] },
  BP_Austroraptor_C: { stomach: 0.33, points: [[0.25, 12, 100, 1000], [0.4, 76.8, 370, 1000], [0.5, 120, 550, 1000], [0.6, 168.0, 730.0, 1000], [0.75, 240, 1000, 1000], [0.9, 240.0, 1000, 1000], [1, 240.0, 1000, 1000]] },
  BP_Beipiaosaurus_C: { stomach: 0.5, points: [[0.25, 2.43, 100, 1000], [0.4, 27, 370, 1000], [0.5, 45, 550, 1000], [0.6, 63.0, 730.0, 1000], [0.75, 90, 1000, 1000], [0.9, 90, 1000, 1000], [1, 90, 1000, 1000]] },
  BP_Carnotaurus_C: { stomach: 0.33, points: [[0.25, 32, 100, 1000], [0.4, 416, 370, 1000], [0.5, 700, 550, 1000], [0.6, 940.0, 730.0, 1000], [0.75, 1300, 1000, 1000], [0.9, 1300.0, 1000, 1000], [1, 1300.0, 1000, 1000]] },
  BP_Ceratosaurus_C: { stomach: 0.33, points: [[0.25, 35.1, 100, 1000], [0.4, 380, 370, 1000], [0.5, 600, 550, 1000], [0.6, 900.0, 730.0, 1000], [0.75, 1450, 1000, 1000], [0.9, 1450, 1000, 1000], [1, 1450, 1000, 1000]] },
  BP_Deinosuchus_C: { stomach: 0.33, points: [[0.25, 12, 100, 1000], [0.4, 195, 370, 1000], [0.5, 550, 550, 1000], [0.6, 1934.0, 730.0, 1000], [0.75, 8000, 1000, 1000], [0.9, 8900.0, 1000, 1000], [1, 9500.0, 1000, 1000]] },
  BP_Diabloceratops_C: { stomach: 0.5, points: [[0.25, 81, 100, 1000], [0.4, 900, 370, 1000], [0.5, 1500, 550, 1000], [0.6, 2100, 730.0, 1000], [0.75, 3000, 1000, 1000], [0.9, 3000, 1000, 1000], [1, 3000, 1000, 1000]] },
  BP_Dilophosaurus_C: { stomach: 0.33, points: [[0.25, 20.03, 100, 1000], [0.4, 210, 340, 1000], [0.5, 350, 500, 1000], [0.6, 490.0, 700.0, 1000], [0.75, 700, 1000, 1000], [0.9, 700.0, 1000, 1000], [1, 700.0, 1000, 1000]] },
  BP_Dryosaurus_C: { stomach: 0.5, points: [[0.25, 6.86, 100, 1000], [0.4, 39, 370, 1000], [0.5, 65, 550, 1000], [0.6, 91.0, 730.0, 1000], [0.75, 130, 1000, 1000], [0.9, 130.0, 1000, 1000], [1, 130.0, 1000, 1000]] },
  BP_Gallimimus_C: { stomach: 0.5, points: [[0.25, 11.48, 100, 1000], [0.4, 127.5, 370, 1000], [0.5, 212.5, 550, 1000], [0.6, 297.5, 730.0, 1000], [0.75, 535, 1000, 1000], [0.9, 535.0, 1000, 1000], [1, 535.0, 1000, 1000]] },
  BP_Herrerasaurus_C: { stomach: 0.33, points: [[0.25, 4.73, 100, 1000], [0.4, 55.81, 370, 1000], [0.5, 89.87, 550, 1000], [0.6, 123.92, 730.0, 1000], [0.75, 175, 1000, 1000], [0.9, 175, 1000, 1000], [1, 175, 1000, 1000]] },
  BP_Hypsilophodon_C: { stomach: 0.5, points: [[0.25, 0.5, 100, 1000], [0.4, 6, 370, 1000], [0.5, 10, 550, 1000], [0.6, 14.0, 730.0, 1000], [0.75, 20, 1000, 1000], [0.9, 20.0, 1000, 1000], [1, 20.0, 1000, 1000]] },
  BP_Kentrosaurus_C: { stomach: 0.5, points: [[0.25, 38, 100, 1000], [0.4, 106.97, 370, 1000], [0.5, 1000, 550, 1000], [0.6, 1631.09, 730.0, 1000], [0.75, 1950, 1000, 1000], [0.9, 1950.0, 1000.0, 1000], [1, 1950.0, 1000, 1000]] },
  BP_Maiasaura_C: { stomach: 0.5, points: [[0.25, 83, 100, 1000], [0.4, 1165.5, 370, 1000], [0.5, 1875, 550, 1000], [0.6, 2625.0, 730.0, 1000], [0.75, 3750, 1000, 1000], [0.9, 3750.0, 1000, 1000], [1, 3750.0, 1000, 1000]] },
  BP_Omniraptor_C: { stomach: 0.33, points: [[0.25, 12.15, 100, 1000], [0.4, 135, 370, 1000], [0.5, 225, 550, 1000], [0.6, 315.0, 730.0, 1000], [0.75, 395, 1000, 1000], [0.9, 395.0, 1000.0, 1000], [1, 395.0, 1000, 1000]] },
  BP_Pachycephalosaurus_C: { stomach: 0.5, points: [[0.25, 13.5, 100, 1000], [0.4, 180.0, 423.97, 1000], [0.5, 400, 639.96, 1000], [0.6, 520, 855.94, 1000], [0.75, 700, 1000, 1000], [0.9, 700.0, 1000, 1000], [1, 700.0, 1000, 1000]] },
  BP_Pteranodon_C: { stomach: 0.33, points: [[0.25, 1.22, 100, 1000], [0.4, 16, 370, 1000], [0.5, 35, 550, 1000], [0.6, 57.0, 730.0, 1000], [0.75, 90, 1000, 1000], [0.9, 90.0, 1000, 1000], [1, 90.0, 1000, 1000]] },
  BP_Stegosaurus_C: { stomach: 0.5, points: [[0.25, 125, 100, 1000], [0.4, 1600, 370, 1000], [0.5, 2800, 550, 1000], [0.6, 4160.0, 730.0, 1000], [0.75, 6000, 1000, 1000], [0.9, 6000.0, 1000, 1000], [1, 6000.0, 1000, 1000]] },
  BP_Tenontosaurus_C: { stomach: 0.5, points: [[0.25, 43.2, 100, 1000], [0.4, 480, 370, 1000], [0.5, 800, 550, 1000], [0.6, 1120, 730.0, 1000], [0.75, 1600, 1000, 1000], [0.9, 1600, 1000, 1000], [1, 1600, 1000, 1000]] },
  BP_Triceratops_C: { stomach: 0.5, points: [[0.25, 85, 100, 1000], [0.4, 850, 370, 1000], [0.5, 3500, 550, 1000], [0.6, 5833.33, 730.0, 1000], [0.75, 9500, 1000, 1000], [0.9, 9500.0, 1000, 1000], [1, 9500.0, 1000, 1000]] },
  BP_Troodon_C: { stomach: 0.33, points: [[0.25, 1.62, 100, 1000], [0.4, 18, 370, 1000], [0.5, 30, 550, 1000], [0.6, 42.0, 730.0, 1000], [0.75, 60, 1000, 1000], [0.9, 60.0, 1000, 1000], [1, 60.0, 1000, 1000]] },
  BP_Tyrannosaurus_C: { stomach: 0.33, points: [[0.25, 50, 325, 1000], [0.4, 520, 460, 1000], [0.5, 2800, 550, 1000], [0.6, 5016.5, 640, 1000], [0.75, 9350, 775, 1000], [0.9, 9350, 910, 1000], [1, 9350, 1000, 1000]] },
};

/** The lab's points for a species, in the shape of the live readings (or null). */
export function labPoints(species: string): SpeciesStatsView['points'] | null {
  const s = LAB[species];
  if (s === undefined) return null;
  return s.points.map(([growth, health, stamina, thirst]) => {
    const max: Maxima = { health, blood: health, stamina, thirst, hunger: Math.round(health * s.stomach * 100) / 100 };
    return { growth, max, t: 0 };
  });
}
