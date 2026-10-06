import { SkinStudio } from '../../features/skin/SkinStudio';
import { useMe } from '../../lib/queries';

/** Skin Studio (#skin): the skin colour editor, applied onto the dino played now. */
export function SkinPage() {
  const me = useMe();
  return <SkinStudio me={me} />;
}
