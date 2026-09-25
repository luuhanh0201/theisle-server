/**
 * The AI the AIZones mod can spawn: a pawn class and the AI controller that
 * drives it. Every pair here was verified live ("spawned, possessed, the AI
 * brain actually pathfinds the pawn") by the evrima-dev-knowledge AI Spawn
 * Pair catalog, 2026-05-22 — https://github.com/diplomatic-tendencies/evrima-dev-knowledge
 * (EVRIMA_AI_Spawn_Pairs.md; code and data MIT, prose CC BY 4.0). Species
 * with no controller of their own borrow a similar one, as the catalog does
 * (a Triceratops with the Diabloceratops brain flees a Rex correctly).
 *
 * Left out: fish (their AI needs water at the spawn spot), Kentrosaurus and
 * Parasaurolophus (not re-verified since 0.21.720).
 *
 * `lift`: cm above a ground point where the pawn is placed, so a big body
 * does not start inside a slope (it falls the rest of the way).
 */

export interface AiSpecies {
  key: string;
  label: string;
  kind: 'animal' | 'dino';
  /** Short class name, as the mod reads it off a live pawn ("BP_Boar_C"). */
  cls: string;
  pawn: string;
  ctrl: string;
  lift: number;
}

const ANIMALS = '/Game/TheIsle/Core/Characters/Animals';
const DINOS = '/Game/TheIsle/Core/Characters/Dinosaurs';
const BP_DINO_AI = '/Game/TheIsle/Core/AI/Controllers/Dinos';
const BP_ANIMAL_AI = '/Game/TheIsle/Core/AI/Controllers/Animals';
const bp = (dir: string, name: string): string => `${dir}/${name}.${name}_C`;
const dino = (folder: string, name: string): string => bp(`${DINOS}/${folder}`, name);

export const AI_SPECIES: readonly AiSpecies[] = [
  // --- animals
  { key: 'Boar', label: 'Heo rừng', kind: 'animal', cls: 'BP_Boar_C', pawn: bp(`${ANIMALS}/Boar`, 'BP_Boar'), ctrl: '/Script/TheIsle.TIAIBoarController', lift: 100 },
  { key: 'Deer', label: 'Hươu', kind: 'animal', cls: 'BP_Deer_C', pawn: bp(`${ANIMALS}/Deer`, 'BP_Deer'), ctrl: bp(BP_ANIMAL_AI, 'BP_AI_Deer_Controller'), lift: 100 },
  { key: 'Goat', label: 'Dê', kind: 'animal', cls: 'BP_Goat_C', pawn: `${ANIMALS}/Goat/BP_goat.BP_Goat_C`, ctrl: '/Script/TheIsle.TIAIGoatController', lift: 100 },
  { key: 'Rabbit', label: 'Thỏ', kind: 'animal', cls: 'BP_Rabbit_C', pawn: bp(`${ANIMALS}/Rabbit`, 'BP_Rabbit'), ctrl: '/Script/TheIsle.TIAIRabbitController', lift: 60 },
  { key: 'Chicken', label: 'Gà', kind: 'animal', cls: 'BP_Chicken_C', pawn: bp(`${ANIMALS}/Chicken`, 'BP_Chicken'), ctrl: '/Script/TheIsle.TIAIChickenController', lift: 60 },
  { key: 'Crab', label: 'Cua', kind: 'animal', cls: 'BP_Crab_C', pawn: bp(`${ANIMALS}/Crab`, 'BP_Crab'), ctrl: '/Script/TheIsle.TIAICrabController', lift: 60 },
  { key: 'Bullfrog', label: 'Ếch', kind: 'animal', cls: 'BP_Bullfrog_C', pawn: bp(`${ANIMALS}/Bullfrog`, 'BP_Bullfrog'), ctrl: '/Script/TheIsle.TIAIFrogController', lift: 60 },
  { key: 'Seaturtle', label: 'Rùa biển', kind: 'animal', cls: 'BP_Seaturtle_C', pawn: bp(`${ANIMALS}/Seaturtle`, 'BP_Seaturtle'), ctrl: '/Script/TheIsle.TIAISeaturtleController', lift: 80 },
  // --- small AI dinos (the game's own ambient kinds)
  { key: 'Compsognathus', label: 'Compsognathus', kind: 'dino', cls: 'BP_Compsognathus_C', pawn: dino('Compsognathus', 'BP_Compsognathus'), ctrl: bp(BP_DINO_AI, 'BP_AI_Compsognathus_Controller'), lift: 80 },
  { key: 'Psittacosaurus', label: 'Psittacosaurus (đồng bằng)', kind: 'dino', cls: 'BP_Psittacosaurus_Plains_C', pawn: dino('Psittacosaurus', 'BP_Psittacosaurus_Plains'), ctrl: bp(BP_DINO_AI, 'BP_AI_Psittacosaurus_Controller'), lift: 100 },
  { key: 'PsittacosaurusHighlands', label: 'Psittacosaurus (cao nguyên)', kind: 'dino', cls: 'BP_Psittacosaurus_Highlands_C', pawn: dino('Psittacosaurus', 'BP_Psittacosaurus_Highlands'), ctrl: bp(BP_DINO_AI, 'BP_AI_Psittacosaurus_Controller'), lift: 100 },
  { key: 'PsittacosaurusCoastal', label: 'Psittacosaurus (ven biển)', kind: 'dino', cls: 'BP_Psittacosaurus_Coastal_C', pawn: dino('Psittacosaurus', 'BP_Psittacosaurus_Coastal'), ctrl: '/Script/TheIsle.TIAIPsittacosaurusController', lift: 100 },
  { key: 'Pterodactylus', label: 'Pterodactylus', kind: 'dino', cls: 'BP_Pterodactylus_C', pawn: dino('Pterodactylus', 'BP_Pterodactylus'), ctrl: bp(BP_DINO_AI, 'BP_AI_Pterodactylus_Controller'), lift: 100 },
  // --- playable dinos, as AI
  { key: 'Hypsilophodon', label: 'Hypsilophodon', kind: 'dino', cls: 'BP_Hypsilophodon_C', pawn: dino('Hypsilophodon', 'BP_Hypsilophodon'), ctrl: '/Script/TheIsle.TIAIHypsilophodon', lift: 100 },
  { key: 'Dryosaurus', label: 'Dryosaurus', kind: 'dino', cls: 'BP_Dryosaurus_C', pawn: dino('Dryosaurus', 'BP_Dryosaurus'), ctrl: '/Script/TheIsle.TIAIDryosaurusController', lift: 150 },
  { key: 'Gallimimus', label: 'Gallimimus', kind: 'dino', cls: 'BP_Gallimimus_C', pawn: dino('Gallimimus', 'BP_Gallimimus'), ctrl: '/Script/TheIsle.TIAIGallimimusController', lift: 200 },
  { key: 'Tenontosaurus', label: 'Tenontosaurus', kind: 'dino', cls: 'BP_Tenontosaurus_C', pawn: dino('Tenontosaurus', 'BP_Tenontosaurus'), ctrl: '/Script/TheIsle.TIAITenontosaurusController', lift: 250 },
  { key: 'Maiasaura', label: 'Maiasaura', kind: 'dino', cls: 'BP_Maiasaura_C', pawn: dino('Maiasaura', 'BP_Maiasaura'), ctrl: '/Script/TheIsle.TIAITenontosaurusController', lift: 300 },
  { key: 'Pachycephalosaurus', label: 'Pachycephalosaurus', kind: 'dino', cls: 'BP_Pachycephalosaurus_C', pawn: dino('Pachycephalosaurus', 'BP_Pachycephalosaurus'), ctrl: bp(BP_DINO_AI, 'BP_AI_Diabloceratops_Controller'), lift: 200 },
  { key: 'Diabloceratops', label: 'Diabloceratops', kind: 'dino', cls: 'BP_Diabloceratops_C', pawn: dino('Diabloceratops', 'BP_Diabloceratops'), ctrl: '/Script/TheIsle.TIAIDiabloceratopsController', lift: 250 },
  { key: 'Triceratops', label: 'Triceratops', kind: 'dino', cls: 'BP_Triceratops_C', pawn: dino('Triceratops', 'BP_Triceratops'), ctrl: bp(BP_DINO_AI, 'BP_AI_Diabloceratops_Controller'), lift: 350 },
  { key: 'Stegosaurus', label: 'Stegosaurus', kind: 'dino', cls: 'BP_Stegosaurus_C', pawn: dino('Stegosaurus', 'BP_Stegosaurus'), ctrl: bp(BP_DINO_AI, 'BP_AI_Diabloceratops_Controller'), lift: 350 },
  { key: 'Beipiaosaurus', label: 'Beipiaosaurus', kind: 'dino', cls: 'BP_Beipiaosaurus_C', pawn: dino('Beipiaosaurus', 'BP_Beipiaosaurus'), ctrl: bp(BP_DINO_AI, 'BP_AI_Compsognathus_Controller'), lift: 100 },
  { key: 'Troodon', label: 'Troodon', kind: 'dino', cls: 'BP_Troodon_C', pawn: dino('Troodon', 'BP_Troodon'), ctrl: bp(BP_DINO_AI, 'BP_AI_Compsognathus_Controller'), lift: 100 },
  { key: 'Herrerasaurus', label: 'Herrerasaurus', kind: 'dino', cls: 'BP_Herrerasaurus_C', pawn: dino('Herrerasaurus', 'BP_Herrerasaurus'), ctrl: '/Script/TheIsle.TIAIOmniraptor', lift: 150 },
  { key: 'Omniraptor', label: 'Omniraptor', kind: 'dino', cls: 'BP_Omniraptor_C', pawn: dino('Omniraptor', 'BP_Omniraptor'), ctrl: '/Script/TheIsle.TIAIOmniraptor', lift: 150 },
  { key: 'Dilophosaurus', label: 'Dilophosaurus', kind: 'dino', cls: 'BP_Dilophosaurus_C', pawn: dino('Dilophosaurus', 'BP_Dilophosaurus'), ctrl: '/Script/TheIsle.TIAIDilophosaurusController', lift: 200 },
  { key: 'Ceratosaurus', label: 'Ceratosaurus', kind: 'dino', cls: 'BP_Ceratosaurus_C', pawn: dino('Ceratosaurus', 'BP_Ceratosaurus'), ctrl: '/Script/TheIsle.TIAICeratosaurusController', lift: 250 },
  { key: 'Carnotaurus', label: 'Carnotaurus', kind: 'dino', cls: 'BP_Carnotaurus_C', pawn: dino('Carnotaurus', 'BP_Carnotaurus'), ctrl: '/Script/TheIsle.TIAICarnotaurus', lift: 300 },
  { key: 'Allosaurus', label: 'Allosaurus', kind: 'dino', cls: 'BP_Allosaurus_C', pawn: dino('Allosaurus', 'BP_Allosaurus'), ctrl: '/Script/TheIsle.TIAIRexController', lift: 350 },
  { key: 'Tyrannosaurus', label: 'Tyrannosaurus', kind: 'dino', cls: 'BP_Tyrannosaurus_C', pawn: dino('Tyrannosaurus', 'BP_Tyrannosaurus'), ctrl: '/Script/TheIsle.TIAIRexController', lift: 400 },
  { key: 'Deinosuchus', label: 'Deinosuchus', kind: 'dino', cls: 'BP_Deinosuchus_C', pawn: dino('Deinosuchus', 'BP_Deinosuchus'), ctrl: '/Script/TheIsle.TIAIDeinosuchus', lift: 150 },
  { key: 'Pteranodon', label: 'Pteranodon', kind: 'dino', cls: 'BP_Pteranodon_C', pawn: dino('Pteranodon', 'BP_Pteranodon'), ctrl: '/Script/TheIsle.TIAIPteranodon', lift: 150 },
];

export const AI_BY_KEY: ReadonlyMap<string, AiSpecies> = new Map(AI_SPECIES.map((s) => [s.key, s]));
