/** Hook for the UI: `focusTacticalSquad(id)` (or `useTacSelection.getState().requestFocus(id)`) flies the tactical camera to a squad. */
import { useTacSelection } from './store';

export function focusTacticalSquad(squadId: number): void {
  useTacSelection.getState().requestFocus(squadId);
}
