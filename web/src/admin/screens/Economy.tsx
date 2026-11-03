import { useState, type CSSProperties } from 'react';
import type { EconomyGroup, EconomyPreview, EconomySetting, EconomySim } from '../../../../shared/api';
import { RARITY } from '../../lib/rarity';
import { useIsMobile } from '../../lib/useMediaQuery';
import { AdminPage } from '../AdminApp';
import { cr, num, useAdminAction, useEconomy, usePreview, useStaff, utcStamp } from '../lib';
import { Btn, CLOSE, Dialog, Dot, ErrorBox, Header, Logged, ReasonField, cx, s } from '../ui';

type Edits = Record<string, string>;

const panel: CSSProperties = { border: '1px solid var(--border)', borderRadius: 'var(--radius-panel)', background: 'var(--surface)' };

/** "79 CR", "32% of 250". */
const simText = (sim: EconomySim) => ({ value: cr(sim.average), pct: `${Math.round(sim.share * 100)}% of ${num(sim.price)}`, width: `${Math.min(100, sim.share * 100).toFixed(1)}%` });

function EditedTag() {
  return (
    <span className="mono" style={{ fontSize: 9, letterSpacing: '.1em', textTransform: 'uppercase', padding: '2px 5px', background: 'var(--primary-bg)', color: 'var(--primary-text)' }}>
      Edited
    </span>
  );
}

interface FieldProps {
  setting: EconomySetting;
  value: string;
  edited: boolean;
  bad: boolean;
  disabled: boolean;
  onChange: (v: string) => void;
  width?: number;
  ariaLabel?: string;
  id?: string;
}

function ValueInput({ setting, value, edited, bad, disabled, onChange, width, ariaLabel, id }: FieldProps) {
  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      className={cx('mono', s.field)}
      aria-label={ariaLabel}
      aria-invalid={bad}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      style={{ width: width ?? '100%', flex: width ? 'none' : 1, minWidth: 0, height: 40, textAlign: 'right', borderColor: bad ? 'var(--error)' : edited ? 'var(--text)' : undefined, boxShadow: width && edited ? 'inset 2px 0 0 var(--text)' : undefined }}
      title={setting.help}
    />
  );
}

function ListGroup({ group, edits, preview, onEdit, disabled, mobile }: { group: EconomyGroup; edits: Edits; preview: EconomyPreview | undefined; onEdit: (key: string, v: string) => void; disabled: boolean; mobile: boolean }) {
  const changed = new Set(preview?.diff.map((d) => d.key));
  return (
    <>
      {group.settings.map((x) => {
        const edited = changed.has(x.key);
        const bad = Boolean(edits[x.key] !== undefined && preview?.errors[x.key]);
        const id = `f-${x.key.replace(/\./g, '-')}`;
        return (
          <div
            key={x.key}
            style={{
              display: 'grid',
              gridTemplateColumns: mobile ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) 170px 200px',
              alignItems: 'center',
              gap: mobile ? 8 : 16,
              minHeight: 56,
              padding: mobile ? '12px 16px' : '8px 20px',
              borderTop: '1px solid var(--separator)',
              boxShadow: edited ? 'inset 2px 0 0 var(--text)' : undefined,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 500 }}>
                <label htmlFor={id}>{x.label}</label>
                {edited && <EditedTag />}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
                {x.help}
                {x.changed && (
                  <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    {' '}
                    · {x.changed}
                  </span>
                )}
              </span>
              {bad && <span style={{ fontSize: 12, color: 'var(--error)' }}>{preview?.errors[x.key]}</span>}
            </div>
            <span className={cx('mono', s.ellipsis)} style={{ fontSize: 13, color: 'var(--text-2)', textAlign: mobile ? 'left' : 'right' }}>
              Now {x.value} {x.unit}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ValueInput id={id} setting={x} value={edits[x.key] ?? x.value} edited={edited} bad={bad} disabled={disabled} onChange={(v) => onEdit(x.key, v)} />
              <span className="mono" style={{ flex: 'none', width: 40, fontSize: 12, color: 'var(--text-3)' }}>
                {x.unit}
              </span>
            </span>
          </div>
        );
      })}
    </>
  );
}

function MatrixGroup({ group, edits, preview, onEdit, disabled }: { group: EconomyGroup; edits: Edits; preview: EconomyPreview | undefined; onEdit: (key: string, v: string) => void; disabled: boolean }) {
  const changed = new Set(preview?.diff.map((d) => d.key));
  const oddsBad = preview ? !preview.oddsOk : false;
  const odds = group.settings.filter((x) => x.key.startsWith('odds.'));
  const recycle = new Map(group.settings.filter((x) => x.key.startsWith('recycle.')).map((x) => [x.tier, x]));
  const cols = 'minmax(150px, 1fr) minmax(170px, 1fr) minmax(190px, 1fr)';
  const cell = (x: EconomySetting, unit: string, width: number, aria: string) => {
    const edited = changed.has(x.key);
    const bad = Boolean((edits[x.key] !== undefined && preview?.errors[x.key]) || (x.key.startsWith('odds.') && oddsBad && edits[x.key] !== undefined));
    return (
      <span role="cell" style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ValueInput setting={x} value={edits[x.key] ?? x.value} edited={edited} bad={bad} disabled={disabled} onChange={(v) => onEdit(x.key, v)} width={width} ariaLabel={aria} />
          <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>
            {unit}
          </span>
        </span>
        <span className="mono" style={{ fontSize: 11, color: bad && preview?.errors[x.key] ? 'var(--error)' : 'var(--text-3)' }}>
          {bad && preview?.errors[x.key] ? preview.errors[x.key] : `Now ${x.value}`}
        </span>
      </span>
    );
  };
  return (
    <div role="table" aria-label="Odds and recycle by rarity" style={{ overflowX: 'auto' }}>
      <div role="row" style={{ display: 'grid', gridTemplateColumns: cols, gap: 16, alignItems: 'center', minHeight: 36, padding: '0 20px', borderTop: '1px solid var(--separator)', background: 'var(--rail)', minWidth: 560 }}>
        {['Rarity', 'Odds per opening', 'Recycle, before wear'].map((h) => (
          <span key={h} role="columnheader" className={cx('lbl', s.th)}>
            {h}
          </span>
        ))}
      </div>
      {odds.map((o) => {
        const tier = o.tier!;
        const rec = recycle.get(tier)!;
        const changedText = [o.changed, rec.changed].filter(Boolean).join(' · ');
        return (
          <div key={tier} role="row" style={{ display: 'grid', gridTemplateColumns: cols, gap: 16, alignItems: 'center', minHeight: 64, padding: '8px 20px', borderTop: '1px solid var(--separator)', minWidth: 560 }}>
            <span role="rowheader" style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 500 }}>
                <span aria-hidden="true" style={{ width: 8, height: 8, background: RARITY[tier].color }} />
                <span style={{ color: RARITY[tier].text }}>{o.label}</span>
              </span>
              {changedText && (
                <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
                  {changedText}
                </span>
              )}
            </span>
            {cell(o, '%', 110, `Odds, ${o.label}`)}
            {cell(rec, 'CR', 130, `Recycle value, ${o.label}`)}
          </div>
        );
      })}
    </div>
  );
}

function Simulator({ now, edit, edited, rangeEdit }: { now: EconomySim; edit: EconomySim | null; edited: boolean; rangeEdit: string | null }) {
  const a = simText(now);
  const b = edit ? simText(edit) : null;
  return (
    <section aria-labelledby="sim-t" style={{ ...panel, display: 'flex', flexDirection: 'column', gap: 14, padding: '18px 20px 20px' }}>
      <h2 id="sim-t" className="lbl">
        // Simulator
      </h2>
      <span style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-2)' }}>Average return per case if the player recycles everything they open.</span>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'var(--border)', border: '1px solid var(--border)', borderRadius: 'var(--radius-card)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 14, background: 'var(--surface-raised)' }}>
          <span style={{ fontSize: 12, color: 'var(--text-2)' }}>Now</span>
          <span className="mono" style={{ fontSize: 24, fontWeight: 500 }}>
            {a.value}
          </span>
          <span className="mono" style={{ fontSize: 12, color: 'var(--text-2)' }}>
            {a.pct}
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 14, background: 'var(--surface-raised)' }}>
          <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{edited ? 'With your edits' : 'With your edits (none yet)'}</span>
          <span className="mono" style={{ fontSize: 24, fontWeight: 500, color: edited && b ? 'var(--text)' : 'var(--text-2)' }}>
            {b ? b.value : a.value}
          </span>
          <span className="mono" style={{ fontSize: 12, color: 'var(--text-2)' }}>
            {b ? b.pct : a.pct}
          </span>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[
          ['Now', a.width, 'var(--text-3)'],
          ['Edited', (b ?? a).width, 'var(--text)'],
        ].map(([label, width, color]) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="mono" style={{ width: 52, fontSize: 11, color: 'var(--text-3)' }}>
              {label}
            </span>
            <span aria-hidden="true" style={{ flex: 1, height: 6, background: 'var(--track)' }}>
              <span style={{ display: 'block', height: 6, width, background: color, transition: 'width var(--dur-slow) var(--ease-out)' }} />
            </span>
          </div>
        ))}
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
          Bars show the share of the case price that comes back.
        </span>
      </div>
      <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
        Range by case{' '}
        <span className="mono" style={{ color: 'var(--text)' }}>
          {num(now.min)}–{cr(now.max)}
          {rangeEdit ? ` → ${rangeEdit}` : ''}
        </span>
      </span>
    </section>
  );
}

function SaveDialog({ preview, now, edits, onClose, onSaved }: { preview: EconomyPreview; now: EconomySim; edits: Edits; onClose: () => void; onSaved: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { run, busy } = useAdminAction();
  const n = preview.diff.length;
  const label = `Save ${n} ${n === 1 ? 'change' : 'changes'}`;
  const a = simText(now);
  const b = preview.sim ? simText(preview.sim) : a;
  const go = async () => {
    const message = await run('/admin/economy', { edits, reason: reason.trim() });
    if (message) setError(message);
    else onSaved();
  };
  return (
    <Dialog
      label="Save economy changes"
      title={`${label} to the economy`}
      onClose={onClose}
      footer={
        <>
          <Logged />
          <Btn size={44} onClick={onClose}>
            Cancel
          </Btn>
          <Btn size={44} variant="primary" min="admin" disabled={!reason.trim() || busy || !preview.valid} onClick={() => void go()}>
            {label}
          </Btn>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--border)', borderRadius: 'var(--radius-card)' }}>
        {preview.diff.map((d) => (
          <div key={d.key} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 12, alignItems: 'center', minHeight: 48, padding: '0 14px', borderBottom: '1px solid var(--separator)', fontSize: 14 }}>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span>{d.label}</span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
                {d.key}
              </span>
            </span>
            <span className="mono" style={{ fontSize: 14, whiteSpace: 'nowrap' }}>
              <span style={{ color: 'var(--text-2)' }}>{d.from}</span> → {d.to}
            </span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '6px 12px', padding: '14px 16px', border: '1px solid var(--border)', borderRadius: 'var(--radius-card)', background: 'var(--page)' }}>
        <span style={{ flexBasis: '100%', fontSize: 12, color: 'var(--text-2)' }}>Average return per case</span>
        <span className="mono" style={{ fontSize: 18, color: 'var(--text-2)' }}>
          {a.value} · {a.pct}
        </span>
        <span aria-hidden="true" style={{ color: 'var(--text-3)' }}>
          →
        </span>
        <span className="mono" style={{ fontSize: 22, fontWeight: 500 }}>
          {b.value} · {b.pct}
        </span>
      </div>
      <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, lineHeight: 1.5, color: 'var(--text-2)' }}>
        {preview.impacts.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      <ReasonField value={reason} onChange={setReason} hint="required, shown in the change history and admin log" placeholder="e.g. too many credits in circulation" />
      {error && (
        <span role="alert" className={s.alertText}>
          {error}
        </span>
      )}
    </Dialog>
  );
}

export function Economy() {
  const mobile = useIsMobile();
  const staff = useStaff();
  const isAdmin = staff.can('admin');
  const economy = useEconomy();
  const [edits, setEdits] = useState<Edits>({});
  const [open, setOpen] = useState(false);
  const hasEdits = Object.keys(edits).length > 0;
  const preview = usePreview<EconomyPreview>('/admin/economy/preview', { edits }, hasEdits).data;
  const current = preview && hasEdits ? preview : undefined;

  if (economy.isError) {
    return (
      <AdminPage>
        <Header label="Economy" title="Economy settings" />
        <ErrorBox title="Couldn't load the economy settings" error={economy.error} onRetry={() => void economy.refetch()} />
      </AdminPage>
    );
  }
  const data = economy.data;
  const byKey = new Map(data?.groups.flatMap((g) => g.settings.map((x) => [x.key, x] as const)));
  const onEdit = (key: string, v: string) =>
    setEdits((prev) => {
      const next = { ...prev };
      if (v.trim() === byKey.get(key)?.value) delete next[key];
      else next[key] = v;
      return next;
    });
  const undo = (key: string) =>
    setEdits((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  const diff = current?.diff ?? [];
  const n = diff.length;
  const saveLabel = `Save ${n} ${n === 1 ? 'change' : 'changes'}`;
  const oddsTotal = current?.oddsTotal ?? data?.oddsTotal ?? '100.00';
  const oddsOk = current ? current.oddsOk : true;
  const editSim = current?.sim ?? null;

  return (
    <AdminPage gap={24}>
      <Header
        label="Economy"
        title="Economy settings"
        sub="Tune the game's numbers without a deploy. Nothing changes until you save, and every save is kept below. All times UTC."
        right={
          !isAdmin ? (
            <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
              Read-only: economy settings are for admins.
            </span>
          ) : undefined
        }
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
        <div style={{ flex: '999 1 640px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
          {!data
            ? [3, 5, 3].map((rows, i) => (
                <div key={i} aria-busy="true" aria-label="Loading the economy settings" style={panel}>
                  <div style={{ padding: '16px 20px 12px' }}>
                    <span className={s.skel} style={{ width: 120 }} />
                  </div>
                  {Array.from({ length: rows }, (_, j) => (
                    <div key={j} className={s.skelRow} style={{ height: 56 }}>
                      <span className={s.skel} style={{ width: 160 }} />
                      <span className={s.skel} style={{ width: 90, marginLeft: 'auto' }} />
                      <span className={s.skel} style={{ width: 150, height: 32 }} />
                    </div>
                  ))}
                </div>
              ))
            : data.groups.map((g) => (
                <section key={g.id} aria-labelledby={`g-${g.id}`} style={panel}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px 16px', padding: '16px 20px 12px' }}>
                    <h2 id={`g-${g.id}`} className="lbl">
                      {g.title}
                    </h2>
                    {g.id === 'rarity' && (
                      <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: oddsOk ? 'var(--text-2)' : 'var(--error)' }}>
                        {!oddsOk && <Dot />}
                        Odds total {oddsTotal}%{oddsOk ? '' : ' · must be 100.00%'}
                      </span>
                    )}
                  </div>
                  {g.id === 'rarity' ? (
                    <MatrixGroup group={g} edits={edits} preview={current} onEdit={onEdit} disabled={!isAdmin} />
                  ) : (
                    <ListGroup group={g} edits={edits} preview={current} onEdit={onEdit} disabled={!isAdmin} mobile={mobile} />
                  )}
                </section>
              ))}

          <section aria-labelledby="hist-t" style={{ ...panel, overflowX: 'auto' }}>
            <h2 id="hist-t" className="lbl" style={{ padding: '16px 20px 12px' }}>
              // Change history
            </h2>
            <div role="table" aria-label="Change history" style={{ minWidth: 640 }}>
              <div role="row" className={s.thead} style={{ gridTemplateColumns: '110px 76px 170px 150px minmax(0, 1fr)', padding: '0 20px', borderTop: '1px solid var(--border)', minHeight: 40 }}>
                {['Time', 'Staff', 'Setting', 'Change', 'Reason'].map((h) => (
                  <span key={h} role="columnheader" className={cx('lbl', s.th)}>
                    {h}
                  </span>
                ))}
              </div>
              {data?.history.map((h) => (
                <div key={h.id} role="row" className={s.tr} style={{ gridTemplateColumns: '110px 76px 170px 150px minmax(0, 1fr)', padding: '0 20px', minHeight: 48 }}>
                  <span role="cell" className="mono" style={{ fontSize: 13, color: 'var(--text-2)' }}>
                    {utcStamp(h.at)}
                  </span>
                  <span role="cell" className={s.ellipsis}>
                    {h.staff}
                  </span>
                  <span role="cell" className={cx('mono', s.ellipsis)} style={{ fontSize: 13 }}>
                    {h.key}
                  </span>
                  <span role="cell" className={cx('mono', s.ellipsis)} style={{ fontSize: 13 }}>
                    {h.change}
                  </span>
                  <span role="cell" className={s.ellipsis} style={{ color: 'var(--text-2)' }}>
                    {h.reason}
                  </span>
                </div>
              ))}
              {data && data.history.length === 0 && (
                <div style={{ padding: '18px 20px', fontSize: 13, color: 'var(--text-2)', borderTop: '1px solid var(--separator)' }}>No change saved yet. The game runs on the default numbers.</div>
              )}
            </div>
          </section>
        </div>

        <aside style={{ flex: '1 1 340px', position: mobile ? 'static' : 'sticky', top: 24, display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          {data ? (
            <Simulator now={data.sim} edit={n ? editSim : null} edited={n > 0} rangeEdit={n && editSim ? `${num(editSim.min)}–${cr(editSim.max)}` : null} />
          ) : (
            <div aria-busy="true" aria-label="Loading the simulator" style={{ ...panel, height: 300 }} />
          )}
          <section aria-labelledby="pend-t" style={{ ...panel, display: 'flex', flexDirection: 'column', gap: 12, padding: '18px 20px 20px', border: `1px solid ${hasEdits ? 'var(--border-strong)' : 'var(--border)'}` }}>
            <h2 id="pend-t" className="lbl">
              // Pending changes · {n}
            </h2>
            {hasEdits ? (
              <>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {diff.map((d) => (
                    <div key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, borderBottom: '1px solid var(--separator)', fontSize: 13 }}>
                      <span style={{ flex: 1, minWidth: 0 }}>{d.label}</span>
                      <span className="mono" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                        <span style={{ color: 'var(--text-2)' }}>{d.from}</span> → {d.to}
                      </span>
                      <button type="button" aria-label={`Undo ${d.label}`} className={s.close} style={{ width: 32, height: 32, margin: 0, color: 'var(--text-3)' }} onClick={() => undo(d.key)}>
                        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24">
                          <path d={CLOSE} />
                        </svg>
                      </button>
                    </div>
                  ))}
                  {!diff.length && <span style={{ fontSize: 13, color: 'var(--text-2)', padding: '8px 0' }}>{current?.invalidText ? 'Nothing valid to save yet.' : 'Checking…'}</span>}
                </div>
                {current?.invalidText && (
                  <span role="alert" style={{ fontSize: 13, color: 'var(--error)' }}>
                    {current.invalidText}
                  </span>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <Btn size={44} onClick={() => setEdits({})}>
                    Discard
                  </Btn>
                  <Btn size={44} variant="primary" min="admin" disabled={!current?.valid} onClick={() => setOpen(true)} style={{ flex: 1 }}>
                    {saveLabel}…
                  </Btn>
                </div>
              </>
            ) : (
              <span style={{ padding: 18, border: '1px dashed var(--border-strong)', borderRadius: 'var(--radius-card)', fontSize: 13, color: 'var(--text-2)', textAlign: 'center' }}>Edit a value to see it here before saving.</span>
            )}
          </section>
        </aside>
      </div>
      {open && current?.valid && data && (
        <SaveDialog
          preview={current}
          now={data.sim}
          edits={edits}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            setEdits({});
          }}
        />
      )}
    </AdminPage>
  );
}
