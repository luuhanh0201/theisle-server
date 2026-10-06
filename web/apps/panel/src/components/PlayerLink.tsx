/**
 * A player's name linking to their page. The player page is not in React yet (web/MIGRATION.md):
 * it opens in the panel before React. Change the href to `#player/<id>` once it is moved.
 */
export function PlayerLink({ steamId, name }: { steamId: string; name: string | null }) {
  return (
    <a href={`/#player/${encodeURIComponent(steamId)}`} style={{ fontWeight: 650, textDecoration: 'none' }}>
      {name ?? <span style={{ fontFamily: 'var(--font-mono)' }}>{steamId}</span>}
    </a>
  );
}
