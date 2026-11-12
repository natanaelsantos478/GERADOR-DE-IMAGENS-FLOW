import type { ReactNode } from 'react';
import { t } from '../i18n';
import { Icon } from '../kit/Icon';

export function Modal({ titleKey, onClose, children, width }: { titleKey: string; onClose(): void; children: ReactNode; width?: number }) {
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={width ? { width } : undefined} data-testid={`modal-${titleKey}`}>
        <div className="win-head">
          <h3>{t(titleKey)}</h3>
          <button className="btn ghost sm" onClick={onClose} aria-label={t('ui.close')}><Icon name="close" /></button>
        </div>
        <div className="win-body">{children}</div>
      </div>
    </div>
  );
}
