import { fireEvent, render } from '@testing-library/react';
import type { PlayerMe } from '@isle/api';
import { Ranking } from '../features/ranking/Ranking';

const me = (lives: Array<Record<string, unknown>>): PlayerMe => ({
  steamId: '1', name: 'A', online: true, dino: null, stats: { kills: 0, deaths: 0, spawns: 0, playtime: 0, longestLife: 0, sessions: 0 }, lives, garage: [],
});
const board = {
  kills: [{ name: 'Rex', value: 5, species: 'Tyrannosaurus' }, { name: null, value: 3 }, { name: 'C', value: 2 }, { name: 'D', value: 1 }],
  playtime: [{ name: 'Rex', value: 3725 }], longestLife: [], hunters: [{ name: 'H', value: 2 }],
};

describe('Bảng Xếp Hạng', () => {
  it('loading, then the kills: the top three dressed, the rest plain', () => {
    const { container, rerender } = render(<Ranking me={null} board={undefined} />);
    expect(container.querySelector('#ranking-list')?.textContent).toBe('Đang tải bảng xếp hạng…');
    rerender(<Ranking me={null} board={board} />);
    const li = [...container.querySelectorAll('#ranking-list > li')];
    expect(li.map((x) => x.className)).toEqual([
      'leaderboard-item tier-apex rank-top rank-1', 'leaderboard-item tier-rex rank-top rank-2', 'leaderboard-item tier-dna rank-top rank-3', 'leaderboard-item tier-fossil rank-rest']);
    expect(li[0]?.querySelector('.leaderboard-rank')?.textContent).toBe('👑 #1');
    expect(li[1]?.querySelector('.leaderboard-player-name')?.textContent).toBe('Ẩn danh');
    expect(li[3]?.querySelector('.leaderboard-rank')?.textContent).toBe('#4');
    expect(li[0]?.querySelector('.leaderboard-val-num')?.textContent).toBe('5 kills');
    expect(li[0]?.querySelector('.leaderboard-species')?.textContent).toBe('Tyrannosaurus');
  });
  it('the other boards and an empty one', () => {
    const { container } = render(<Ranking me={null} board={board} />);
    fireEvent.click(container.querySelector('[data-rtab=playtime]') as HTMLElement);
    expect(container.querySelector('.leaderboard-val-num')?.textContent).toBe('1g 2p');
    fireEvent.click(container.querySelector('[data-rtab=hunters]') as HTMLElement);
    expect(container.querySelector('.leaderboard-val-num')?.textContent).toBe('🏹 2 lần');
    fireEvent.click(container.querySelector('[data-rtab=longestLife]') as HTMLElement);
    expect(container.querySelector('#ranking-list')?.textContent).toBe('Chưa có người chơi trong danh sách.');
  });
  it('your dinos: status, killer, rebirths, tier', () => {
    const lives = [
      { species: 'Tyrannosaurus', spawnedAt: 1_790_000_000, lastAt: 1_790_000_600, status: 'death', seconds: 600, growth: 0.8, kills: 2, killedBy: 'Bob', killedBySpecies: 'Carnotaurus', rebirths: 1, elderStacks: 2 },
      { species: 'Stegosaurus', spawnedAt: 1_790_001_000, lastAt: 1_790_001_000, status: 'alive', seconds: 30, growth: 0.2, kills: 0, killedBy: null, killedBySpecies: null, rebirths: 0, elderStacks: null },
    ];
    const { container } = render(<Ranking me={me(lives)} board={null} />);
    fireEvent.click(container.querySelector('[data-rtab=lives]') as HTMLElement);
    expect(container.querySelector('#ranking-list')?.className).toBe('leaderboard-list lives-mode');
    const li = [...container.querySelectorAll('.dino-life-item')];
    expect(li[0]?.className).toBe('dino-life-item high-tier tier-rex');
    expect(li[0]?.textContent).toContain('Đã chết bởi Bob (Carnotaurus)');
    expect(li[0]?.textContent).toContain('sống 10p 0s · CS x1');
    expect(li[1]?.className).toBe('dino-life-item fossil-tier');
    expect(li[1]?.querySelector('.tag.info')?.textContent).toBe('Đang sống');
  });
  it('no dino yet', () => {
    const { container } = render(<Ranking me={me([])} board={board} />);
    fireEvent.click(container.querySelector('[data-rtab=lives]') as HTMLElement);
    expect(container.querySelector('#ranking-list')?.textContent).toBe('Chưa có lịch sử đời dino nào.');
  });
});
