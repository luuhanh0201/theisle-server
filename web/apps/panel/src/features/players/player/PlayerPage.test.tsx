import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { parseCoords, toGame } from '../../../lib/map';
import { fakeApi } from '../../../test/fakeBridge';
import { livesMatch, type Life } from './Lives';
import { sharesOf } from './PlayerAdmin';
import { PlayerPage, type PlayerDetail } from './PlayerPage';

const ID = '76561198000000011';
const life = (p: Partial<Life>): Life => ({
  species: 'BP_Tyrannosaurus_C', spawnedAt: 1_791_000_000, lastAt: 1_791_000_600, endedAt: null, end: null, growthStart: 0.5, growth: 0.6,
  kills: 1, damageDealt: 350, damageTaken: 0, killer: null, killerName: null, killerSpecies: null, redeemedFrom: null, elderStacks: null, ...p,
});
const detail = (online: boolean): PlayerDetail => ({
  steamId: ID,
  player: {
    steamId: ID, name: 'Rex Tester', online, species: 'BP_Tyrannosaurus_C', growth: 0.6, health: 500, stamina: 50, hunger: 20, thirst: 40, oxygen: 100, blood: 100,
    max: { health: 1000, stamina: 100, hunger: 40, thirst: 80, oxygen: 100, blood: 100 }, lastSeen: 1_791_000_600, loc: null,
    kills: 1, deaths: 0, damageDealt: 350, damageTaken: 0, hits: 1, playtime: 200, sessions: 1, spawns: 1, longestLife: 0, longestLifeSpecies: null,
    longestLifeAlive: true, biggestKill: { species: 'BP_Carnotaurus_C', growth: 0.8 }, stored: 0, redeemed: 0, chats: 1, prime: null,
  },
  timeline: [], lives: [life({}), life({ spawnedAt: 1_790_000_000, end: 'death', endedAt: 1_790_000_500, species: 'BP_Carnotaurus_C' })],
  garage: [{ slot: 'a', meta: { classPath: '/Game/X/BP_Tyrannosaurus.BP_Tyrannosaurus_C', growth: 0.7, capturedAt: 1_791_000_000 }, state: null }],
});
const lives = { lives: [{ spawnedAt: 1_790_000_000, species: 'BP_Carnotaurus_C', classPath: '/Game/X/BP_Carnotaurus.BP_Carnotaurus_C', growth: 0.8, end: 'death', restoredTo: null, prime: { done: 6, code: '1111110000', prime: true } }] };
afterEach(() => vi.unstubAllGlobals());

test('coordinates as the game shows them, the vitals as shares, the lives filters', () => {
  expect(parseCoords('349,211, 148,696')).toEqual([349.211, 148.696]);
  expect(parseCoords('349211 148696')).toEqual([349.211, 148.696]);
  expect(parseCoords('abc')).toBeNull();
  expect(toGame([349.211, 148.696])).toEqual([148696, 349211]);
  const sh = sharesOf(detail(true).player!);
  expect(sh['health']).toBe(50);
  expect(sh['hunger']).toBe(50);
  expect(sh['carb']).toBeNull();
  expect(livesMatch(life({}), undefined, { date: '', species: 'BP_Carnotaurus_C', prime: 'all' })).toBe(false);
  expect(livesMatch(life({ elderStacks: 2 }), undefined, { date: '', species: 'all', prime: 'prime' })).toBe(true);
  expect(livesMatch(life({}), undefined, { date: '', species: 'all', prime: 'prime' })).toBe(false);
});

test('a player not seen: said so', async () => {
  const { show } = fakeApi({});
  show(<PlayerPage id={ID} />);
  expect(await screen.findByText('Chưa thấy người chơi này')).toBeInTheDocument();
});

test('online: kill with a reason, heal, vitals, growth and prime, teleport', async () => {
  const { calls, show } = fakeApi({
    [`GET /api/player/${ID}`]: detail(true), [`GET /api/lives/${ID}`]: lives, 'GET /api/players': { players: [] },
    [`POST /api/player/${ID}/kill`]: { command: { id: 7 } }, [`POST /api/player/${ID}/admin`]: { command: { id: 8 } },
  });
  show(<PlayerPage id={ID} />);
  expect(await screen.findByRole('heading', { name: /Rex Tester/ })).toBeInTheDocument();
  // Kill.
  await userEvent.click(screen.getByRole('button', { name: 'Xoá dino hiện tại' }));
  const dialog = screen.getByRole('dialog');
  await userEvent.type(within(dialog).getByRole('textbox'), 'kẹt map');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Xoá dino' }));
  await waitFor(() => expect(calls.find((c) => c.url.endsWith('/kill'))?.body).toEqual({ reason: 'kẹt map' }));
  expect(await screen.findByText(/lệnh #7 đang chờ server/)).toBeInTheDocument();
  const admin = () => calls.filter((c) => c.url.endsWith('/admin')).map((c) => c.body);
  // Heal.
  await userEvent.click(screen.getByRole('button', { name: /Hồi máu & chữa trị/ }));
  await waitFor(() => expect(admin()).toContainEqual({ action: 'heal' }));
  expect(await screen.findByText(/lệnh #8/)).toBeInTheDocument();
  // Vitals: nothing moved is refused; "Đầy dinh dưỡng" sends the five.
  await userEvent.click(screen.getByRole('button', { name: '✓ Áp chỉ số' }));
  expect(await screen.findByText('Chưa kéo chỉ số nào')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '🍖 Đầy dinh dưỡng' }));
  await userEvent.click(screen.getByRole('button', { name: '✓ Áp chỉ số' }));
  await waitFor(() => expect(admin()).toContainEqual({ action: 'vitals', values: { hunger: 1, thirst: 1, carb: 1, protein: 1, lipid: 1 } }));
  // Growth: prime only at 100%.
  await userEvent.click(screen.getByRole('tab', { name: '📈 Tăng trưởng' }));
  await userEvent.click(screen.getByRole('button', { name: '🦖 50% (Thiếu niên)' }));
  await userEvent.click(screen.getByRole('switch', { name: /Prime/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Đặt tăng trưởng' }));
  expect(await screen.findByText('Prime chỉ đặt được ở tăng trưởng 100%')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '👑 100% (Trưởng thành)' }));
  await userEvent.click(screen.getByRole('button', { name: 'Đặt tăng trưởng' }));
  await waitFor(() => expect(admin()).toContainEqual({ action: 'grow', growth: 1, prime: true }));
  // Teleport to coordinates.
  await userEvent.click(screen.getByRole('tab', { name: '📍 Dịch chuyển' }));
  await userEvent.click(screen.getByRole('button', { name: 'Dịch chuyển tới người chơi' }));
  expect(await screen.findByText('Không có người chơi nào để dịch chuyển tới')).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Toạ độ dịch chuyển'), '349,211, 148,696');
  await userEvent.click(screen.getByRole('button', { name: 'Dịch chuyển tới toạ độ' }));
  await waitFor(() => expect(admin()).toContainEqual({ action: 'teleport', to: { x: 148696, y: 349211 } }));
});

test('offline: actions locked; lives with prime tasks, put back into the garage', async () => {
  const { calls, show } = fakeApi({
    [`GET /api/player/${ID}`]: detail(false), [`GET /api/lives/${ID}`]: lives, 'GET /api/players': { players: [] }, 'POST /api/restore-life': { slot: 'khoiphuc-1790000000' },
  });
  show(<PlayerPage id={ID} />);
  expect(await screen.findByText('Người chơi không online hoặc chưa có dino.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Xoá dino hiện tại' })).toBeDisabled();
  expect(screen.getByRole('button', { name: /Hồi máu & chữa trị/ })).toBeDisabled();
  expect(screen.getByText('2 đời dino')).toBeInTheDocument();
  expect(await screen.findByText('6/10')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '👑 Prime' }));
  expect(screen.getByText('1 / 2 đời dino')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Khôi phục vào gara' }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Khôi phục' }));
  await waitFor(() => expect(calls.find((c) => c.url === '/api/restore-life')?.body).toEqual({ steamId: ID, spawnedAt: 1_790_000_000, slot: 'khoiphuc-1790000000' }));
});
