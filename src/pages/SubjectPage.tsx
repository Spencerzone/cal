// src/pages/SubjectPage.tsx
import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { getRollingSettings, setRollingSettings } from '../rolling/settings';
import { useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { getLessonsForSubject } from '../db/queries';
import { formatEventTime, toLocalDayKey, formatDayLabel } from '../util/time';
import type { BaseEvent } from '../ics/parseIcs';

export default function SubjectPage() {
    const { user } = useAuth();
    const userId = user?.uid || '';
    const [rollingSettings, setRollingSettingsState] = useState<any>(null);
    const activeYear = useMemo(
        () => (rollingSettings?.activeYear ?? new Date().getFullYear()) as number,
        [rollingSettings],
    );

    const yearOptions = useMemo(() => {
        const ys = new Set<number>();
        const nowY = new Date().getFullYear();
        ys.add(nowY);
        const tys: any[] = rollingSettings?.termYears ?? [];
        for (const ty of tys) {
            if (typeof ty?.year === 'number') ys.add(ty.year);
        }
        // also include legacy year if present
        const legacyAnyStart =
            rollingSettings?.termStarts?.t1 ||
            rollingSettings?.termStarts?.t2 ||
            rollingSettings?.termStarts?.t3 ||
            rollingSettings?.termStarts?.t4;
        if (typeof legacyAnyStart === 'string' && legacyAnyStart.length >= 4) {
            const y = parseInt(legacyAnyStart.slice(0, 4), 10);
            if (Number.isFinite(y)) ys.add(y);
        }
        return Array.from(ys).sort((a, b) => b - a);
    }, [rollingSettings]);
    const params = useParams();
    const code = (params.code || '').toUpperCase();

    useEffect(() => {
        if (!userId) return;
        let alive = true;
        const load = async () => {
            const s = await getRollingSettings(userId);
            if (!alive) return;
            setRollingSettingsState(s);
        };
        load();
        const onChange = () => load();
        window.addEventListener('rolling-settings-changed', onChange as any);
        return () => {
            alive = false;
            window.removeEventListener('rolling-settings-changed', onChange as any);
        };
    }, [userId]);

    const [events, setEvents] = useState<BaseEvent[]>([]);

    useEffect(() => {
        if (!userId || !code) return;
        if (!activeYear) return;
        (async () => {
            const rows = await getLessonsForSubject(userId, activeYear, code);
            setEvents(rows.filter((e) => (e as any).active !== false));
        })();
    }, [userId, code, activeYear]);

    const grouped = useMemo(() => {
        const m = new Map<string, BaseEvent[]>();
        for (const e of events) {
            const dayKey = toLocalDayKey(e.dtStartUtc);
            if (!m.has(dayKey)) m.set(dayKey, []);
            m.get(dayKey)!.push(e);
        }
        for (const [k, arr] of m) arr.sort((a, b) => a.dtStartUtc - b.dtStartUtc);
        return Array.from(m.entries()).sort((a, b) => b[0].localeCompare(a[0]));
    }, [events]);

    return (
        <div className='grid'>
            <h1>Lessons for {code || '(unknown)'}</h1>

            <div className='card'>
                <div
                    className='row'
                    style={{
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 12,
                        flexWrap: 'wrap',
                    }}
                >
                    <div>
                        <strong>Active year</strong>
                    </div>
                    <select
                        value={activeYear}
                        onChange={async (e: React.ChangeEvent<HTMLSelectElement>) => {
                            const y = parseInt(e.target.value, 10);
                            if (!userId || !Number.isFinite(y)) return;
                            // Persist globally
                            await setRollingSettings(userId, { activeYear: y } as any);
                            // Local state update so UI reflects immediately
                            setRollingSettingsState((prev: any) => ({
                                ...(prev ?? {}),
                                activeYear: y,
                            }));
                        }}
                    >
                        {yearOptions.map((y) => (
                            <option key={y} value={y}>
                                {y}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            {grouped.length === 0 ? (
                <div className='card'>
                    <div className='muted'>No lessons found.</div>
                </div>
            ) : (
                grouped.map(([dayKey, rows]) => (
                    <div key={dayKey} className='card'>
                        <div>
                            <strong>{formatDayLabel(dayKey)}</strong>
                        </div>
                        <div className='space' />
                        <div className='grid' style={{ gap: 8 }}>
                            {rows.map((e) => (
                                <div key={e.id}>
                                    <div>
                                        <strong>{e.title}</strong>{' '}
                                        {e.room ? <span className='muted'>({e.room})</span> : null}
                                    </div>
                                    <div className='muted'>{formatEventTime(e)}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))
            )}
        </div>
    );
}
