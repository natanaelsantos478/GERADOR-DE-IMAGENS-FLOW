import { Window } from '../kit/Window';
import { useRegistry } from '../registry';
import { useUi } from '../store';

/** Renders every open panel registered via `registerPanel`. */
export function Windows() {
  const panels = useRegistry((s) => s.panels);
  const wins = useUi((s) => s.wins);
  return (
    <>
      {panels.filter((p) => wins[p.id]).map((p) => (
        <Window key={p.id} id={p.id} titleKey={p.titleKey} icon={p.icon} width={p.width}>
          <p.component />
        </Window>
      ))}
    </>
  );
}
