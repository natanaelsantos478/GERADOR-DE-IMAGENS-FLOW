import { useEffect, useRef, useState } from 'react';
import { deleteSave, type SaveSlotInfo } from '../../app/save';
import { useAppHost } from '../../app/host';
import { fmtDate, fmtInt } from '../fmt';
import { t } from '../i18n';
import { Flag } from '../kit/Icon';
import { useUi } from '../store';
import { Modal } from './Modal';
import { exportFile, importFile, loadSlot, saveSlot, slots } from './saveOps';

export function SaveLoadDialog({ onClose }: { onClose(): void }) {
  const hasGame = useAppHost((s) => !!s.game);
  const screen = useUi((s) => s.screen);
  const inGame = hasGame && screen === 'game';
  const world = useAppHost((s) => s.world);
  const [list, setList] = useState<SaveSlotInfo[]>([]);
  const [name, setName] = useState('slot-1');
  const file = useRef<HTMLInputElement>(null);
  const refresh = () => void slots().then(setList);
  useEffect(refresh, []);
  return (
    <Modal titleKey={inGame ? 'ui.save.title' : 'ui.load.title'} onClose={onClose}>
      <div className="col">
        {inGame && (
          <div className="row">
            <input className="input grow" data-testid="save-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('ui.save.slotName')} />
            <button className="btn primary" data-testid="save-btn" disabled={!name.trim()} onClick={() => void saveSlot(name.trim()).then(refresh)}>{t('ui.save.save')}</button>
            <button className="btn" onClick={() => void exportFile()}>{t('ui.save.export')}</button>
          </div>
        )}
        <table className="tbl">
          <thead><tr><th>{t('ui.save.slot')}</th><th>{t('ui.save.country')}</th><th>{t('ui.save.gameDate')}</th><th>{t('ui.save.size')}</th><th /></tr></thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.name} data-testid={`slot-${s.name}`}>
                <td><b>{s.name}</b><div className="faint" style={{ fontSize: 11 }}>{new Date(s.savedAt).toLocaleString('pt-BR')}</div></td>
                <td><span className="row gap4"><Flag id={s.playerCountryId} width={20} />{world?.countryById.get(s.playerCountryId)?.namePt}</span></td>
                <td>{fmtDate(s.hours)}</td>
                <td className="num">{fmtInt(s.sizeBytes / 1024)} KB</td>
                <td className="r">
                  <button className="btn sm primary" data-testid={`load-${s.name}`} onClick={() => void loadSlot(s.name).then((ok) => ok && onClose())}>{t('ui.load.load')}</button>{' '}
                  <button className="btn sm danger" onClick={() => void deleteSave(s.name).then(refresh)}>{t('ui.save.delete')}</button>
                </td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={5} className="dim">{t('ui.save.empty')}</td></tr>}
          </tbody>
        </table>
        <div className="row">
          <input ref={file} type="file" accept=".json,.gz,application/json,application/gzip" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f).then((ok) => ok && onClose()); e.target.value = ''; }} />
          <button className="btn" onClick={() => file.current?.click()}>{t('ui.save.import')}</button>
        </div>
      </div>
    </Modal>
  );
}
