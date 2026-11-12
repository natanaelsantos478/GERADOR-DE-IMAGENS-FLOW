import { describe, expect, it } from 'vitest';
import { createGame } from '../core/game';
import { fixtureWorld } from '../data/fixture.test-util';
import { decodeSave, encodeSave } from './save';

describe('save encoding', () => {
  it('gzips and restores a save byte-for-byte (JSON)', async () => {
    const world = fixtureWorld();
    const game = createGame(world, { systems: [], playerCountryId: 'AAA' });
    game.advanceHours(100);
    const save = game.serialize();
    const { bytes, compressed } = await encodeSave(save);
    expect(compressed).toBe(true);
    expect(bytes[0]).toBe(0x1f);
    expect(await decodeSave(bytes)).toEqual(save);
    const plain = new TextEncoder().encode(JSON.stringify(save));
    expect(await decodeSave(plain)).toEqual(save);
    const other = createGame(world, { systems: [], playerCountryId: 'BBB' });
    other.hydrate(await decodeSave(bytes));
    expect(JSON.stringify(other.state)).toBe(JSON.stringify(game.state));
  });
});
