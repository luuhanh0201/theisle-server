import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Dialog, TextArea, TextInput } from '@isle/ui';
import { useSession } from './session';

export interface ConfirmOptions {
  title: string;
  body: ReactNode;
  okLabel: string;
  /** Red, with the warning sign (default): something is deleted, kicked, replaced… */
  danger?: boolean;
  /** Ask a reason (passed to run). */
  withReason?: boolean;
  /** Ask a text, with its label and starting value (passed to run). */
  text?: { label: string; value: string; long?: boolean };
  /** The action, with the admin token; a thrown error stays in the dialog. */
  run: (token: string, reason: string, text: string) => Promise<void>;
}

const ConfirmContext = createContext<((o: ConfirmOptions) => void) | null>(null);

/** The confirm dialog of every action that changes something (the panel before React's confirmAction). */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { tokenNow } = useSession();
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [reason, setReason] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = useCallback((o: ConfirmOptions) => {
    setOpts(o); setReason(''); setText(o.text?.value ?? ''); setError(null); setBusy(false);
  }, []);
  const ok = async (): Promise<void> => {
    if (!opts) return;
    const token = await tokenNow(opts.title);
    if (token === null) return;
    setBusy(true); setError(null);
    try {
      await opts.run(token, reason.trim(), text);
      setOpts(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const value = useMemo(() => open, [open]);
  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Dialog open={opts !== null} title={opts?.title ?? ''} okLabel={opts?.okLabel ?? 'OK'} danger={opts?.danger ?? true} busy={busy} error={error}
        onOk={() => void ok()} onClose={() => { if (!busy) setOpts(null); }}>
        <div>{opts?.body}</div>
        {opts?.withReason && (
          <div style={{ marginTop: 12 }}>
            <label htmlFor="cf-reason" style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Lý do (người chơi thấy)</label>
            <TextInput id="cf-reason" autoFocus value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
          </div>
        )}
        {opts?.text && (
          <div style={{ marginTop: 12 }}>
            <label htmlFor="cf-text" style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{opts.text.label}</label>
            {opts.text.long
              ? <TextArea id="cf-text" autoFocus value={text} maxLength={500} onChange={(e) => setText(e.target.value)} />
              : <TextInput id="cf-text" autoFocus value={text} onChange={(e) => setText(e.target.value)} />}
          </div>
        )}
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): (o: ConfirmOptions) => void {
  const c = useContext(ConfirmContext);
  if (c === null) throw new Error('useConfirm: no ConfirmProvider above');
  return c;
}
