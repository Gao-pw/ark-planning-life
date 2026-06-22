import '@hackernoon/pixel-icon-library/fonts/iconfont.css';
import { invoke } from '@tauri-apps/api/core';
import { LogicalPosition, LogicalSize, PhysicalPosition } from '@tauri-apps/api/dpi';
import { Menu } from '@tauri-apps/api/menu';
import { getCurrentWindow, primaryMonitor } from '@tauri-apps/api/window';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

type PeriodKind = 'session' | 'weekly' | 'monthly';
type CompactMode = 'auto' | PeriodKind;
type Signal = 'green' | 'yellow' | 'red' | 'gray';

interface UsagePeriod {
  kind: string;
  percent: number;
  reset_at?: number | null;
}

interface UsagePayload {
  ok: boolean;
  message: string;
  product: string;
  version: string;
  region: string;
  periods: UsagePeriod[];
}

const appWindow = getCurrentWindow();
const refreshOptions = [1, 5, 10] as const;
const periodKinds: PeriodKind[] = ['session', 'weekly', 'monthly'];
const compactWidth = 420;
const compactHeight = 64;
const detailWidth = 760;
const detailHeight = 340;
const compactSize = new LogicalSize(compactWidth, compactHeight);
const isDetailWindow = new URLSearchParams(window.location.search).get('window') === 'detail';

async function getDockPosition(width: number, top = 0, rightOffset = 96): Promise<LogicalPosition> {
  const monitor = await primaryMonitor();
  if (!monitor) return new LogicalPosition(560, top);

  const scale = monitor.scaleFactor;
  const logicalX = monitor.position.x / scale;
  const logicalY = monitor.position.y / scale;
  const logicalWidth = monitor.size.width / scale;

  // 吸顶到主屏幕中间偏右：居中后再右偏 rightOffset，避免贴边也避免挡住系统菜单。
  return new LogicalPosition(logicalX + (logicalWidth - width) / 2 + rightOffset, logicalY + top);
}

const signalText: Record<Signal, string> = {
  green: 'text-[#12d18e]',
  yellow: 'text-[#ffd166]',
  red: 'text-[#ff4d7d]',
  gray: 'text-slate-400',
};

const signalFill: Record<Signal, string> = {
  green: 'from-[#7dffbd] via-[#16d995] to-[#06a86f]',
  yellow: 'from-[#ffe08a] via-[#ffc533] to-[#ff9f1c]',
  red: 'from-[#ff8fab] via-[#ff4d7d] to-[#d90452]',
  gray: 'from-slate-300 to-slate-400',
};

const signalIconClass: Record<Signal, string> = {
  green: 'text-[#00d084]',
  yellow: 'text-[#ffbe0b]',
  red: 'text-[#ff4d7d]',
  gray: 'text-slate-400',
};

const periodTitle: Record<PeriodKind, string> = {
  session: 'Session 会话',
  weekly: 'Weekly 周',
  monthly: 'Monthly 月度',
};

const compactModeTitle: Record<CompactMode, string> = {
  auto: '自动最少 HP',
  session: 'Session',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

const compactModeShortTitle: Record<CompactMode, string> = {
  auto: 'MIN',
  session: 'SES',
  weekly: 'WK',
  monthly: 'MON',
};

function getPeriod(payload: UsagePayload | null, kind: PeriodKind): UsagePeriod | undefined {
  return payload?.periods.find((period) => period.kind.toLowerCase() === kind);
}

function getHpPercent(payload: UsagePayload | null, usagePercent?: number): number | undefined {
  if (!payload?.ok || usagePercent === undefined || Number.isNaN(usagePercent)) return undefined;

  return Math.max(0, Math.min(100, 100 - usagePercent));
}

function getSignal(payload: UsagePayload | null, usagePercent?: number): Signal {
  if (!payload?.ok || usagePercent === undefined || Number.isNaN(usagePercent)) return 'gray';

  // usage.percent 是使用量；颜色按使用量分档。
  if (usagePercent <= 60) return 'green';
  if (usagePercent <= 80) return 'yellow';
  return 'red';
}

function getWorstPeriod(payload: UsagePayload | null): UsagePeriod | undefined {
  if (!payload?.ok) return undefined;

  return periodKinds
    .map((kind) => getPeriod(payload, kind))
    .filter((period): period is UsagePeriod => Boolean(period))
    .sort((first, second) => second.percent - first.percent)[0];
}

function formatPercent(percent?: number): string {
  return percent === undefined || Number.isNaN(percent) ? '--%' : `${percent.toFixed(0)}%`;
}

function formatCountdown(timestamp?: number | null): string {
  if (!timestamp) return '--:--:--';

  const diff = Math.max(0, timestamp - Date.now());
  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}天 ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function ProgressBar({ payload, usedPercent, signal, compact = false }: { payload: UsagePayload | null; usedPercent?: number; signal: Signal; compact?: boolean }) {
  const hpPercent = getHpPercent(payload, usedPercent) ?? 0;
  const animationClass = signal === 'yellow' ? 'animate-hp-breath' : signal === 'red' ? 'animate-hp-danger' : '';

  return (
    <div className={`${compact ? 'h-4 w-32' : 'h-5 w-full'} pixel-meter relative overflow-hidden rounded-sm bg-slate-900/10 shadow-inner dark:bg-black/35`}>
      <div
        className={`pixel-meter-fill h-full rounded-sm bg-gradient-to-r ${signalFill[signal]} ${animationClass} transition-[width] duration-500`}
        style={{ width: `${hpPercent}%` }}
      />
    </div>
  );
}

function HeartIcon({ signal, size = 'text-4xl' }: { signal: Signal; size?: string }) {
  const animationClass = signal === 'yellow' ? 'animate-heart-breath' : signal === 'red' ? 'animate-heart-danger' : '';
  return <i className={`hn hn-heart-solid pixel-icon ${size} ${signalIconClass[signal]} ${animationClass}`} />;
}

function PeriodCard({ kind, period, payload }: { kind: PeriodKind; period?: UsagePeriod; payload: UsagePayload | null }) {
  const signal = getSignal(payload, period?.percent);
  const hpPercent = getHpPercent(payload, period?.percent);

  return (
    <div className={`pixel-card min-w-0 rounded-lg p-4 ${signal === 'red' ? 'pixel-alert' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="truncate text-sm font-black tracking-wide text-slate-700 dark:text-slate-100">{periodTitle[kind]}</div>
        <span className={`pixel-badge ${signal}`}>{signal.toUpperCase()}</span>
      </div>
      <div className="mt-4 flex min-w-0 items-center gap-3">
        <HeartIcon signal={signal} />
        <div className="min-w-0 flex-1">
          <div className={`font-mono text-4xl font-black leading-none tracking-tight ${signalText[signal]}`}>{formatPercent(hpPercent)}</div>
          <div className="mt-3">
            <ProgressBar payload={payload} usedPercent={period?.percent} signal={signal} />
          </div>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-2 text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
        <span>RESET</span>
        <span className="font-mono text-sm normal-case text-slate-700 dark:text-slate-100">◷ {formatCountdown(period?.reset_at)}</span>
      </div>
    </div>
  );
}

function useUsageData() {
  const [payload, setPayload] = useState<UsagePayload | null>(null);
  const [refreshMinutes, setRefreshMinutes] = useState<(typeof refreshOptions)[number]>(5);
  const [loading, setLoading] = useState(false);
  const [, setTick] = useState(0);

  const refreshUsage = useCallback(async () => {
    setLoading(true);
    try {
      setPayload(await invoke<UsagePayload>('fetch_usage'));
    } catch (error) {
      setPayload({
        ok: false,
        message: `调用主进程失败：${String(error)}`,
        product: 'coding-plan',
        version: 'personal',
        region: 'cn-beijing',
        periods: [],
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshUsage();
  }, [refreshUsage]);

  useEffect(() => {
    const timer = window.setInterval(refreshUsage, refreshMinutes * 60_000);
    return () => window.clearInterval(timer);
  }, [refreshUsage, refreshMinutes]);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return { payload, refreshMinutes, setRefreshMinutes, loading, refreshUsage };
}

function MainWindow() {
  const { payload, refreshMinutes, setRefreshMinutes, loading, refreshUsage } = useUsageData();
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);
  const [compactMode, setCompactMode] = useState<CompactMode>('auto');
  const dragRef = useRef<{ startX: number; startY: number; dragging: boolean } | null>(null);
  const ignoreClickRef = useRef(false);
  const displayPeriod = useMemo(
    () => (compactMode === 'auto' ? getWorstPeriod(payload) : getPeriod(payload, compactMode)),
    [compactMode, payload],
  );
  const signal = getSignal(payload, displayPeriod?.percent);
  const displayHp = getHpPercent(payload, displayPeriod?.percent);

  useEffect(() => {
    void getDockPosition(compactWidth).then((position) => appWindow.setPosition(position));
    void appWindow.setSize(compactSize);
  }, []);

  useEffect(() => {
    let snapping = false;
    let snapTimer: number | undefined;

    const unlistenPromise = appWindow.onMoved(({ payload }) => {
      if (snapping || payload.y === 0) return;

      if (snapTimer) window.clearTimeout(snapTimer);
      snapTimer = window.setTimeout(() => {
        snapping = true;
        void appWindow.setPosition(new PhysicalPosition(payload.x, 0)).finally(() => {
          snapping = false;
        });
      }, 180);
    });

    return () => {
      if (snapTimer) window.clearTimeout(snapTimer);
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  const prepareNativeDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('[data-no-drag]')) return;
    dragRef.current = { startX: event.screenX, startY: event.screenY, dragging: false };
  };

  const maybeStartNativeDrag = async (event: React.PointerEvent<HTMLElement>) => {
    if (!dragRef.current || dragRef.current.dragging) return;
    const distanceX = Math.abs(event.screenX - dragRef.current.startX);
    const distanceY = Math.abs(event.screenY - dragRef.current.startY);
    if (distanceX < 4 && distanceY < 4) return;

    dragRef.current.dragging = true;
    ignoreClickRef.current = true;
    await appWindow.startDragging();
  };

  const finishNativeDrag = () => {
    dragRef.current = null;
  };

  const togglePin = async () => {
    const next = !alwaysOnTop;
    setAlwaysOnTop(next);
    await invoke('set_always_on_top', { enabled: next });
  };

  const openNativeMenu = async () => {
    const menu = await Menu.new({
      items: [
        { id: 'refresh', text: loading ? '刷新中...' : '手动刷新', action: () => void refreshUsage() },
        { item: 'Separator' },
        ...refreshOptions.map((minute) => ({
          id: `interval-${minute}`,
          text: `${minute} 分钟刷新${refreshMinutes === minute ? ' ✓' : ''}`,
          action: () => setRefreshMinutes(minute),
        })),
        { item: 'Separator' },
        { id: 'mode-auto', text: `${compactModeTitle.auto}${compactMode === 'auto' ? ' ✓' : ''}`, action: () => setCompactMode('auto') },
        ...periodKinds.map((kind) => ({
          id: `mode-${kind}`,
          text: `${compactModeTitle[kind]}${compactMode === kind ? ' ✓' : ''}`,
          action: () => setCompactMode(kind),
        })),
        { item: 'Separator' },
        { id: 'dock', text: '吸附顶部', action: () => void getDockPosition(compactWidth).then((position) => appWindow.setPosition(position)) },
        { id: 'pin', text: alwaysOnTop ? '取消置顶' : '置顶', action: () => void togglePin() },
        { id: 'tray', text: '最小化到托盘', action: () => void invoke('minimize_to_tray') },
        { item: 'Separator' },
        { id: 'close', text: '关闭', action: () => void appWindow.close() },
      ],
    });
    await menu.popup(undefined, appWindow);
  };

  const openDetailWindow = async () => {
    if (ignoreClickRef.current) {
      ignoreClickRef.current = false;
      return;
    }

    const position = await getDockPosition(detailWidth, 72, 96);
    await invoke('toggle_detail_window', { x: position.x, y: position.y });
  };

  return (
    <section
      onPointerDown={prepareNativeDrag}
      onPointerMove={(event) => void maybeStartNativeDrag(event)}
      onPointerUp={finishNativeDrag}
      onPointerCancel={finishNativeDrag}
      onContextMenu={(event) => {
        event.preventDefault();
        void openNativeMenu();
      }}
      className="relative h-screen w-screen cursor-ew-resize overflow-hidden text-slate-900 dark:text-slate-50"
    >
      <button
        onClick={() => void openDetailWindow()}
        className={`pixel-hud group absolute left-0 top-0 px-4 py-2.5 ${signal === 'red' ? 'pixel-alert' : ''}`}
      >
        <span className="pixel-spark left-4 top-2" />
        <span className="pixel-spark right-10 bottom-2 animation-delay-300" />
        <div className="relative z-10 flex items-center gap-2.5">
          <HeartIcon signal={signal} size="text-[26px]" />
          <span className="text-sm font-black tracking-tight">HP</span>
          <span className="w-8 text-center text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">{compactModeShortTitle[compactMode]}</span>
          <span className={`w-11 text-right font-mono text-sm font-black ${signalText[signal]}`}>{formatPercent(displayHp)}</span>
          <ProgressBar payload={payload} usedPercent={displayPeriod?.percent} signal={signal} compact />
          <span className="text-slate-500 dark:text-slate-400">⌄</span>
        </div>
      </button>

    </section>
  );
}

function DetailWindow() {
  const { payload, refreshMinutes, loading } = useUsageData();
  const monthly = useMemo(() => getPeriod(payload, 'monthly'), [payload]);
  const signal = getSignal(payload, monthly?.percent);
  const monthlyHp = getHpPercent(payload, monthly?.percent);
  const healthy = payload?.ok === true;

  const startDrag = async (event: React.PointerEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-no-drag]')) return;
    await appWindow.startDragging();
  };

  return (
    <section onPointerDown={startDrag} className="h-screen w-screen cursor-move overflow-hidden p-0 text-slate-900 dark:text-slate-50">
      <div className={`pixel-panel h-full w-full p-4 ${signal === 'red' ? 'pixel-alert' : ''}`}>
        <span className="pixel-spark left-8 top-7" />
        <span className="pixel-spark right-16 top-10 animation-delay-300" />
        <header className="relative z-10 flex h-16 items-center gap-4 border-b border-slate-900/10 pb-3 dark:border-white/10">
          <div className="flex items-center gap-2">
            <HeartIcon signal={signal} size="text-[38px]" />
            <span className="text-xl font-black tracking-wide">HP</span>
          </div>
          <div className={`w-20 font-mono text-4xl font-black leading-none ${signalText[signal]}`}>{formatPercent(monthlyHp)}</div>
          <div className="min-w-0 flex-1">
            <div className="mb-1 text-sm font-bold text-slate-600 dark:text-slate-300">月度套餐剩余</div>
            <ProgressBar payload={payload} usedPercent={monthly?.percent} signal={signal} />
          </div>
          <div className="w-48 border-l border-slate-200/70 pl-4 text-right dark:border-white/10">
            <div className="text-xs font-bold text-slate-500 dark:text-slate-400">恢复倒计时</div>
            <div className="mt-1 whitespace-nowrap font-mono text-sm font-bold text-sky-500">◷ {formatCountdown(monthly?.reset_at)}</div>
          </div>
          <button data-no-drag className="pixel-close px-2 text-xl" onClick={() => void invoke('hide_detail_window')}>×</button>
        </header>

        <main className="relative z-10 mt-3 grid h-[204px] grid-cols-3 gap-3 overflow-hidden">
          {periodKinds.map((kind) => (
            <PeriodCard key={kind} kind={kind} period={getPeriod(payload, kind)} payload={payload} />
          ))}
        </main>

        <footer className="relative z-10 mt-3 flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
          <span className="truncate">copyright @siroi</span>
          <span className="shrink-0">{loading ? '刷新中' : `${refreshMinutes}m 自动刷新`}</span>
        </footer>
      </div>
    </section>
  );
}

createRoot(document.getElementById('app')!).render(isDetailWindow ? <DetailWindow /> : <MainWindow />);
